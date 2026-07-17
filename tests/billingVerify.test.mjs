import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertPurchaseEntitlement } from '../server/routes/billing.js';

const BASE_ENTITLEMENT = {
  user_id: 'user-1',
  plan_id: 'take',
  status: 'active',
  provider: 'google_play',
  purchase_token: 'tok-1',
  current_period_start: '2026-07-17T00:00:00.000Z',
  current_period_end: '2026-08-17T00:00:00.000Z',
  updated_at: '2026-07-17T00:00:00.000Z',
};

function makeMockSupabase({ error = null } = {}) {
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'user_entitlements');
      return {
        upsert(row, options) {
          calls.push({ row, options });
          return Promise.resolve({ error });
        },
      };
    },
  };
  return { client, calls };
}

test('重複なし: 200を返し、正常にupsertされる', async () => {
  const mock = makeMockSupabase({ error: null });
  const result = await upsertPurchaseEntitlement(BASE_ENTITLEMENT, { supabase: mock.client });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(mock.calls[0].options, { onConflict: 'user_id' });
});

test('一意制約違反(23505): 403を返し、既存所有者情報を含まない', async () => {
  const mock = makeMockSupabase({
    error: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "user_entitlements_purchase_token_unique"',
      details: 'Key (purchase_token)=(tok-1) already exists.',
    },
  });
  const result = await upsertPurchaseEntitlement(BASE_ENTITLEMENT, { supabase: mock.client });

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: 'このトークンは既に別のアカウントで使用されています' });
});

test('一意制約違反(23505): レスポンスにpurchase_token・user_id等の値が一切含まれない', async () => {
  const mock = makeMockSupabase({ error: { code: '23505', message: 'dup', details: 'Key (purchase_token)=(tok-1) already exists.' } });
  const result = await upsertPurchaseEntitlement(BASE_ENTITLEMENT, { supabase: mock.client });

  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes('tok-1'), false);
  assert.equal(serialized.includes('user-1'), false);
  assert.deepEqual(Object.keys(result.body), ['error']);
});

test('23505以外のDBエラー: 呼び出し元に例外として伝播する（既存の500経路を維持）', async () => {
  const mock = makeMockSupabase({ error: { code: '42501', message: 'permission denied' } });

  await assert.rejects(
    () => upsertPurchaseEntitlement(BASE_ENTITLEMENT, { supabase: mock.client }),
    (err) => err.code === '42501'
  );
});
