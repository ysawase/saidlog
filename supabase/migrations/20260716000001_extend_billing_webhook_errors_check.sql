-- billing_webhook_errors.error_class のCHECK制約を拡張する。
-- 対象テーブル: public.billing_webhook_errors
-- 対象列: error_class
-- 目的: resolveEntitlementStatus()のinvalid_purchase一括分類を
-- product_mismatch / token_invalid / unknown_result に分解したことに伴い、
-- 既存2値（entitlement_not_found, entitlement_conflict）に加えてこの3値を許可する。
ALTER TABLE public.billing_webhook_errors
  DROP CONSTRAINT IF EXISTS billing_webhook_errors_error_class_check;

ALTER TABLE public.billing_webhook_errors
  ADD CONSTRAINT billing_webhook_errors_error_class_check
  CHECK (error_class IN (
    'entitlement_not_found',
    'entitlement_conflict',
    'product_mismatch',
    'token_invalid',
    'unknown_result'
  ));
