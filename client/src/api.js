import { supabase } from './lib/supabase.js';
import { getOrCreateGuestId } from './lib/guestId.js';
import { getOrCreateSessionId } from './lib/analytics.js';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export { uploadAudio } from './lib/storage.js';

/** 音声ファイルの長さを秒（切り上げ）で返す。取得失敗時は 0 を返す。 */
export function getAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url);
      resolve(Math.ceil(audio.duration) || 0);
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      resolve(0);
    });
    audio.src = url;
  });
}

/**
 * アップロード済みファイルのパスを渡して文字起こしを依頼する。
 * 音声データ本体はSupabase Storage経由でSTTプロバイダーに渡るため、ここを通らない。
 * 長い会議は処理に数分かかることがある。
 */
export async function requestTranscription(filePath, durationSeconds = 0) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const guestId = session ? null : getOrCreateGuestId();
  const res = await fetch(`${API_BASE}/api/transcribe`, {
    method: 'POST',
    headers,
    // sessionIdはanalytics専用の任意フィールド（サーバー側で検証、本体処理には不使用）
    body: JSON.stringify({ filePath, durationSeconds, guestId, sessionId: getOrCreateSessionId() }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `文字起こしに失敗しました（HTTP ${res.status}）`);
  }
  return res.json();
}

export async function requestSummary({ utterances, template, names, userChoseFullTrial = false, audioDurationSec = 0, transcriptId = null }) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${API_BASE}/api/summarize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ utterances, template, names, userChoseFullTrial, audioDurationSec, transcriptId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function getAccountStatus() {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {};
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${API_BASE}/api/account/status`, { headers, cache: 'no-cache' });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE}/api/delete-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function checkEmailRegistered(email) {
  const res = await fetch(`${API_BASE}/api/auth/check-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.exists;
}
