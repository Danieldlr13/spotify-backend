import axios from 'axios';
import { load } from 'cheerio';

// Usamos una combinación de APIs públicas
const GENIUS_SEARCH_URL = 'https://genius.com/api/search/multi';

// Función para limpiar el título del video
const cleanTitle = (title) => {
  // Remover contenido entre paréntesis y corchetes
  let cleaned = title
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/official\s*(video|audio|lyric|lyrics)/gi, '')
    .replace(/ft\.?|feat\.?/gi, 'featuring')
    .trim();
  
  return cleaned;
};

// Función para extraer artista y título
const extractArtistAndTitle = (videoTitle) => {
  const cleaned = cleanTitle(videoTitle);
  
  // Intentar separar por "-" o "|"
  const separators = [' - ', ' | ', ' – '];
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep);
      if (parts.length >= 2) {
        return {
          artist: parts[0].trim(),
          title: parts.slice(1).join(sep).trim()
        };
      }
    }
  }
  
  // Si no hay separador, usar el título completo
  return {
    artist: '',
    title: cleaned
  };
};

// Buscar canción en Genius (sin autenticación)
const searchGenius = async (query) => {
  try {
    // Usamos la búsqueda pública de Genius
    const response = await axios.get(GENIUS_SEARCH_URL, {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    // Buscar en las secciones de resultados
    const sections = response.data?.response?.sections || [];
    
    for (const section of sections) {
      if (section.type === 'song' && section.hits && section.hits.length > 0) {
        return section.hits[0].result;
      }
    }
    
    // Fallback: buscar en todos los hits
    for (const section of sections) {
      if (section.hits && section.hits.length > 0) {
        const songHit = section.hits.find(hit => hit.result && hit.result.url);
        if (songHit) {
          return songHit.result;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error searching Genius:', error.message);
    return null;
  }
};

// Extraer letras de la página de Genius usando scraping
const scrapeLyrics = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = load(response.data);
    
    // Genius usa diferentes selectores, intentamos varios
    let lyrics = '';
    
    // Método 1: Buscar divs con data-lyrics-container
    $('[data-lyrics-container="true"]').each((i, elem) => {
      // Remover elementos no deseados antes de extraer el texto
      $(elem).find('script, style, img, .ReferentFragmentdesktop__Highlight-sc-110r0d9-1').remove();
      lyrics += $(elem).text() + '\n\n';
    });
    
    // Método 2: Buscar por clase (backup)
    if (!lyrics) {
      $('.Lyrics__Container-sc-1ynbvzw-1, .lyrics, .Lyrics__Root-sc-1ynbvzw-0').each((i, elem) => {
        $(elem).find('script, style, img').remove();
        lyrics += $(elem).text() + '\n\n';
      });
    }
    
    // Limpiar el texto
    lyrics = lyrics
      .replace(/\[.*?\]/g, (match) => '\n' + match + '\n') // Separar etiquetas de sección
      .replace(/\n{3,}/g, '\n\n') // Reducir líneas vacías múltiples
      .replace(/^\d+\s*Contributors.*$/gm, '') // Remover línea de contributors
      .replace(/^Translations.*$/gm, '') // Remover línea de traducciones
      .replace(/^.*?Lyrics$/gm, '') // Remover título de letras
      .replace(/^Embed$/gm, '') // Remover "Embed"
      .replace(/See.*?Live$/gm, '') // Remover "See X Live"
      .replace(/Get tickets.*$/gm, '') // Remover "Get tickets"
      .replace(/^You might also like$/gm, '') // Remover "You might also like"
      .trim();
    
    return lyrics || null;
  } catch (error) {
    console.error('Error scraping lyrics:', error.message);
    return null;
  }
};

// Endpoint principal para obtener letras
export const getLyrics = async (req, res) => {
  try {
    const { videoTitle, artist, title } = req.query;
    
    if (!videoTitle && !title) {
      return res.status(400).json({ 
        success: false, 
        error: 'Se requiere videoTitle o title' 
      });
    }
    
    let searchQuery;
    let extractedData;
    
    if (videoTitle) {
      extractedData = extractArtistAndTitle(videoTitle);
      searchQuery = extractedData.artist 
        ? `${extractedData.artist} ${extractedData.title}`
        : extractedData.title;
    } else {
      searchQuery = artist ? `${artist} ${title}` : title;
    }
    
    console.log('🔍 Buscando letras para:', searchQuery);
    
    // Buscar en Genius
    const geniusResult = await searchGenius(searchQuery);
    
    if (!geniusResult) {
      return res.json({
        success: false,
        error: 'No se encontraron letras para esta canción'
      });
    }
    
    console.log('✅ Canción encontrada en Genius:', geniusResult.full_title);
    
    // Extraer letras de la página
    const lyrics = await scrapeLyrics(geniusResult.url);
    
    if (!lyrics) {
      return res.json({
        success: false,
        error: 'No se pudieron extraer las letras'
      });
    }
    
    res.json({
      success: true,
      lyrics: lyrics,
      metadata: {
        title: geniusResult.title,
        artist: geniusResult.primary_artist.name,
        url: geniusResult.url,
        thumbnail: geniusResult.song_art_image_url
      }
    });
    
  } catch (error) {
    console.error('Error in getLyrics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al buscar las letras' 
    });
  }
};
