import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import transcribeRouter from './routes/transcribe.js';
import { supabaseConfigured } from './services/storage.js';
import { cleanupOldFiles } from './services/cleanup.js';

// server/.env を明示パスで読む（ローカル開発用。Vercel上はダッシュボードの
// 環境変数が使われ、.envが無くてもno-opになる）
// APIキーはリクエスト処理時に遅延参照されるため、import順より後の読み込みで問題ない。
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY),
    supabaseConfigured: supabaseConfigured(),
  });
});

// Vercel Cron から1日1回呼ばれる（vercel.json の crons 参照）。
// CRON_SECRET 設定時は Authorization ヘッダーを検証する。
app.get('/api/cleanup', async (req, res, next) => {
  try {
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const deleted = await cleanupOldFiles();
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

app.use('/api', transcribeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'サーバーエラーが発生しました' });
});

export default app;
