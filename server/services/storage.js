import { createClient } from '@supabase/supabase-js';

// ---- 保持期間・閾値定数（ここだけ変更すれば全体に反映）----
export const THRESHOLD_LOW = 0.5;     // 50%未満：低使用量
export const THRESHOLD_HIGH = 0.8;    // 80%超：要削除
export const RETENTION_DAYS_LOW = 30; // THRESHOLD_LOW 未満のとき
export const RETENTION_DAYS_MID = 7;  // THRESHOLD_LOW 以上 THRESHOLD_HIGH 未満のとき
const MAX_BUCKET_BYTES = 1 * 1024 * 1024 * 1024; // 1GB（Supabase フリープランの目安）

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

async function listAllBucketFiles() {
  const storage = getSupabase().storage.from(BUCKET);
  const { data: topLevel } = await storage.list('', { limit: 1000 });
  let totalBytes = 0;
  const files = [];
  for (const entry of topLevel ?? []) {
    if (entry.id !== null) {
      totalBytes += entry.metadata?.size ?? 0;
      continue;
    }
    const { data: children } = await storage.list(entry.name, { limit: 1000 });
    for (const file of children ?? []) {
      const size = file.metadata?.size ?? 0;
      totalBytes += size;
      files.push({
        path: `${entry.name}/${file.name}`,
        size,
        createdAt: file.created_at ? new Date(file.created_at).getTime() : 0,
      });
    }
  }
  return { totalBytes, files };
}

/** バケットの使用量比率（0〜1）を返す。取得失敗時は 1 を返す（即削除フォールバック）。 */
export async function getStorageUsageRatio() {
  try {
    const { totalBytes } = await listAllBucketFiles();
    return Math.min(totalBytes / MAX_BUCKET_BYTES, 1);
  } catch {
    return 1;
  }
}

/** バケット使用量が THRESHOLD_HIGH を下回るまで、古いファイルから順に削除する。 */
export async function deleteOldAudioFiles() {
  const storage = getSupabase().storage.from(BUCKET);
  const { totalBytes, files } = await listAllBucketFiles();
  files.sort((a, b) => a.createdAt - b.createdAt);

  let remaining = totalBytes;
  let deleted = 0;
  for (const file of files) {
    if (remaining / MAX_BUCKET_BYTES < THRESHOLD_HIGH) break;
    const { error } = await storage.remove([file.path]);
    if (!error) {
      remaining -= file.size;
      deleted++;
    }
  }
  if (deleted > 0) console.log(`ストレージ圧迫解消: ${deleted}件削除`);
  return deleted;
}

/**
 * 使用量に応じた保持期間を audio_retention テーブルに記録する。
 * deleteAudio() の即削除が失敗した場合の安全網として機能する。
 */
export async function scheduleAudioDeletion(filePath, uploadedAt = new Date()) {
  try {
    const ratio = await getStorageUsageRatio();
    let retentionDays;
    if (ratio >= THRESHOLD_HIGH) {
      retentionDays = 0;
    } else if (ratio >= THRESHOLD_LOW) {
      retentionDays = RETENTION_DAYS_MID;
    } else {
      retentionDays = RETENTION_DAYS_LOW;
    }
    const deleteAfter = new Date(uploadedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const { error } = await getSupabase()
      .from('audio_retention')
      .upsert({ file_path: filePath, delete_after: deleteAfter.toISOString() }, { onConflict: 'file_path' });
    if (error) console.error(`保持期間記録失敗 (${filePath}):`, error.message);
  } catch (err) {
    console.error(`scheduleAudioDeletion エラー:`, err.message);
  }
}
