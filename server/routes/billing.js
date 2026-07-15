import express from 'express';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { optionalAuth } from '../middleware/auth.js';
import { verifyGooglePlaySubscription, PACKAGE_NAME } from '../services/googlePlay.js';
import { resolveEntitlementStatus } from '../services/subscriptionStatus.js';

const router = express.Router();

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

let cachedOAuth2Client = null;

function getOAuth2Client() {
  if (!cachedOAuth2Client) cachedOAuth2Client = new google.auth.OAuth2();
  return cachedOAuth2Client;
}

/**
 * Pub/Sub push subscription のOIDCトークンを検証する。
 * verifyIdToken が署名・iss・exp・aud を検証するため、
 * ここでは email / email_verified の照合のみ追加で行う。
 *
 * @returns {Promise<{ok: true} | {ok: false, status: number, error: string}>}
 */
async function verifyPubSubPushToken(req) {
  const audience = process.env.PUBSUB_PUSH_AUDIENCE;
  const serviceAccount = process.env.PUBSUB_PUSH_SERVICE_ACCOUNT;

  if (!audience || !serviceAccount) {
    // 本番では検証をスキップせずエラーにする（fail-close）
    if (isProduction()) {
      console.error('[billing/webhook] PUBSUB_PUSH_AUDIENCE / PUBSUB_PUSH_SERVICE_ACCOUNT が未設定のため検証できません');
      return { ok: false, status: 500, error: 'webhook not configured' };
    }
    console.warn('[billing/webhook] PUBSUB_PUSH_* 未設定（開発環境）。OIDC検証をスキップします');
    return { ok: true };
  }

  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  let payload;
  try {
    const ticket = await getOAuth2Client().verifyIdToken({
      idToken: token,
      audience,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.warn('[billing/webhook] OIDCトークン検証失敗:', err?.message);
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  if (payload?.email !== serviceAccount || payload?.email_verified !== true) {
    console.warn('[billing/webhook] サービスアカウント照合失敗:', payload?.email);
    return { ok: false, status: 403, error: 'forbidden' };
  }

  return { ok: true };
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

    const { data: existing, error: lookupError } = await getSupabase()
      .from('user_entitlements')
      .select('user_id')
      .eq('purchase_token', purchase_token)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing && existing.user_id !== user_id) {
      return res.status(403).json({ error: 'このトークンは既に別のアカウントで使用されています' });
    }

    const now = new Date();
    // 検証で得た実際の有効期限を使う（開発環境の検証スキップ時のみ従来どおり+1ヶ月）
    const periodEnd = verification.expiryTime
      ? new Date(verification.expiryTime)
      : new Date(now);
    if (!verification.expiryTime) periodEnd.setMonth(periodEnd.getMonth() + 1);

    // verification.valid が true の場合、resolveEntitlementStatus は必ず 'active' か 'grace_period' を返す
    const newStatus = resolveEntitlementStatus(verification);

    const { error } = await getSupabase()
      .from('user_entitlements')
      .upsert({
        user_id,
        plan_id: 'take',
        status: newStatus,
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
  const auth = await verifyPubSubPushToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    const message = req.body?.message;
    if (!message?.data) {
      return res.status(400).json({ error: 'invalid message' });
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf8');
    const notification = JSON.parse(decoded);

    if (notification.packageName !== PACKAGE_NAME) {
      console.warn('[billing/webhook] packageName不一致:', notification.packageName);
      return res.status(200).json({ ok: true }); // 自アプリ以外の通知は無視してACK
    }

    const sub = notification.subscriptionNotification;
    if (sub?.purchaseToken) {
      const { notificationType, purchaseToken } = sub;
      // notificationType はログ用途のみ。statusはGoogle側の実状態（再取得）から決定する。
      // Pub/Subはat-least-once・順序不保証のため、通知の値をそのまま状態遷移に使わない。
      console.log(`[billing/webhook] notificationType=${notificationType} purchaseToken=${purchaseToken}`);

      const verification = await verifyGooglePlaySubscription(purchaseToken);

      if (verification.reason === 'NOT_CONFIGURED') {
        // 本番の設定不備。/verify と同じfail-close方針でPub/Subに再試行させる。
        console.error('[billing/webhook] verifyGooglePlaySubscription: NOT_CONFIGURED');
        return res.status(500).json({ error: 'billing not configured' });
      }

      const newStatus = resolveEntitlementStatus(verification);
      if (newStatus === null) {
        // PRODUCT_MISMATCH / TOKEN_INVALID 等の異常系。既存entitlementは書き換えない。
        console.warn('[billing/webhook] 検証結果により更新をスキップ:', verification.reason);
        return res.status(200).json({ ok: true });
      }

      const update = { status: newStatus, updated_at: new Date().toISOString() };
      if (verification.expiryTime) {
        update.current_period_end = verification.expiryTime;
      }

      const { error: updateError } = await getSupabase()
        .from('user_entitlements')
        .update(update)
        .eq('purchase_token', purchaseToken);
      if (updateError) {
        console.error('[billing/webhook] update error:', updateError);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[billing/webhook]', err);
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;
