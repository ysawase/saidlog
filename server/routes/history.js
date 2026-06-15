import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { getVisibleMeetings } from '../services/plan.js';
import { getSupabase } from '../services/storage.js';

const router = Router();

router.get('/transcripts', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'ログインが必要です' });

    const limit = await getVisibleMeetings(userId);

    const { data, error } = await getSupabase()
      .from('transcripts')
      .select('id, filename, created_at, result')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

export default router;
