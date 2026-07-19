# 課金・RTDN 追加調査レポート

作成日: 2026-07-15

---

## 1. purchase acknowledge の実装箇所

### 判定: **ライブラリ（capacitor-plugin-cdv-purchase）が自動でacknowledge**

**根拠コード（`client/src/lib/billing.js`）:**
```javascript
store.when()
  .approved(transaction => transaction.verify())
  .verified(async receipt => {
    const ok = await verifyPurchaseOnServer(receipt);
    if (ok) await receipt.finish();  // ← ここでacknowledgeが内部呼び出しされる
  });
```

`receipt.finish()` は `VerifiedReceipt` のメソッドで、ライブラリ内部で Google Play の acknowledge を呼ぶ。

**ライブラリ内部の実装（`node_modules/capacitor-plugin-cdv-purchase/www/store.js`）:**

```javascript
// store.js:6349 Google Play adapter の finish() メソッド
if (product.type === ProductType.NON_RENEWING_SUBSCRIPTION || product.type === ProductType.CONSUMABLE) {
  if (!transaction.isConsumed)
    return this.bridge.consumePurchase(onSuccess, onFailure, receipt.purchaseToken);
} else { // subscription and non-consumable
  if (!transaction.isAcknowledged)
    return this.bridge.acknowledgePurchase(onSuccess, onFailure, receipt.purchaseToken);
}
```

- `take_monthly_680` は `ProductType.PAID_SUBSCRIPTION`（サブスクリプション）
- `receipt.finish()` → adapter の `finish(transaction)` → `bridge.acknowledgePurchase()` が呼ばれる
- さらに `bridge.acknowledgePurchase()` は Capacitor プラグイン経由でネイティブ Android の `acknowledgePurchase` APIを呼ぶ

**追加: サーバー側での acknowledgementState 確認**

`server/services/googlePlay.js` の `verifyGooglePlaySubscription()` は:
```javascript
acknowledgementState: purchase.acknowledgementState ?? null,
```
として `acknowledgementState` を返却している。呼び出し元（verify/webhook）では現状この値を利用していないが、Developer API レスポンスから確認可能な状態になっている。

**結論: 実装済み。`receipt.finish()` 呼び出しがacknowledgeを兼ねている。サーバー検証成功時のみ `receipt.finish()` が呼ばれる設計になっており、未検証の購入が acknowledge されることはない。**

---

## 2. resolveEntitlementStatus() の入力契約（4d4f86b での明記内容の再掲）

`server/services/subscriptionStatus.js` JSDoc より:

```
Google Play Developer API (purchases.subscriptionsv2.get) を再照会した結果を
SaidLog 内部の利用権状態に変換する。

【重要】この関数が受け取るのは RTDN の notificationType ではなく、
verifyGooglePlaySubscription() が Developer API を再照会して返した
verification オブジェクトである。
RTDN 通知は at-least-once かつ順序不保証のため、通知の値を直接状態遷移に使わず、
常に Developer API を再照会してから本関数を呼ぶこと。
```

**呼び出し元でのパラメーター渡し方:**

verify (`server/routes/billing.js:90, 97`):
```javascript
const verification = await verifyGooglePlaySubscription(purchase_token);
// ...
const { result, status: newStatus } = resolveEntitlementStatus(verification);
```

webhook (`server/routes/billing.js:176, 184`):
```javascript
const verification = await verifyGooglePlaySubscription(purchaseToken);
// ...
const { result, status: newStatus } = resolveEntitlementStatus(verification);
```

両経路とも `verifyGooglePlaySubscription()` の返却値をそのまま渡している。

---

## 3. RECOVEREDテストケースの意味（`tests/subscriptionStatus.test.mjs` より再掲）

テスト名:
```
「RTDN SUBSCRIPTION_RECOVERED通知後にDeveloper APIを再照会した結果がACTIVEの場合 → entitled/active」
```

テスト内コメント:
```javascript
// RTDN の notificationType=SUBSCRIPTION_RECOVERED を受けた webhook は
// verifyGooglePlaySubscription() で Developer API を再照会する。
// ON_HOLD 等から回復した購読は Developer API が SUBSCRIPTION_STATE_ACTIVE を返す。
// この関数が受け取るのはその再照会結果であり、通知種別の文字列ではない。
```

---

## 4. invalid/mismatch/unknown の経路別挙動（該当コード引用）

### POST /api/billing/verify（`billing.js:97–100`）

```javascript
const { result, status: newStatus } = resolveEntitlementStatus(verification);
if (result !== 'entitled') {
  console.warn('[billing/verify] 検証失敗:', verification.reason, verification.subscriptionState);
  return res.status(403).json({ error: '購入トークンの検証に失敗しました', reason: verification.reason });
}
```

| result | HTTP | DB更新 |
|---|---|---|
| `entitled` | 200 + upsert | あり |
| `not_entitled` / `retryable_error` / `invalid_purchase` | 403 | なし |

### POST /api/billing/webhook（`billing.js:184–194`）

```javascript
const { result, status: newStatus } = resolveEntitlementStatus(verification);

if (result === 'retryable_error') {
  console.error('[billing/webhook] retryable error:', verification.reason);
  return res.status(500).json({ error: 'internal error' });
}
if (result === 'invalid_purchase') {
  // TOKEN_INVALID / PRODUCT_MISMATCH 等の異常系。既存entitlementは書き換えない。
  console.warn('[billing/webhook] 検証結果により更新をスキップ:', verification.reason);
  return res.status(200).json({ ok: true });
}
// result === 'entitled' または 'not_entitled': 通常通り DB 更新して 200
```

| result | HTTP | DB更新 | Pub/Sub再試行 | ログ |
|---|---|---|---|---|
| `entitled` / `not_entitled` | 200 | あり | なし | なし |
| `retryable_error` | 500 | なし | あり | console.error |
| `invalid_purchase` | 200 | なし | なし | console.warn |

---

## 5. ENTITLED_STATUSES 共通化内容（該当コード引用）

**定義元: `server/services/subscriptionStatus.js:6`**
```javascript
export const ENTITLED_STATUSES = ['active', 'grace_period'];
```

コメント:
```
Plus利用可能とみなす user_entitlements.status の値。
plan.js の getEntitlement() で使用する。resolveEntitlementStatus() の
result='entitled' が書き込む status 値のセットと常に一致させること。
```

**使用箇所: `server/services/plan.js:3, 15`**
```javascript
import { ENTITLED_STATUSES } from './subscriptionStatus.js';
// ...
.in('status', ENTITLED_STATUSES)
```

---

## 6. OIDC否定系テスト（新規追加: `tests/webhookOidc.test.mjs`）

### 実現方式

`verifyPubSubPushToken()` は `billing.js` から export されていない非公開関数のため、
`/webhook` エンドポイントへの HTTP リクエスト経由でテストした。
`t.mock.module('googleapis', ...)` で `google.auth.OAuth2.verifyIdToken` の
挙動を制御し、ランダムポートで起動した Mini Express サーバーに fetch でリクエストを送る。

### テスト結果（全5件通過）

| # | テスト名 | 期待値 | 実測値 |
|---|---|---|---|
| 1 | Authorizationヘッダーなし | 401 | 401 ✔ |
| 2 | 不正な Bearer token（署名検証失敗） | 401 | 401 ✔ |
| 3 | audience不一致のtoken | 401 | 401 ✔ |
| 4 | 想定外のservice account email | 403 | 403 ✔ |
| 5 | 正規のOIDCトークン（モック）→ 後続処理に到達 | 400 (invalid message) | 400 ✔ |

シナリオ2と3は、どちらも `verifyIdToken` が throw する経路を通り 401 を返す（実装上の区別なし）。

---

## 7. messageId重複対策の確認

### 判定: **明示的な重複排除は未実装。ただし処理は冪等。**

**コード確認（`billing.js:202–205`）:**
```javascript
const { error: updateError } = await getSupabase()
  .from('user_entitlements')
  .update(update)
  .eq('purchase_token', purchaseToken);
```

- `message.messageId` や `message.publishTime` による重複チェックは実装されていない
- ただし、同一 `purchaseToken` に対して同じ `status` / `current_period_end` を複数回 UPDATE しても最終状態は変わらない（**冪等**）
- `resolveEntitlementStatus()` は純粋関数のため、同じ verification を何度渡しても同じ結果を返す

### 冪等性を確認するテスト（`tests/subscriptionStatus.test.mjs` に追加）

```javascript
test('同一の valid verification を2回渡しても毎回同じ結果を返す（純粋関数）', ...)
test('同一の invalid verification を2回渡しても毎回同じ結果を返す（副作用なし）', ...)
test('grace_period の verification を2回渡しても毎回 entitled/grace_period を返す', ...)
```

全3件通過。

---

## テスト実行結果まとめ

```
tests 83 / pass 83 / fail 0
```

内訳:
- 既存テスト（継続）: 65件
- subscriptionStatus テスト（うち今回追加3件）: 13件
- webhookOidc テスト（新規）: 5件
