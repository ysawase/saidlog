export { uploadAudio } from './lib/storage.js';

/**
 * アップロード済みファイルのパスを渡して文字起こしを依頼する。
 * 音声データ本体はSupabase Storage経由でAssemblyAIに渡るため、ここを通らない。
 * 長い会議は処理に数分かかることがある。
 */
export async function requestTranscription(filePath) {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `文字起こしに失敗しました（HTTP ${res.status}）`);
  }
  return res.json();
}
