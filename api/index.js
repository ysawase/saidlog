// Vercel Functions のエントリポイント。
// vercel.json の rewrites で /api/* がこの関数に集約され、
// ルーティングは Express アプリ側（/api/health, /api/transcribe）が行う。
import app from '../server/app.js';

export default app;
