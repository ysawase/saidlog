import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntitlementStatus } from '../server/services/subscriptionStatus.js';

// resolveEntitlementStatus() が受け取るのは RTDN の notificationType ではなく、
// verifyGooglePlaySubscription() が Developer API (subscriptionsv2.get) を
// 再照会して返した verification オブジェクトである。

const base = {
  valid: false,
  reason: null,
  subscriptionState: null,
  productId: null,
  expiryTime: null,
  startTime: null,
  acknowledgementState: null,
  testPurchase: false,
};

// --- result='entitled' ケース ---

test('ACTIVE → entitled/active', () => {
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }),
    { result: 'entitled', status: 'active' }
  );
});

test('CANCELED かつ期限内 → entitled/active', () => {
  // googlePlay.js は expiryTime が未来の場合のみ valid:true を返す。
  // CANCELED かつ期限内は valid:true で到達するため、アクセス権を維持する。
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }),
    { result: 'entitled', status: 'active' }
  );
});

test('IN_GRACE_PERIOD → entitled/grace_period', () => {
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }),
    { result: 'entitled', status: 'grace_period' }
  );
});

test('RTDN SUBSCRIPTION_RECOVERED通知後にDeveloper APIを再照会した結果がACTIVEの場合 → entitled/active', () => {
  // RTDN の notificationType=SUBSCRIPTION_RECOVERED を受けた webhook は
  // verifyGooglePlaySubscription() で Developer API を再照会する。
  // ON_HOLD 等から回復した購読は Developer API が SUBSCRIPTION_STATE_ACTIVE を返す。
  // この関数が受け取るのはその再照会結果であり、通知種別の文字列ではない。
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }),
    { result: 'entitled', status: 'active' }
  );
});

// --- result='not_entitled' ケース ---

test('EXPIRED → not_entitled/expired', () => {
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, reason: 'EXPIRED' }),
    { result: 'not_entitled', status: 'expired' }
  );
});

test('NOT_ACTIVE (ON_HOLD/PAUSED/PENDING) → not_entitled/expired', () => {
  // grace_period への倒し込みは行わない（誤ってアクセス継続を許すことになるため）
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, reason: 'NOT_ACTIVE' }),
    { result: 'not_entitled', status: 'expired' }
  );
});

// --- result='retryable_error' ケース ---

test('NOT_CONFIGURED → retryable_error（通常は呼び出し元が事前に弾くが、到達した場合の安全網）', () => {
  // verify/webhook ともに NOT_CONFIGURED は resolveEntitlementStatus() を呼ぶ前に
  // 500を返して早期returnする。到達した場合もDB更新せず再試行可能エラーとして扱う。
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, reason: 'NOT_CONFIGURED' }),
    { result: 'retryable_error', status: null }
  );
});

// --- result='product_mismatch' / 'token_invalid' / 'unknown_result' ケース ---

test('PRODUCT_MISMATCH → product_mismatch（既存entitlement維持、更新スキップ）', () => {
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, reason: 'PRODUCT_MISMATCH' }),
    { result: 'product_mismatch', status: null }
  );
});

test('TOKEN_INVALID → token_invalid（既存entitlement維持、更新スキップ）', () => {
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, reason: 'TOKEN_INVALID' }),
    { result: 'token_invalid', status: null }
  );
});

test('未知のreason → unknown_result（activeへの倒し込みも即時expired剥奪も行わない）', () => {
  // 将来 Developer API が新しい状態を返した場合でも、既存権利を書き換えないよう安全側に倒す。
  // 意図的にアクセスを付与することも剥奪することも行わない。
  assert.deepEqual(
    resolveEntitlementStatus({ ...base, reason: 'UNKNOWN_FUTURE_REASON' }),
    { result: 'unknown_result', status: null }
  );
});
