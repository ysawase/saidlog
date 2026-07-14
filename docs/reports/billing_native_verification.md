# ESM import 移行後の Android 実機検証レポート

- 検証日: 2026-07-13
- 対象: billing.js ESM import 移行版（未コミット、ビルド/cap sync 済み）
- 端末: Android 実機（Pixel 系、ワイヤレスデバッグ接続）、debug APK を adb install で再インストール
- コード変更: なし（検証のみ）

## 結論サマリ

| 確認項目 | 結果 |
|---|---|
| 「CdvPurchase not available」警告 | **消滅（解消確認）**。起動ログに0件。代わりに `Create CdvPurchase...` が出力され、JSがWebViewにロードされている |
| store.initialize の完走 | **成功**。PurchasePlugin 登録 → init() → startServiceConnection() → Success まで例外なし |
| Google Play 接続・商品クエリ | **接続・クエリ自体は成功**。ただし商品情報が **0件** で返る |
| 購入UI到達 | **到達できた**。「SaidLog Plusに進む」ボタンまで遷移・押下可能 |
| purchaseTake() | **失敗**（`Product not found: take_monthly_680`）。JS側の例外であり、Google Play Billing のエラーコードは発生していない |
| 決済確定操作 | 実施せず（商品0件のため決済画面には到達しない） |

## 起動時ログの要点（logcat）

```
D Capacitor: Registering plugin instance: PurchasePlugin
D CdvPurchase: handleOnStart()
I Capacitor/Console: Msg: Create CdvPurchase...          ← JS側でCdvPurchase生成（移行前は未ロードだった）
D CdvPurchase: init()
D CdvPurchase: startServiceConnection()
D CdvPurchase: startServiceConnection() -> Success       ← Google Play Billing接続成功
D CdvPurchase: init() -> Success
D CdvPurchase: getStorefront() -> JP
D CdvPurchase: getAvailableProducts()                    ← subsSkus: ["take_monthly_680"] を照会
D CdvPurchase: queryProductDetailsAsync() -> Success     ← クエリ自体は成功
W CdvPurchase: queryAllProductDetails() -> Query returned nothing.  ← しかし結果0件
I Capacitor/Console: Msg: {"products":[]}
I CdvPurchase: queryPurchases(INAPP/SUBS) -> 完了（purchases: []）
```

- 「CdvPurchase not available」は起動ログ全体で **0件**（grep確認）
- エラー・例外・クラッシュなし。初期化フローは最後まで完走

## 購入UI到達と purchaseTake() の結果

1. アプリ起動 → ログイン済み・無料プラン表示の正常状態
2. 「無料枠と料金を見る」→ プラン比較セクション → 「SaidLog Plusに進む」ボタンに到達（UI到達OK）
3. ボタン押下時のログ（これが唯一の関連行）:

```
E Capacitor/Console: Msg: [upgrade] purchaseTake failed: Error: Product not found: take_monthly_680
```

4. 画面には既存のフォールバック文言「購入処理に失敗しました。時間をおいて再度お試しください。」が表示（App.jsx の catch が想定どおり動作）

### エラーの性質

- **Google Play Billing のエラーコード（BillingResult / CdvPurchase.ErrorCode）は一切発生していない**
- 失敗箇所は billing.js `purchaseTake()` 内の `store.get('take_monthly_680', Platform.GOOGLE_PLAY)` が undefined を返し、コード自身の `throw new Error('Product not found: ...')` が投げられたもの
- つまり「起動時の商品クエリが0件だった」ことの帰結であり、購入フロー自体の不具合ではない

## 原因の推定（Google Play Console 側の設定と推定。billing.js のコード起因ではない）

接続成功・クエリ成功・結果0件というパターンの典型的な原因（いずれもPlay Console側でのみ確認可能）:

1. アプリ（com.saidlog.app）が内部テスト等のトラックに一度もアップロードされていない、または検証端末のGoogleアカウントがテスターに未登録
2. 定期購入 take_monthly_680 が有効化されていない（下書き状態）、または基本プラン（base plan）が有効になっていない
3. サイドロードした debug 署名ビルドのため、Playがパッケージ＋署名の組み合わせを認識していない（テストトラック配信済みであれば通常はサイドロードでも商品取得可能）

## ESM import 移行（案2）の評価

**移行の目的は達成。** 移行前の問題「JSがWebViewにロードされず window.CdvPurchase が undefined」は解消し、JS→ネイティブ→Google Play の疎通まで確認できた。残る商品0件の問題はコード外（Play Console構成）の課題。

## 次ステップ（未実施）

1. Play Console で確認: take_monthly_680 のステータス（有効か）／基本プランの有効化／内部テストトラックへのAABアップロード有無／検証アカウントのテスター登録
2. 上記解消後、同じ手順で商品取得（products が1件返ること）→ ライセンステスターでの購入フロー検証
3. 検証完了後に billing.js の移行と本レポート等をまとめてコミット

## 備考

- ログ中に purchase_token・個人情報・Google APIレスポンスraw全文は含まれていない（商品・購入とも0件のため該当データ自体が存在しない）。検証端末のログインアカウントのメールアドレスは本レポートから除外した
