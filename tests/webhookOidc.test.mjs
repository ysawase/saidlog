import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';

// verifyPubSubPushToken() は billing.js から export されていない非公開関数のため、
// /webhook エンドポイントへの HTTP リクエスト経由でテストする。
// googleapis を t.mock.module() でモックし、verifyIdToken の返却値を制御する。
// （--experimental-test-module-mocks フラグが必要 / package.json の test スクリプト参照）

// ── helpers ───────────────────────────────────────────────────

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
 * OIDC環境変数をテスト用に上書きし、テスト後に元に戻す。
 * 環境変数が両方設定されているとき verifyPubSubPushToken() は OIDC 検証を実行する。
 */
function setupOidcEnv(t) {
  const origAudience = process.env.PUBSUB_PUSH_AUDIENCE;
  const origSA = process.env.PUBSUB_PUSH_SERVICE_ACCOUNT;
  process.env.PUBSUB_PUSH_AUDIENCE = 'https://test-audience';
  process.env.PUBSUB_PUSH_SERVICE_ACCOUNT = 'sa@test.iam.gserviceaccount.com';
  t.after(() => {
    process.env.PUBSUB_PUSH_AUDIENCE = origAudience;
    process.env.PUBSUB_PUSH_SERVICE_ACCOUNT = origSA;
  });
  return { serviceAccount: 'sa@test.iam.gserviceaccount.com' };
}

/**
 * googleapis をモックして billing.js を動的 import する。
 * verifyBehavior: idToken => ticket ({ getPayload }) を返す、または throw する関数。
 * クエリ文字列で ESM キャッシュを回避（summarizeGeneration.test.mjs と同パターン）。
 */
async function importBillingWithMockedGoogle(t, verifyBehavior) {
  t.mock.module('googleapis', {
    exports: {
      google: {
        auth: {
          OAuth2: class MockOAuth2 {
            async verifyIdToken({ idToken }) {
              return verifyBehavior(idToken);
            }
          },
        },
      },
    },
  });
  const { default: router } = await import(
    `../server/routes/billing.js?t=${Date.now()}-${Math.random()}`
  );
  return router;
}

// ── テストケース ───────────────────────────────────────────────

test('webhook: Authorizationヘッダーなし → 401', async (t) => {
  setupOidcEnv(t);
  // Authorization ヘッダーがなければ verifyIdToken は呼ばれない
  const router = await importBillingWithMockedGoogle(t, () => {
    throw new Error('should not be called');
  });
  const { port, close } = await createTestServer(router);
  t.after(close);

  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test('webhook: 不正な Bearer token（署名検証失敗）→ 401', async (t) => {
  setupOidcEnv(t);
  // verifyIdToken が throw すると catch ブロックが 401 を返す
  const router = await importBillingWithMockedGoogle(t, () => {
    throw new Error('Token verification failed');
  });
  const { port, close } = await createTestServer(router);
  t.after(close);

  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid_token',
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test('webhook: audience不一致のtoken → 401', async (t) => {
  setupOidcEnv(t);
  // audience 不一致も verifyIdToken が throw するため、不正トークンと同じ 401 パスを通る
  const router = await importBillingWithMockedGoogle(t, () => {
    throw new Error('audience mismatch');
  });
  const { port, close } = await createTestServer(router);
  t.after(close);

  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token_with_wrong_audience',
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test('webhook: 想定外のservice accountのemail → 403', async (t) => {
  setupOidcEnv(t);
  // 署名は正しいが email が設定済みサービスアカウントと一致しない
  const router = await importBillingWithMockedGoogle(t, () => ({
    getPayload: () => ({ email: 'attacker@evil.com', email_verified: true }),
  }));
  const { port, close } = await createTestServer(router);
  t.after(close);

  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token_with_wrong_email',
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 403);
});

test('webhook: 正規のOIDCトークン（モック）→ 認証通過し後続処理に到達', async (t) => {
  setupOidcEnv(t);
  // 正規のサービスアカウントで email_verified = true
  const router = await importBillingWithMockedGoogle(t, () => ({
    getPayload: () => ({ email: 'sa@test.iam.gserviceaccount.com', email_verified: true }),
  }));
  const { port, close } = await createTestServer(router);
  t.after(close);

  // body に message.data がない → 認証後の処理で 400 "invalid message" が返る
  // 401/403 ではなく 400 が返ることで「認証が通過して後続処理に到達した」ことを確認する
  const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer valid_mock_token',
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid message');
});
