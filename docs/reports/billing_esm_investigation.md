# capacitor-plugin-cdv-purchase ESM import 移行可否調査レポート

- 調査日: 2026-07-13
- 調査方法: 読み取り専用（コード変更・パッケージ操作・コミットなし）
- 対象: saidlog リポジトリ（git pull 済み、HEAD: 30064e2）

## 結論（先出し）

**案2（ESM import 移行）は可能。変更対象は `client/src/lib/billing.js` の1ファイルのみで、案1（dist/plugins への JS コピー）は不要。**

---

## 1. パッケージ導入状況

| 項目 | 確認結果 |
|---|---|
| ルート `package.json` | `"capacitor-plugin-cdv-purchase": "^13.17.2"`（dependencies、22行目） |
| `client/package.json` | 記載なし |
| node_modules 実体 | ルート `node_modules/capacitor-plugin-cdv-purchase`（実インストール版 13.17.2）。`client/node_modules` 配下には存在しない |

補足（重要な前例）: `@capacitor/filesystem` と `@capacitor/share` も同様に**ルートのみ**に導入されており、`client/src/lib/recorder.js:6-7` から import されて Android 実機で動作実績がある（コミット 30064e2）。Node/Vite のモジュール解決は親ディレクトリの node_modules を遡るため、client 側コードからルート専属パッケージを import する構成は本プロジェクトで既に成立している。

## 2. 公式 README 推奨の import 形式

`node_modules/capacitor-plugin-cdv-purchase/README.md` の Usage 節（原文引用）:

```typescript
import { store, ProductType, Platform } from 'capacitor-plugin-cdv-purchase';

// Register products
store.register([{
  id: 'my_subscription',
  type: ProductType.PAID_SUBSCRIPTION,
  platform: Platform.GOOGLE_PLAY, // or Platform.APPLE_APPSTORE
}]);
```

Migration 節（原文引用）:

> 4. Update your import to `import { store, ProductType, Platform } from 'capacitor-plugin-cdv-purchase'` — the API is identical

README に `window.CdvPurchase` 方式の記載は**ない**。ESM import が唯一の案内された使用方法である。

なお `dist/index.js` の実装を確認したところ、モジュール読み込み時の副作用として `window.CdvPurchase = CdvPurchase`（dist/index.js:2475）も設定される。つまり ESM import を1回行えば `window.CdvPurchase` も同時に生えるが、公式推奨に従い named import へ揃えるのが正道。

### window.CdvPurchase が undefined だった原因（根本原因）

本パッケージの `package.json` には `"capacitor": { "ios": ..., "android": ... }` フィールドがあり、**Capacitor ネイティブプラグイン**として `npx cap sync` に認識される。Capacitor プラグインはネイティブコードのみ自動登録され、Cordova プラグインと異なり **JS が WebView へ自動注入されることはない**。JS 側はアプリコードが ESM import して初めて実行される。現行の billing.js は import せず `window.CdvPurchase` を読むだけなので、JS が一度もロードされず undefined のまま——という構図（Capacitor の標準挙動に基づく説明。パッケージ内 `www/store.js` が存在するのは Cordova 版との共用のためで、Capacitor ビルドでは使われない）。

## 3. パッケージの実際の export

`node_modules/capacitor-plugin-cdv-purchase/package.json`:

```json
"main": "dist/index.js",
"module": "dist/index.js",
"types": "types/index.d.ts",
"exports": {
  ".": {
    "types": "./types/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  },
  "./package.json": "./package.json"
}
```

- `dist/index.js`（9,133行）は **ESM 形式**（`import { registerPlugin } from '@capacitor/core'` で始まり、末尾が `export { CdvPurchase, ErrorCode, Iaptic, LogLevel, Logger, Platform, ProductType, PurchasePlugin, Store, store };`）
- `dist/esm/` ディレクトリも存在（definitions/index の .js と .d.ts）
- 型定義 `types/index.d.ts` でも `store` / `Store` / `ProductType` / `Platform` / `LogLevel` / `ErrorCode` / `Logger` / `Iaptic` の named export を宣言

→ **billing.js が必要とする `store` / `ProductType` / `Platform` はすべて named export として実在する。**

## 4. billing.js の現状

### window.CdvPurchase 参照箇所（client/src/lib/billing.js）

| 行 | 内容 |
|---|---|
| 57 | `const { CdvPurchase } = window;`（initBilling 内） |
| 58-61 | `if (!CdvPurchase)` → 警告「CdvPurchase not available」して return |
| 63 | `const { store, ProductType, Platform } = CdvPurchase;` |
| 91 | `const { CdvPurchase } = window;`（purchaseTake 内） |
| 92 | `if (!CdvPurchase) throw new Error('CdvPurchase not available');` |
| 94 | `const { store, Platform } = CdvPurchase;` |
| 110 | `const { CdvPurchase } = window;`（restorePurchases 内） |
| 111 | `if (!CdvPurchase) return;` |
| 113 | `await CdvPurchase.store.restorePurchases();` |

### 使用しているプロパティ

- `store`: `register()` / `when().approved().verified()` / `initialize([Platform.GOOGLE_PLAY])` / `get('take_monthly_680', Platform.GOOGLE_PLAY)` / `restorePurchases()`
- `ProductType`: `PAID_SUBSCRIPTION`（65-69行）
- `Platform`: `GOOGLE_PLAY`（68, 78, 95行）
- `ErrorCode`: **billing.js では未使用**（タスク文に挙がっていたが実コードに参照なし）

### upgradeGuard.js との関係

- `upgradeGuard.js` は `@capacitor/core` の `Capacitor` のみ import。**CdvPurchase / billing.js への依存はゼロ**。今回の移行の影響を受けない。
- 両者を繋ぐのは `App.jsx` のみ:
  - `App.jsx:11` — `import { initBilling, purchaseTake, restorePurchases } from './lib/billing';`
  - `App.jsx:12` — `import { getUpgradeMode } from './lib/upgradeGuard';`
  - `App.jsx:234` — `getUpgradeMode({...})` で upgradeMode 判定
  - `App.jsx:246-265` — `handleUpgrade()` 内で `upgradeMode === 'purchase'` のときのみ `purchaseTake()` 実行

### initBilling() の呼び出し元

- `App.jsx:41` — `useEffect(() => { initBilling(); }, []);`（起動時1回のみ）
- ほかに `purchaseTake` は `App.jsx:249`、`restorePurchases` は `App.jsx:279`（購入を復元ボタン）から呼ばれる

## 5. ESM import 移行の最小差分見積もり

### 変更が必要なファイル: billing.js の1ファイルのみ

- `window.CdvPurchase` 参照は client 全体で billing.js にしか存在しない（grep で確認済み）
- App.jsx / upgradeGuard.js は billing.js の export 関数（シグネチャ不変）を呼ぶだけなので無変更

### 変更内容の骨子（実装はしていない）

1. 冒頭に `import { store, ProductType, Platform } from 'capacitor-plugin-cdv-purchase';` を追加
2. 3関数内の `const { CdvPurchase } = window;` と `if (!CdvPurchase)` ガード（57-63, 91-94, 110-111行）を削除し、import した `store` / `ProductType` / `Platform` を直接使用
3. 113行の `CdvPurchase.store.restorePurchases()` → `store.restorePurchases()`

補足検討: 静的 import はモジュール読み込み時に副作用（`window.CdvPurchase` 設定、`registerPlugin('PurchasePlugin')` 実行）が Web ビルドでも走る。`registerPlugin` 自体は呼び出しまで例外を出さないため実害はない見込み（推測）だが、Web バンドルから完全に切り離したい場合は `isNative()` ガード内での動的 import（`await import('capacitor-plugin-cdv-purchase')`）という選択肢もある。Vite はどちらも標準対応。

### Vite 設定について

- `client/vite.config.js` に特別な対応は**不要**（推測ではなく前例根拠: 同じくルート専属の `@capacitor/filesystem` / `@capacitor/share` が設定変更なしで import・実機動作している）
- 留意点: プラグインは `@capacitor/core` をルート側 node_modules から、アプリコードは client 側 node_modules から解決するため、バンドルに core が2インスタンス入る可能性がある。両者とも 8.4.0 で一致しており、filesystem/share の前例でも問題は出ていないが、もし気になる場合は `resolve.dedupe: ['@capacitor/core']` の追加で一本化できる（必須ではない）

### セキュリティロジックへの影響

移行は「CdvPurchase オブジェクトの取得経路」の変更のみで、以下の**変更禁止対象**には一切触れずに実施可能:

- `verifyPurchaseOnServer()`（billing.js:15-47）— purchase_token のサーバー検証、access_token 必須条件、検証成功時のみ `receipt.finish()`
- `/api/billing/verify` への到達条件（`store.when().approved(tx => tx.verify()).verified(...)` のフロー、billing.js:71-76）
- サーバー検証前に Plus を付与しない構造（購入後も `getAccountStatus()` の再取得結果でのみ plan 状態を更新、App.jsx:250-257）
- `upgradeGuard.js` の6段階判定（多重押下・不正状態での購入開始防止）— 本移行の影響範囲外

## 6. 結論

**判定: 可能**（条件なし）

- パッケージ 13.17.2 は ESM 専用設計（main/module/exports すべて ESM の dist/index.js を指す）で、README も ESM import のみを案内している
- 必要な named export（store / ProductType / Platform）は dist・型定義の両方で実在確認済み
- 変更は billing.js 1ファイルで完結し、セキュリティロジックには触れない
- ルート専属パッケージを client から import する構成は @capacitor/filesystem / @capacitor/share で実機動作実績あり
- **案1（dist/plugins への JS コピー）は不要**。window.CdvPurchase が undefined なのは「Capacitor プラグインの JS は自動注入されない」という標準挙動によるもので、ESM import すれば解消する

### 次の実装ステップ案（実装は未着手）

1. billing.js に named import を追加し、3関数の `window.CdvPurchase` 参照とガードを置き換える（静的 import で開始、Web 側副作用が気になれば動的 import へ）
2. `npm --prefix client run build` → `npx cap sync android` → Android 実機で initBilling のログ確認（「CdvPurchase not available」警告が消えること、`store.initialize` が完走すること）
3. 購入フローはサンドボックス（ライセンステスター）で検証し、`/api/billing/verify` 到達とサーバー検証後の plan 反映を確認
