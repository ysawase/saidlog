-- Step 1-a: user_entitlements
CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id               text NOT NULL CHECK (plan_id IN ('ume', 'take')),
  status                text NOT NULL CHECK (status IN ('free', 'active', 'expired', 'canceled', 'grace_period')),
  provider              text NOT NULL CHECK (provider IN ('manual', 'google_play', 'app_store')),
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_entitlement"
  ON public.user_entitlements FOR SELECT
  USING (auth.uid() = user_id);

-- Step 1-b: usage_periods
CREATE TABLE IF NOT EXISTS public.usage_periods (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start  timestamptz NOT NULL,
  used_seconds  integer NOT NULL DEFAULT 0,
  UNIQUE (user_id, period_start)
);

ALTER TABLE public.usage_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_usage"
  ON public.usage_periods FOR SELECT
  USING (auth.uid() = user_id);

-- Step 1-c: profiles (create if not exists, then add column)
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_update_own_profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_summary_used boolean NOT NULL DEFAULT false;

-- Step 1-d: transcripts — add status columns
ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS transcription_status text
    CHECK (transcription_status IN ('uploaded', 'transcribing', 'completed', 'failed'));

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS audio_duration_seconds integer;

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS charged_seconds integer;

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS stt_provider text
    CHECK (stt_provider IN ('assemblyai', 'amivoice'));

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS error_code text;

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS summary_type text
    CHECK (summary_type IN ('none', 'preview', 'full'));
