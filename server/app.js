import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import transcribeRouter from './routes/transcribe.js';

// server/.env を明示パスで読む（ローカル開発用。Vercel上はダッシュボードの
// 環境変数が使われ、.envが無くてもno-opになる）
// APIキーはリクエスト処理時に遅延参照されるため、import順より後の読み込みで問題ない。
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const app = express();

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

export default app;
