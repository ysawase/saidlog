import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import FormData from 'form-data';
import fetch from 'node-fetch';

const ASYNC_API_BASE = 'https://acp-api-async.amivoice.com/v2/recognitions';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

// AmiVoiceが受け付けない形式はffmpegでWAVに変換する
const CONVERT_EXTENSIONS = new Set(['m4a', 'webm', 'mp4']);

async function convertToWav(buffer, ext) {
  const id = randomUUID();
  const inputPath = path.join(os.tmpdir(), `saidlog-${id}.${ext}`);
  const outputPath = path.join(os.tmpdir(), `saidlog-${id}.wav`);
  try {
    await writeFile(inputPath, buffer);
    await new Promise((resolve, reject) => {
      // ffmpeg-staticのバイナリを優先し、未対応環境ではPATH上のffmpegにフォールバック
      const ffmpeg = spawn(ffmpegStatic ?? 'ffmpeg', ['-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', outputPath]);
      let stderr = '';
      ffmpeg.stderr.on('data', (d) => { stderr += d; });
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 変換失敗 (exit ${code}): ${stderr.slice(-500)}`));
      });
    });
    return await readFile(outputPath);
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}

export async function transcribe({ audio, language, filename }) {
  const appkey = process.env.AMIVOICE_APPKEY;
  if (!appkey) throw new Error('AMIVOICE_APPKEY が設定されていません');

  const form = new FormData();
  form.append('u', appkey);
  form.append('d', 'grammarFileNames=-a-general speakerDiarization=True diarizationMinSpeaker=1 diarizationMaxSpeaker=8');

  let audioBuffer = audio;
  if (typeof audio === 'string') {
    const audioRes = await fetch(audio);
    if (!audioRes.ok) {
      throw new Error(`AmiVoice: 音声のダウンロードに失敗しました: ${audioRes.status}`);
    }
    audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  }

  const ext = filename ? path.extname(filename).slice(1).toLowerCase() : '';
  if (CONVERT_EXTENSIONS.has(ext)) {
    audioBuffer = await convertToWav(audioBuffer, ext);
  }

  form.append('a', audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });

  const submitRes = await fetch(ASYNC_API_BASE, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`AmiVoice ジョブ投入失敗: ${submitRes.status} ${text}`);
  }

  const submitJson = await submitRes.json();
  console.log('AmiVoice submit response:', submitJson);
  const { sessionid } = submitJson;
  if (!sessionid) {
    throw new Error(`AmiVoice ジョブ投入失敗: code=${submitJson.code} message=${submitJson.message}`);
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${ASYNC_API_BASE}/${sessionid}`, {
      headers: { 'Authorization': `Bearer ${appkey}` },
    });

    if (!pollRes.ok) continue;

    const result = await pollRes.json();

    if (result.status === 'error') {
      throw new Error(`AmiVoice 認識エラー: ${result.message ?? JSON.stringify(result)}`);
    }

    if (result.status !== 'completed') continue;

    const tokens = (result.segments ?? []).flatMap((seg) =>
      (seg.results ?? []).flatMap((r) => r.tokens ?? [])
    );

    const utterances = [];
    for (const token of tokens) {
      const last = utterances[utterances.length - 1];
      if (last && last.speaker === token.label) {
        last.text += token.written ?? '';
        last.endMs = token.endtime ?? last.endMs;
      } else {
        utterances.push({
          speaker: token.label ?? 'speaker0',
          text: token.written ?? '',
          startMs: token.starttime ?? 0,
          endMs: token.endtime ?? 0,
        });
      }
    }

    const audioDurationSec = result.audioFileDuration ?? null;

    return { utterances, audioDurationSec };
  }

  throw new Error('AmiVoice: タイムアウトしました（10分超過）');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}