# SaidLog 作業引き継ぎ（2026-06-22更新）

## アプリ概要
- 名称：SaidLog（旧Meetlog）
- リアル会議向け・話者識別付き音声文字起こしWebアプリ
- URL：https://saidlog.vercel.app/
- GitHub：https://github.com/ysawase/saidlog
- プロジェクトフォルダ：C:\Users\ysawa\repos\saidlog（自宅）/ C:\Users\sawase\saidlog（職場A・通常）/ C:\Users\sawase\repos\saidlog（職場B・会社中央）

## 技術スタック
- フロントエンド：React + Vite（client/）ポート5173
- バックエンド：Node.js + Express（server/）ポート3000
- STT：Groq（Whisper v3 Turbo）・抽象化層経由
- ストレージ：Supabase Storage（audio-uploads・非公開・50MB上限）
- デプロイ：Vercel

## 実装済み機能
- 音声ファイルアップロード（mp3/mp4/wav/m4a/webm・50MB上限・進捗表示）
- m4a/webm/mp4はffmpegで自動WAV変換（ffmpeg-static対応・Vercel本番でも動作）
- Supabase Storage直接アップロード→署名URL→文字起こし→即削除
- AmiVoice話者識別付き文字起こし（STT抽象化層経由・ログ保存なしエンドポイント /v2/nolog/recognitions 使用）
- 音声ファイル動的保持期間管理（使用量50%未満→30日、50〜80%→7日、80%超→古いものから削除）
- Supabase audio_retentionテーブル・Vercel cronによる自動クリーンアップ（毎日18:00 UTC）
- フィラー語除去・日本語文字間スペース除去
- 話者名インライン編集・テキストコピー・タイムスタンプ表示
- 録音機能（MediaRecorder・webm/mp4自動選択・64kbps）
- IndexedDB逐次保存・起動時復元ダイアログ・7日超残骸自動削除
- Wake Lock（画面消灯防止）
- 録音中：経過時間表示・90分超警告・45MB到達警告
- 確認画面：端末保存・文字起こし・破棄の3択（50MB超は文字起こし無効）
- 文字起こし中：経過時間カウンター表示・所要時間目安メッセージ
- 結果画面：「録音を保存」ボタン（録音由来のみ表示）・所要時間表示
- AI要約（箇条書き・議事録形式の2テンプレート、Claude Haiku使用、注意文言表示）
- Capacitorプロジェクト（Android）導入済み・Androidビルド可能な状態
- ユーザー認証（Supabase Auth・メール＋パスワード）
- 未ログイン＝梅プラン相当として動作（機能制限は今後実装）
- AuthContext（React Context）でログイン状態をグローバル管理
- ログイン・サインアップモーダル（AuthModal）
- 文字起こし履歴保存（Supabase DB・transcriptsテーブル・RLS設定済み）
- 履歴一覧モーダル（ログイン時のみ表示・直近30件・選択・削除）
- テキストエクスポート（原文→TXT、議事録→TXT/DOCX/PDF）PDFはpdfmake v0.3 + NotoSansJP。竹以上対象（プラン制御は未実装）
- アカウント削除機能（transcripts・audio_retention・Storage・Authを順番に全削除）
- react-i18next導入・日英2言語対応（ブラウザ言語設定で自動切替）
- PWA対応（vite-plugin-pwa・manifest.webmanifest・theme-color #4F46E5・アイコン192/512px）
- 録音adapter層（client/src/lib/adapters/）：WebMediaRecorderAdapter・NativeRecorderAdapter・createRecordingAdapter()ファクトリ。Web環境は既存MediaRecorder継続、Capacitorネイティブ環境は@capgo/capacitor-audio-recorderをラップ（未インストール）
- プライバシーポリシーページ（client/public/privacy.html・日英併記）
- Capacitorネイティブ録音プラグイン（@capgo/capacitor-audio-recorder v8.2.1）インストール済み・NativeRecorderAdapter実装済み
- AndroidManifest.xml に RECORD_AUDIO・FOREGROUND_SERVICE・FOREGROUND_SERVICE_MICROPHONE 権限追加済み
- privacy.html 制定日（2026年6月16日）・問い合わせ先（saidlogapp@gmail.com）記入済み
- user_entitlements・usage_periods・profiles.full_summary_used によるプラン制御（DB・サーバー・フロント）
- 利用状況表示（梅：x秒/1時間・竹：x時間/10時間）
- 初回フル要約選択UI（梅プラン・5分以上・未使用時のみ表示）
- AI要約プレビュー表示（梅プラン2回目以降）
- エクスポート制限UI（梅プランはグレーアウト・制限メッセージ）
- 履歴件数制限（梅：3件・竹：30件・サーバー側で制御）
- 梅プランのフルAI要約トライアル（登録後1回限り・5分以上の音源のみ・ユーザー選択制・動作確認完了）
- profiles.full_summary_used によるフラグ管理（upsert対応済み）
- 5分未満の音源に対する機能解放メッセージUI（竹プラン誘導含む）
- AI要約のMarkdownレンダリング（react-markdown・見出し・行間調整済み）
- 文字起こし処理中の点滅アニメーション（※現在逆になっているバグあり→未修正）
- 「原文を保存」ボタンのグレーアウト・ツールチップ（梅プラン時・竹プランで利用できます）
- 自動プレビュー走らないバグ修正（userChoseFullTrial=nullに変更）
- 履歴モーダル外クリックで閉じる
- transcript重複INSERT修正（サーバーがINSERTしたIDをクライアントに返却）
- 録音時間表示の秒数フォーマット改善（formatDuration関数）
- 竹プランマスクUI v1（サーバー側でpreview/full出し分け・blur演出・DUMMY_PREVIEW）
- transcript_full_summariesテーブル追加（summary_full別テーブル管理・RLS無効でserver経由のみ）
- transcriptsテーブルにsummary_preview・summary_typeカラム追加・RLS有効化
- POST /summarize/full エンドポイント追加（竹加入後オンデマンド全文要約生成）
- 竹プランマスクUI完成（白カード＋青ボタン・blur4px・overlay10%・スマホ対応・青線統一・ダミーテキスト長文化で途中切れ演出）
- ノイズ除去（未使用CSS: .account-status/.done-elapsed/.dp-heading/.dp-line、未使用state: lockedSections）
- Groq Whisper v3 Turbo STT組み込み（server/stt/providers/groq.js・STT抽象化層経由）
- transcriptsテーブルにstt_model・stt_cost_estimateカラム追加（stt_provider・audio_duration_secondsは既存）
- 話者1人の場合は話者ラベルを非表示、複数の場合はA/B/C形式で表示
- 梅プランのコピー・エクスポート制限をモーダルCTAに統一（竹プラン680円/月への誘導）
- privacy.htmlにGroq利用を明記（日英両方）
- 竹プラン表示文言を680円・月10時間に更新
- capacitor-plugin-cdv-purchase（v13.17.2）導入済み（Google Play Billing用）
- Google Play Billing基盤実装（capacitor-plugin-cdv-purchase v13.17.2・billing.js・TranscriptView接続・server/routes/billing.js・RTDN Webhook notificationType別処理・grace_period対応・購入完了後UI更新・購入復元ボタン）
- user_entitlementsにpurchase_tokenカラム追加（マイグレーション済み）
- 録音中の音声レベルメーター（Web Audio API・AnalyserNode・リアルタイムバー表示）

## 思想・方向性（重要・毎回引き継ぐこと）

### ビジネスモデル
- BtoC・社会人個人向け・法人営業なし
- 収益はApp Store / Google Playのアプリ内課金のみ（Stripeは使わない）
- 理由：日本の社会人がサブスクを契約するのはApp Store経由が圧倒的。市場が違う
- Apple手数料は年$99＋15〜30%だが、参入障壁が高い分ライバルも少ない
- Google Play先行（$25・一回のみ）→反応を見てApp Store（年$99）

### 競合戦略
- 大手（Notta・AutoMemo）は多機能・高額・ヘビー
- SaidLogの売り：「軽い・速い・安い・シンプル」
- 余計な機能を入れないことが個人事業としての強み
- 差別化機能・便利機能は松プラン（Pro）に集約する

### 松竹梅プラン設計
ユーザーが会議後に本当にやりたいことは4つだけ：
1. 誰が何を言ったか確認したい
2. 決定事項・アクションアイテムを把握したい
3. 記録として残したい
4. 関係者に共有したい

| 機能 | 梅（無料） | 竹（月額・主戦場） | 松（月額・こだわり層） |
|------|-----------|-----------------|-------------------|
| 話者識別文字起こし | 月3回 | 無制限 | 無制限 |
| AI要約 | ✕ | ◎ | ◎ |
| テキストエクスポート | ✕ | ◎ | ◎ |
| 履歴保存 | 直近3件 | 直近30件 | 無制限 |
| 固有名詞登録・感情分析など | ✕ | ✕ | ◎ |

- 竹が主戦場：「普通の社会人が会議で本当に必要なもの全部入り・安い」
- 松はこだわりたい人向け・金持ち目当て
- 価格は竹400〜500円、松900〜1,000円想定（要調整）

### アプリ化方針
- 最終目標はApp Store / Google Playへの配布
- 基本はCapacitorで既存Reactコードを活かす（無料・OSS）
- 録音機能はWeb標準だけに頼らずCapacitorのネイティブ録音プラグイン前提で設計
  - バックグラウンド録音・長時間録音・OS権限まわりはネイティブの知識が必要
  - UI描画性能の面でネイティブ差は出にくいが録音まわりは軽く見ない
- Web版は開発・テスト環境として維持。課金はアプリ内課金のみ

### STT方針
- 現在はAmiVoice（日本語話者識別精度が高い）
- AI要約が入ると文字起こし精度の重要度が下がる
- 将来的にGroq（Whisper）など速くて安い選択肢への乗り換えも検討
- 抽象化層があるので切り替えは容易
### AIモデル方針
- 通常処理：claude-haiku-4-5-20251001（低コスト・1回1〜2円）
- 複雑な処理が必要な場合：claude-fable-5も選択肢（入力$10/出力$50 per MTok・Haikuの約10倍）
- SaidLogの要約用途はHaikuで十分。Fableは将来の高度な機能で検討

### コストに関するルール
- APIや外部サービス導入時は必ず無料か有料か・費用感を明示する
- 無料の場合も「無料です」と明示する
- コスト情報はアプリ性能より優先度が高い

### 音声データ保持方針（2026-06-13 確定）
- 音声ファイルはSupabase Storageに保持し、使用量に応じて自動削除
- 使用量50%未満→30日、50〜80%→7日、80%超→古いファイルから削除
- 即削除しない理由：再処理（文字起こしやり直し）のユーザーメリットがあるため
- 閾値・期間はserver/services/storage.jsの定数で管理（変更容易）
- AmiVoice側には音声データを残さない（ログ保存なしエンドポイント使用）

### 個人情報・プライバシーに関する方針
- Supabase Authにメールアドレス・ハッシュ化パスワードが保存される
- 管理者はメールアドレス・登録日時・最終ログイン日時を確認できる
- パスワードはbcryptハッシュ化されており管理者も読めない
- リリース前にプライバシーポリシーの作成が必要
- アカウント削除機能はユーザーの権利として実装必須

### 英語対応方針（2026-06-13 確定）
- 日本語・英語を同一アプリで同時リリースする方針
- 「本格海外展開」ではなく「低コストな拡張オプション」として早めに持つ
- UIはブラウザ言語設定で自動切替（react-i18next・実装済み）
- プラン制御は日英共通の仕組みで一度作ればよい
- まだやらないこと：英語圏向け本格広告・LP・英語STT最適化・英語圏サポート前提の運用
- 次の優先順位：無料回数制限→プラン制御→英語ストア掲載文

### STTエンジン方針（2026-06-22 確定）
- 標準STTはGroq（Whisper v3 Turbo）に確定
- 梅・竹はGroqのみ
- AmiVoiceは松プラン・高品質モード候補として維持（無制限提供はしない）
- AssemblyAIは安価な話者ラベル候補として検証対象に留める（本線ではない）
- STT抽象化層は引き続き維持する
- 話者名の自動断定はしない（誤認リスクが高い・初期スコープ外）
- LLM成形済み文字起こしは要約入力に使わない（設計ルール）

### AmiVoice運用上の注意（2026-06-23 確認）
- コード上は /v2/nolog/recognitions（ログなし）を使用しているが、AmiVoiceダッシュボードではログありエンドポイントとして集計されていた
- ログなし（0.0375円/秒）はログあり（0.025円/秒）より1.5倍高い
- 将来AmiVoiceに戻す場合は、エンドポイントの実際の動作とダッシュボード集計を再確認すること
- ログありに切り替える場合はプライバシーポリシーの記載変更が必要

### STT品質検証結果（2026-06-22 確認済み）
- 仮説「文字起こし精度が低くてもAI要約でカバーできる」→ 実音声4本で支持された
- Groq（話者分離なし）でも要約合格基準3条件をすべてクリア
- 検証音源：地域会議15分×2本・スタッフ会議15分×1本・2人会話5分40秒
- 処理速度：約5秒/15分（AssemblyAIの約10倍速）
- コスト：約1円/15分（AmiVoiceの約1/40）

### Groqのプライバシー設計（2026-06-22 確認済み）
- デフォルトで推論データを保持しない
- ZDR（Zero Data Retention）オプションあり・コンソールから有効化可能
- データは米国GCPに保存
- モデル学習への利用可否は明示なし・要継続確認
- プライバシーポリシーへのGroq利用明記が必要

### Groqのコスト・安定性（2026-06-22 確認済み）
- 無料枠：1日2,000リクエスト・実質無料
- 有料移行後：$0.04/時（約6円）・最安水準を維持
- 2025〜2026年を通じて料金安定・$750M調達済み
- STT抽象化層があるため将来の乗り換えは容易

### STT選定の意思決定プロセス（2026-06-22）
- ChatGPTに方針相談・意見一致を確認済み
- 「Groqで日常利用を安く広げ、AmiVoiceで高品質需要から回収する」方針で合意
- AssemblyAIは安価な話者分離候補として保留（品質検証未完）

### プラン設計（2026-06-22 確定）
- 梅（無料）：月60分・月3録音・全文表示・3行要約コピー可・全文コピー不可・エクスポート不可・保存7日
- 竹（有料）：680円/月・月10時間・Groq・詳細要約・TODO・決定事項・コピー可・エクスポート可・履歴30件
- 松：後回し・1,480円候補・AmiVoice高品質モード月60分候補
- 追加課金：松の後に検討
- 無制限プランは出さない

### 中核価値（2026-06-15 確定）
- 「録音するだけで、AIが会議メモと次にやることを整理する」
- 話者識別は補助。主役はAI要約・会議メモ生成
- UI：AI会議メモを前面・全文ログは折りたたみ・話者ラベルは補助表示

### ストア訴求（2026-06-15 確定）
- メイン：「録音して終わり。あとはAIが整理します。」
- 検索キーワード：AI議事録・文字起こし・会議録音・AI要約・会議メモ

### リリース方針（2026-06-20 確定）
- 課金実装（Google Play Billing）まで完成させてからGoogle Play申請する
- 梅のみで先行リリースはしない
- 理由：課金なしでリリースしても竹プランへの誘導が機能しない・収益検証ができない

### プラン・訴求の見直し（2026-06-22 課題化）
- Groq標準化に伴い以下の見直しが必要
  - 梅：Groqのみ・話者分離なし
  - 竹：Groqのみ・話者分離なし・AI要約フル
  - 松：Groq標準＋AmiVoice限定枠（月60〜120分）・話者分離あり
  - AmiVoice追加課金パックの設計も検討
- 訴求文言の「話者識別」の扱いを要検討
- UI：話者分離なし時の生ログ表示設計を要検討
- 原価試算：松プランのAmiVoice枠を月60/120/180分で比較予定

### ソフトローンチ方針（2026-06-15 確定）
- Google Playで小さく公開
- 広告なし・大きなSNS告知なし
- 知人・少人数に直接使ってもらう
- フィードバックフォームを設置
- 有効録音10件・うち15分以上が5件を達成するまで様子を見る
- 達成後に問題なければ本格告知

### Google Play公開準備（別管理）
- 事業・申請準備は knowledge-base/40_business/Google Play公開準備_SaidLog.md で管理
- 個人事業主として組織アカウントで進める方針（屋号決定後にPlayConsoleアカウント作成）
- 審査対応として将来的にプライバシーポリシー・データセーフティ・特商法・サブスク表記の実装が必要
- コード変更は別途指示があるまで不要

## 今後のフェーズ

### フェーズ1・2：完了
- ✅ コア機能・使い続けてもらう仕組みはすべて実装済み

### フェーズ3：リリース（現在）
- ✅ PWA対応（ホーム画面追加・vite-plugin-pwa・アイコン・theme-color）
- ✅ Capacitor導入・Androidプロジェクト生成
- ✅ Capacitorネイティブ録音プラグイン対応
- ✅ STT品質テスト完了（Groq採用方針に変更・実音声4本で仮説検証済み）
- ✅ Groq STT組み込み実装（STT抽象化層経由）
- ✅ プライバシーポリシーへのGroq利用明記
- ✅ STTをGroqに切り替え（Vercel本番環境変数変更済み）
- ✅ usage_periods月間上限修正（梅60分・竹10時間）
- 🔲 訴求文言・プラン設計・UIの見直し（話者分離なし前提）
- ✅ プラン制御実装（梅・竹）→ 梅プランUI完了
- ✅ 竹プランマスクUI（白カード＋青ボタン・blur・スマホ対応完了）
- 🔲 Google Play Billing実装（capacitor-plugin-cdv-purchase導入済み・フロント・サーバー未実装）
- ✅ 録音中の音声レベルメーター（Web Audio API）
- ✅ 文字起こし処理中のスピナー・点滅アニメーション追加
- 🔲 録音時間表示の（）修正
- 🔲 ソフトローンチ（少人数検証・有効録音10件基準）
- 🔲 Google Play申請（$25・一回のみ）→ 申請前にprivacy.htmlの制定日・問い合わせ先を確定すること
- 🔲 App Store申請（年$99）

### フェーズ4：収益化
- 🔲 アプリ内課金実装（基盤ほぼ完了・Google Play Developer APIによるレシート検証が残タスク・UIとデザインはGoogle Play Console準備後に調整）
- 🔲 松竹梅プラン実装（App Store対応）

### フェーズ5：差別化強化・残タスク
- 🔲 出力テンプレート追加（商談メモ・1on1メモ・インタビュー形式）
- 🔲 固有名詞・カスタム語彙登録（AmiVoice辞書・無料）
- 🔲 感情分析・詳細統計
- 🔲 声紋登録
- 🔲 業種特化モード
- 🔲 複数会議横断レポート

### フェーズ3以降の検討事項（ソフトローンチ後）
- 🔲 Googleログイン導入（Supabase Auth Google Provider）
  - ソフトローンチ後・有料ユーザーが出始めてから検討
  - スコープは openid / email / profile のみ
  - Google Drive / Gmail / Calendar 等の権限は取らない
  - メールログインとのアカウント重複挙動を事前確認すること
  - App Store対応時はAppleログインも必須になる（App Storeガイドライン要件）
  - Capacitor環境でのDeep Link設定が別途必要

## 次にやること
1. usage_periodsの月間上限を竹10時間・梅60分に合わせて確認・修正
2. Vercel本番環境のSTT_PROVIDER環境変数をgroqに変更
3. ソフトローンチ準備（Google Play申請素材・説明文・スクショ）
4. Google Play Billing実装

## 残バグ・未実装
- 点滅アニメーションが逆（経過時間が点滅・処理中…が点滅しない）→未修正
- AmiVoice 404エラー原因未調査

## 常時ルール
- 1指示1ファイル原則
- 注意書き文面は実装前に承認を取る
- 修正とリファクタリングは別コミット
- STT呼び出しは抽象化レイヤー経由
- 音声データはサーバーに残さない
- LP化・過剰デザイン・整いすぎ禁止
- APIや外部サービス導入時はコスト情報を必ず明示（無料も含む）
- セッション終了時にsaidlog_handover.mdを更新してgit commit・pushすること（コミットメッセージ：docs: 引き継ぎMD更新）
- 実装・修正のたびに不要なコード（コメントアウト・未使用import・未使用変数）を除去すること
- Claude Codeへの指示には必ず末尾に Set-Clipboard を入れる。中身は次のターンでClaudeが必要とする情報（修正後のファイル内容・確認結果など）を入れる。完了報告文や指示文の繰り返しは入れない。
- Google Play申請前にprivacy.htmlの制定日（2026年XX月XX日）を確定すること
- Google Play申請前にprivacy.htmlの問い合わせ先メールを記載すること
- Claude Codeへの指示には必ず末尾にgit add・commit・pushを入れること
- ファイルを複数回修正した場合、セッション終了前に全文確認・ノイズ除去・整理commitを行うこと
- PowerShellのAdd-Contentを使うと文字化け・BOMが発生するため、ファイル追記はClaude Code側でstr_replaceまたはファイル直接編集で行うこと
- CSS数値微調整が必要な場面では、git push往復の前にArtifactでスライダーUIを作って検証してから最終値を確定する
- デザイン案の比較検討が必要な場面では、ArtifactでA/B/C/D案を並べた比較ウィジェットを作る
- テストスクリプト（test-groq.mjs・test-assemblyai.mjs・test-summarize.mjs）はリポジトリ直下に配置・本番コードとは別・テスト用途のみ
- server/.envにGROQ_API_KEY追加済み

## 引き継ぎMDの運用ルール
- 毎セッション終了時に必ず更新版を出力する
- 次回セッション開始時にこのMDを冒頭に貼り付けることで引き継ぎ完了とする
- 「そんな会話して決定したけど覚えてない」をなくすため、会話で決まったことは必ずこのMDに記録する

### セクションごとの更新方針
- **思想・方向性・決定事項**：削らず残す。なぜそう決めたかの経緯が重要
- **実装済み機能**：常に最新状態のみ。古い状態は残さない
- **フェーズ計画**：完了したものは✅にして残す。削らない
- **変更前の内容**：よほど重要な判断の経緯がある場合のみ「変更前」として残す。それ以外は最新に上書き
- MDが肥大化しないよう、状態管理系（実装済み機能・フェーズ）は最新のみ保持し、判断・思想系は蓄積する

## Capacitor / Android 対応メモ（2026-06-13 確定）

- `capacitor.config.json` に `server.androidScheme: "https"` を設定済み（CapacitorのWebViewでhttps扱いにする）
- `client/.env` に `VITE_API_BASE=https://saidlog.vercel.app` を追加済み
- `api.js` の全fetch呼び出しは `${API_BASE}/api/...` の絶対パス形式に統一済み
- `android/app/src/main/res/xml/network_security_config.xml` を作成済み（saidlog.vercel.app・supabase.co への通信許可）
- `storage.js` のアップロードはXHR廃止・`file.arrayBuffer()` → fetch方式に変更済み
  - 理由：CapacitorのWebViewはXHRがブロックされる場合があり、ReadableStreamをfetch bodyに渡す方法（duplex）も非対応
  - 進捗表示はアップロード開始時0%・完了時100%のみ（中間進捗なし）
- ビルド手順：`npm --prefix client run build` → `npx cap sync android` → Android Studioでビルド
- 録音はcreateRecordingAdapter()経由で呼ぶ（client/src/lib/adapters/index.js）
- Web環境はWebMediaRecorderAdapter（既存recorder.jsラッパー）、ネイティブ環境はNativeRecorderAdapter（@capgo/capacitor-audio-recorder）
- @capgo/capacitor-audio-recorderはまだ未インストール。インストール後はvite.config.jsのexternalから外す
- 次のステップ：Android Studio実機テスト（10分・30分・画面ロック・バックグラウンド） → Google Play申請素材作成（説明文・スクショ・フィーチャーグラフィック） → Google Play申請

### もう蒸し返さないこと
- AssemblyAIを今すぐ本線にする案（検証対象のまま・確定）
- 話者名自動断定の採用（切り捨て確定）
- LLM成形済み文字起こしを要約入力に使う設計（禁止確定）
- AmiVoiceを竹に標準搭載する案（非推奨確定）
- 竹の月間分数を300分に絞る案（10時間で確定）

### ブレやすい注意点（毎回確認すること）
- SaidLogは「軽い・速い・安い・シンプル」が売り
- AI要約を入れても、Notta化しない（多機能化しない）
- 便利機能は竹・松プランに寄せる。無料・梅に詰め込まない
- Web版は収益化の主戦場ではなく、開発・検証用
- 録音まわりはWeb標準だけで楽観しない（Capacitorネイティブプラグイン前提）

## SaidLog 長期ビジョン（2026-06-20）

### 使った翌朝に感じていてほしいこと

昨日の会議や面談で話したことが、もう頭の中で散らかっていない。

何を決めたか。何を頼まれたか。次に何をすればいいか。

それが自然に見える状態になっている。

---

### 北極星

5年後、SaidLogは、話した内容を忘れない・整理しない・見失わないための、日本の個人・小規模事業者向け会話記録エンジンである。

---

### 3つの進化段階

| フェーズ | テーマ | 主な内容 |
|---|---|---|
| 1 | 記録する | 録音・文字起こし・話者識別・履歴保存・検索 |
| 2 | 整理する | 要約・決定事項・TODO・保留・担当者・次回確認事項 |
| 3 | 活かす | メール下書き・引き継ぎ文・顧客別履歴・過去検索 |

---

### 想定する利用場面

小規模会議・個人事業の打ち合わせ・営業面談・福祉現場の申し送り・採用面談など、会話のあとに整理作業が発生する場面すべてが対象。

---

### 福祉領域について（特記）

開発者自身に現場経験があり、リアルな検証環境として有効。一般要約ではなく「申し送り」「支援記録補助」「次の確認事項」に寄せた設計を検討。ただし個人情報・要配慮情報の扱いが重いため、初期段階では安易に機能を広げない。有力な検証環境である一方、慎重に扱うべき領域。

---

### やらないこと

- 大企業向け営業管理・売上予測
- CRMの完全代替・複雑な権限管理
- AIの賢さそのものを売ること

---

### 基本思想

ユーザーが求めているのはAIではない。会話後の頭の中が片づき、次にやることが見える状態である。その状態を、個人や小規模な現場でも使える価格と軽さで提供する。

## Google Play Billing 実装状況（2026-06-22時点）
- ✅ capacitor-plugin-cdv-purchase（v13.17.2）導入・cap sync済み
- 🔲 client/src/lib/billing.js 作成
- 🔲 TranscriptView.jsx「竹プランを見る」ボタン×2にonClick接続
- 🔲 server/routes/billing.js（レシート検証・user_entitlements更新）
- 🔲 Google Play Webhook（RTDN）受信エンドポイント
- 商品ID予定：take_monthly_680
- Billingライブラリ：capacitor-plugin-cdv-purchase（MIT・無料・週8,276DL・Capacitor8対応）
