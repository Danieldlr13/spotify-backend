import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  searchVideos,
  getVideoDetails,
  getRelatedVideos,
  getPlaylistItems,
  searchChannels,
  getChannelDetails,
  getChannelVideos,
  getApiKeysStatus,
  resetApiKey,
  resetAllApiKeys
} from '../controllers/youtubeController.js';

const router = express.Router();

// Rate limiter específico para búsquedas (aumentado para permitir carga inicial)
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // 100 búsquedas por minuto por IP (suficiente para carga inicial + navegación)
  message: {
    error: 'Demasiadas búsquedas, espera un momento',
    retryAfter: '1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Video endpoints
router.get('/search', searchLimiter, searchVideos);
router.get('/video/:videoId', getVideoDetails);
router.get('/related/:videoId', getRelatedVideos);
router.get('/playlist/:playlistId', getPlaylistItems);

// Channel endpoints
router.get('/channels/search', searchLimiter, searchChannels);
router.get('/channel/:channelId', getChannelDetails);
router.get('/channel/:channelId/videos', getChannelVideos);

// API Keys management endpoints
router.get('/keys/status', getApiKeysStatus);
router.post('/keys/reset/:keyIndex', resetApiKey);
router.post('/keys/reset-all', resetAllApiKeys);

export default router;
