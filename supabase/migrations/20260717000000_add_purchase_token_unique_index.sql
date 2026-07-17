-- purchase_tokenの二重登録防止のための部分UNIQUE INDEX。
-- NULLは複数許容し、値がある行のみ一意性を保証する。
-- CONCURRENTLYは使用しない: Supabase CLIのdb pushは各migrationファイルを
-- 1トランザクションとして実行するため、トランザクションブロック内では
-- CREATE INDEX CONCURRENTLYが使用できない。
CREATE UNIQUE INDEX IF NOT EXISTS user_entitlements_purchase_token_unique
  ON public.user_entitlements (purchase_token)
  WHERE purchase_token IS NOT NULL;
