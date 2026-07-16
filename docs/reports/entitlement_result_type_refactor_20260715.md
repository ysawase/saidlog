# entitlement状態管理 設計改善レポート

作成日: 2026-07-15
対象コミット: （未コミット、差分提示中）

---

## 1. resolveEntitlementStatus() の新しい入力契約・出力結果型

### 入力契約

```
この関数が受け取るのは RTDN の notificationType ではなく、
verifyGooglePlaySubscription() が Developer API (purchases.subscriptionsv2.get) を
再照会して返した verification オブジェクトである。

RTDN 通知は at-least-once かつ順序不保証のため、通知の値を直接状態遷移に使わず、
常に Developer API を再照会してから本関数を呼ぶこと。
```

### 出力結果型

```typescript
{ result: 'entitled' | 'not_entitled' | 'retryable_error' | 'invalid_purchase', status: string | null }
```

| result | status | 意味 |
|---|---|---|
| `'entitled'` | `'active'` または `'grace_period'` | Plus利用可能 |
| `'not_entitled'` | `'expired'` | Plus利用不可（期限切れ・停止） |
| `'retryable_error'` | `null` | 設定不備等の一時的エラー。非2xxで再試行させる |
| `'invalid_purchase'` | `null` | TOKEN_INVALID / PRODUCT_MISMATCH / 未知reason。既存entitlement維持 |

---

## 2. RECOVEREDケースが何を模擬しているか

テスト名:
```
「RTDN SUBSCRIPTION_RECOVERED通知後にDeveloper APIを再照会した結果がACTIVEの場合 → entitled/active」
```

**模擬している状況:**
RTDN で `notificationType=SUBSCRIPTION_RECOVERED`（RTDNの通知種別）を受けた webhook が、
`verifyGooglePlaySubscription()` を呼んで Developer API を再照会する。
ON_HOLD 等から回復した購読は Developer API が `subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE'` を返す。
`resolveEntitlementStatus()` が受け取るのはその再照会結果（`valid: true, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE'`）であり、
RTDN の `notificationType` 文字列ではない。

---

## 3. verify/webhook それぞれの結果型ごとの分岐

### POST /api/billing/verify

| result | HTTP応答 | DB更新 | 備考 |
|---|---|---|---|
| `'entitled'` | 200 | upsert（status: 'active' または 'grace_period'） | Plus付与 |
| `'not_entitled'` | 403 | なし | EXPIRED/NOT_ACTIVE |
| `'retryable_error'` | 403 | なし | NOT_CONFIGURED は先に500で弾く |
| `'invalid_purchase'` | 403 | なし | TOKEN_INVALID/PRODUCT_MISMATCH |

※NOT_CONFIGUREDはresolveEntitlementStatus()を呼ぶ前に500で早期return（変更なし）

### POST /api/billing/webhook

| result | HTTP応答 | DB更新 | Pub/Sub再試行 | 備考 |
|---|---|---|---|---|
| `'entitled'` | 200 | update（status: 'active' または 'grace_period'） | なし | 通常ACTIVE/CANCELED/IN_GRACE_PERIOD |
| `'not_entitled'` | 200 | update（status: 'expired'） | なし | EXPIRED/NOT_ACTIVE |
| `'retryable_error'` | 500 | なし | あり（Pub/Subが非2xxで再試行） | 設定不備等 |
| `'invalid_purchase'` | 200 | なし | なし | TOKEN_INVALID/PRODUCT_MISMATCH |

※NOT_CONFIGUREDはresolveEntitlementStatus()を呼ぶ前に500で早期return（変更なし）

---

## 4. ENTITLED_STATUSES の共通化

`server/services/subscriptionStatus.js` から export:
```javascript
export const ENTITLED_STATUSES = ['active', 'grace_period'];
```

`server/services/plan.js` の getEntitlement() が import して使用:
```javascript
import { ENTITLED_STATUSES } from './subscriptionStatus.js';
// ...
.in('status', ENTITLED_STATUSES)
```

これにより、Plus判定の状態リストが subscriptionStatus.js の生成ロジックと同じファイルで管理される。
将来 'grace_period' 以外の状態を追加した場合も、subscriptionStatus.js 側だけを変更すれば良い。

---

## 5. git diff --stat とテスト実行結果

### diff --stat

```
 server/routes/billing.js              | 27 +++++-----
 server/services/plan.js               |  3 +-
 server/services/subscriptionStatus.js | 44 ++++++++++++++---
 tests/subscriptionStatus.test.mjs     | 92 ++++++++++++++++++++---------------
 4 files changed, 108 insertions(+), 58 deletions(-)
```

### テスト実行結果

```
tests 75 / pass 75 / fail 0
```

新規追加した10ケース（全て deepEqual で結果型を検証）:
- ACTIVE → entitled/active
- CANCELED かつ期限内 → entitled/active
- IN_GRACE_PERIOD → entitled/grace_period
- RTDN SUBSCRIPTION_RECOVERED後、Developer API再照会結果がACTIVEの場合 → entitled/active
- EXPIRED → not_entitled/expired
- NOT_ACTIVE → not_entitled/expired
- NOT_CONFIGURED → retryable_error
- PRODUCT_MISMATCH → invalid_purchase
- TOKEN_INVALID → invalid_purchase
- 未知のreason → invalid_purchase

---

## 6. 新規購入正常系（ACTIVE → 'entitled' → Plus付与）に影響がないことの確認

### フロー

```
購入
  → billing.js (.verified callback)
    → verifyPurchaseOnServer(receipt)
      → /api/billing/verify
        → verifyGooglePlaySubscription(purchase_token)
           ↓ 通常購入: valid=true, subscriptionState='SUBSCRIPTION_STATE_ACTIVE'
        → NOT_CONFIGURED チェック（通過）
        → resolveEntitlementStatus() → { result: 'entitled', status: 'active' }
        → result === 'entitled' → upsert（status: 'active'）
        → 200 OK
  → getAccountStatus() → getEntitlement()
    → .in('status', ENTITLED_STATUSES)  // ['active', 'grace_period']
    → 'active' はマッチする
    → planId: 'take' → UI: SaidLog Plus 表示
```

**変更前後で動作は同一。** 通常購入では:
- resolveEntitlementStatus() は以前 `'active'`（文字列）を返していたが、今は `{ result: 'entitled', status: 'active' }` を返す
- 呼び出し元が `status` を取り出してDBに書き込む値は変わらず `'active'`
- plan.js の `.in('status', ENTITLED_STATUSES)` は `'active'` を含むためマッチする
- 今日のE2E確認（購入→検証→SaidLog Plus表示）に影響なし
