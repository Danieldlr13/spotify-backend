import express from 'express';
import { getLyrics } from '../controllers/lyricsController.js';

const router = express.Router();

router.get('/', getLyrics);

export default router;
