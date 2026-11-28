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
    WHERE source_key IN ('main-initial:'||contract.id::text,'main-initial-room:'||contract.id::text,'main-initial-sandbox-room:'||contract.id::text)
      AND task_data->>'recordType'='MainInitialPaymentV1'
    ORDER BY (source_key='main-initial-sandbox-room:'||contract.id::text) DESC,
      (source_key='main-initial-room:'||contract.id::text) DESC LIMIT 1;
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
  SELECT CASE WHEN quote->>'sharedRentContractId' IS NULL AND quote->>'sharedInvoiceId' IS NULL
    THEN (quote->>'monthlyRent')::numeric ELSE 0 END+COALESCE(sum((fee->>'amount')::numeric),0)
    INTO rental_due FROM jsonb_array_elements(quote->'charges') fee;
  SELECT COALESCE(sum(amount),0) INTO receipt_used FROM payment_allocations WHERE source_payment_id=receipt.id;
  IF NEW.amount<>rental_due-rental_paid OR (quote->>'sharedDepositContractId' IS NULL AND deposit_paid<(quote->>'requiredDeposit')::numeric)
    OR receipt_used+NEW.amount<>receipt.amount
    OR EXISTS(SELECT 1 FROM payment_allocations WHERE source_payment_id=receipt.id AND
      (target_deposit_contract_id IS DISTINCT FROM contract.id OR target_initial_contract_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Initial payment amount or allocation differs' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
