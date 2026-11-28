-- A verified move-out date can be known even if historical actual start was never recorded.
-- Preserve unknown starts; do not substitute contractual dates or delete registration evidence.
DO $$
DECLARE old_check record;
BEGIN
  FOR old_check IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.contract_residents'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%actual_move_out_date%'
      AND pg_get_constraintdef(oid) LIKE '%actual_residence_from%'
      AND conname<>'ck_resident_actual_dates'
  LOOP
    EXECUTE format('ALTER TABLE public.contract_residents DROP CONSTRAINT %I',old_check.conname);
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.contract_residents'::regclass AND conname='ck_resident_actual_dates') THEN
    ALTER TABLE public.contract_residents ADD CONSTRAINT ck_resident_actual_dates
      CHECK(actual_move_out_date IS NULL OR actual_residence_from IS NULL OR actual_move_out_date>=actual_residence_from);
  END IF;
END $$;
