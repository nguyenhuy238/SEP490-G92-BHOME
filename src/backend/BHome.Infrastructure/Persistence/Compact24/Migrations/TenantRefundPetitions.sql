-- Extend the existing Compact24 refund table without adding any of the 24 physical tables.
-- Actual receipt/deposit refunds must still have exactly one financial source.
DO $migration$
DECLARE old_constraint text;
BEGIN
  -- Fresh Compact24 DDL already includes the final constraint; only existing
  -- databases with the original exclusive-source CHECK need an upgrade.
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid='public.refund_requests'::regclass AND contype='c'
               AND conname='ck_refund_source_or_tenant_petition') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid='public.refund_requests'::regclass AND contype='c'
                     AND conname='ck_refund_source_or_tenant_petition' AND convalidated
                     AND position('TenantRefundPetitionV1' IN pg_get_constraintdef(oid))>0) THEN
      RAISE EXCEPTION 'Unexpected tenant refund constraint definition';
    END IF;
  ELSE
    SELECT conname INTO old_constraint FROM pg_constraint
      WHERE conrelid='public.refund_requests'::regclass AND contype='c'
        AND position('source_payment_id IS NULL' IN pg_get_constraintdef(oid))>0
        AND position('source_deposit_contract_id IS NULL' IN pg_get_constraintdef(oid))>0
        AND position('<>' IN pg_get_constraintdef(oid))>0;
    IF old_constraint IS NULL THEN
      RAISE EXCEPTION 'Expected refund source exclusivity constraint is missing';
    END IF;
    EXECUTE format('ALTER TABLE public.refund_requests DROP CONSTRAINT %I',old_constraint);
    EXECUTE $ddl$ALTER TABLE public.refund_requests ADD CONSTRAINT ck_refund_source_or_tenant_petition
      CHECK ((source_payment_id IS NULL)<>(source_deposit_contract_id IS NULL) OR
        (source_payment_id IS NULL AND source_deposit_contract_id IS NULL
         AND beneficiary_kind='RESIDENT' AND beneficiary_resident_id IS NOT NULL
         AND history @> '[{"recordType":"TenantRefundPetitionV1"}]'::jsonb))$ddl$;
  END IF;
END $migration$;
