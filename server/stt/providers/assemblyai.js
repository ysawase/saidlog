import { AssemblyAI } from 'assemblyai';

let client = null;

function getClient() {
  if (!client) {
    client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
  }
  return client;
}

/**
 * AssemblyAI実装。SDKがアップロード（バッファ時）と完了までのポーリングを行う。
 * 戻り値は server/stt/index.js のプロバイダー共通形式。
 */
export async function transcribe({ audio, language }) {
  const transcript = await getClient().transcripts.transcribe({
    audio,
    speech_models: ['universal-3-pro', 'universal-2'],
    language_code: language,
    speaker_labels: true,
  });

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAIエラー: ${transcript.error}`);
  }

  return {
    utterances: (transcript.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      text: u.text,
      startMs: u.start,
      endMs: u.end,
    })),
    audioDurationSec: transcript.audio_duration ?? null,
  };
}
