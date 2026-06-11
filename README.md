# Meetlog

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
meetlog/
├── client/                      # フロントエンド (React + Vite)
│   └── src/
│       ├── App.jsx              # 画面全体の状態管理
│       ├── api.js               # バックエンド呼び出し
│       └── components/
│           ├── UploadForm.jsx   # ファイルアップロードUI
│           └── TranscriptView.jsx # 結果表示（話者名は編集可能）
├── server/                      # バックエンド (Express)
│   ├── index.js                 # エントリポイント
│   ├── routes/transcribe.js     # POST /api/transcribe
│   ├── services/assemblyai.js   # AssemblyAI 呼び出し
│   └── utils/removeFillers.js   # フィラー語除去
└── package.json                 # ルート（client/server を一括起動）
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

## ロードマップ

- **フェーズ1（現在）**: アップロード → 文字起こし＋話者識別 → 表示、フィラー語除去
- **フェーズ2**: Supabase による履歴保存、Vercel デプロイ
