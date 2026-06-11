// Supabase Storage への直接アップロード。
// supabase-js の標準アップロードは進捗イベント非対応のため、
// Storage REST API へ XHR でPOSTする（認証は同じくanonキー＋RLS INSERTポリシー）。
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
 * @param {(percent: number) => void} [onProgress] 0-100
 * @returns {Promise<string>} アップロード先の filePath（{uuid}/{ファイル名}）
 */
export function uploadAudio(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      reject(new Error('Supabaseの接続設定がありません（client/.env の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認）'));
      return;
    }
    const filePath = `${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`);
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Content-Type', contentTypeOf(file));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(filePath);
      } else {
        reject(new Error(`アップロードに失敗しました（HTTP ${xhr.status}）`));
      }
    };
    xhr.onerror = () => reject(new Error('アップロードに失敗しました（ネットワークエラー）'));
    xhr.send(file);
  });
}
