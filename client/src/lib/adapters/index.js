import { Capacitor } from '@capacitor/core';
import { CapacitorAudioRecorder } from '@capgo/capacitor-audio-recorder';
import { WebMediaRecorderAdapter } from './WebMediaRecorderAdapter.js';

export class NativeRecorderAdapter {
  async start() {
    await CapacitorAudioRecorder.startRecording();
  }

  async stop() {
    const result = await CapacitorAudioRecorder.stopRecording();
    if (result.blob) return result.blob;
    const response = await fetch(Capacitor.convertFileSrc(result.uri));
    return response.blob();
  }

  async requestPermission() {
    await CapacitorAudioRecorder.requestPermissions();
  }

  async checkPermission() {
    return await CapacitorAudioRecorder.checkPermissions();
  }
}

export function createRecordingAdapter(callbacks = {}) {
  if (Capacitor.isNativePlatform()) {
    return new NativeRecorderAdapter();
  }
  return new WebMediaRecorderAdapter(callbacks);
}
