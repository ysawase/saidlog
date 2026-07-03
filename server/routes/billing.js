import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { optionalAuth } from '../middleware/auth.js';
import { verifyGooglePlaySubscription } from '../services/googlePlay.js';

const router = express.Router();

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * POST /api/billing/verify
 * Google Playレシート検証・エンタイトルメント更新
 * body: { purchase_token: string }
 */
router.post('/verify', optionalAuth, async (req, res) => {
  const user_id = req.userId;
  if (!user_id) return res.status(401).json({ error: 'ログインが必要です' });

  const { purchase_token } = req.body;

  if (!purchase_token) {
    return res.status(400).json({ error: 'purchase_token is required' });
  }

  try {
    const verification = await verifyGooglePlaySubscription(purchase_token);

    if (!verification.valid) {
      if (verification.reason === 'NOT_CONFIGURED') {
        // 本番でサービスアカウント未設定：検証をスキップせずエラーにする
        return res.status(500).json({ error: 'billing not configured' });
      }
      console.warn('[billing/verify] 検証失敗:', verification.reason, verification.subscriptionState);
      return res.status(403).json({ error: '購入トークンの検証に失敗しました', reason: verification.reason });
    }

    const now = new Date();
    // 検証で得た実際の有効期限を使う（開発環境の検証スキップ時のみ従来どおり+1ヶ月）
    const periodEnd = verification.expiryTime
      ? new Date(verification.expiryTime)
      : new Date(now);
    if (!verification.expiryTime) periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { error } = await getSupabase()
      .from('user_entitlements')
      .upsert({
        user_id,
        plan_id: 'take',
        status: 'active',
        provider: 'google_play',
        purchase_token,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: 'user_id' });

    if (error) throw error;

    return res.json({ ok: true });
  } catch (err) {
    console.error('[billing/verify]', err);
    return res.status(500).json({ error: 'internal error' });
  }
});

/**
 * POST /api/billing/webhook
 * Google Play RTDN（Real-time Developer Notifications）受信
 * body: Pub/Subメッセージ形式
 */
router.post('/webhook', async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.data) {
      return res.status(400).json({ error: 'invalid message' });
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf8');
    const notification = JSON.parse(decoded);

    const sub = notification.subscriptionNotification;
    if (sub?.purchaseToken) {
      const { notificationType, purchaseToken } = sub;
      const statusMap = {
        1: 'active',
        2: 'active',
        3: 'canceled',
        4: 'active',
        5: 'grace_period',
        6: 'grace_period',
        12: 'expired',
      };
      const newStatus = statusMap[notificationType];
      if (newStatus) {
        const { error: updateError } = await getSupabase()
          .from('user_entitlements')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('purchase_token', purchaseToken);
        if (updateError) {
          console.error('[billing/webhook] update error:', updateError);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[billing/webhook]', err);
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;
