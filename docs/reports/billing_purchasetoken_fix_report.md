# billing.js purchaseToken 不一致バグ 調査・修正レポート

作成日: 2026-07-15

---

## 1. 原因

### コードが期待していた構造
```
receipt.purchaseToken   ← 存在しない
```

### 実際の VerifiedReceipt 構造
```
VerifiedReceipt {
  className: 'VerifiedReceipt'
  platform: Platform
  sourceReceipt: GooglePlay.Receipt {   ← ここに purchaseToken がある
    purchaseToken: string               ← 正しいパス
    orderId?: string
    transactions: Transaction[]
    ...
  }
  collection: VerifiedPurchase[]        ← purchaseToken は持たない
  nativeTransactions: NativeTransaction[]
  latestReceipt: boolean
  validationDate: Date
}
```

### 根拠（型定義）

`node_modules/capacitor-plugin-cdv-purchase/www/store.d.ts` より：

- **4711–4713行目**: `CdvPurchase.GooglePlay.Receipt extends CdvPurchase.Receipt` が `purchaseToken: string` を持つ
- **1993–2009行目**: 基底クラス `CdvPurchase.Receipt` には `purchaseToken` プロパティが存在しない
- **VerifiedReceipt.sourceReceipt** は型上 `CdvPurchase.Receipt`（基底型）だが、Android実行時は `GooglePlay.Receipt` のインスタンスになる

つまり `.verified()` コールバックで渡される `VerifiedReceipt` に `purchaseToken` は直接ない。
`receipt.purchaseToken` は常に `undefined` → ガード条件が即 `return false` していた。

---

## 2. 修正の差分

### git diff --stat
```
 client/src/lib/billing.js | 15 ++++++++++++---
 1 file changed, 12 insertions(+), 3 deletions(-)
```

### git diff 本文
```diff
diff --git a/client/src/lib/billing.js b/client/src/lib/billing.js
index 046f1b0..6df0b8a 100644
--- a/client/src/lib/billing.js
+++ b/client/src/lib/billing.js
@@ -14,8 +14,17 @@ let storeInitialized = false;
  * 成功時のみ true を返す。
  */
 async function verifyPurchaseOnServer(receipt) {
-  if (!receipt.purchaseToken) {
-    console.error('[billing] receipt.purchaseToken is missing, skipping verification');
+  // [DEBUG] receiptオブジェクトの構造確認（キー名のみ・値は出力しない）
+  console.log('[billing][debug] receipt class:', receipt?.className);
+  console.log('[billing][debug] receipt keys:', Object.keys(receipt ?? {}));
+  console.log('[billing][debug] sourceReceipt keys:', receipt?.sourceReceipt ? Object.keys(receipt.sourceReceipt) : 'undefined');
+  console.log('[billing][debug] collection length:', receipt?.collection?.length ?? 'n/a');
+
+  // VerifiedReceipt には purchaseToken は直接存在しない。
+  // Google Play の購入トークンは sourceReceipt (GooglePlay.Receipt) に格納されている。
+  const purchaseToken = receipt.sourceReceipt?.purchaseToken;
+  if (!purchaseToken) {
+    console.error('[billing] purchaseToken is missing from receipt.sourceReceipt, skipping verification');
     return false;
   }
 
@@ -33,7 +42,7 @@ async function verifyPurchaseOnServer(receipt) {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${accessToken}`,
       },
-      body: JSON.stringify({ purchase_token: receipt.purchaseToken }),
+      body: JSON.stringify({ purchase_token: purchaseToken }),
     });
```

---

## 3. 追加したデバッグログ

```javascript
console.log('[billing][debug] receipt class:', receipt?.className);
console.log('[billing][debug] receipt keys:', Object.keys(receipt ?? {}));
console.log('[billing][debug] sourceReceipt keys:', receipt?.sourceReceipt ? Object.keys(receipt.sourceReceipt) : 'undefined');
console.log('[billing][debug] collection length:', receipt?.collection?.length ?? 'n/a');
```

- 値（購入トークンの実際の文字列など）は一切出力しない
- キー名の一覧と `className`、`collection` の件数のみ
- 実機でテストした場合の期待出力例：
  ```
  [billing][debug] receipt class: VerifiedReceipt
  [billing][debug] receipt keys: ["className","validationDate","sourceReceipt","collection","latestReceipt","nativeTransactions"]
  [billing][debug] sourceReceipt keys: ["className","platform","transactions","purchaseToken","orderId"]
  [billing][debug] collection length: 1
  ```
  → `sourceReceipt.purchaseToken` の存在が確認できれば修正の正しさを証明できる

---

## 4. この修正で解決する自信と根拠

**自信度: 高（85%）**

### 確実な根拠
- 型定義（`store.d.ts`）から `VerifiedReceipt` に `purchaseToken` プロパティが存在しないことを明示的に確認
- `purchaseToken` は `GooglePlay.Receipt`（`VerifiedReceipt.sourceReceipt` の実体）のプロパティとして型定義に存在することを確認
- エラーログ「receipt.purchaseToken is missing」が常に出力されるのは、`VerifiedReceipt` に `purchaseToken` がないため必ず `undefined` になるから、という説明と一致する

### 残る不確実性（15%）
- バリデーターサーバーを使用していない場合（`store.initialize()` に `validator` を設定していない場合）、cdv-purchase が `.verified()` を呼ぶかどうかの動作がバージョンによって異なる可能性がある
  - ただし現在エラーログが出ているということは `.verified()` は呼ばれており、`receipt` オブジェクト自体は届いている
- `receipt.sourceReceipt` が `null` または別の型になるケースがゼロではないが、デバッグログで確認後に対処可能

### 追加確認事項（実機テスト後）
デバッグログで `sourceReceipt keys` に `purchaseToken` が含まれることを確認してから、デバッグログを削除してコミットすることを推奨。
