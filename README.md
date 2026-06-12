# SaidLog

リアル会議向けの、話者識別付き音声文字起こしWebアプリ。

音声ファイル（mp3 / mp4 / wav / m4a）をアップロードすると、AssemblyAI で文字起こし＋話者識別を行い、「話者名：発言内容」の形式で表示します。フィラー語（あー、えーと など）は自動除去されます。

## 技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | React (Vite) |
| バックエンド | Node.js + Express |
| 文字起こし・話者識別 | AssemblyAI API |
| データベース | Supabase（フェーズ2で追加予定） |
| デプロイ | Vercel（フェーズ2で追加予定） |

## ディレクトリ構成

```
saidlog/
├── api/
│   └── index.js                 # Vercel Functions エントリ（Expressをエクスポート）
├── client/                      # フロントエンド (React + Vite)
│   └── src/
│       ├── App.jsx              # 画面全体の状態管理
│       ├── api.js               # バックエンド呼び出し
│       └── components/
│           ├── UploadForm.jsx   # ファイルアップロードUI
│           └── TranscriptView.jsx # 結果表示（話者名は編集可能）
├── server/                      # バックエンド (Express)
│   ├── app.js                   # Expressアプリ本体（ローカル/Vercel共通）
│   ├── index.js                 # ローカル開発用エントリポイント
│   ├── routes/transcribe.js     # POST /api/transcribe
│   ├── services/assemblyai.js   # AssemblyAI 呼び出し
│   └── utils/removeFillers.js   # フィラー語除去
├── vercel.json                  # Vercel ビルド・ルーティング設定
└── package.json                 # ルート（サーバー依存＋一括起動スクリプト）
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
