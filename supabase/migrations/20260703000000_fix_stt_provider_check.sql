ALTER TABLE public.transcripts
  DROP CONSTRAINT IF EXISTS transcripts_stt_provider_check;

ALTER TABLE public.transcripts
  ADD CONSTRAINT transcripts_stt_provider_check
  CHECK (stt_provider IN ('assemblyai', 'amivoice', 'groq'));
