import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { transcribeAudio } from '../services/assemblyai.js';

const router = Router();

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.mp4', '.wav', '.m4a']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('対応していないファイル形式です（mp3 / mp4 / wav / m4a のみ）'));
    }
  },
});

router.post('/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '音声ファイルが選択されていません' });
    }
    if (!process.env.ASSEMBLYAI_API_KEY) {
      return res.status(500).json({ error: 'サーバーに ASSEMBLYAI_API_KEY が設定されていません' });
    }

    console.log(`文字起こし開始: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);
    const result = await transcribeAudio(req.file.buffer);
    console.log(`文字起こし完了: ${result.id} (発言数: ${result.utterances.length})`);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
