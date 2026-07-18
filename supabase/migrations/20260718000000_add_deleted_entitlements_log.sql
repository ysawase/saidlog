-- アカウント削除時にuser_entitlementsがON DELETE CASCADEで完全消去されることへの対策。
-- 返金・チャージバック紛争時の課金骨格情報を、個人を特定できない形で一定期間保持する。
-- user_id・メールアドレス等の個人識別情報は一切持たない。purchase_tokenは生値ではなくSHA-256ハッシュのみ保存する。
CREATE TABLE IF NOT EXISTS public.deleted_entitlements_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at          timestamptz NOT NULL DEFAULT now(),
  plan_id             text,
  status              text,
  purchase_token_hash text,
  period_end          timestamptz,
  retention_expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS deleted_entitlements_log_retention_idx
  ON public.deleted_entitlements_log (retention_expires_at);

ALTER TABLE public.deleted_entitlements_log ENABLE ROW LEVEL SECURITY;
-- クライアント向けポリシーなし（service role経由のみ）
