# grace_period判定統一 修正レポート

作成日: 2026-07-15

---

## 修正概要

verify経路とwebhook経路でGoogle Play状態→SaidLog内部statusの変換ロジックが異なっていたため、
grace_period中のユーザーが無料プランへ落ちるバグを修正した。

---

## 共通変換関数の設計（resolveEntitlementStatus）

ファイル: `server/services/subscriptionStatus.js`（新規作成）

| Google Play subscriptionState / reason | verification.valid | SaidLog status |
|---|---|---|
| SUBSCRIPTION_STATE_ACTIVE | true | `'active'` |
| SUBSCRIPTION_STATE_CANCELED（期限内） | true | `'active'` |
| SUBSCRIPTION_STATE_IN_GRACE_PERIOD | true | `'grace_period'` |
| RECOVERED（→ Google側でACTIVEに戻る） | true | `'active'` |
| reason: EXPIRED | false | `'expired'` |
| reason: NOT_ACTIVE（ON_HOLD/PAUSED等） | false | `'expired'` |
| reason: PRODUCT_MISMATCH / TOKEN_INVALID | false | `null`（更新スキップ） |
| reason: NOT_CONFIGURED | false | 呼び出し元が事前に弾く（500を返す） |

---

## git diff --stat

```
 server/routes/billing.js | 25 ++++++++++---------------
 server/services/plan.js  |  4 ++--
 2 files changed, 12 insertions(+), 17 deletions(-)
```

新規ファイル（未ステージ）:
- `server/services/subscriptionStatus.js` (+20行)
- `tests/subscriptionStatus.test.mjs` (+57行)

---

## 変更内容（diff本文）

### server/routes/billing.js

```diff
+import { resolveEntitlementStatus } from '../services/subscriptionStatus.js';

 // /verify ハンドラー内
-        status: 'active',
+    // verification.valid が true の場合、resolveEntitlementStatus は必ず 'active' か 'grace_period' を返す
+    const newStatus = resolveEntitlementStatus(verification);
+        status: newStatus,

 // /webhook ハンドラー内
-      let newStatus;
-      if (verification.valid) {
-        newStatus = verification.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
-          ? 'grace_period'
-          : 'active';
-      } else if (verification.reason === 'EXPIRED') {
-        newStatus = 'expired';
-      } else if (verification.reason === 'NOT_ACTIVE') {
-        newStatus = 'expired';
-      } else if (verification.reason === 'NOT_CONFIGURED') {
+      if (verification.reason === 'NOT_CONFIGURED') {
         console.error('[billing/webhook] verifyGooglePlaySubscription: NOT_CONFIGURED');
         return res.status(500).json({ error: 'billing not configured' });
-      } else {
+      }
+      const newStatus = resolveEntitlementStatus(verification);
+      if (newStatus === null) {
         console.warn('[billing/webhook] 検証結果により更新をスキップ:', verification.reason);
         return res.status(200).json({ ok: true });
       }
```

### server/services/plan.js

```diff
-    .eq('status', 'active')
+    .in('status', ['active', 'grace_period'])
```

---

## 追加した単体テスト（tests/subscriptionStatus.test.mjs）

テストケース一覧:
1. ACTIVE → active
2. CANCELED かつ期限内 → active
3. IN_GRACE_PERIOD → grace_period
4. RECOVERED後（Google側でACTIVEに戻った場合）→ active
5. EXPIRED → expired
6. NOT_ACTIVE (ON_HOLD/PAUSED/PENDING) → expired
7. PRODUCT_MISMATCH → null（更新スキップ）
8. TOKEN_INVALID → null（更新スキップ）
9. NOT_CONFIGURED → null（呼び出し元が事前に弾く想定だが、到達しても安全側に倒す）
10. 未知の reason → null（更新スキップ）

実行結果: **75件全テスト通過（fail: 0）** ※既存65件 + 新規10件

---

## 今日確認した新規購入正常系への影響確認

今日確認したフロー: 購入 → `/api/billing/verify` → `getEntitlement()` → UI反映

変更後の動作:
1. `verifyGooglePlaySubscription()` が `valid: true` を返す（通常購入はACTIVE状態）
2. `resolveEntitlementStatus()` が `'active'` を返す（変更前と同じ値）
3. `user_entitlements.status = 'active'` で upsert（変更前と同じ）
4. `getEntitlement()` の `.in('status', ['active', 'grace_period'])` が 'active' を含むためマッチする

**通常の新規購入では status='active' が書き込まれるため、今日のE2E確認結果に影響なし。**
grace_period（支払い失敗時の猶予期間）は通常購入では発生しないため、新規購入正常系に変化はない。

---

## 設計上の注意点

- `plan.js` が `'grace_period'` を有効とみなすようになったが、
  grace_period中はGoogleが次の請求を試みている最中であり、アクセスを維持するのが正しい挙動
- `NOT_CONFIGURED` はwebhookハンドラー内で `resolveEntitlementStatus()` を呼ぶ前に独立した早期returnとして処理される
- `resolveEntitlementStatus()` 自体は500を返す処理を持たない（安全な純粋関数）
