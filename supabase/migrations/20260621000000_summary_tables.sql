-- transcriptsにRLSを有効化
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users_select_own_transcripts"
    ON public.transcripts FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "users_insert_own_transcripts"
    ON public.transcripts FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "users_delete_own_transcripts"
    ON public.transcripts FOR DELETE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- summary_previewカラム追加
ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS summary_preview text;

-- summary_typeのdefault追加（既存カラム）
ALTER TABLE public.transcripts
  ALTER COLUMN summary_type SET DEFAULT 'none';

-- transcript_full_summariesテーブル作成
CREATE TABLE IF NOT EXISTS public.transcript_full_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES public.transcripts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template text NOT NULL DEFAULT 'bullets'
    CHECK (template IN ('bullets', 'minutes')),
  summary_full text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transcript_id, template)
);

-- transcript_full_summariesはRLSを有効化するが
-- クライアント向けSELECTポリシーは作らない（server/service role経由のみ）
ALTER TABLE public.transcript_full_summaries ENABLE ROW LEVEL SECURITY;
