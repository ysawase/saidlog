import { createClient } from '@supabase/supabase-js';

function defaultSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function recordError(supabase, { errorClass, notificationType, subscriptionState, environment, retryable }) {
  try {
    const { error } = await supabase
      .from('billing_webhook_errors')
      .insert({
        error_class: errorClass,
        notification_type: notificationType ?? null,
        subscription_state: subscriptionState ?? null,
        environment,
        retryable,
      });
    if (error) console.error('[billing/webhook] error record insert失敗:', error.message);
  } catch (err) {
    console.error('[billing/webhook] recordErrorで例外:', err.message);
  }
}

/**
 * RTDN webhookの検証結果をuser_entitlementsへ反映する。
 * purchase_tokenにDB制約（UNIQUE等）がないため、update()の影響行数を
 * count: 'exact' で必ず確認し、0件・複数件を成功扱いにしない。
 * @param {{ purchaseToken: string, update: object, notificationType: number, subscriptionState: string|null, environment: 'production'|'development' }} params
 * @param {{ supabase?: object }} [_deps] テスト用依存注入（省略時は本番クライアント）
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function applyEntitlementUpdate(
  { purchaseToken, update, notificationType, subscriptionState, environment },
  _deps = {}
) {
  const supabase = _deps.supabase ?? defaultSupabase();

  const { error: updateError, count } = await supabase
    .from('user_entitlements')
    .update(update, { count: 'exact' })
    .eq('purchase_token', purchaseToken);

  if (updateError) {
    console.error('[billing/webhook] update error:', updateError.message);
    return { status: 500, body: { error: 'internal error' } };
  }

  if (count === 0) {
    await recordError(supabase, {
      errorClass: 'entitlement_not_found',
      notificationType,
      subscriptionState,
      environment,
      retryable: true,
    });
    return { status: 503, body: { error: 'entitlement not found' } };
  }

  if (count > 1) {
    console.error(`[billing/webhook] update matched ${count} rows for a single purchaseToken`);
    await recordError(supabase, {
      errorClass: 'entitlement_conflict',
      notificationType,
      subscriptionState,
      environment,
      retryable: false,
    });
    return { status: 500, body: { error: 'data integrity error' } };
  }

  return { status: 200, body: { ok: true } };
}
