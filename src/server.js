import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// IMPORTANTE: Cargar variables de entorno ANTES de cualquier otro import
// Solo en desarrollo (si existe el archivo .env)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: join(__dirname, '..', '.env') });
}

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import youtubeRoutes from './routes/youtube.js';
import lyricsRoutes from './routes/lyrics.js';

const app = express();
const PORT = process.env.PORT || 3001;

// IMPORTANTE: Trust proxy para Railway
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting - Protección general de API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP cada 15 minutos
  message: {
    error: 'Demasiadas solicitudes desde esta IP, intenta más tarde'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Skip rate limiting para health checks
    return req.path === '/health';
  }
});

// Rate limiting específico para búsquedas (más estricto)
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 20, // 20 búsquedas por minuto
  message: {
    error: 'Demasiadas búsquedas, espera un momento'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    return req.path === '/health';
  }
});

// Aplicar rate limiting general a todas las rutas API
app.use('/api/', apiLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT });
});

// Routes
app.use('/api/youtube', searchLimiter, youtubeRoutes);
app.use('/api/lyrics', searchLimiter, lyricsRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`YouTube API Key configured: ${process.env.YOUTUBE_API_KEY ? '✅' : '❌'}`);
});
