// Supabase Storage への直接アップロード。
// Capacitor WebView は ReadableStream を fetch body に渡す方法（duplex）非対応のため、
// arrayBuffer() で先読みしてから fetch に渡す。
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BUCKET = 'audio-uploads';

// Supabase Storage のオブジェクトキーは非ASCII文字で失敗することがあるため、
// ファイル名をASCII安全な形に正規化する（拡張子は保持、uuidで衝突は防止済み）
function sanitizeFileName(name) {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80);
  return (base || 'audio') + ext;
}

const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};

function contentTypeOf(file) {
  if (file.type) return file.type;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * 音声ファイルをSupabase Storageへ直接アップロードする。
 * @param {File} file
 * @param {(percent: number) => void} [onProgress] 0%（開始）と100%（完了）のみ通知
 * @returns {Promise<string>} アップロード先の filePath（{uuid}/{ファイル名}）
 */
export async function uploadAudio(file, onProgress) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabaseの接続設定がありません（client/.env の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認）');
  }

  const filePath = `${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;
  const buffer = await file.arrayBuffer();

  onProgress?.(0);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': contentTypeOf(file),
      },
      body: buffer,
    }
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`アップロードに失敗しました（HTTP ${res.status}）${msg ? ': ' + msg : ''}`);
  }

  onProgress?.(100);
  return filePath;
}
