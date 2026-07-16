# 課金・RTDN現状把握レポート

作成日: 2026-07-15

---

## 1. 今回修正した3件の変更ファイル・commit hash・Production反映状況

| # | commit hash | コミットメッセージ | 変更ファイル | Vercel Production |
|---|---|---|---|---|
| 1 | `213f33d` | fix: correct purchaseToken path from receipt.sourceReceipt | `client/src/lib/billing.js` | 反映済み |
| 2 | `c41e4ea` | fix: prevent stale cache on /api/account/status after entitlement update | `server/routes/account.js` `client/src/api.js` | 反映済み |
| 3 | `fd80aef` | fix: remove overly strict current_period_end check causing valid subscriptions to fall back to free plan | `server/services/plan.js` | 反映済み |

**確認根拠:** `git log origin/main --oneline -1` の結果が `4f1ffdd`（本日最終コミット）であり、上記3件はすべてそれより前にマージ済み。Vercel はorigin/main への push で自動デプロイ。

---

## 2. Android versionCode / versionName と実機導入版

ソース: `android/app/build.gradle` 16〜17行目

```
versionCode 1
versionName "1.0"
```

**実機に導入した版:** コードベースから判断不可。`versionCode 1 / versionName "1.0"` が現在のビルド定義上の値。実機インストール済みAPKのバージョンは別途端末側で確認が必要。

---

## 3. RTDN実装状況

**判定: 実装済み・本番未検証**

`server/routes/billing.js` に `POST /api/billing/webhook` が実装されている。

実装内容:
- Pub/Sub push メッセージを受信（Authorization ヘッダーの Bearer トークンで OIDC 検証）
- `message.data` を base64 デコードして Google Play RTDN 通知を解析
- `subscriptionNotification.purchaseToken` が存在する場合、`verifyGooglePlaySubscription()` でGoogle Play Developer API（subscriptionsv2）から現在の購読状態を**再取得**（通知の値をそのまま使わない設計）
- `user_entitlements.status` と `current_period_end` を更新

検証状況:
- OIDC検証の設定値（`PUBSUB_PUSH_AUDIENCE`、`PUBSUB_PUSH_SERVICE_ACCOUNT`）が Vercel 環境変数に投入されているか不明
- Google Cloud Pub/Sub の push サブスクリプションが本番プロジェクトに設定されているか不明
- 実際に RTDN 通知が届いて user_entitlements が更新された事実確認なし

---

## 4. RTDN通知種別 → user_entitlements 変換ロジック

`server/routes/billing.js` webhook ハンドラーの変換ロジック（抜粋）:

```javascript
// verifyGooglePlaySubscription() の返却値 verification を元に判定
if (verification.valid) {
  newStatus = verification.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    ? 'grace_period'
    : 'active';                         // ACTIVE / CANCELED（期限内）→ 'active'
} else if (verification.reason === 'EXPIRED') {
  newStatus = 'expired';                // 有効期限切れ → 'expired'
} else if (verification.reason === 'NOT_ACTIVE') {
  newStatus = 'expired';                // ON_HOLD/PAUSED/PENDING等 → 'expired'（アクセス不可に寄せる）
} else if (verification.reason === 'NOT_CONFIGURED') {
  return res.status(500)...             // サービスアカウント未設定 → 500（再試行させる）
} else {
  // PRODUCT_MISMATCH / TOKEN_INVALID → 既存entitlementを書き換えない（スキップ）
}
```

Google PlayのsubscriptionState（例: `SUBSCRIPTION_STATE_ACTIVE`）から SaidLog の status への対応表:

| Google Play subscriptionState | verification.valid | SaidLog status |
|---|---|---|
| SUBSCRIPTION_STATE_ACTIVE | true | 'active' |
| SUBSCRIPTION_STATE_CANCELED（期限内） | true | 'active' |
| SUBSCRIPTION_STATE_IN_GRACE_PERIOD | true | 'grace_period' |
| 上記以外（ON_HOLD/PAUSED等） | false (NOT_ACTIVE) | 'expired' |
| 有効期限切れ | false (EXPIRED) | 'expired' |

---

## 5. status='active' の意味（Google Play生状態 vs SaidLog正規化済み）

**SaidLog独自の正規化済み利用権状態。** Google PlayのsubscriptionStateをそのまま格納していない。

設定箇所は2箇所:

**① `POST /api/billing/verify`（直接購入検証時）**
```javascript
// server/routes/billing.js:124
.upsert({ status: 'active', ... })
```
`verifyGooglePlaySubscription()` が `valid: true` を返した場合に無条件で `'active'` をセット（grace_period の区別なし）。

**② `POST /api/billing/webhook`（RTDN受信時）**
```javascript
// server/routes/billing.js:180
newStatus = verification.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
  ? 'grace_period' : 'active';
```
こちらは grace_period を区別する。

**参照箇所（読み取り側）**
```javascript
// server/services/plan.js:14
.eq('status', 'active')
```
`plan.js` は `'active'` のみを有効とみなす。`'grace_period'` は有効扱いにならない（現在の設計上の不整合として存在する）。

---

## 6. production_evidence_cards.md の現在の保存状況

ファイルパス: `docs/reports/production_evidence_cards.md`

現在の見出し一覧:

```
# 本番証拠カード
## 公開前ブロッカー：詳細要約・履歴閲覧条件のUI文言整合
## 詳細要約の生成・保存・安定再閲覧（本番証拠カード）
## 公開前ブロッカー：重要変更後の本番スモークテスト
## 公開前ブロッカー：AI要約障害の記録・確認
```

---

## 補足：設計上の注意点（事実の記録）

- `plan.js` が `status = 'active'` のみを判定するため、`'grace_period'` 中のユーザーはPlusとして扱われない。Webhook が正しく `'grace_period'` を書き込んでも、`getEntitlement()` は `'ume'` を返す。
- `current_period_end` による時刻チェックは本日の修正（`fd80aef`）で削除済み。
- テスト購入の有効期限（約5分）問題は `plan.js` 修正で解消された。本番購入（1ヶ月サイクル）では元々影響なかった。
