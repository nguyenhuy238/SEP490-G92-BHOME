-- BR-01/05/07: contact before account; Holding can be anonymously accepted before a Main activates.
-- No accounts, contract state or financial rows are changed by this migration.
ALTER TABLE public.residents ADD COLUMN contact_email varchar(256);
CREATE UNIQUE INDEX ux_resident_contact_email ON public.residents(lower(btrim(contact_email))) WHERE contact_email IS NOT NULL;
DO $lifecycle$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid='public.contracts'::regclass AND contype='c'
          AND position('activated_at' in pg_get_constraintdef(oid))>0
          AND position('tenant_user_id' in pg_get_constraintdef(oid))>0
    LOOP
        EXECUTE format('ALTER TABLE public.contracts DROP CONSTRAINT %I',constraint_name);
    END LOOP;
END
$lifecycle$;
ALTER TABLE public.contracts ADD CONSTRAINT ck_contract_active_metadata
    CHECK (status<>3 OR (activated_at IS NOT NULL AND activated_by_user_id IS NOT NULL));
