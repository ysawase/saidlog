# SaidLog

リアル会議向けの、話者識別付き音声文字起こしWebアプリ。

音声ファイル（mp3 / mp4 / wav / m4a）をアップロードすると、AssemblyAI で文字起こし＋話者識別を行い、「話者名：発言内容」の形式で表示します。フィラー語（あー、えーと など）は自動除去されます。

## 技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | React (Vite) |
| バックエンド | Node.js + Express |
| 文字起こし・話者識別 | AssemblyAI API |
| データベース | Supabase |
| デプロイ | Vercel |

## ディレクトリ構成

```
saidlog/
├── .claude/
├── .gitattributes
├── .gitignore
├── 90_vault-admin/
├── CLAUDE.md
├── README.md
├── android/
├── api/
├── capacitor.config.json
├── client/
│   └── src/
│       ├── components/
│       │   ├── AuthModal.jsx
│       │   ├── HistoryList.jsx
│       │   ├── Recorder.jsx
│       │   ├── TranscriptView.jsx
│       │   └── UploadForm.jsx
│       ├── constants/
│       │   └── limits.js
│       ├── context/
│       │   └── AuthContext.jsx
│       ├── lib/
│       │   ├── adapters/
│       │   │   ├── WebMediaRecorderAdapter.js
│       │   │   ├── index.js
│       │   │   └── types.js
│       │   ├── analytics.js
│       │   ├── billing.js
│       │   ├── guestId.js
│       │   ├── history.js
│       │   ├── recorder.js
│       │   ├── recordingDb.js
│       │   ├── storage.js
│       │   ├── supabase.js
│       │   └── upgradeGuard.js
│       ├── utils/
│       │   └── export.js
│       ├── App.css
│       ├── App.jsx
│       ├── api.js
│       ├── i18n.js
│       └── main.jsx
├── docs/
├── meetlog-phase2-design.md
├── package-lock.json
├── package.json
├── saidlog_handover.md
├── scripts/
├── server/
│   ├── config/
│   │   └── plans.js
│   ├── middleware/
│   │   └── auth.js
│   ├── routes/
│   │   ├── account.js
│   │   ├── authCheck.js
│   │   ├── billing.js
│   │   ├── deleteAccount.js
│   │   ├── events.js
│   │   ├── history.js
│   │   ├── summarize.js
│   │   └── transcribe.js
│   ├── services/
│   │   ├── billingWebhook.js
│   │   ├── cleanup.js
│   │   ├── events.js
│   │   ├── googlePlay.js
│   │   ├── plan.js
│   │   ├── storage.js
│   │   ├── subscriptionStatus.js
│   │   └── supabaseAdmin.js
│   ├── stt/
│   │   ├── providers/
│   │   │   ├── amivoice.js
│   │   │   ├── assemblyai.js
│   │   │   └── groq.js
│   │   └── index.js
│   ├── utils/
│   │   ├── classifyTranscriptionError.js
│   │   └── removeFillers.js
│   ├── # Saidlog 作業引き継ぎ（2026-06-12）.md
│   ├── .env.example
│   ├── app.js
│   └── index.js
├── supabase/
│   └── migrations/
│       ├── 20260615000000_plan_control.sql
│       ├── 20260615100000_profiles_trigger.sql
│       ├── 20260621000000_summary_tables.sql
│       ├── 20260623000000_add_purchase_token.sql
│       ├── 20260623000001_add_guest_usage.sql
│       ├── 20260703000000_fix_stt_provider_check.sql
│       ├── 20260704000000_add_events.sql
│       ├── 20260716000000_add_billing_webhook_errors.sql
│       ├── 20260716000001_extend_billing_webhook_errors_check.sql
│       ├── 20260717000000_add_purchase_token_unique_index.sql
│       ├── 20260718000000_add_deleted_entitlements_log.sql
│       └── 20260723000000_add_email_is_registered_function.sql
├── tests/
└── vercel.json
```

## セットアップ

### 1. 依存パッケージのインストール

```powershell
npm run install:all
```

### 2. APIキーの設定

[AssemblyAI のダッシュボード](https://www.assemblyai.com/dashboard) でAPIキーを取得し、`server/.env` を作成します：

```powershell
Copy-Item server/.env.example server/.env
# server/.env を開いて ASSEMBLYAI_API_KEY を書き換える
```

### 3. 起動

```powershell
npm run dev
```

- フロントエンド: http://localhost:5173
- バックエンド: http://localhost:3000

## API

### `POST /api/transcribe`

- リクエスト: `multipart/form-data`、フィールド名 `audio`（mp3 / mp4 / wav / m4a、最大200MB）
- レスポンス:

```json
{
  "id": "transcript-id",
  "text": "全文テキスト",
  "utterances": [
    { "speaker": "A", "text": "発言内容", "start": 1200, "end": 4500 }
  ]
}
```

`start` / `end` はミリ秒。フィラー語は除去済み。

## Vercel へのデプロイ

リポジトリを Vercel に接続すると、`vercel.json` の設定で以下が自動構成されます。

- フロントエンド: `client/` を Vite でビルドし `client/dist` を静的配信
- バックエンド: `api/index.js`（Express アプリ）が Vercel Functions として動作し、`/api/*` を処理

デプロイ前に Vercel ダッシュボードで以下を設定してください。

1. **Settings → General → Root Directory**: 空（リポジトリルート）にする
2. **Settings → Environment Variables**: `ASSEMBLYAI_API_KEY` を追加

### Vercel 上の制限（重要）

- **アップロード上限 約4.5MB**: Vercel Functions のリクエストボディ制限。大きな会議音声はローカル実行を使うか、フェーズ2のストレージ直接アップロード対応が必要
- **実行時間上限**: 長時間音声は文字起こし完了前にタイムアウトする可能性あり（`maxDuration: 300` を設定済み）

## ロードマップ

- **フェーズ1（現在）**: アップロード → 文字起こし＋話者識別 → 表示、フィラー語除去、Vercel デプロイ
- **フェーズ2**: Supabase による履歴保存＋ストレージ直接アップロード（Vercelの4.5MB制限の回避）
