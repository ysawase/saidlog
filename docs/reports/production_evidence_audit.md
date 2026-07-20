# 本番証拠カード運用に基づく「実装済み・本番未確認」項目の横断棚卸し

調査はすべて既存のgit履歴・ソースコード・`docs/`・`reports/`配下の既存文書の読み取りのみで実施。コード変更・git操作・本番環境（Supabase/Vercel/Google Play Console）への書き込み操作は一切行っていない。

判定基準（4段階、証拠が無ければ推測で埋めない）：
1. **実装完了**：該当コードが存在する
2. **ローカル確認完了**：開発環境で実際に動かして確認した記録（コメント・コミットメッセージ・レポート）がある
3. **デプロイ完了**：該当コードが現在の`main`ブランチ（HEAD、`origin/main`と同期済み）に含まれている
4. **本番動作確認完了**：本番ログ・本番DBの実データ・本番URLでのスクリーンショット・Play Console記録等、実際に本番で観測された証拠がある（コード上の意図コメントだけでは不可）

現在のHEAD：`aaebf77`（`main`、`origin/main`と同期済み）

---

### 1. 課金（Google Play課金・権利付与）

- **実装完了：あり**
  `client/src/lib/billing.js`（`initBilling`, `purchaseTake`, `verifyPurchaseOnServer`）、`server/routes/billing.js`（`POST /api/billing/verify`, `POST /api/billing/webhook`）、`server/services/googlePlay.js`（`verifyGooglePlaySubscription`、Google Play Developer API連携）、`client/src/lib/upgradeGuard.js`（6段階の誤操作防止判定）
- **ローカル確認完了：部分的にあり（ただし失敗という結果）**
  `docs/reports/billing_native_verification.md`（2026-07-13、Android実機・ワイヤレスデバッグ接続での検証）：`store.initialize()`完走・Google Play Billing接続・商品クエリ自体は成功を確認したが、**商品情報が0件で返り、`purchaseTake()`は`Product not found: take_monthly_680`で失敗**。実際の購入・サーバー検証到達までは実機でも到達できていない（同レポート12-56行目）。
- **デプロイ完了：あり**
  `aaebf77`（billing.js ESM移行・リリース署名設定）は現HEAD。ただし**本セッションで加えた`receipt.sourceReceipt?.purchaseToken`修正は現時点で未コミット**（`git status`で`M client/src/lib/billing.js`）であり、この最新修正はデプロイ未完了。
- **本番動作確認完了：なし（未確認）**
  `docs/db_push_verification_2026_07_04.txt:77-78`に明記：「Google Play検証を含む`/api/billing/verify`エンドポイント全体の疎通確認（実purchase_tokenでの検証）は、本番環境でのユーザー確認事項」。実機検証でも購入token自体が一度も生成されていないため、サーバー側検証ロジックを実データで通した記録は存在しない。
- **本番動作確認完了に必要なこと**：Google Play Console側で内部テストトラックへのAABアップロード・`take_monthly_680`サブスクの有効化・テスターアカウント登録（同レポート58-64行目の推定原因）を解消した上で、実機で購入UIから購入を完了させ、`/api/billing/verify`が実purchase_tokenで正常応答し`user_entitlements`が更新されることを本番DBで確認する。加えて、本セッションで加えた未コミットの`sourceReceipt.purchaseToken`修正についても同じ手順での実機再検証が必要。

---

### 2. 認証（ログイン・新規登録・セッション管理）

- **実装完了：あり**
  `client/src/context/AuthContext.jsx`（`supabase.auth.getSession`/`onAuthStateChange`/`signOut`）、`client/src/components/AuthModal.jsx`（`signInWithPassword`/`signUp`/`deleteAccount`）、`server/middleware/auth.js:7-21`（`optionalAuth`、Bearerトークン検証）。パスワードリセット機能は未実装（`resetPasswordForEmail`等のコード不在）。
- **ローカル確認完了：なし（未確認）**
  認証実装コミット（`b820a87`, `0830ecc`）はいずれもコミット本文が空で動作確認の記述なし。`docs/`・`reports/`配下を横断検索したが、ログイン/サインアップを実際に実行して成功を確認した記述は見つからなかった。
- **デプロイ完了：あり**
  `b820a87`, `0830ecc`とも現HEAD `aaebf77`の履歴に含まれる（`git cat-file -e HEAD:client/src/context/AuthContext.jsx`等で存在確認済み）。
- **本番動作確認完了：なし（未確認）**
  本番ログ・本番URLでのスクリーンショット等の証拠は発見できず。`reports/ui_screenshots/06_auth_modal.png`は存在するが、ローカルdevサーバーに対してPlaywrightで撮影したものであり本番証拠ではない（本レポート作成者自身が前回セッションでローカルdevサーバーに対して撮影したことを把握している）。
- **本番動作確認完了に必要なこと**：本番URLで実際にログイン・新規登録・ログアウトを行い、Supabase Auth側にユーザーが作成される／セッションが正しく継続することを確認する。

---

### 3. 無料枠・利用量制限

- **実装完了：あり**
  `server/config/plans.js`：`ume`（無料）プラン 月3600秒(60分)・履歴3件・エクスポート不可、`take`（Plus）プラン 月36000秒(10時間)・履歴30件・エクスポート可。`server/services/plan.js:38-77`（`canStartTranscription`、`usage_periods`の`used_seconds`と月間上限を比較）。`usage_periods`テーブル：`supabase/migrations/20260615000000_plan_control.sql:20-34`。`client/src/constants/limits.js`：`MAX_SIZE_MB=50`。`server/services/storage.js`：ストレージバケット80%閾値（`THRESHOLD_HIGH`）。ゲスト15分上限・3分閾値は既存の`reports/events_and_guest_limit_investigation.md`で確認済み（重複調査なし）。
- **ローカル確認完了：なし（未確認）**
  `dcadf8b`「梅プランの月間上限を180分→60分に修正」はコミットメッセージのみで検証記述なし。`plan.js`の月間上限ゲートを対象にした自動テストは存在しない。
- **デプロイ完了：あり**
  `dcadf8b`、`78af478`（guest_usage）、`20260615000000_plan_control.sql`はいずれも現HEADの祖先。`docs/db_push_verification_2026_07_04.txt:17-19`でリモートのマイグレーション履歴7件がローカルと完全一致していることも確認済み。
- **本番動作確認完了：部分的にあり（基盤のみ。制限ロジック自体は未確認）**
  `docs/db_push_verification_2026_07_04.txt:58-65`：`usage_periods`（2行）、`user_entitlements`（1行）が本番Supabaseに実在し、service roleでの読み取りに成功（実データの存在確認）。ただし**月間上限を超えた際に実際に403が返る、といった制限ロジックそのものの本番挙動を観測した記録はない**。テーブルが本番に存在し書き込まれている、という基盤レベルの確認に留まる。
- **本番動作確認完了に必要なこと**：本番環境で実際に月間上限に近い/超過する利用を行い、上限到達時に文字起こしがブロックされる（403とその理由）ことを確認する。

---

### 4. データ保存（会議メモ・文字起こし結果・要約の保存）

- **実装完了：あり**
  `server/routes/transcribe.js:119-136`（`transcripts`への事前insert、status='transcribing'）、`:189-197`（完了後update）。`server/routes/summarize.js:133-151, 255-267`（プレビュー/フル要約の`transcripts`更新、`transcript_full_summaries`へのupsertキャッシュ）。`client/src/lib/history.js:5-20`（`saveTranscript`、ログイン時のクライアント側直接insert。ゲスト時のlocalStorageフォールバックは無し＝ゲストの文字起こし結果はDBに保存されない仕様）。
- **ローカル確認完了：なし（未確認）**
  insert/update/要約保存フローを対象にしたテストファイル・実行記録は見つからなかった。
- **デプロイ完了：あり**
  `20260621000000_summary_tables.sql`・`transcribe.js`の事前insertロジック（`6757861`）とも現HEADの祖先。`docs/db_push_verification_2026_07_04.txt:17-19`でリモート適用済みを確認。
- **本番動作確認完了：あり（`transcripts`本体のみ。フル要約キャッシュは未確認）**
  `docs/db_push_verification_2026_07_04.txt:58-65`：本番`transcripts`テーブルに**実データ61行**が存在（service role読み取りで確認）。これはテストデータではなく実際のユーザー利用によって蓄積された行数と考えられ、本番での文字起こし結果保存が実際に機能していることの直接証拠と判断できる。一方、`transcript_full_summaries`（フル要約キャッシュ）は**0行**であり、こちらの保存パスが本番で一度でも実行されたという証拠はない。
- **本番動作確認完了に必要なこと**（フル要約キャッシュのみ残課題）：本番で実際にフル要約を1件生成し、`transcript_full_summaries`に行が入ることを確認する。

---

### 5. データ削除（アカウント削除・履歴削除・音声自動削除）

- **実装完了：あり**
  `server/routes/deleteAccount.js:6-54`（`transcripts`削除→`audio_retention`削除→Storageファイル削除→`auth.admin.deleteUser`、途中失敗時は500でロールバックなし）。`server/services/storage.js`（`deleteAudio`即時削除、`scheduleAudioDeletion`が使用率に応じ0/7/30日保持のフォールバック記録）。`server/services/cleanup.js`（`cleanupStaleTranscribing`：1時間超のtranscribing状態をfailedへ、`runRetentionCleanup`：期限切れ`audio_retention`削除、`cleanupOldFiles`：24時間サイクルのcron的削除）。`client/src/components/HistoryList.jsx:42-44`→`client/src/lib/history.js:33-44`（履歴の個別削除、RLSポリシー`users_delete_own_transcripts`で保護）。
- **ローカル確認完了：`cleanupStaleTranscribing`のみあり（他は未確認）**
  `tests/cleanupStaleTranscribing.test.mjs`は12件のテストがすべてローカルで通ることを確認済み（ただしSupabaseをモックした単体テストであり、実DB・実ストレージに対するE2E実行ではない）。`deleteAccount.js`・`runRetentionCleanup`・`cleanupOldFiles`については、動作確認を示すテスト・コメント・レポートは見つからなかった。
- **デプロイ完了：あり**
  `0830ecc`, `d7c7ec5`, `e900afa`, `6fa7a75`とも現HEADの祖先。
- **本番動作確認完了：なし（未確認）**
  アカウント削除・音声自動削除・保持期限切れクリーンアップ・履歴個別削除のいずれについても、本番での実行を裏付けるログ・スクリーンショット・記述は`docs/`・`reports/`のどこにも見つからなかった。
- **本番動作確認完了に必要なこと**：本番環境でテストアカウントを1件作成→文字起こし実行→アカウント削除を実施し、`transcripts`・Storageファイル・`auth.users`から実際に消えることを確認する。音声自動削除についても、本番の文字起こし後に該当ファイルがStorageから消えることをログで確認する。

---

### 6. 文字起こし処理（Groq / AmiVoice / AssemblyAI 外部STT API連携）

- **実装完了：あり**
  `server/stt/index.js:11-37`（プロバイダーレジストリ、`STT_PROVIDER`環境変数で切替）。`server/stt/providers/{assemblyai,groq,amivoice}.js`。`server/routes/transcribe.js:35-41`でプロバイダーに応じた必須APIキーの存在チェック（過去にAssemblyAIキーのみを常時チェックする不整合があり、`8256543`「STTプロバイダーに応じたAPIキー検証」で修正済み、現HEADの祖先であることを確認）。
- **ローカル確認完了：なし（未確認）**
  実プロバイダーへの接続確認スクリプト（`test-assemblyai.mjs`, `test-groq.mjs`）はかつて存在したが削除済みで、実行結果の記録も残っていない（`docs/untracked_docs_final_triage_2026_07_04.txt:98-99`に存在言及のみ）。`tests/amivoiceErrorSafety.test.mjs`・`tests/classifyTranscriptionError.test.mjs`は自作モックのみを使う純粋な単体テストで、実プロバイダーへの疎通は検証していない。
- **デプロイ完了：あり**
  `docs/fable_audit_packet_2026_07_03.txt:39-40`に「Vercelに`STT_PROVIDER=groq`を設定して解消済み」という明記あり。Groq/AmiVoide関連コミット（`dfd3cb9`, `c203b37`/`e900afa`, `8256543`）は現HEADの祖先。
  **注意**：ローカル`server/.env`は現在`STT_PROVIDER=assemblyai`（`GROQ_API_KEY`は未設定、`ASSEMBLYAI_API_KEY`・`AMIVOICE_APPKEY`は設定あり）で、本番Vercel側の現在値と一致しているかはリポジトリからは確認不能（ローカル開発用の値に過ぎない）。
- **本番動作確認完了：なし（未確認、明示的な否定記録あり）**
  `docs/fable_audit_packet_2026_07_03.txt:34`に明記：「本番確認: 未（本番URLでのpush済み部分の実機動作確認は次工程）」。これを覆す後続の確認記録は見つからなかった。レート制限・クォータについても、コード上の分類（`classifyTranscriptionError.js`が429を`RATE_LIMIT`に分類）のみで、実際の本番クォータ状況を確認した記録はない。
- **本番動作確認完了に必要なこと**：本番URLで実際に音声ファイルをアップロードし、現在Vercelに設定されているSTTプロバイダーで文字起こしが成功することをログまたは結果画面で確認する。

---

### 7. 本番イベント計測（events テーブル）

前回セッションの`reports/events_and_guest_limit_investigation.md`の内容を本監査の4段階基準で再整理。

- **実装完了：あり**
  client発火5件（`s01_view`, `auth_modal_open`, `s01_record_click`, `s01_upload_click`, `signup_submit`）+ server発火3件（`transcription_request`, `transcription_success`, `transcription_error`）。`server/services/events.js`のホワイトリスト方式サニタイズ。
- **ローカル確認完了：なし（未確認）**
  イベント送信を実際にローカルで動かして確認した記録は見つからなかった。
- **デプロイ完了：あり**
  `2e8f9e9`, `146fd0e`, `88e862a`, `cf903a4`, `fea76f9`はいずれも現HEADの祖先。
- **本番動作確認完了：なし（未確認。ただしDBスキーマ・RLS層のみ本番検証済み）**
  `docs/db_push_verification_2026_07_04.txt:29-52`：`events`テーブルは本番Supabaseに実在し、service roleでのinsert成功・許可外イベント名のCHECK制約拒否・anonキーでのinsert/select拒否（RLS有効）を実際に本番で確認済み（これはスキーマ・セキュリティ境界の本番確認としては本物の証拠）。しかし**同時点でテーブルは0行**であり、実際のユーザートラフィックによってイベントが記録されたという証拠はこの文書には無い。それ以降、実データが入っているかを確認した記録は見つからなかった。
- **本番動作確認完了に必要なこと**：本番URLで実際に画面を開く・録音を開始する等の操作を行った後、本番`events`テーブルをservice roleで読み取り、対応する行が実際に記録されていることを確認する。

---

### 8. その他の外部API連携（Anthropic要約API・Google Play Developer API）

**Anthropic（`@anthropic-ai/sdk`、AI要約）**
- **実装完了：あり**　`server/routes/summarize.js:2, 91-128, 192-253`（モデル`claude-haiku-4-5-20251001`、`ANTHROPIC_API_KEY`は`server/.env`に設定あり＝キー名の存在のみ確認、値は非開示）
- **ローカル確認完了：なし（未確認）**
- **デプロイ完了：あり**（`summarize.js`は現HEADに含まれる。ただしSTTのような「Vercelに環境変数を設定した」という明示的記述は見つからなかった）
- **本番動作確認完了：なし（未確認）**　本番で要約が生成されたことを示すログ・スクリーンショットは見つからなかった

**Google Play Developer API（`server/services/googlePlay.js`、購入検証）**
- **実装完了：あり**　`verifyGooglePlaySubscription()`（`server/services/googlePlay.js:67-131`）。`GOOGLE_SERVICE_ACCOUNT_JSON`環境変数が必要だが、`server/.env`には**存在しない**（グレップで0件）。本番でも未設定であれば`isProduction()`チェックによりfail-closeする設計（同ファイル82-84行目）。
- **ローカル確認完了：なし（未確認）**　ローカルでは認証情報が無いためdevスキップ経路（`VERIFICATION_SKIPPED_DEV`）しか通らず、実APIには到達していない
- **デプロイ完了：あり**（コード自体は現HEADに含まれる。`GOOGLE_SERVICE_ACCOUNT_JSON`をVercelに設定したという記述は見つからなかった）
- **本番動作確認完了：なし（未確認、明示的な保留記録あり）**　`docs/db_push_verification_2026_07_04.txt:77-78`で「本番環境でのユーザー確認事項」と明記。加えて領域1（課金）の実機検証で購入token自体が一度も生成されていないため、この関数を実データで通した記録は存在しない。
- **本番動作確認完了に必要なこと（両方共通）**：Anthropicは本番で実際に要約を1件生成し結果を確認する。Google Play APIは`GOOGLE_SERVICE_ACCOUNT_JSON`が本番に設定されていることを確認した上で、領域1の課金フローが実際に完了し、`verifyGooglePlaySubscription`が実purchase_tokenで呼ばれた結果を確認する。

---

## 集計：8領域中「本番動作確認完了」に到達している件数

**1件（データ保存の中核部分のみ。それも部分的）**

| 領域 | 本番動作確認完了 |
|---|---|
| 1. 課金 | なし |
| 2. 認証 | なし |
| 3. 無料枠・利用量制限 | なし（テーブル存在確認のみ、制限ロジック自体は未確認） |
| 4. データ保存 | **あり（`transcripts`本体のみ。フル要約キャッシュは未確認）** |
| 5. データ削除 | なし |
| 6. 文字起こし処理（STT） | なし（明示的な「本番確認: 未」記録あり） |
| 7. 本番イベント計測 | なし（RLS/スキーマ層のみ本番確認、実イベント記録は未確認） |
| 8. その他外部API（Anthropic/Google Play） | なし |

**構造的な傾向**：今回判明した「実装済み・本番未確認」は課金・events計測の2領域に限った偶発的な見落としではなく、認証・利用量制限・データ削除・STT・他の外部API連携を含む**8領域すべてに共通する構造的なパターン**である。「実装完了」「デプロイ完了（現HEADに反映済み）」までは全領域で証拠が揃っている一方、「ローカル確認完了」の明示的記録がある領域はごく一部（`cleanupStaleTranscribing`のテスト、billing実機検証＝ただし失敗という結果）に限られ、「本番動作確認完了」は実質1領域（データ保存の中核）にとどまる。`docs/fable_audit_packet_2026_07_03.txt`が2026-07-03時点で「本番確認: 未（次工程）」と明記して以降、これを覆す包括的な本番確認記録が作成された形跡はない。
