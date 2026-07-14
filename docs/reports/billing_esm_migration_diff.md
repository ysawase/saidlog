# billing.js ESM import 移行（案2）実装差分

- 実施日: 2026-07-13
- 変更ファイル: `client/src/lib/billing.js` のみ（未コミット）
- 事前調査: docs/reports/billing_esm_investigation.md

## 確認結果

| 項目 | 結果 |
|---|---|
| `window.CdvPurchase` の残存 | なし（`CdvPurchase` という文字列自体がファイルから消滅、grep で確認） |
| 関数シグネチャ | `initBilling()` / `purchaseTake()` / `restorePurchases()` とも引数・返り値・export 形式に変更なし（App.jsx 側への影響なし） |
| セキュリティロジック | `verifyPurchaseOnServer()`・`approved→verify→verified→サーバー検証成功時のみ finish()` のフローは無変更 |
| `npm --prefix client run build` | 成功（vite v6.4.3、14.57s、エラーなし。500kB超チャンク警告は既存のもの） |
| `npx cap sync android` | 成功（capacitor-plugin-cdv-purchase@13.17.2 を含む4プラグイン認識） |
| バンドル確認 | 同期後の `android/app/src/main/assets/public/assets/index-GulOAkz4.js` に CdvPurchase のコードが含まれることを確認（JS が WebView にロードされる状態になった） |

## git diff

```diff
diff --git a/client/src/lib/billing.js b/client/src/lib/billing.js
index 97fa792..046f1b0 100644
--- a/client/src/lib/billing.js
+++ b/client/src/lib/billing.js
@@ -1,4 +1,5 @@
 import { Capacitor } from '@capacitor/core';
+import { store, ProductType, Platform } from 'capacitor-plugin-cdv-purchase';
 import { supabase } from './supabase';
 
 const API_BASE = import.meta.env.VITE_API_BASE ?? '';
@@ -54,14 +55,6 @@ export async function initBilling() {
   if (!isNative()) return;
   if (storeInitialized) return;
 
-  const { CdvPurchase } = window;
-  if (!CdvPurchase) {
-    console.warn('[billing] CdvPurchase not available');
-    return;
-  }
-
-  const { store, ProductType, Platform } = CdvPurchase;
-
   store.register([{
     id: 'take_monthly_680',
     type: ProductType.PAID_SUBSCRIPTION,
@@ -88,10 +81,6 @@ export async function purchaseTake() {
     return;
   }
 
-  const { CdvPurchase } = window;
-  if (!CdvPurchase) throw new Error('CdvPurchase not available');
-
-  const { store, Platform } = CdvPurchase;
   const product = store.get('take_monthly_680', Platform.GOOGLE_PLAY);
   if (!product) throw new Error('Product not found: take_monthly_680');
 
@@ -107,8 +96,5 @@ export async function purchaseTake() {
 export async function restorePurchases() {
   if (!isNative()) return;
 
-  const { CdvPurchase } = window;
-  if (!CdvPurchase) return;
-
-  await CdvPurchase.store.restorePurchases();
+  await store.restorePurchases();
 }
```

## 次ステップ（未実施）

1. Android 実機へインストールし、起動ログで「CdvPurchase not available」警告が消えたこと・`store.initialize` 完走を確認
2. ライセンステスターで購入フロー検証（`/api/billing/verify` 到達とサーバー検証後の plan 反映）
3. 検証後にまとめてコミット
