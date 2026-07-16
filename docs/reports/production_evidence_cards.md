# 本番証拠カード

公開判定に関わる項目を「確定した商品ルール」「実装状態」「内部テスト可否」「一般公開可否」の単位でカード化して記録する。このファイルは2026-07-15に新規作成した（既存の正本ファイルは見つからなかったため）。

---

## 公開前ブロッカー：詳細要約・履歴閲覧条件のUI文言整合

**分類**：一般公開ブロッカー（内部テスト継続は可）

**確定した商品ルール**：
保存済み詳細要約は、現在のプランで閲覧可能な履歴範囲内にある限り再閲覧できる。

**対象箇所（6項目、すべて未実装）**：
1. 料金画面
2. 無料トライアル説明
3. 履歴上限説明
4. 範囲外ロック時の説明
5. Plus失効後の表示
6. 再契約後の閲覧可否

**状態**：未実装
**内部テスト**：継続可
**一般公開**：文言反映確認まで不可

---

## 詳細要約の生成・保存・安定再閲覧（本番証拠カード）

**検証日**：2026-07-15
**方法**：テスト用ドメイン（@example.com）を使用した本番環境での実データE2E検証。テスト後に全データ削除・残存ゼロを確認済み。

| 項目 | 結果 |
|---|---|
| コード実装 | PASS |
| 自動テスト（65件） | PASS |
| 実データ手動テスト（開発環境） | PASS |
| Git commit（永続化・旧API削除を分離） | PASS |
| 一体push・Production反映 | PASS |
| 旧API本番404確認 | PASS |
| 本番初回full要約生成 | PASS |
| 本番DB保存（transcript_full_summaries） | PASS |
| 本番再閲覧（cached:true、本文完全一致） | PASS |
| 保存済みキャッシュ経路の利用 | PASS（コード確認：cached:true経路はcallAnthropicを呼ばずDBのsummary_fullをそのまま返す実装。callAnthropic呼び出し回数を直接数える自動テスト、本番cached:true、初回/再閲覧の本文完全一致、の複合証拠で確認。cached:true単独をAnthropic未呼び出しの証明とはしない） |
| 本番履歴範囲外の遮断（キャッシュ実在状態での403を実証） | PASS |
| テストデータ削除・残存ゼロ確認 | PASS（transcript_full_summaries・transcripts・userをそれぞれ個別に明示DELETEで削除。CASCADE制約の動作確認ではなく、クリーンアップ手順の成功と残存ゼロの確認） |

**一般公開判定**：詳細要約永続化の技術的な合格ライン到達。ただし一般公開には、UI文言ブロッカー（別項目）の解消が別途必要。

**副次的に発見・対応した問題**：
検証中、本番環境変数 ANTHROPIC_API_KEY が失効済みの古いキーになっており、本番でのfull要約生成が全て401エラーで失敗する状態だったことが判明。新規キーを発行しVercelに設定・再デプロイして解消。この問題はSaidLogが内部テスト段階で本番課金ユーザーが存在しないため、実害の生じたユーザーはいない。原因（いつから無効だったか）は未調査。

---

## 公開前ブロッカー：重要変更後の本番スモークテスト

**状態**：未整備
**内部テスト**：継続可
**一般公開**：手順確定と本番実施証拠まで不可

**実施するタイミング**（いずれかの後）：
- Productionデプロイ
- Groq、Anthropic、Google Play等のAPIキー変更
- Vercel環境変数変更
- 文字起こし、要約、保存、認証、課金の本番コード変更
- 外部API連携設定の変更

（文書のみのcommitや本番機能へ影響しない変更では省略可）

**最低限の確認項目**：
1. 本番画面を開ける
2. 認証済みテストアカウントでログインできる
3. 機密性のない固定音声でGroq文字起こしが成功する
4. Anthropic要約が成功する
5. transcriptが保存される
6. 詳細要約が保存される
7. 再閲覧で同一本文が表示される
8. server側の成功イベントが記録される
9. テストデータを削除する
10. 残存データを確認する

（課金変更時は別途Google Play課金E2Eを実施）

**記録する証拠**：実施日時、対象Production commit/デプロイ、変更理由、各項目のPASS/FAIL/未確認、最初のFAIL地点、秘密情報を含まないログまたはDB確認、テストデータの削除結果。docs/reports/production_evidence_cards.md内に短く追記する形でよい。

---

## 公開前ブロッカー：AI要約障害の記録・確認

**状態**：未実装
**内部テスト**：継続可
**一般公開**：記録と確認経路の動作確認まで不可

**内容**：
- summary_errorイベント（Supabase既存eventsテーブルを使用、新規分析ツール導入なし）
- 属性候補：error_class, summary_mode, template, auth_state, plan_state, source, occurred_at
- error_classは固定enum：auth / rate_limit / timeout / invalid_response / upstream / unknown（生の例外メッセージは保存しない）
- 送ってはいけない情報：APIキー、生の例外メッセージ全文、要約本文、文字起こし本文、音声、メールアドレス、ファイル名、URL、purchaseToken、外部APIレスポンス本文

**合格条件**：
1. Anthropic要約失敗時にsummary_errorが発火する
2. 正常成功時には発火しない
3. 同じ失敗で無意味に複数記録されない
4. 本番eventsテーブルへ実際に保存される
5. 禁止情報が含まれない
6. error_classが想定enumになる
7. 本番の直近エラーを確認する方法が決まっている（保存済みSQLまたは簡易確認手順）

---

## 公開前ブロッカー：Google Play課金・権利付与・RTDNライフサイクル同期

状態：一般公開 FAIL（複数項目が未確認・未実装）

### 検証済み項目（PASS）

- 新規テスト購入トランザクション：PASS
- purchaseToken取得：PASS
- サーバー検証：PASS
- user_entitlements更新：PASS
- 購入直後のPlus表示：PASS
- acknowledgeコード経路：PASS
- RTDN Play Console設定：PASS
- Pub/Sub publisher権限：PASS
- Pub/Sub push／OIDC肯定・否定系：PASS
- RTDNテスト通知到達：PASS
- grace_periodコード：PASS
- 0行silent failure：コード修正PASS
- Productionエラーテーブル（billing_webhook_errors）：PASS
  - service roleでSELECT/INSERT/DELETE可能
  - anonからのSELECT/INSERT拒否：実測PASS
  - authenticatedからの拒否：RLS有効・ポリシー0件という構造確認PASS（直接実測は未実施）
  - 列構成がmigration定義と一致
  - テスト行削除後の残存ゼロを確認
- count > 1（複数行更新）とHTTP応答のretryable整合：PASS
- product_mismatch分岐：自動テストPASS（200 ACK、retryable: false）
- token_invalid分岐：自動テストPASS（503、retryable: true）
- unknown_result分岐：自動テストPASS（500、retryable: true）
- 未登録result値への防御フォールバック：PASS
- purchase_token重複調査：PASS（現状重複ゼロ）
- 自動テスト：87件全通過

### 未確認項目

- 修正後の購入回帰：未確認
- 実acknowledgementState：未確認
- 実subscriptionNotification：未確認
- Developer API再照会：未確認
- grace_period実状態：未確認
- account hold：未確認
- recovery：未確認
- recordError失敗時の非2xx維持：コード確認PASS、故障注入テスト未実施
- 再起動後のPlus維持：未確認
- 再ログイン後のPlus維持：未確認

### 未実装項目

- purchase_token DB一意制約（部分UNIQUE INDEX）：未実装
  - 現状、DBレベルではpurchase_tokenの重複を防げない
  - アプリケーションロジックのみに依存している状態

---

## 公開前ブロッカー：Plus権利状態の確認UI

状態：未実装（一般公開は反映確認まで不可）

### 最低要件

- 購入成功時にPlus有効化を明示する
- 現在のプランがSaidLog Plusだと明確に分かる
- 月10時間の上限と現在使用量を判別できる
- 状態取得中を無料と誤表示しない
- grace period中はPlus維持と支払い確認を案内する
- account hold中は支払い問題による一時停止を明示する
- 解約済み期限内は利用可能終了日を表示する
- 反映失敗時に再確認手段を表示する

備考：色・装飾の磨き込みとは別に、課金状態を誤認させないための最低限の表示として扱う。内部テストは継続可、一般公開には反映確認が必須。
