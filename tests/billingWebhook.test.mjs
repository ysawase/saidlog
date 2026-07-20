import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEntitlementUpdate, resolveWebhookErrorResponse } from '../server/services/billingWebhook.js';

// user_entitlements / billing_webhook_errors を模擬するモックSupabaseクライアント。
// entitlementsは呼び出しをまたいで状態を保持するため、同一トークンへの
// 複数回のupdate()呼び出し（冪等性テスト）を検証できる。
function makeMockSupabase({ entitlements = [] } = {}) {
  const rows = entitlements.map((r) => ({ ...r }));
  const insertedErrors = [];

  const client = {
    from(table) {
      if (table === 'user_entitlements') {
        return {
          update(data) {
            return {
              eq(col, val) {
                const matched = rows.filter((r) => r[col] === val);
                matched.forEach((r) => Object.assign(r, data));
                return Promise.resolve({ error: null, count: matched.length, data: null });
              },
            };
          },
        };
      }
      if (table === 'billing_webhook_errors') {
        return {
          insert(row) {
            insertedErrors.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, rows, insertedErrors };
}

const BASE_PARAMS = {
  purchaseToken: 'tok-1',
  update: { status: 'active', updated_at: '2026-07-16T00:00:00.000Z' },
  notificationType: 4,
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  environment: 'development',
};

test('1行更新: 成功扱いで200を返し、エラーは記録しない', async () => {
  const mock = makeMockSupabase({ entitlements: [{ purchase_token: 'tok-1', status: 'expired' }] });
  const result = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(mock.rows[0].status, 'active');
  assert.equal(mock.insertedErrors.length, 0);
});

test('0行更新: 成功扱いにせず503を返し、entitlement_not_foundを記録する', async () => {
  const mock = makeMockSupabase({ entitlements: [] });
  const result = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });

  assert.equal(result.status, 503);
  assert.notEqual(result.status, 200);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'entitlement_not_found');
  assert.equal(mock.insertedErrors[0].retryable, true);
});

test('複数行更新: 成功扱いにせず非2xxを返し、entitlement_conflictを記録する', async () => {
  const mock = makeMockSupabase({
    entitlements: [
      { purchase_token: 'tok-1', status: 'expired' },
      { purchase_token: 'tok-1', status: 'expired' },
    ],
  });
  const result = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });

  assert.ok(result.status >= 400);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'entitlement_conflict');
  assert.equal(mock.insertedErrors[0].retryable, true);
});

test('DB更新エラー: 成功扱いにせず500を返す', async () => {
  const client = {
    from(table) {
      assert.equal(table, 'user_entitlements');
      return {
        update() {
          return {
            eq() {
              return Promise.resolve({ error: { message: 'mock db error' }, count: null, data: null });
            },
          };
        },
      };
    },
  };
  const result = await applyEntitlementUpdate(BASE_PARAMS, { supabase: client });
  assert.equal(result.status, 500);
});

test('エラー記録行にはPII禁止項目が一切含まれない（キー完全一致チェック）', async () => {
  const mock = makeMockSupabase({ entitlements: [] });
  await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });

  const row = mock.insertedErrors[0];
  const allowedKeys = ['error_class', 'notification_type', 'subscription_state', 'environment', 'retryable'].sort();
  assert.deepEqual(Object.keys(row).sort(), allowedKeys);
  assert.equal(JSON.stringify(row).includes('tok-1'), false);
});

test('同一通知を2回処理: 0行のケースは2回とも503のまま成功扱いにならない', async () => {
  const mock = makeMockSupabase({ entitlements: [] });

  const first = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });
  const second = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });

  assert.equal(first.status, 503);
  assert.equal(second.status, 503);
  assert.equal(mock.rows.length, 0);
  assert.equal(mock.insertedErrors.length, 2);
  assert.equal(mock.insertedErrors[0].error_class, 'entitlement_not_found');
  assert.equal(mock.insertedErrors[1].error_class, 'entitlement_not_found');
});

test('linkedPurchaseTokenフォールバック: 完全一致0件でも旧トークンにヒットすればentitlementを引き継ぎ200を返す', async () => {
  const mock = makeMockSupabase({ entitlements: [{ purchase_token: 'old-tok', status: 'expired' }] });
  const result = await applyEntitlementUpdate(
    { ...BASE_PARAMS, purchaseToken: 'new-tok', linkedPurchaseToken: 'old-tok' },
    { supabase: mock.client }
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(mock.rows.length, 1);
  assert.equal(mock.rows[0].purchase_token, 'new-tok');
  assert.equal(mock.rows[0].status, 'active');
  assert.equal(mock.insertedErrors.length, 0);
});

test('linkedPurchaseTokenフォールバック: 旧トークンでも見つからない場合は従来通りentitlement_not_foundで503', async () => {
  const mock = makeMockSupabase({ entitlements: [] });
  const result = await applyEntitlementUpdate(
    { ...BASE_PARAMS, purchaseToken: 'new-tok', linkedPurchaseToken: 'old-tok' },
    { supabase: mock.client }
  );

  assert.equal(result.status, 503);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'entitlement_not_found');
});

test('linkedPurchaseToken未指定（null）: フォールバックせず従来通りentitlement_not_foundで503', async () => {
  const mock = makeMockSupabase({ entitlements: [{ purchase_token: 'old-tok', status: 'expired' }] });
  const result = await applyEntitlementUpdate(
    { ...BASE_PARAMS, purchaseToken: 'new-tok', linkedPurchaseToken: null },
    { supabase: mock.client }
  );

  assert.equal(result.status, 503);
  assert.equal(mock.rows[0].purchase_token, 'old-tok');
  assert.equal(mock.rows[0].status, 'expired');
});

test('linkedPurchaseTokenフォールバックが複数行にマッチ: entitlement_conflictとして500', async () => {
  const mock = makeMockSupabase({
    entitlements: [
      { purchase_token: 'old-tok', status: 'expired' },
      { purchase_token: 'old-tok', status: 'expired' },
    ],
  });
  const result = await applyEntitlementUpdate(
    { ...BASE_PARAMS, purchaseToken: 'new-tok', linkedPurchaseToken: 'old-tok' },
    { supabase: mock.client }
  );

  assert.ok(result.status >= 400);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'entitlement_conflict');
});

test('linkedPurchaseTokenフォールバック: 新トークンが既に別行で使われている場合(23505)はentitlement_conflictとして500', async () => {
  let callCount = 0;
  const client = {
    from(table) {
      if (table === 'user_entitlements') {
        return {
          update() {
            return {
              eq() {
                callCount += 1;
                if (callCount === 1) {
                  return Promise.resolve({ error: null, count: 0, data: null });
                }
                return Promise.resolve({
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                  count: null,
                  data: null,
                });
              },
            };
          },
        };
      }
      if (table === 'billing_webhook_errors') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const result = await applyEntitlementUpdate(
    { ...BASE_PARAMS, purchaseToken: 'new-tok', linkedPurchaseToken: 'old-tok' },
    { supabase: client }
  );

  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'data integrity error' });
});

test('同一通知を2回処理: 1行のケースは2回とも同じstatusで、行が重複作成されない', async () => {
  const mock = makeMockSupabase({ entitlements: [{ purchase_token: 'tok-1', status: 'expired' }] });

  const first = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });
  const second = await applyEntitlementUpdate(BASE_PARAMS, { supabase: mock.client });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(mock.rows.length, 1);
  assert.equal(mock.rows[0].status, 'active');
  assert.equal(mock.insertedErrors.length, 0);
});

const WEBHOOK_ERROR_PARAMS = {
  notificationType: 4,
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  environment: 'development',
};

test('resolveWebhookErrorResponse: product_mismatch → 200、retryable:falseで記録', async () => {
  const mock = makeMockSupabase({});
  const result = await resolveWebhookErrorResponse(
    { result: 'product_mismatch', ...WEBHOOK_ERROR_PARAMS },
    { supabase: mock.client }
  );

  assert.equal(result.status, 200);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'product_mismatch');
  assert.equal(mock.insertedErrors[0].retryable, false);
});

test('resolveWebhookErrorResponse: token_invalid → 503、retryable:trueで記録', async () => {
  const mock = makeMockSupabase({});
  const result = await resolveWebhookErrorResponse(
    { result: 'token_invalid', ...WEBHOOK_ERROR_PARAMS },
    { supabase: mock.client }
  );

  assert.equal(result.status, 503);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'token_invalid');
  assert.equal(mock.insertedErrors[0].retryable, true);
});

test('resolveWebhookErrorResponse: unknown_result → 500、retryable:trueで記録', async () => {
  const mock = makeMockSupabase({});
  const result = await resolveWebhookErrorResponse(
    { result: 'unknown_result', ...WEBHOOK_ERROR_PARAMS },
    { supabase: mock.client }
  );

  assert.equal(result.status, 500);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'unknown_result');
  assert.equal(mock.insertedErrors[0].retryable, true);
});

test('resolveWebhookErrorResponse: 想定外のresult値はunknown_resultにフォールバックする（防御実装）', async () => {
  const mock = makeMockSupabase({});
  const result = await resolveWebhookErrorResponse(
    { result: 'something_else', ...WEBHOOK_ERROR_PARAMS },
    { supabase: mock.client }
  );

  assert.equal(result.status, 500);
  assert.equal(mock.insertedErrors.length, 1);
  assert.equal(mock.insertedErrors[0].error_class, 'unknown_result');
  assert.equal(mock.insertedErrors[0].retryable, true);
});

test('resolveWebhookErrorResponse: 記録行にはPII禁止項目が一切含まれない（キー完全一致チェック）', async () => {
  const mock = makeMockSupabase({});
  await resolveWebhookErrorResponse(
    { result: 'token_invalid', ...WEBHOOK_ERROR_PARAMS },
    { supabase: mock.client }
  );

  const row = mock.insertedErrors[0];
  const allowedKeys = ['error_class', 'notification_type', 'subscription_state', 'environment', 'retryable'].sort();
  assert.deepEqual(Object.keys(row).sort(), allowedKeys);
});
