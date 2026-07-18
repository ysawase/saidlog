import { test } from 'node:test';
import assert from 'node:assert/strict';

// server/services/storage.js の getSupabase() をモックし、
// user_entitlements への select().eq().eq().in().maybeSingle() チェーンが
// 指定した1行（またはnull）を返すようにする。
// 実行には --experimental-test-module-mocks フラグが必要（package.json の test スクリプト参照）。
function mockStorage(t, data) {
  return t.mock.module('../server/services/storage.js', {
    exports: {
      getSupabase: () => ({
        from(table) {
          assert.equal(table, 'user_entitlements');
          const chain = {
            select() { return chain; },
            eq() { return chain; },
            in() { return chain; },
            maybeSingle() { return Promise.resolve({ data, error: null }); },
          };
          return chain;
        },
      }),
    },
  });
}

async function importFreshPlan() {
  // クエリ文字列でESMモジュールキャッシュを回避し、都度そのテストのモックを反映させて再importする
  return import(`../server/services/plan.js?t=${Date.now()}-${Math.random()}`);
}

test('current_period_end が未来 → 権利あり（planId: take）', async (t) => {
  const future = new Date(Date.now() + 60_000).toISOString();
  mockStorage(t, { plan_id: 'take', status: 'active', current_period_end: future });
  const { getEntitlement } = await importFreshPlan();

  const result = await getEntitlement('user-1');
  assert.equal(result.planId, 'take');
  assert.equal(result.status, 'active');
});

test('current_period_end が過去 → statusがactiveでも権利なし（planId: ume）', async (t) => {
  const past = new Date(Date.now() - 60_000).toISOString();
  mockStorage(t, { plan_id: 'take', status: 'active', current_period_end: past });
  const { getEntitlement } = await importFreshPlan();

  const result = await getEntitlement('user-1');
  assert.equal(result.planId, 'ume');
});

test('current_period_end が null → 既存のstatusベース判定のまま（planId: take）', async (t) => {
  mockStorage(t, { plan_id: 'take', status: 'active', current_period_end: null });
  const { getEntitlement } = await importFreshPlan();

  const result = await getEntitlement('user-1');
  assert.equal(result.planId, 'take');
  assert.equal(result.status, 'active');
});

test('該当行なし（無料プランユーザー等）→ 従来通りplanId: ume（回帰確認）', async (t) => {
  mockStorage(t, null);
  const { getEntitlement } = await importFreshPlan();

  const result = await getEntitlement('user-1');
  assert.equal(result.planId, 'ume');
  assert.equal(result.status, null);
});

test('current_period_end が過去でも生のstatusはそのまま返る（isGracePeriod算出はplanIdでガードする設計の裏付け）', async (t) => {
  const past = new Date(Date.now() - 60_000).toISOString();
  mockStorage(t, { plan_id: 'take', status: 'grace_period', current_period_end: past });
  const { getEntitlement } = await importFreshPlan();

  const result = await getEntitlement('user-1');
  assert.equal(result.planId, 'ume');
  assert.equal(result.status, 'grace_period');
});
