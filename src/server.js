import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// IMPORTANTE: Cargar variables de entorno ANTES de cualquier otro import
dotenv.config({ path: join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import youtubeRoutes from './routes/youtube.js';
import lyricsRoutes from './routes/lyrics.js';

const app = express();
const PORT = process.env.PORT || 3001;

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
});

// Aplicar rate limiting general a todas las rutas API
app.use('/api/', apiLimiter);

// Routes
app.use('/api/youtube', youtubeRoutes);
app.use('/api/lyrics', lyricsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
