-- One receipt may fund a Main security deposit and its initial rent/service obligation.
-- No new table; immutable order snapshots live in operational_tasks with their own record type.
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS target_initial_contract_id uuid REFERENCES contracts(id);
ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS ck_allocation_one_target;
ALTER TABLE payment_allocations ADD CONSTRAINT ck_allocation_one_target CHECK
  (num_nonnulls(target_invoice_id,target_deposit_contract_id,target_settlement_contract_id,target_initial_contract_id)=1);
CREATE INDEX IF NOT EXISTS ix_allocation_initial_contract ON payment_allocations(target_initial_contract_id);

CREATE OR REPLACE FUNCTION bhome24_initial_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE receipt payments%ROWTYPE; contract contracts%ROWTYPE; quote jsonb; code text;
  deposit_paid numeric; rental_paid numeric; rental_due numeric; receipt_used numeric;
BEGIN
  IF NEW.target_initial_contract_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  IF NEW.source_payment_id IS NULL OR NEW.source_deposit_contract_id IS NOT NULL OR NEW.amount<=0 THEN
    RAISE EXCEPTION 'Initial payment requires a verified bank receipt' USING ERRCODE='23514';
  END IF;
  SELECT * INTO receipt FROM payments WHERE id=NEW.source_payment_id FOR UPDATE;
  SELECT * INTO contract FROM contracts WHERE id=NEW.target_initial_contract_id;
  SELECT task_data->'state' INTO quote FROM operational_tasks
    WHERE source_key='main-initial:'||contract.id::text AND task_data->>'recordType'='MainInitialPaymentV1';
  SELECT task_data->'state'->>'code' INTO code FROM operational_tasks
    WHERE task_data->>'recordType'='PaymentCodeV1' AND task_data->'state'->>'kind'='MainInitial'
    AND task_data->'state'->>'obligationId'=contract.id::text
    AND upper(task_data->'state'->>'mode')=split_part(receipt.provider_code,':',2);
  IF quote IS NULL OR code IS NULL OR receipt.status<>'VERIFIED' OR receipt.verification_method<>'AUTO'
    OR receipt.provider_code NOT IN ('SEPAY:TEST','SEPAY:LIVE') OR contract.contract_type<>'MAIN' OR contract.status<>2
    OR quote->>'snapshotHash'<>contract.snapshot_hash
    OR (quote->>'requiredDeposit')::numeric<>contract.deposit_required OR (quote->>'monthlyRent')::numeric<>contract.monthly_rent
    OR COALESCE(receipt.remittance_info,'') !~* ('(^|[^A-Za-z0-9])'||code||'([^A-Za-z0-9]|$)') THEN
    RAISE EXCEPTION 'Initial payment order or source is invalid' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO deposit_paid FROM payment_allocations WHERE target_deposit_contract_id=contract.id;
  SELECT COALESCE(sum(amount),0) INTO rental_paid FROM payment_allocations WHERE target_initial_contract_id=contract.id;
  SELECT (quote->>'monthlyRent')::numeric+COALESCE(sum((fee->>'amount')::numeric),0)
    INTO rental_due FROM jsonb_array_elements(quote->'charges') fee;
  SELECT COALESCE(sum(amount),0) INTO receipt_used FROM payment_allocations WHERE source_payment_id=receipt.id;
  IF NEW.amount<>rental_due-rental_paid OR deposit_paid<(quote->>'requiredDeposit')::numeric
    OR receipt_used+NEW.amount<>receipt.amount
    OR EXISTS(SELECT 1 FROM payment_allocations WHERE source_payment_id=receipt.id AND
      (target_deposit_contract_id IS DISTINCT FROM contract.id OR target_initial_contract_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Initial payment amount or allocation differs' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS allocation_initial_payment_guard ON payment_allocations;
CREATE TRIGGER allocation_initial_payment_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_initial_payment_guard();

CREATE OR REPLACE FUNCTION bhome24_initial_order_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.task_data->>'recordType'='MainInitialPaymentV1' THEN
    RAISE EXCEPTION 'Initial payment orders are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS main_initial_order_immutable ON operational_tasks;
CREATE TRIGGER main_initial_order_immutable BEFORE UPDATE OR DELETE ON operational_tasks FOR EACH ROW EXECUTE FUNCTION bhome24_initial_order_immutable();

CREATE OR REPLACE FUNCTION bhome24_sepay_technical_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE state jsonb; target_location uuid;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.task_data->>'recordType'='PaymentCodeV1' THEN
    RAISE EXCEPTION 'Issued payment codes are immutable and cannot be reused' USING ERRCODE='23514';
  END IF;
  IF TG_OP<>'INSERT' AND OLD.task_data->>'recordType'='SePayEventV1' THEN
    IF TG_OP='DELETE' OR NEW.task_type<>'COMMAND' OR NEW.task_data->>'recordType' IS DISTINCT FROM 'SePayEventV1' OR ROW(OLD.id,OLD.source_key,OLD.task_data->'transaction',OLD.task_data->>'mode') IS DISTINCT FROM
      ROW(NEW.id,NEW.source_key,NEW.task_data->'transaction',NEW.task_data->>'mode') THEN
      RAISE EXCEPTION 'Provider event identity and evidence are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.task_data->>'recordType'='PaymentCodeV1' THEN
    state:=NEW.task_data->'state';
    IF state->>'kind'='Invoice' THEN SELECT location_id INTO target_location FROM invoices WHERE id=(state->>'obligationId')::uuid;
    ELSIF state->>'kind' IN ('Deposit','MainInitial') THEN SELECT r.location_id INTO target_location FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.id=(state->>'obligationId')::uuid;
    END IF;
    IF NEW.task_type<>'COMMAND' OR NEW.status<>'Issued' OR COALESCE(state->>'code','') !~ '^BH[0-9]{8}$' OR
      COALESCE(state->>'mode','') NOT IN ('Test','Live') OR NEW.source_key IS DISTINCT FROM 'payment-code:'||(state->>'code') OR
      target_location IS NULL OR target_location IS DISTINCT FROM NEW.location_id OR target_location::text IS DISTINCT FROM state->>'locationId' THEN
      RAISE EXCEPTION 'Payment code must bind one scoped obligation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION bhome24_receipt_disposition_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE receipt_amount numeric; receipt_ref text; allocated numeric; reserved numeric;
BEGIN
  IF NEW.source_payment_id IS NULL OR NEW.amount<=0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT amount,upper(btrim(transaction_reference)) INTO receipt_amount,receipt_ref FROM payments WHERE id=NEW.source_payment_id AND status='VERIFIED';
  SELECT COALESCE(sum(amount),0) INTO allocated FROM payment_allocations WHERE source_payment_id=NEW.source_payment_id;
  SELECT COALESCE(sum(requested_amount),0) INTO reserved FROM refund_requests
    WHERE source_payment_id=NEW.source_payment_id AND status IN ('REQUESTED','APPROVED','COMPLETED');
  IF receipt_amount IS NULL OR allocated+reserved+NEW.amount>receipt_amount OR EXISTS(
    SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
    WHERE p.id=NEW.source_payment_id AND h->>'recordType'='ReceiptExcessDispositionV1') OR EXISTS(
    SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
    WHERE h->>'recordType'='BankReferenceClaim' AND h->'state'->>'normalizedReference'=receipt_ref
      AND NOT (NEW.target_initial_contract_id IS NOT NULL AND p.id=NEW.source_payment_id AND EXISTS(
        SELECT 1 FROM payment_allocations a WHERE a.id=(h->'state'->>'allocationId')::uuid
          AND a.source_payment_id=NEW.source_payment_id AND a.target_deposit_contract_id=NEW.target_initial_contract_id))) THEN
    RAISE EXCEPTION 'A refundable receipt or reserved refund cannot fund another allocation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
