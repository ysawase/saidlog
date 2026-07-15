import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntitlementStatus } from '../server/services/subscriptionStatus.js';

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

// valid=true: 利用可能状態

test('ACTIVE → active', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }),
    'active'
  );
});

test('CANCELED かつ期限内 → active', () => {
  // googlePlay.js は expiryTime が未来の場合のみ valid:true を返すため、
  // CANCELED かつ期限内は valid:true で到達する
  assert.equal(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }),
    'active'
  );
});

test('IN_GRACE_PERIOD → grace_period', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }),
    'grace_period'
  );
});

test('RECOVERED後（Google側でACTIVEに戻った場合）→ active', () => {
  // ON_HOLD等から回復した購読は Google Play API が SUBSCRIPTION_STATE_ACTIVE を返す
  assert.equal(
    resolveEntitlementStatus({ ...base, valid: true, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }),
    'active'
  );
});

// valid=false: 利用不可状態

test('EXPIRED → expired', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, reason: 'EXPIRED' }),
    'expired'
  );
});

test('NOT_ACTIVE (ON_HOLD/PAUSED/PENDING) → expired', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, reason: 'NOT_ACTIVE' }),
    'expired'
  );
});

// valid=false: 更新スキップ（entitlement は書き換えない）

test('PRODUCT_MISMATCH → null（更新スキップ）', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, reason: 'PRODUCT_MISMATCH' }),
    null
  );
});

test('TOKEN_INVALID → null（更新スキップ）', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, reason: 'TOKEN_INVALID' }),
    null
  );
});

test('NOT_CONFIGURED → null（呼び出し元が事前に弾く想定だが、到達しても安全側に倒す）', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, reason: 'NOT_CONFIGURED' }),
    null
  );
});

test('未知の reason → null（更新スキップ）', () => {
  assert.equal(
    resolveEntitlementStatus({ ...base, reason: 'UNKNOWN_FUTURE_REASON' }),
    null
  );
});
