# 確認メール未達 調査記録（2026-07-21）

## 発見内容

Supabaseダッシュボード（Authentication → Rate Limits）を確認したところ、
以下の設定になっていた。

- Rate limit for sending emails：2 emails/h（プロジェクト全体、ユーザー単位ではない）

同じくAuthentication → Emails画面の上部に以下の表示があり、カスタムSMTPが
未設定であることを確認した。

- "Set up custom SMTP to edit templates - Emails will be sent using the
  default templates. Set up custom SMTP to edit their subject and body."

## 推定原因（未実測）

SaidLogは現時点でSupabase組み込みのデフォルトメール送信を使用しており、
この経路には1時間あたり2通という上限がかかっている。この制限は開発・検証
用途向けの制限であり、本番の実ユーザー宛送信には不向きとされる。

保留4項目1位「確認メール未達」は、この送信上限の枯渇が原因である可能性が
高いと推定する。ただし、以下は未実測・未確認である。

- 実際にこの2通/h制限へ到達したログ・実績があるかどうか（Supabase側の
  ログまたはevents等での裏付けは未取得）
- 制限到達時にSupabase側がエラーを返すか、サイレントに送信をスキップするか
- 確認メール以外（Magic Link等）の送信も同じ2通/hの枠を共有しているため、
  他の認証系メールとの競合が未達に影響しているかどうか

## 次のアクション

カスタムSMTP（SendGrid、Resend、Amazon SES等）の導入を検討する。
外部プロバイダ導入のため、無料枠・料金比較を別途行う（比較検討は次のステップ
で実施、本ファイルでは調査結果の記録のみ）。

## 確認した画面

- Authentication → Emails → Confirm sign up（テンプレート自体は正常、
  デフォルトのまま。件名「Confirm your email address」）
- Authentication → Rate Limits（sending emails: 2/h、他の項目は30〜150の範囲）
