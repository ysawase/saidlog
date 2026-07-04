-- S01効果検証イベント（Phase 1）
-- 匿名の行動イベントのみを保存する。個人情報・本文・raw値は保存しない。
-- auth.usersへの外部キーを持たない（raw user_id非保存の方針、保持期間削除の単純化）。
CREATE TABLE IF NOT EXISTS public.events (
  id                    bigserial PRIMARY KEY,
  event_name            text NOT NULL CHECK (event_name IN (
                          's01_view', 's01_record_click', 's01_upload_click',
                          'transcription_request', 'transcription_success',
                          'transcription_error', 'auth_modal_open',
                          'signup_submit')),
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  anonymous_session_id  uuid,
  actor_type            text NOT NULL DEFAULT 'unknown'
                          CHECK (actor_type IN ('guest', 'user', 'unknown')),
  auth_state            text NOT NULL DEFAULT 'guest'
                          CHECK (auth_state IN ('guest', 'logged_in')),
  plan_state            text NOT NULL DEFAULT 'unknown'
                          CHECK (plan_state IN ('unknown', 'free', 'plus')),
  source                text CHECK (source IN
                          ('s01', 'auth_modal', 'history', 'plus_cta',
                           'header', 'guest_gate')),
  page_path             text,
  device_category       text NOT NULL DEFAULT 'unknown'
                          CHECK (device_category IN ('mobile', 'desktop', 'unknown')),
  result                text CHECK (result IN ('success', 'error')),
  error_category        text CHECK (error_category IN
                          ('auth', 'rate_limit', 'timeout',
                           'provider_response', 'audio_processing', 'unknown')),
  audio_duration_bucket text CHECK (audio_duration_bucket IN
                          ('0-3m', '3-15m', '15m+')),
  stt_provider          text CHECK (stt_provider IN
                          ('groq', 'amivoice', 'assemblyai', 'unknown')),
  metadata_json         jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 保持期間削除（将来: occurred_at < now() - interval '90 days' のDELETE）用
CREATE INDEX IF NOT EXISTS events_occurred_at_idx
  ON public.events (occurred_at);
-- イベント別集計用
CREATE INDEX IF NOT EXISTS events_name_occurred_idx
  ON public.events (event_name, occurred_at);

-- RLS有効・クライアント向けポリシーなし（server/service role経由のみ）
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
