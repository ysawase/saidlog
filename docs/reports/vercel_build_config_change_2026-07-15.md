# Vercel ビルド設定変更記録（2026-07-15）

**重要な注記（記録の出所について）**：本記録はユーザーからの申告に基づいて作成している。Claude
Codeはこのセッション中、Vercelダッシュボードへのアクセス・変更操作を一切行っておらず、
以下の内容を独自の手段（API・ダッシュボード閲覧等）で検証していない。あくまで
「ユーザーがこの会話の外でVercelダッシュボードを手動変更した」という申告を、後から
参照できる形で文書化したものである。

---

## 変更日時

2026-07-15（本日）

## 変更理由

Production OverridesとProject Settingsのビルド設定に差分があり、今後のデプロイでビルド失敗のリスクがあったため。

## 変更前

Project Settings、Override OFF、値は空欄・プレースホルダーのみ。

## 変更後

Project Settings、Override ON、以下の値を設定：

- Build Command: `npm --prefix client run build`
- Output Directory: `client/dist`
- Install Command: `npm install && npm --prefix client install`

（参考：これらの値はリポジトリの`vercel.json`に記載されている`buildCommand`/`outputDirectory`/`installCommand`と一致する。`vercel.json`自体は今回のセッションで変更していない。）

## 変更箇所

Vercelダッシュボード（`vercel.com/ysawases-projects/saidlog/settings/build-and-deployment`）。**リポジトリ内のコミットには残らない変更である**（Gitリポジトリのどのファイルにも対応する差分は存在しない）。

## 変更後のデプロイ確認

直近のProductionデプロイ（commit `eff3516`、Ready状態）が、この設定変更前と変更後のどちらの設定で生成されたものかは、リポジトリの情報だけでは判別できない。**Vercelダッシュボードのデプロイ詳細画面でのビルドログ・タイムスタンプ比較でのみ判別可能なため、「要確認」とする。**

## 残作業

次回デプロイ（新しいpushまたは再デプロイ操作）で、変更後の設定に基づき正常にビルドが完了することの確認が必要。

## Node.jsバージョン整合性（ユーザーがVercelダッシュボードで確認済みの情報）

**注記**：以下もユーザーからの申告に基づく記録であり、Claude Codeが独自にVercelダッシュボードへアクセスして確認したものではない。

- VercelプロジェクトのNode.js Version設定：**24.x**（Build and Deployment画面で確認済み）
- ローカル実行環境のNode.js：**v24.16.0**（このセッション内で`node --version`により確認）
- 両者に不整合がないことを確認済み
