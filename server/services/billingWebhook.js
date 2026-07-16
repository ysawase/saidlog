import { createClient } from '@supabase/supabase-js';

function defaultSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * billing_webhook_errorsへ固定分類のエラーを記録する（fire-and-forget、never throw）。
 * PII禁止方針を維持するため、固定の名前付き引数のみを受け取る。
 */
export async function recordError(supabase, { errorClass, notificationType, subscriptionState, environment, retryable }) {
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
      // 競合状態自体は自然回復しないが、人間がデータ修正した後の再送は成功しうるため true
      retryable: true,
    });
    return { status: 500, body: { error: 'data integrity error' } };
  }

  return { status: 200, body: { ok: true } };
}

const WEBHOOK_ERROR_RESPONSES = {
  product_mismatch: { status: 200, body: { ok: true }, retryable: false, logLevel: 'warn' },
  token_invalid: { status: 503, body: { error: 'token invalid' }, retryable: true, logLevel: 'warn' },
  unknown_result: { status: 500, body: { error: 'unknown verification result' }, retryable: true, logLevel: 'error' },
};

/**
 * result が product_mismatch / token_invalid / unknown_result のいずれかである前提で、
 * 固定分類のエラー記録とHTTPレスポンスを決定する。
 * retryable_error / entitled / not_entitled はこの関数の対象外（呼び出し元で別途分岐）。
 * 未知のresult値（想定外の呼び出し）は成功扱いにせず、500 + error_class: 'unknown_result' に倒す。
 * @param {{ result: string, notificationType: number, subscriptionState: string|null, environment: 'production'|'development' }} params
 * @param {{ supabase?: object }} [_deps] テスト用依存注入（省略時は本番クライアント）
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function resolveWebhookErrorResponse(
  { result, notificationType, subscriptionState, environment },
  _deps = {}
) {
  const config = WEBHOOK_ERROR_RESPONSES[result] ?? WEBHOOK_ERROR_RESPONSES.unknown_result;
  const errorClass = WEBHOOK_ERROR_RESPONSES[result] ? result : 'unknown_result';
  const supabase = _deps.supabase ?? defaultSupabase();

  if (!WEBHOOK_ERROR_RESPONSES[result]) {
    console.error(`[billing/webhook] resolveWebhookErrorResponse: 想定外のresult値 "${result}"`);
  }
  (config.logLevel === 'error' ? console.error : console.warn)(`[billing/webhook] ${errorClass}:`, subscriptionState);

  await recordError(supabase, {
    errorClass,
    notificationType,
    subscriptionState,
    environment,
    retryable: config.retryable,
  });

  return { status: config.status, body: config.body };
}
