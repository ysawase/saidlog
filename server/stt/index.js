import { transcribe as assemblyai } from './providers/assemblyai.js';
import { transcribe as amivoice } from './providers/amivoice.js';
import { transcribe as groq } from './providers/groq.js';
import { removeFillers } from '../utils/removeFillers.js';

// STTプロバイダーの抽象化レイヤー。
// 各プロバイダーは transcribe({ audio, language }) を実装し、
// { utterances: [{ speaker, text, startMs, endMs }], audioDurationSec } を返す。
// フィラー除去・日本語スペース除去などの後処理はプロバイダーの外側（ここ）で行い、
// ベンダー乗り換え時にも後処理資産を持ち運べるようにする。
const providers = {
  assemblyai,
  amivoice,
  groq,
};

/**
 * @param {object} params
 * @param {string|Buffer} params.audio - 音声URLまたはバッファ
 * @param {string} [params.language] - 言語コード（デフォルト ja）
 * @param {string} [params.filename] - 元ファイル名（拡張子による変換判定に使用）
 */
export async function transcribe({ audio, language = 'ja', filename }) {
  const providerName = process.env.STT_PROVIDER || 'assemblyai';
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`未対応のSTTプロバイダーです: ${providerName}`);
  }

  const raw = await provider({ audio, language, filename });

  const utterances = raw.utterances
    .map((u) => ({ ...u, text: removeFillers(u.text) }))
    .filter((u) => u.text.length > 0);

  return { utterances, audioDurationSec: raw.audioDurationSec };
}
