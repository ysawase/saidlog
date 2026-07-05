import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import transcribeRouter from './routes/transcribe.js';
import summarizeRouter from './routes/summarize.js';
import deleteAccountRouter from './routes/deleteAccount.js';
import accountRouter from './routes/account.js';
import historyRouter from './routes/history.js';
import billingRouter from './routes/billing.js';
import eventsRouter from './routes/events.js';
import { supabaseConfigured } from './services/storage.js';
import { cleanupOldFiles, runRetentionCleanup, cleanupStaleTranscribing } from './services/cleanup.js';

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
// CLEANUP_SECRET 設定時は Authorization ヘッダーを検証する。
async function handleCleanup(req, res, next) {
  try {
    const secret = process.env.CLEANUP_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const [deleted, retentionDeleted] = await Promise.all([cleanupOldFiles(), runRetentionCleanup()]);
    const staleFixed = await cleanupStaleTranscribing();
    res.json({ ok: true, deleted, retentionDeleted, staleFixed });
  } catch (err) {
    next(err);
  }
}

app.get('/api/cleanup', handleCleanup);
app.post('/api/cleanup', handleCleanup);

app.use('/api', transcribeRouter);
app.use('/api', summarizeRouter);
app.use('/api', deleteAccountRouter);
app.use('/api', accountRouter);
app.use('/api', historyRouter);
app.use('/api/billing', billingRouter);
app.use('/api', eventsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'サーバーエラーが発生しました' });
});

export default app;
