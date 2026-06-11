/**
 * 音声ファイルをサーバーに送信し、文字起こし結果を受け取る。
 * 長い会議は処理に数分かかることがある。
 */
export async function transcribeFile(file) {
  const formData = new FormData();
  formData.append('audio', file);

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `サーバーエラー（${res.status}）`);
  }
  return res.json();
}
