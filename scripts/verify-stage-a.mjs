// ステージA完了条件のローカル検証（一時スクリプト）
// クライアントと同一経路：anonキーでStorage直接アップロード → /api/transcribe → 削除確認
import fs from 'node:fs';
import path from 'node:path';

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const clientEnv = parseEnv('client/.env');
const serverEnv = parseEnv('server/.env');
const SUPABASE_URL = clientEnv.VITE_SUPABASE_URL;
const ANON_KEY = clientEnv.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'audio-uploads';

const audioFile = process.argv[2];
const buffer = fs.readFileSync(audioFile);
console.log(`1. テストファイル: ${audioFile} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

// クライアントと同じ：anonキーで直接アップロード
const uuid = crypto.randomUUID();
const filePath = `${uuid}/${path.basename(audioFile)}`;
const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ANON_KEY}`,
    apikey: ANON_KEY,
    'Content-Type': 'audio/wav',
  },
  body: buffer,
});
if (!upRes.ok) {
  console.error(`アップロード失敗: HTTP ${upRes.status}`, await upRes.text());
  process.exit(1);
}
console.log(`2. anonキーでアップロード成功: ${filePath}`);

// anonでの読み出しが禁止されていること（RLS確認）
const readRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`, {
  headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
});
console.log(`3. anonキーでの読み出し: HTTP ${readRes.status}（400/403/404なら期待通り＝非公開）`);

// 文字起こし
console.log('4. 文字起こし実行中…');
const t0 = Date.now();
const trRes = await fetch('http://localhost:3000/api/transcribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filePath }),
});
const result = await trRes.json();
if (!trRes.ok) {
  console.error(`文字起こし失敗: HTTP ${trRes.status}`, result);
  process.exit(1);
}
console.log(`   完了 (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
fs.writeFileSync('scripts/last-result.json', JSON.stringify(result, null, 2));
console.log(`   音声長: ${result.audioDurationSec}秒 / 発言数: ${result.utterances.length}`);
for (const u of result.utterances.slice(0, 3)) {
  console.log(`   話者${u.speaker} [${Math.floor(u.startMs / 1000)}s]: ${u.text.slice(0, 60)}`);
}

// フィラー残留チェック
const joined = result.utterances.map((u) => u.text).join('');
const fillerLeft = ['えーと', 'えーっと', 'ええと', 'あのー', 'うーんと'].filter((f) => joined.includes(f));
console.log(`5. フィラー残留: ${fillerLeft.length === 0 ? 'なし ✓' : fillerLeft.join(', ')}`);

// 削除確認（service_roleキーでフォルダを照会）
const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ prefix: uuid, limit: 10 }),
});
const remaining = await listRes.json();
console.log(`6. 文字起こし後のバケット内残存ファイル: ${Array.isArray(remaining) ? remaining.length : '確認失敗'}件（0なら期待通り）`);
