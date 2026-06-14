import { AudioRecorder } from '@capgo/capacitor-audio-recorder';

/** @import { AdapterCallbacks, RecordingResult } from './types.js' */

export class NativeRecorderAdapter {
  #startedAt = 0;
  #callbacks;

  /** @param {AdapterCallbacks} [callbacks] */
  constructor(callbacks = {}) {
    this.#callbacks = callbacks;
  }

  /** @returns {Promise<boolean>} */
  async canRecord() {
    const { result } = await AudioRecorder.canDeviceVoiceRecord();
    return result;
  }

  /** @returns {Promise<boolean>} */
  async requestPermission() {
    const { result } = await AudioRecorder.requestAudioRecordingPermission();
    return result === 'granted';
  }

  /** @returns {Promise<void>} */
  async start() {
    this.#startedAt = Date.now();
    await AudioRecorder.startRecording();
  }

  /** @returns {Promise<void>} */
  async pause() {
    await AudioRecorder.pauseRecording();
  }

  /** @returns {Promise<void>} */
  async resume() {
    await AudioRecorder.resumeRecording();
  }

  /** @returns {Promise<RecordingResult>} */
  async stop() {
    const { value } = await AudioRecorder.stopRecording();
    const durationMs = Date.now() - this.#startedAt;
    if (value.filePath) {
      return { filePath: value.filePath, mimeType: value.mimeType, durationMs };
    }
    const blob = base64ToBlob(value.recordDataBase64, value.mimeType);
    return { blob, mimeType: value.mimeType, durationMs };
  }

  /** @returns {Promise<void>} */
  async cancel() {
    try {
      await AudioRecorder.stopRecording();
    } catch {
      // 結果は捨てる
    }
  }
}

/**
 * @param {string} b64
 * @param {string} mimeType
 * @returns {Blob}
 */
function base64ToBlob(b64, mimeType) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
