import { Capacitor } from '@capacitor/core';
import { WebMediaRecorderAdapter } from './WebMediaRecorderAdapter.js';
import { NativeRecorderAdapter } from './NativeRecorderAdapter.js';

/** @import { AdapterCallbacks } from './types.js' */

/**
 * @param {AdapterCallbacks} [callbacks]
 * @returns {WebMediaRecorderAdapter | NativeRecorderAdapter}
 */
export function createRecordingAdapter(callbacks = {}) {
  if (Capacitor.isNativePlatform()) {
    return new NativeRecorderAdapter(callbacks);
  }
  return new WebMediaRecorderAdapter(callbacks);
}
