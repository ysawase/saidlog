ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS purchase_token text;
