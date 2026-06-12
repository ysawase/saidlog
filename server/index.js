// ローカル開発用エントリポイント。Vercel上では api/index.js が使われる。
import app from './app.js';

const PORT = process.env.PORT || 3000;

const provider = process.env.STT_PROVIDER || 'assemblyai';
const requiredKey = provider === 'amivoice' ? 'AMIVOICE_APPKEY' : 'ASSEMBLYAI_API_KEY';
if (!process.env[requiredKey]) {
  console.warn(`[警告] ${requiredKey} が設定されていません。server/.env を確認してください。`);
}

app.listen(PORT, () => {
  console.log(`SaidLog server: http://localhost:${PORT}`);
});
