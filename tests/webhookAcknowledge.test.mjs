import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';

// webhookハンドラの「entitled確定時のみacknowledgeを呼ぶ」分岐をHTTP層でテストする。
// googlePlay/subscriptionStatus/billingWebhookをt.mock.module()でモックし、
// 実際のGoogle API呼び出し・Supabase呼び出しは発生させない。
// （--experimental-test-module-mocks フラグが必要 / package.json の test スクリプト参照）

const PACKAGE_NAME = 'com.test.app';

/** ランダムポートで Express サーバーを起動し、{ port, close } を返す */
async function createTestServer(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', router);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const close = () => new Promise(resolve => server.close(resolve));
  return { port, close };
}

/**
 * googlePlay/subscriptionStatus/billingWebhookをモックしてbilling.jsを動的importする。
 * クエリ文字列でESMキャッシュを回避（webhookOidc.test.mjsと同パターン）。
 */
async function importBillingWithMocks(t, { verification, resolveResult, updateResult, needsAck, onAcknowledge }) {
  t.mock.module('../server/services/googlePlay.js', {
    exports: {
      PACKAGE_NAME,
      verifyGooglePlaySubscription: async () => verification,
      needsAcknowledgement: () => needsAck,
      acknowledgeGooglePlaySubscription: async (purchaseToken) => {
        onAcknowledge(purchaseToken);
      },
    },
  });
  t.mock.module('../server/services/subscriptionStatus.js', {
    exports: {
      resolveEntitlementStatus: () => resolveResult,
    },
  });
  t.mock.module('../server/services/billingWebhook.js', {
    exports: {
      applyEntitlementUpdate: async () => updateResult,
      resolveWebhookErrorResponse: async () => {
        throw new Error('should not be called in these tests');
      },
    },
  });

  const { default: router } = await import(
    `../server/routes/billing.js?t=${Date.now()}-${Math.random()}`
  );
  return router;
}

function pubsubBody(notification) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(notification)).toString('base64'),
    },
  };
}

test('webhook: entitled・DB更新200・acknowledgementStatePENDING → acknowledgeが呼ばれる', async (t) => {
  const acknowledged = [];
  const router = await importBillingWithMocks(t, {
    verification: { reason: 'OK', acknowledgementState: 'PENDING', subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' },
    resolveResult: { result: 'entitled', status: 'active' },
    updateResult: { status: 200, body: { ok: true } },
    needsAck: true,
    onAcknowledge: (token) => acknowledged.push(token),
  });
  const { port, close } = await createTestServer(router);
  t.after(close);

  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pubsubBody({
      packageName: PACKAGE_NAME,
      subscriptionNotification: { notificationType: 4, purchaseToken: 'tok-entitled' },
    })),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(acknowledged, ['tok-entitled']);
});

test('webhook: entitlement_not_found（503）→ acknowledgeは呼ばれない', async (t) => {
  const acknowledged = [];
  const router = await importBillingWithMocks(t, {
    verification: { reason: 'OK', acknowledgementState: 'PENDING', subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' },
    resolveResult: { result: 'entitled', status: 'active' },
    updateResult: { status: 503, body: { error: 'entitlement not found' } },
    needsAck: true,
    onAcknowledge: (token) => acknowledged.push(token),
  });
  const { port, close } = await createTestServer(router);
  t.after(close);

  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pubsubBody({
      packageName: PACKAGE_NAME,
      subscriptionNotification: { notificationType: 4, purchaseToken: 'tok-not-found' },
    })),
  });

  assert.equal(res.status, 503);
  assert.deepEqual(acknowledged, []);
});
