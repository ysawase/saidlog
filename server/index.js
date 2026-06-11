// ローカル開発用エントリポイント。Vercel上では api/index.js が使われる。
import app from './app.js';

const PORT = process.env.PORT || 3000;

if (!process.env.ASSEMBLYAI_API_KEY) {
  console.warn('[警告] ASSEMBLYAI_API_KEY が設定されていません。server/.env を作成してください。');
}

app.listen(PORT, () => {
  console.log(`Meetlog server: http://localhost:${PORT}`);
});
