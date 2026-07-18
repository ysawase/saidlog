import { Router } from 'express';
import { createHash } from 'node:crypto';
import { getSupabase, BUCKET } from '../services/storage.js';

const router = Router();

const RETENTION_YEARS = 1;

router.post('/delete-account', async (req, res) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'unauthorized' });

  const userId = user.id;
  const errors = [];

  // 0. deleted_entitlements_log（課金証跡ログ、削除前に退避）
  // 返金・チャージバック紛争時の証跡として、個人を特定できない形で一定期間保持する。
  // 失敗してもアカウント削除処理全体はブロックしない（削除権利を内部ログの失敗で妨げないため。errorsには積まない）。
  try {
    const { data: entitlement } = await supabase
      .from('user_entitlements')
      .select('plan_id, status, current_period_end, purchase_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (entitlement) {
      const purchaseTokenHash = entitlement.purchase_token
        ? createHash('sha256').update(entitlement.purchase_token).digest('hex')
        : null;
      const deletedAt = new Date();
      const retentionExpiresAt = new Date(deletedAt);
      retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + RETENTION_YEARS);

      const { error: logError } = await supabase
        .from('deleted_entitlements_log')
        .insert({
          deleted_at: deletedAt.toISOString(),
          plan_id: entitlement.plan_id,
          status: entitlement.status,
          purchase_token_hash: purchaseTokenHash,
          period_end: entitlement.current_period_end,
          retention_expires_at: retentionExpiresAt.toISOString(),
        });
      if (logError) console.error('[delete-account] deleted_entitlements_log insert失敗:', logError.message);
    }
  } catch (err) {
    console.error('[delete-account] deleted_entitlements_log処理で例外:', err.message);
  }

  // 1. transcripts
  const { error: transcriptsError } = await supabase
    .from('transcripts')
    .delete()
    .eq('user_id', userId);
  if (transcriptsError) errors.push(`transcripts: ${transcriptsError.message}`);

  // 2. audio_retention（file_path は {userId}/{filename} 形式）
  const { error: retentionError } = await supabase
    .from('audio_retention')
    .delete()
    .like('file_path', `${userId}/%`);
  if (retentionError) errors.push(`audio_retention: ${retentionError.message}`);

  // 3. Storage 残存ファイル
  try {
    const { data: files } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000 });
    if (files && files.length > 0) {
      const paths = files.map(f => `${userId}/${f.name}`);
      const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
      if (storageError) errors.push(`storage: ${storageError.message}`);
    }
  } catch (err) {
    errors.push(`storage: ${err.message}`);
  }

  // 4. Auth アカウント削除
  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteUserError) errors.push(`auth: ${deleteUserError.message}`);

  if (errors.length > 0) {
    return res.status(500).json({ error: errors.join('; ') });
  }

  res.json({ ok: true });
});

export default router;
