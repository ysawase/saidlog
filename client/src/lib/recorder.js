// MediaRecorder ラッパー。
// timeslice 5秒でチャンクを受け取り、メモリ保持と並行して recordingDb へ
// 逐次保存する（ブラウザクラッシュ時は IndexedDB 側から復元）。
// 録音中は Wake Lock で画面消灯を防ぐ（非対応ブラウザでは黙ってスキップ）。
import { saveChunk } from './recordingDb.js';

const MIME_CANDIDATES = ['audio/webm', 'audio/mp4'];
const TIMESLICE_MS = 5000;
const AUDIO_BITS_PER_SECOND = 64000; // 音声向け低ビットレート（50MB上限内で約100分）
const SIZE_WARNING_BYTES = 45 * 1024 * 1024; // 50MB制限への事前警告ライン

/** 対応MIMEタイプを audio/webm → audio/mp4 の優先順で返す。非対応なら null */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

/** MIMEタイプから保存用の拡張子を返す */
export function extensionOf(mimeType) {
  return mimeType === 'audio/mp4' ? 'mp4' : 'webm';
}

/** 録音ファイルの共通ファイル名（SaidLog-YYYYMMDD-HHmm.拡張子）を返す */
export function recordingFileName(mimeType) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `SaidLog-${stamp}.${extensionOf(mimeType)}`;
}

/** Blobを端末にダウンロード保存する */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 録音セッションを作成する。
 * @param {{ onSizeWarning?: () => void }} [callbacks]
 *   onSizeWarning: チャンク累計が45MBに達したとき一度だけ呼ばれる
 */
export function createRecorder({ onSizeWarning } = {}) {
  let stream = null;
  let mediaRecorder = null;
  let wakeLock = null;
  let sessionId = null;
  let mimeType = null;
  let startedAt = 0;
  let seq = 0;
  let totalBytes = 0;
  let sizeWarned = false;
  const chunks = [];

  async function acquireWakeLock() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      // 非対応・拒否時は注意書きでカバーする方針のため握りつぶす
      wakeLock = null;
    }
  }

  function handleVisibilityChange() {
    // バックグラウンドから復帰すると Wake Lock は解放されているため再取得する
    if (document.visibilityState === 'visible' && mediaRecorder?.state === 'recording') {
      acquireWakeLock();
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLock?.release();
    } catch {
      // 解放失敗は無視してよい
    }
    wakeLock = null;
  }

  /**
   * マイク取得から録音開始までを行う。
   * @returns {Promise<{ sessionId: string, mimeType: string }>}
   * @throws マイク拒否・MediaRecorder非対応時
   */
  async function start() {
    mimeType = pickMimeType();
    if (!mimeType) {
      throw new Error('このブラウザは録音に対応していません');
    }
    // 会議室の収音はデバイス差が大きいため加工なしの素の音声を取得する
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false },
    });

    sessionId = crypto.randomUUID();
    seq = 0;
    totalBytes = 0;
    sizeWarned = false;
    chunks.length = 0;

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    mediaRecorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      chunks.push(e.data);
      totalBytes += e.data.size;
      // クラッシュ対策のバックアップ。保存失敗で録音は止めない
      saveChunk(sessionId, seq, e.data, mimeType).catch(() => {});
      seq += 1;
      if (!sizeWarned && totalBytes >= SIZE_WARNING_BYTES) {
        sizeWarned = true;
        onSizeWarning?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    await acquireWakeLock();

    startedAt = Date.now();
    mediaRecorder.start(TIMESLICE_MS);
    return { sessionId, mimeType };
  }

  /**
   * 録音を停止し、全チャンクを連結した Blob を返す。
   * @returns {Promise<{ blob: Blob, sessionId: string, mimeType: string, durationMs: number }>}
   */
  function stop() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        reject(new Error('録音していません'));
        return;
      }
      mediaRecorder.onstop = () => {
        const durationMs = Date.now() - startedAt;
        const blob = new Blob(chunks, { type: mimeType });
        cleanup();
        resolve({ blob, sessionId, mimeType, durationMs });
      };
      mediaRecorder.onerror = (e) => {
        cleanup();
        reject(e.error || new Error('録音中にエラーが発生しました'));
      };
      mediaRecorder.stop();
    });
  }

  function cleanup() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    releaseWakeLock();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    mediaRecorder = null;
  }

  return {
    start,
    stop,
    get totalBytes() {
      return totalBytes;
    },
  };
}
