-- RTDN webhookのuser_entitlements更新で0行/複数行がヒットした異常を記録する。
-- purchase_token・トークン本文・メールアドレス等の機微情報は保存しない。
CREATE TABLE IF NOT EXISTS public.billing_webhook_errors (
  id                 bigserial PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  error_class        text NOT NULL CHECK (error_class IN ('entitlement_not_found', 'entitlement_conflict')),
  notification_type  integer,
  subscription_state text,
  environment        text NOT NULL CHECK (environment IN ('production', 'development')),
  retryable          boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_webhook_errors_occurred_at_idx
  ON public.billing_webhook_errors (occurred_at);

ALTER TABLE public.billing_webhook_errors ENABLE ROW LEVEL SECURITY;
-- クライアント向けポリシーなし（service role経由のみ）
