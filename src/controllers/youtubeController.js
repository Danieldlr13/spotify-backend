import axios from 'axios';
import axiosRetry from 'axios-retry';
import { LRUCache } from 'lru-cache';
import { getApiKeyManager } from '../utils/apiKeyManager.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Configurar retry logic para axios
axiosRetry(axios, {
  retries: 3, // 3 reintentos
  retryDelay: axiosRetry.exponentialDelay, // Delay exponencial: 1s, 2s, 4s
  retryCondition: (error) => {
    // Reintentar en errores de red o errores 5xx del servidor
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           error.response?.status === 503 ||
           error.response?.status === 429; // También reintentar en rate limit temporal
  },
  onRetry: (retryCount, error) => {
    console.log(`🔄 Reintentando request (${retryCount}/3):`, error.message);
  }
});

// Configurar LRU cache
const cache = new LRUCache({
  max: 500, // Máximo 500 entradas
  ttl: 1000 * 60 * 30, // 30 minutos TTL
  updateAgeOnGet: true
});

const getCurrentApiKey = () => {
  const key = getApiKeyManager().getCurrentKey();
  const info = getApiKeyManager().getCurrentKeyInfo();
  console.log(`🔑 Usando API Key #${info.index}/${info.total}`);
  return key;
};

// Función helper para manejar errores de API (log + delegar)
const handleApiError = (error) => {
  const keyManager = getApiKeyManager();
  console.log('❌ Error de API detectado:', {
    status: error.response?.status,
    code: error.response?.data?.error?.code,
    message: error.response?.data?.error?.message || error.message
  });

  keyManager.handleApiError(error);
  // Re-lanzar para que el caller pueda decidir
  throw error;
};

// Función helper para marcar request exitoso
const markRequestSuccess = () => {
  getApiKeyManager().resetCurrentKeyErrors();
};

// Función para hacer peticiones con rotación automática de keys
const makeApiRequestWithKeyRotation = async (url, params = {}, maxRetries = 3) => {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const apiKey = getCurrentApiKey();
      const response = await axios.get(url, { params: { ...params, key: apiKey } });
      markRequestSuccess();
      return response;
    } catch (error) {
      lastError = error;
      const statusCode = error.response?.status;

      // Si es error de cuota/rate limit, rotar y reintentar
      if (statusCode === 429 || statusCode === 403) {
        console.log(`⚠️  Error ${statusCode} detectado, rotando key... (intento ${attempt + 1}/${maxRetries})`);
        try {
          handleApiError(error);
        } catch (e) {
          // handleApiError re-lanza; continuar para intentar con nueva key
        }

        if (attempt < maxRetries - 1) {
          // short backoff
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      }

      // No es error de cuota o no quedan reintentos
      throw error;
    }
  }

  throw lastError;
};

// Función helper para obtener/guardar en caché
const getCachedOrFetch = async (cacheKey, fetchFunction) => {
  const cached = cache.get(cacheKey);
  
  if (cached) {
    console.log(`✅ Cache HIT: ${cacheKey}`);
    return cached;
  }
  
  console.log(`❌ Cache MISS: ${cacheKey} - Fetching from API`);
  const data = await fetchFunction();
  
  // LRU cache automáticamente maneja el límite de tamaño
  cache.set(cacheKey, data);
  
  return data;
};

// Buscar videos
export const searchVideos = async (req, res) => {
  try {
    const { q, maxResults = 20, type = 'video' } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Clave de caché basada en query
    const cacheKey = `search:${q}:${maxResults}:${type}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      // Usar función que rota keys automáticamente en caso de 429/403
      const response = await makeApiRequestWithKeyRotation(`${YOUTUBE_API_BASE}/search`, {
        part: 'snippet',
        q: q,
        type: type,
        maxResults: maxResults,
        videoCategoryId: '10'
      });

      // Obtener IDs de videos
      const videoIds = response.data.items
        .map(item => item.id.videoId)
        .filter(Boolean)
        .join(',');

      // Obtener detalles adicionales (duración, estadísticas)
      let detailedItems = response.data.items;
      if (videoIds) {
        const detailsResponse = await makeApiRequestWithKeyRotation(`${YOUTUBE_API_BASE}/videos`, {
          part: 'contentDetails,statistics',
          id: videoIds
        });

        // Combinar datos
        detailedItems = response.data.items.map(item => {
          const details = detailsResponse.data.items.find(
            d => d.id === item.id.videoId
          );
          return {
            ...item,
            contentDetails: details?.contentDetails,
            statistics: details?.statistics
          };
        });
      }

      markRequestSuccess();

      return {
        items: detailedItems,
        pageInfo: response.data.pageInfo
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error searching videos:', error.response?.data || error.message);
    const errorMessage = error.response?.data?.error?.message || error.message;
    
    // Mensaje más claro para errores de cuota
    if (errorMessage.includes('quota')) {
      return res.status(429).json({ 
        error: 'Cuota de API agotada',
        details: 'Has excedido el límite diario de 10,000 unidades. Se reinicia a medianoche PST.',
        help: 'Considera crear un nuevo proyecto en Google Cloud Console para obtener otra cuota.'
      });
    }
    
    // Mensaje más claro para errores de API Key
    if (errorMessage.includes('unregistered callers') || errorMessage.includes('API key')) {
      return res.status(500).json({ 
        error: 'API Key no configurada correctamente',
        details: 'Por favor habilita YouTube Data API v3 en Google Cloud Console',
        help: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com'
      });
    }
    
    res.status(500).json({ 
      error: 'Error searching videos',
      details: errorMessage
    });
  }
};

// Obtener detalles de un video
export const getVideoDetails = async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const cacheKey = `video:${videoId}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      const apiKey = getCurrentApiKey();
      
      const response = await makeApiRequestWithKeyRotation(`${YOUTUBE_API_BASE}/videos`, {
        part: 'snippet,contentDetails,statistics',
        id: videoId
      });

      if (response.data.items.length === 0) {
        throw new Error('Video not found');
      }

      markRequestSuccess();
      return response.data.items[0];
    });

    res.json(result);
  } catch (error) {
    console.error('Error getting video details:', error.response?.data || error.message);
    
    if (error.message === 'Video not found') {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.status(500).json({ 
      error: 'Error getting video details',
      details: error.response?.data?.error?.message || error.message
    });
  }
};

// Obtener videos relacionados
export const getRelatedVideos = async (req, res) => {
  try {
    const { videoId } = req.params;
    const { maxResults = 10 } = req.query;

    const cacheKey = `related:${videoId}:${maxResults}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      const apiKey = getCurrentApiKey();
      
      const response = await makeApiRequestWithKeyRotation(`${YOUTUBE_API_BASE}/search`, {
        part: 'snippet',
        relatedToVideoId: videoId,
        type: 'video',
        maxResults: maxResults
      });

      markRequestSuccess();
      return response.data;
    });

    res.json(result);
  } catch (error) {
    console.error('Error getting related videos:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Error getting related videos',
      details: error.response?.data?.error?.message || error.message
    });
  }
};

// Obtener items de una playlist
export const getPlaylistItems = async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { maxResults = 20 } = req.query;

    const cacheKey = `playlist:${playlistId}:${maxResults}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      const apiKey = getCurrentApiKey();
      
      const response = await makeApiRequestWithKeyRotation(`${YOUTUBE_API_BASE}/playlistItems`, {
        part: 'snippet,contentDetails',
        playlistId: playlistId,
        maxResults: maxResults
      });

      markRequestSuccess();
      return response.data;
    });

    res.json(result);
  } catch (error) {
    console.error('Error getting playlist items:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Error getting playlist items',
      details: error.response?.data?.error?.message || error.message
    });
  }
};

// Buscar canales/artistas
export const searchChannels = async (req, res) => {
  try {
    const { q, maxResults = 20 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const cacheKey = `channels:search:${q}:${maxResults}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      const apiKey = getCurrentApiKey();
      
      const response = await axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: {
          part: 'snippet',
          q: q,
          type: 'channel',
          maxResults: maxResults,
          key: apiKey
        }
      }).catch(error => {
        handleApiError(error);
      });

      // Obtener IDs de canales
      const channelIds = response.data.items
        .map(item => item.id.channelId)
        .filter(Boolean)
        .join(',');

      // Obtener detalles adicionales (estadísticas, branding)
      let detailedItems = response.data.items;
      if (channelIds) {
          const detailsResponse = await makeApiRequestWithKeyRotation(`${YOUTUBE_API_BASE}/channels`, {
            part: 'statistics,brandingSettings',
            id: channelIds
          });

        // Combinar datos
        detailedItems = response.data.items.map(item => {
          const details = detailsResponse.data.items.find(
            d => d.id === item.id.channelId
          );
          return {
            ...item,
            statistics: details?.statistics,
            brandingSettings: details?.brandingSettings
          };
        });
      }

      markRequestSuccess();
      
      return {
        items: detailedItems,
        pageInfo: response.data.pageInfo
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error searching channels:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Error searching channels',
      details: error.response?.data?.error?.message || error.message
    });
  }
};

// Obtener detalles de un canal
export const getChannelDetails = async (req, res) => {
  try {
    const { channelId } = req.params;
    
    const cacheKey = `channel:${channelId}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      const apiKey = getCurrentApiKey();
      
      const response = await axios.get(`${YOUTUBE_API_BASE}/channels`, {
        params: {
          part: 'snippet,contentDetails,statistics,brandingSettings',
          id: channelId,
          key: apiKey
        }
      }).catch(error => {
        handleApiError(error);
      });

      if (response.data.items.length === 0) {
        throw new Error('Channel not found');
      }

      markRequestSuccess();
      return response.data.items[0];
    });

    res.json(result);
  } catch (error) {
    console.error('Error getting channel details:', error.response?.data || error.message);
    
    if (error.message === 'Channel not found') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    
    res.status(500).json({ 
      error: 'Error getting channel details',
      details: error.response?.data?.error?.message || error.message
    });
  }
};

// Obtener videos de un canal
export const getChannelVideos = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { maxResults = 20 } = req.query;

    const cacheKey = `channel:${channelId}:videos:${maxResults}`;
    
    const result = await getCachedOrFetch(cacheKey, async () => {
      const apiKey = getCurrentApiKey();
      
      const response = await axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: {
          part: 'snippet',
          channelId: channelId,
          type: 'video',
          order: 'date',
          maxResults: maxResults,
          key: apiKey
        }
      }).catch(error => {
        handleApiError(error);
      });

      // Obtener IDs de videos
      const videoIds = response.data.items
        .map(item => item.id.videoId)
        .filter(Boolean)
        .join(',');

      // Obtener detalles adicionales
      let detailedItems = response.data.items;
      if (videoIds) {
        const detailsResponse = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
          params: {
            part: 'contentDetails,statistics',
            id: videoIds,
            key: apiKey
          }
        }).catch(error => {
          handleApiError(error);
        });

        detailedItems = response.data.items.map(item => {
          const details = detailsResponse.data.items.find(
            d => d.id === item.id.videoId
          );
          return {
            ...item,
            contentDetails: details?.contentDetails,
            statistics: details?.statistics
          };
        });
      }

      markRequestSuccess();
      
      return {
        items: detailedItems,
        pageInfo: response.data.pageInfo
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error getting channel videos:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Error getting channel videos',
      details: error.response?.data?.error?.message || error.message
    });
  }
};

// Obtener estado de las API keys
export const getApiKeysStatus = async (req, res) => {
  try {
    const manager = getApiKeyManager();
    const status = manager.getAllKeysStatus();
    const currentKeyInfo = manager.getCurrentKeyInfo();
    
    res.json({
      currentKey: currentKeyInfo,
      allKeys: status,
      totalKeys: status.length
    });
  } catch (error) {
    console.error('Error getting API keys status:', error);
    res.status(500).json({ 
      error: 'Error getting API keys status',
      details: error.message
    });
  }
};

// Resetear una API key específica (admin endpoint)
export const resetApiKey = async (req, res) => {
  try {
    const { keyIndex } = req.params;
    const index = parseInt(keyIndex) - 1; // Convert to 0-based index
    
    getApiKeyManager().resetKey(index);
    
    res.json({ 
      success: true,
      message: `API Key ${keyIndex} reseteada exitosamente`
    });
  } catch (error) {
    console.error('Error resetting API key:', error);
    res.status(400).json({ 
      error: 'Error resetting API key',
      details: error.message
    });
  }
};

// Resetear todas las API keys (admin endpoint)
export const resetAllApiKeys = async (req, res) => {
  try {
    getApiKeyManager().resetAllKeys();
    
    res.json({ 
      success: true,
      message: 'Todas las API keys reseteadas exitosamente'
    });
  } catch (error) {
    console.error('Error resetting all API keys:', error);
    res.status(500).json({ 
      error: 'Error resetting all API keys',
      details: error.message
    });
  }
};
