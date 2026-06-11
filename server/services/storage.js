import { createClient } from '@supabase/supabase-js';

// service_roleキーはサーバー専用。クライアントに渡してはならない。
export const BUCKET = 'audio-uploads';

let client = null;

export function getSupabase() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** 署名付きURL（有効期限2時間）を生成する。STTプロバイダーが音声を取得するために使う。 */
export async function createSignedAudioUrl(filePath) {
  const { data, error } = await getSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(filePath, 7200);
  if (error) {
    throw new Error(`署名付きURLの生成に失敗しました: ${error.message}`);
  }
  return data.signedUrl;
}

/** 音声ファイルを削除する。会議データをストレージに残さない方針のため、文字起こし後に必ず呼ぶ。 */
export async function deleteAudio(filePath) {
  const { error } = await getSupabase().storage.from(BUCKET).remove([filePath]);
  if (error) {
    throw new Error(`ファイル削除に失敗しました: ${error.message}`);
  }
}
