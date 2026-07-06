import { Capacitor } from '@capacitor/core';
import { CapacitorAudioRecorder } from '@capgo/capacitor-audio-recorder';
import { WebMediaRecorderAdapter } from './WebMediaRecorderAdapter.js';

export class NativeRecorderAdapter {
  async start() {
    const { recordAudio } = await CapacitorAudioRecorder.requestPermissions();
    if (recordAudio !== 'granted') {
      const err = new Error('Microphone permission denied');
      err.name = 'NotAllowedError';
      throw err;
    }
    await CapacitorAudioRecorder.startRecording();
  }

  async stop() {
    const result = await CapacitorAudioRecorder.stopRecording();
    const durationMs = result.duration ?? 0;
    if (result.blob) {
      return { blob: result.blob, mimeType: 'audio/webm', durationMs };
    }
    const response = await fetch(Capacitor.convertFileSrc(result.uri));
    const blob = await response.blob();
    return { blob, mimeType: 'audio/mp4', durationMs };
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
