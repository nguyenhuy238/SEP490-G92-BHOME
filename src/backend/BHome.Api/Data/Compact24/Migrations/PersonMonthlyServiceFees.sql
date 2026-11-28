-- Compact24 existing databases already have varchar(30) calculation_method.
-- No existing policy, signed contract, invoice or settlement is rewritten.
-- Existing unsupported legacy rows remain available for explicit review;
-- all new/updated policies must satisfy the approved category/method pairs.
ALTER TABLE public.billing_policies ADD CONSTRAINT ck_billing_policy_calculation_method
  CHECK (
    (category = 0 AND calculation_method = 'FIXED_PER_ROOM_PER_MONTH') OR
    (category IN (1, 2) AND calculation_method = 'METERED') OR
    (category = 3 AND calculation_method IN ('FIXED_PER_ROOM_PER_MONTH', 'FIXED_PER_PERSON_PER_MONTH'))
  ) NOT VALID;
