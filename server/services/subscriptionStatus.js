/**
 * verifyGooglePlaySubscription() の返却値を SaidLog 内部ステータスに変換する。
 *
 * @param {object} verification - verifyGooglePlaySubscription() の返却値
 * @returns {'active' | 'grace_period' | 'expired' | null}
 *   null = entitlement を書き換えない（PRODUCT_MISMATCH / TOKEN_INVALID 等の異常系）
 *   NOTE: NOT_CONFIGURED は呼び出し元で事前に弾くこと（本関数はエラーを throw しない）
 */
export function resolveEntitlementStatus(verification) {
  if (verification.valid) {
    return verification.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
      ? 'grace_period'
      : 'active';
  }
  if (verification.reason === 'EXPIRED' || verification.reason === 'NOT_ACTIVE') {
    return 'expired';
  }
  return null;
}
