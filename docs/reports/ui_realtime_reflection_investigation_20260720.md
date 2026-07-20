# UI即時反映・acknowledge実機検証レポート（2026-07-20）

## 目的
versionCode 4（c211a08まで含む）配布後、実購入によるacknowledge・entitlement同期の実動作確認。

## 判明した事実

### 正常に動作していたこと
- AABビルド・署名・Play Console内部テスト配布（versionCode 4）は成功
- 実購入時、\/api/billing/verify\経由でacknowledgeが成功（21:03:01、[billing/verify] acknowledge成功）
- webhook側acknowledgeも実装通り、二重acknowledgeを起こさず正しくスキップ
- Google Play Consoleで商品（take_monthly_680）・基本プラン（take-monthly）は「有効」

### 新たに見つかった軽微な問題
- webhookの初回PURCHASED通知（notificationType=4）が2回連続503で失敗、3回目で成功（21:02:59, 21:03:01, 21:03:03）。billing.js内に503を明示的に返す分岐はなく、インフラ層（コールドスタート等）起因の可能性が高い。Googleの自動リトライで最終的に正常収束、実害なし。

### 解明できた「謎」
- 購入から約35分後（21:38）、notificationType=3（CANCELED）→13（EXPIRED）が到達し、UIが無料プランに戻った。
- これはバグではなく、ライセンステスターの月額プランが5分間隔で更新され、6回更新後に自動失効するというGoogle Play仕様通りの挙動。

### 未解決のまま残ったこと
- アプリ内購入直後、UIが即座にPlus表示に切り替わらない事象を観察（再起動で解消）。
- \client/src/lib/billing.js\の\onPurchaseComplete\、\client/src/App.jsx\のコールバック実装を精査したが、現在のコード上に明確な欠陥は見当たらなかった。
- 調査中、過去の別ビルド（現在のソースには存在しない[account][debug] post-purchase getAccountStatus call等のログを含む、より詳細なデバッグビルド）のログを一時的に現在のコードのものと誤認する場面があった。これは npx cap sync のみでは dist が再ビルドされないことに起因する調査側のミスであり、現在のコードの問題ではない。
- 調査用に \client/src/lib/billing.js\ へ一時デバッグログを追加、commit・push済み（dd90a31）。原因特定後は削除が必要。

## 次回やること
1. 現在の購読が自然失効（23:31頃見込み）した後、無料プラン表示に戻ったことを確認
2. 再度アプリ内購入を行い、dd90a31のデバッグログ（verified event fired / verifyPurchaseOnServer result / calling onPurchaseComplete）がどこまで出るかlogcatで確認
3. 原因特定後、デバッグログを削除してcommit
4. 保留4項目（grace_period回復、表示長期乖離、既存メール新規登録誤挙動、確認メール未達）の優先度判断
5. GPT#47への報告文作成
