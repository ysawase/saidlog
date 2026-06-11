import { BUCKET, getSupabase, supabaseConfigured } from './storage.js';

// 通常は文字起こし完了直後に削除されるため、ここで消すのは削除失敗の残骸のみ。
// Vercel Cron（1日1回）と、文字起こしAPI呼び出し時のpiggybackの両方から呼ばれる。
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;

/**
 * アップロードから24時間以上経過したファイルを削除する。
 * @returns {Promise<number>} 削除したファイル数
 */
export async function cleanupOldFiles() {
  if (!supabaseConfigured()) return 0;

  const storage = getSupabase().storage.from(BUCKET);
  const { data: folders, error } = await storage.list('', { limit: LIST_LIMIT });
  if (error) {
    throw new Error(`Storage一覧取得に失敗: ${error.message}`);
  }

  const threshold = Date.now() - MAX_AGE_MS;
  const targets = [];

  for (const folder of folders ?? []) {
    // バケット直下は {uuid}/ フォルダのみの想定。直下のファイルはスキップ
    if (folder.id !== null) continue;
    const { data: files, error: listErr } = await storage.list(folder.name, { limit: 10 });
    if (listErr) continue;
    for (const file of files ?? []) {
      if (file.created_at && new Date(file.created_at).getTime() < threshold) {
        targets.push(`${folder.name}/${file.name}`);
      }
    }
  }

  if (targets.length > 0) {
    const { error: removeErr } = await storage.remove(targets);
    if (removeErr) {
      throw new Error(`古いファイルの削除に失敗: ${removeErr.message}`);
    }
    console.log(`クリーンアップ: ${targets.length}件削除`);
  }
  return targets.length;
}
