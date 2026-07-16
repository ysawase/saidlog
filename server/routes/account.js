import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { getEntitlement, getCurrentPeriodStart } from '../services/plan.js';
import { getSupabase } from '../services/storage.js';

const router = Router();

router.get('/account/status', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'ログインが必要です' });
    }

    const { planId, plan } = await getEntitlement(userId);
    const supabase = getSupabase();
    const periodStart = getCurrentPeriodStart().toISOString();

    const [{ data: period }, { data: profile }] = await Promise.all([
      supabase
        .from('usage_periods')
        .select('used_seconds')
        .eq('user_id', userId)
        .eq('period_start', periodStart)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('full_summary_used')
        .eq('id', userId)
        .maybeSingle(),
    ]);

    const usedSeconds = period?.used_seconds ?? 0;
    const limitSeconds = plan.monthlySeconds;

    res.set('Cache-Control', 'no-cache');
    res.json({
      planId,
      planName: plan.name,
      usedSeconds,
      limitSeconds,
      remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
      fullSummaryUsed: profile?.full_summary_used ?? false,
      historyLimit: plan.historyLimit,
      canExport: plan.canExport,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
