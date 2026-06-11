import { AssemblyAI } from 'assemblyai';
import { removeFillers } from '../utils/removeFillers.js';

let client = null;

function getClient() {
  if (!client) {
    client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
  }
  return client;
}

/**
 * 音声バッファをAssemblyAIに送り、話者識別付きの文字起こし結果を返す。
 * SDKがアップロードと完了までのポーリングを行う。
 */
export async function transcribeAudio(audioBuffer) {
  const transcript = await getClient().transcripts.transcribe({
    audio: audioBuffer,
    speech_models: ['universal-3-pro', 'universal-2'],
    language_code: 'ja',
    speaker_labels: true,
  });

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAIエラー: ${transcript.error}`);
  }

  const utterances = (transcript.utterances ?? [])
    .map((u) => ({
      speaker: u.speaker,
      text: removeFillers(u.text),
      start: u.start,
      end: u.end,
    }))
    .filter((u) => u.text.length > 0);

  return {
    id: transcript.id,
    text: removeFillers(transcript.text ?? ''),
    utterances,
  };
}
