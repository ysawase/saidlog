CREATE TABLE guest_usage (
  guest_id text PRIMARY KEY,
  used_seconds integer NOT NULL DEFAULT 0,
  transcribe_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  converted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
