# Supabaseイベント計測基盤（commit cf903a4）現状確認レポート

調査はすべてローカルのgitリポジトリ・ソースコードの直接読み取りのみで実施。コード変更・git操作・本番Supabaseへの書き込みは一切行っていない。

---

## ■ commit cf903a4 の内容と、その後の変更・削除の有無

**関連コミット系列（すべて2026-07-04付近、S01効果検証Phase 1）**
```
2e8f9e9 feat: eventsテーブルのmigration追加（S01効果検証 Phase 1）
146fd0e feat: eventsサニタイズ・insertサービスとテスト追加
88e862a feat: POST /api/events エンドポイント追加
cf903a4 feat: client発火5イベントとanalytics送信ヘルパー追加
```

`cf903a4`（2026-07-04 22:02:09 +0900）の変更ファイル：
```
client/src/App.jsx                  | 48 ++++++++++++++++++++------
client/src/api.js                   |  4 ++-
client/src/components/AuthModal.jsx |  3 ++
client/src/components/Recorder.jsx  |  3 +-
client/src/lib/analytics.js         | 67 +++++++++++++++++++++++++++++++++++++ (新規)
```
`client/src/lib/analytics.js` を新規追加し、`trackEvent()` ヘルパーと匿名セッションID発行（`getOrCreateSessionId`、`sessionStorage`保持、UUID）、`planStateFromPlanId()` を実装。`App.jsx` / `AuthModal.jsx` / `Recorder.jsx` から計5箇所で `trackEvent()` を呼び出す配線を追加。

**その後の変更・削除：なし。**
`git log --oneline --all -- client/src/lib/analytics.js server/routes/events.js server/services/events.js supabase/migrations/20260704000000_add_events.sql` の結果は上記4コミットのみで、cf903a4以降にこれらのファイルへの変更コミットは存在しない。現在のワーキングツリーにも全ファイルが存在することを確認済み：
```
client/src/lib/analytics.js
server/routes/events.js
server/services/events.js
supabase/migrations/20260704000000_add_events.sql
```

---

## ■ 現在実装されているイベント一覧

**client発火（`trackEvent()`呼び出し、5件）** — `client/src/lib/analytics.js:46` の `trackEvent(eventName, ...)` を経由

| イベント名 | 発火箇所 |
|---|---|
| `s01_view` | `client/src/App.jsx:56`（idle画面のページロード時、1回のみ） |
| `auth_modal_open` | `client/src/App.jsx:61`（認証モーダルを開いた時） |
| `s01_record_click` | `client/src/App.jsx:380`（Recorderの録音開始クリック時） |
| `s01_upload_click` | `client/src/App.jsx:415`（ファイル選択ボタンクリック時） |
| `signup_submit` | `client/src/components/AuthModal.jsx:27`（新規登録フォーム送信試行時、成否問わず） |

**server発火（`insertEvent()`直接呼び出し、3件）** — `server/routes/transcribe.js`

| イベント名 | 発火箇所 |
|---|---|
| `transcription_request` | `server/routes/transcribe.js:65-69`（文字起こしリクエスト受付時） |
| `transcription_error` | `server/routes/transcribe.js:163-169`（STT失敗時） |
| `transcription_success` | `server/routes/transcribe.js:175-180`（STT成功時） |

背景記録にある「client 5件・server 3件」と**完全に一致**。差異なし。

さらに `server/services/events.js:7-16` の `ALLOWED_EVENT_NAMES`（許可イベント名の一元管理セット）にも上記8件がそのまま定義されており、コード上の唯一の正本（source of truth）として整合している。`/api/events`（`server/routes/events.js`）はclient発火イベントの受け口としてこのセットで検証するのみで、それ自体は新しいイベント名を生成しない。

---

## ■ イベント属性に禁止情報が含まれていないかの確認結果

**結論：禁止情報（音声データ・文字起こし本文・要約本文・メールアドレス・ファイル名等）は一切含まれていない。** `server/services/events.js` の `sanitizeEvent()`（`events.js:91-116`）がホワイトリスト方式で全フィールドを固定カラムに丸め込んでおり、未知のキー・自由文字列は保持されない設計。

- `event_name`：`ALLOWED_EVENT_NAMES`（`events.js:7-16`）に無い値は拒否（`events.js:95-97`）
- `anonymous_session_id`：UUID形式のみ許可、それ以外はnull（`sanitizeSessionId`, `events.js:42-46`）
- `actor_type` / `auth_state` / `plan_state` / `source` / `device_category` / `result` / `error_category` / `audio_duration_bucket` / `stt_provider`：すべてenum許可値リスト（`events.js:19-29`）に丸め、リスト外は既定値かnullに落とす
- `page_path`：`^/[a-zA-Z0-9/_-]{0,99}$` の正規表現でSPA内パスのみ許可、クエリ・フラグメント・自由文字列は拒否（`events.js:36, 105-107`）
- `metadata_json`：`ALLOWED_METADATA_KEYS` が空集合（`events.js:32`）のため、Phase 1では常に空オブジェクト`{}`になる（`sanitizeMetadata`, `events.js:76-83`）
- 音声長は生秒数を保存せず、`bucketAudioDuration()`（`events.js:49-54`）で `'0-3m' | '3-15m' | '15m+'` の3区分に丸めてから渡している（`transcribe.js:68, 168, 179`）
- エラー内容は `classifyTranscriptionError()` の分類コードのみを `mapErrorCategory()`（`events.js:60-69`）で固定enumに変換して渡し、rawなエラーメッセージは渡していない（`transcribe.js:162`コメント「eventsにはrawメッセージを渡さず、分類コードのみをマッピングして記録する」）
- `AuthModal.jsx:26`のコメント「送信『試行』の計測（成否を問わず発火。email等の入力値は一切送らない）」の通り、`signup_submit`イベントにemail等のフォーム入力値は含まれていない

---

## ■ Web/Android両方から送信されているか

**結論：同一コードから送信されており、プラットフォーム分岐は存在しない。**

- `capacitor.config.json:4` の `"webDir": "client/dist"` により、Androidアプリは `client/` の同一ビルド成果物をWebViewでラップして動作する。Web版・Android版で別のanalytics実装は存在しない。
- `client/src/lib/analytics.js`、`App.jsx`、`AuthModal.jsx` 内で `trackEvent()` 呼び出し周辺に `Capacitor.isNativePlatform()` 等の分岐は存在しない（grep結果0件）。`billing.js`（Google Play課金）は `isNative()` 分岐があるのとは対照的に、イベント計測は無条件に両プラットフォームで動作する設計。

---

## ■ 本番Supabaseプロジェクトの同一性

`client/.env` と `server/.env` を突合した結果、**同一のSupabaseプロジェクトURLを参照**している：
```
client/.env: VITE_SUPABASE_URL=https://kbnblxgtsjebhnjupijg.supabase.co
server/.env: SUPABASE_URL=https://kbnblxgtsjebhnjupijg.supabase.co
```

Vercelデプロイ設定（`vercel.json`）では client（`client/dist`）と server（`api/index.js`、同一リポジトリ）を同一プロジェクトからビルド・配信しており、Web版は同一オリジン内で完結する構成。

**未確定：Android版アプリの実ビルド時の値。** `client/.env.example` には `VITE_API_BASE=https://saidlog.vercel.app` という例示があり、Android向けビルドはこの値（絶対URL）を使う設計意図と推測できるが、実際にAndroidの本番AAB/APKビルド時にどの環境変数値が焼き込まれたかは、リポジトリ内のファイルだけでは確認できない（CI/ローカルビルド時の環境変数はリポジトリに含まれないため）。Web版と同じSupabaseプロジェクトを指している可能性が高いが、断定はできない。

---

## ■ guest_usage 15分 と 画面表示 3分 の不一致の実態

**調査の結果、これは「同じ制限が2つの値で矛盾して表示されている」という不一致ではなく、目的の異なる2つの独立した制限が存在するだけであることが判明した。**

### guest_usage の15分制限（ゲスト無料体験の音声長上限）

`server/routes/transcribe.js:71-72, 85-87`：
```js
const GUEST_TRIAL_MAX_MINUTES = parseInt(process.env.GUEST_TRIAL_MAX_MINUTES ?? '15', 10);
const GUEST_TRIAL_MAX_SECONDS = GUEST_TRIAL_MAX_MINUTES * 60;
...
if ((durationSeconds ?? 0) > GUEST_TRIAL_MAX_SECONDS) {
  return res.status(403).json({ error: 'GUEST_TRIAL_TOO_LONG' });
}
```
`server/.env` に `GUEST_TRIAL_MAX_MINUTES` の指定は無く（grep結果0件）、デフォルト値の**15分**がそのまま有効。この値はDBスキーマ（`supabase/migrations/20260623000001_add_guest_usage.sql`）には存在せず、アプリケーションコード（環境変数のデフォルト値）でのみ定義されている。

エラー時のUI文言（`client/src/App.jsx:184`）も同じ15分を表示しており、ここは一致している：
```js
setError('ゲストの無料体験は15分以内の音声のみ対応しています。無料登録するとより長い音声も文字起こしできます。');
```

### 画面表示の3分（無関係の別機能：フルAI要約プレビューの解放閾値）

`client/src/App.jsx:165-169`（文字起こし完了後、無料プラン`ume`ユーザーにフル要約体験を提案するかどうかの判定）：
```js
const eligible = (
  s?.planId === 'ume' &&
  s?.fullSummaryUsed === false &&
  (data.audioDurationSec ?? 0) >= 180
);
setSummaryTrialPending(eligible);
```
`180`秒 = 3分。これは**ゲスト無料体験の音声長上限とは無関係の、別機能（無料プランユーザー向けのフルAI要約お試し提案の解放条件）の閾値**である。

UI文言としては以下2箇所で「3分」が言及されている：
- `client/src/i18n.js:19`：`detailsTrial: '3分以上の音声では、文字起こしに加えて会議メモ化のプレビューを試せます'`（S01画面の「録音・アップロード前の確認」折りたたみ内、`App.jsx`の`<li>{t('app.s01.detailsTrial')}</li>`から参照）
- `client/src/components/TranscriptView.jsx:268`：`『AI議事録ツール』機能が解放されます`という文言（3分未満の音声で文字起こし結果画面に表示される案内）

**結論：15分と3分は同一の制限を指す矛盾した表示ではない。** 「15分」はゲストが無料で文字起こしできる音声の長さの上限、「3分」は（ログイン済み無料プランユーザーに対する）フルAI要約プレビュー機能が解放される音声長の下限であり、対象ユーザー層（ゲスト vs ログイン済み無料会員）も機能（文字起こし可否 vs 要約プレビュー解放）も異なる。

なお、events計測側の `bucketAudioDuration()`（`server/services/events.js:49-54`、`'0-3m' | '3-15m' | '15m+'`）のバケット境界も180秒（3分）を使っており、これはフルAI要約解放閾値と意図的に揃えた分析用の区分と見られる（15分もバケット境界に含まれている：`900`秒）。こちらも「不一致」ではなく、両方の閾値を分析上表現できるよう設計されたバケット分割と解釈できる。

---

## ■ 未確定事項

1. Android本番ビルド時に実際に焼き込まれた `VITE_API_BASE` / `VITE_SUPABASE_URL` の値そのもの（リポジトリ内のファイルからは確認不能。CI/ローカルビルド環境の実際の値の確認が必要）。
2. `GUEST_TRIAL_MAX_MINUTES` はコードのデフォルト値（15）が有効という結論だが、本番のVercel環境変数側で明示的に別の値が設定されている可能性はリポジトリからは確認できない（`server/.env`はローカル開発用ファイルであり、本番のVercel環境変数とは別管理の可能性がある）。
3. `events` テーブルへの実際の書き込みが本番環境で正常に稼働しているか（RLSポリシー、テーブルの実在、直近のデータ有無等）は、本番Supabaseへの読み取りクエリを要するため今回は未確認（禁止事項「本番Supabaseへの書き込み系操作」を踏まえ、読み取りも含め本番アクセスは行っていない）。
