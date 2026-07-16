/**
 * Plus利用可能とみなす user_entitlements.status の値。
 * plan.js の getEntitlement() で使用する。resolveEntitlementStatus() の
 * result='entitled' が書き込む status 値のセットと常に一致させること。
 */
export const ENTITLED_STATUSES = ['active', 'grace_period'];

/**
 * Google Play Developer API (purchases.subscriptionsv2.get) を再照会した結果を
 * SaidLog 内部の利用権状態に変換する。
 *
 * 【重要】この関数が受け取るのは RTDN の notificationType ではなく、
 * verifyGooglePlaySubscription() が Developer API を再照会して返した
 * verification オブジェクトである。
 * RTDN 通知は at-least-once かつ順序不保証のため、通知の値を直接状態遷移に使わず、
 * 常に Developer API を再照会してから本関数を呼ぶこと。
 *
 * @param {object} verification - verifyGooglePlaySubscription() の返却値
 * @returns {{ result: 'entitled'|'not_entitled'|'retryable_error'|'product_mismatch'|'token_invalid'|'unknown_result', status: string|null }}
 *   result:
 *     'entitled'         - Plus利用可能。status は 'active' または 'grace_period'
 *     'not_entitled'     - Plus利用不可（期限切れ・停止）。status は 'expired'
 *     'retryable_error'  - 設定不備等の一時的エラー。呼び出し元は非2xxを返してPub/Subに再試行させること
 *     'product_mismatch' - 別商品の購入トークン。既存entitlementは変更しない。
 *                          自然回復しないため再送しても無意味だが、人間による確認が必要な異常
 *     'token_invalid'    - 無効なトークン。一時的な整合遅延の可能性があるため、初回は再試行の余地を残す
 *     'unknown_result'   - コードが把握していない結果。成功扱いにしてはならない
 *   status: DB に書き込む user_entitlements.status 値。null は DB 更新をスキップすることを示す
 */
export function resolveEntitlementStatus(verification) {
  if (verification.valid) {
    const status = verification.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
      ? 'grace_period'
      : 'active';
    return { result: 'entitled', status };
  }

  if (verification.reason === 'EXPIRED' || verification.reason === 'NOT_ACTIVE') {
    return { result: 'not_entitled', status: 'expired' };
  }

  if (verification.reason === 'NOT_CONFIGURED') {
    // 通常は呼び出し元が事前に弾く（verify: 500, webhook: 500）が、
    // 到達した場合も DB を更新せず再試行可能なエラーとして扱う。
    return { result: 'retryable_error', status: null };
  }

  if (verification.reason === 'PRODUCT_MISMATCH') {
    // 既存entitlementを書き換えない。activeへの倒し込みも即時expired剥奪も行わない。
    return { result: 'product_mismatch', status: null };
  }

  if (verification.reason === 'TOKEN_INVALID') {
    return { result: 'token_invalid', status: null };
  }

  // 未知のreason: 既存entitlementを書き換えない。
  return { result: 'unknown_result', status: null };
}
