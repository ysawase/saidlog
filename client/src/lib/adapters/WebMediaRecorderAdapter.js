import { createRecorder, pickMimeType } from '../recorder.js';

/** @import { AdapterCallbacks, RecordingResult } from './types.js' */

export class WebMediaRecorderAdapter {
  #recorder = null;
  #callbacks;

  /** @param {AdapterCallbacks} [callbacks] */
  constructor(callbacks = {}) {
    this.#callbacks = callbacks;
  }

  /** @returns {Promise<boolean>} */
  async canRecord() {
    return pickMimeType() !== null;
  }

  /** @returns {Promise<boolean>} */
  async requestPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  /** @returns {Promise<void>} */
  async start() {
    this.#recorder = createRecorder({ onSizeWarning: this.#callbacks.onSizeWarning });
    await this.#recorder.start();
  }

  /** @returns {Promise<RecordingResult>} */
  async stop() {
    const { blob, mimeType, durationMs } = await this.#recorder.stop();
    this.#recorder = null;
    return { blob, mimeType, durationMs };
  }

  /** @returns {Promise<void>} */
  async cancel() {
    try {
      await this.#recorder?.stop();
    } catch {
      // 結果は捨てる
    }
    this.#recorder = null;
  }

  get totalBytes() {
    return this.#recorder?.totalBytes ?? 0;
  }
}
