import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import transcribeRouter from './routes/transcribe.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY) });
});

app.use('/api', transcribeRouter);

// multer のファイルサイズ超過などをJSONで返す
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'ファイルサイズが大きすぎます（上限200MB）' });
  }
  res.status(500).json({ error: err.message || 'サーバーエラーが発生しました' });
});

if (!process.env.ASSEMBLYAI_API_KEY) {
  console.warn('[警告] ASSEMBLYAI_API_KEY が設定されていません。server/.env を作成してください。');
}

app.listen(PORT, () => {
  console.log(`Meetlog server: http://localhost:${PORT}`);
});
