import { Router } from 'express';
import { getSupabase, BUCKET } from '../services/storage.js';

const router = Router();

router.post('/delete-account', async (req, res) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'unauthorized' });

  const userId = user.id;
  const errors = [];

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
