import fetch from 'node-fetch';
import FormData from 'form-data';
import path from 'node:path';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

/**
 * Groq Whisper v3 Turbo実装。
 * 話者分離なし。全発言をspeaker0として返す。
 * 戻り値はserver/stt/index.jsのプロバイダー共通形式。
 */
export async function transcribe({ audio, language = 'ja', filename }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY が設定されていません');

  // audioがURLの場合はバッファに変換（GroqはURL直接受付不可）
  let audioBuffer = audio;
  if (typeof audio === 'string') {
    const audioRes = await fetch(audio);
    if (!audioRes.ok) {
      throw new Error(`Groq: 音声のダウンロードに失敗しました: ${audioRes.status}`);
    }
    audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  }

  const ext = filename ? path.extname(filename).slice(1).toLowerCase() : 'wav';
  const mimeType = ext === 'mp3' ? 'audio/mpeg'
    : ext === 'mp4' ? 'audio/mp4'
    : ext === 'm4a' ? 'audio/mp4'
    : ext === 'webm' ? 'audio/webm'
    : 'audio/wav';

  const form = new FormData();
  form.append('file', audioBuffer, { filename: filename ?? `audio.${ext}`, contentType: mimeType });
  form.append('model', MODEL);
  form.append('language', language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq STTエラー: ${res.status} ${text}`);
  }

  const data = await res.json();

  // verbose_jsonのsegmentsから発言リストを構築。話者分離なしのためspeaker0固定。
  const segments = data.segments ?? [];
  const utterances = segments.map((seg) => ({
    speaker: 'speaker0',
    text: seg.text?.trim() ?? '',
    startMs: Math.round((seg.start ?? 0) * 1000),
    endMs: Math.round((seg.end ?? 0) * 1000),
  })).filter((u) => u.text.length > 0);

  const audioDurationSec = data.duration ?? null;

  return { utterances, audioDurationSec };
}
