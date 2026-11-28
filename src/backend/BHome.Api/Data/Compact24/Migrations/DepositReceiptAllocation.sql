-- No rewrite of existing receipts/allocations. New writes respect the agreed deposit budget.
CREATE FUNCTION bhome24_deposit_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE old_records jsonb; records jsonb; record jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(h),'[]'::jsonb) INTO records FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1';
  IF TG_OP='UPDATE' THEN
    SELECT COALESCE(jsonb_agg(h),'[]'::jsonb) INTO old_records FROM jsonb_array_elements(OLD.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1';
    IF old_records<>'[]'::jsonb AND old_records IS DISTINCT FROM records THEN RAISE EXCEPTION 'Deposit payer snapshot is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF jsonb_array_length(records)>1 THEN RAISE EXCEPTION 'Only one deposit allocation per receipt' USING ERRCODE='23514'; END IF;
  IF records='[]'::jsonb THEN RETURN NEW; END IF;
  record:=records->0->'state';
  IF record->>'payerResidentId' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1') THEN
    RAISE EXCEPTION 'Resident depositor cannot be relabeled as an external payer' USING ERRCODE='23514';
  END IF;
  IF old_records=records THEN RETURN NEW; END IF;
  IF NEW.status<>'VERIFIED' OR record->>'transferId' IS DISTINCT FROM NEW.id::text OR
    record->>'normalizedBankReference' IS DISTINCT FROM upper(btrim(NEW.transaction_reference)) OR
    COALESCE(record->>'receiptAmount','') !~ '^[0-9]+$' OR COALESCE(record->>'allocatedAmount','') !~ '^[0-9]+$' OR
    COALESCE(record->>'transferFingerprint','') !~ '^[A-F0-9]{64}$' OR
    (record->>'receiptAmount')::numeric<>NEW.amount OR (record->>'allocatedAmount')::numeric<=0 OR (record->>'allocatedAmount')::numeric>NEW.amount OR
    (record->>'payerResidentId' IS NULL)=(record->>'externalPayerAttestationId' IS NULL) OR
    NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=record->>'verifiedByUserId' AND u.is_active AND 'Owner'=ANY(u.roles)) THEN
    RAISE EXCEPTION 'Deposit receipt requires a verified source and explicit payer' USING ERRCODE='23514';
  END IF;
  IF record->>'payerResidentId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM residents r JOIN contract_residents cr ON cr.resident_id=r.id
    WHERE r.id::text=record->>'payerResidentId' AND cr.contract_id::text=record->>'contractId' AND r.verification_status=1
      AND r.user_id::text IS NOT DISTINCT FROM record->>'payerUserId') THEN
    RAISE EXCEPTION 'Deposit payer must be a verified contract Resident' USING ERRCODE='23514';
  END IF;
  IF record->>'externalPayerAttestationId' IS NOT NULL AND (record->>'payerUserId' IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1' AND h->'state'->>'id'=record->>'externalPayerAttestationId')) THEN
    RAISE EXCEPTION 'Deposit external payer must match its attestation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER payment_deposit_receipt_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bhome24_deposit_receipt_guard();

CREATE FUNCTION bhome24_deposit_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE required numeric; received numeric; receipt_amount numeric; record jsonb;
BEGIN
  IF NEW.target_deposit_contract_id IS NULL OR NEW.amount<=0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT deposit_required INTO required FROM contracts WHERE id=NEW.target_deposit_contract_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO received FROM payment_allocations WHERE target_deposit_contract_id=NEW.target_deposit_contract_id;
  IF NEW.amount>required-received THEN RAISE EXCEPTION 'Deposit allocation exceeds agreed remaining funds' USING ERRCODE='23514'; END IF;
  IF NEW.source_payment_id IS NOT NULL THEN
    SELECT amount INTO receipt_amount FROM payments WHERE id=NEW.source_payment_id;
    IF NEW.amount<>LEAST(receipt_amount,required-received) THEN RAISE EXCEPTION 'Deposit receipt allocation must preserve its excess' USING ERRCODE='23514'; END IF;
    SELECT h->'state' INTO record FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
      WHERE p.id=NEW.source_payment_id AND h->>'recordType'='DepositReceiptAllocationV1';
    IF record IS NOT NULL AND (record->>'allocationId' IS DISTINCT FROM NEW.id::text OR record->>'contractId' IS DISTINCT FROM NEW.target_deposit_contract_id::text OR
      (record->>'allocatedAmount')::numeric<>NEW.amount OR record->>'payerUserId' IS DISTINCT FROM NEW.paid_by_user_id::text OR record->>'verifiedByUserId' IS DISTINCT FROM NEW.created_by_user_id::text) THEN
      RAISE EXCEPTION 'Deposit allocation must match immutable payer snapshot' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_deposit_budget_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_deposit_allocation_guard();

CREATE FUNCTION bhome24_deposit_receipt_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE payer jsonb; receipt_amount numeric; allocated numeric; reserved numeric;
BEGIN
  IF NEW.source_payment_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT h->'state',p.amount INTO payer,receipt_amount FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
    WHERE p.id=NEW.source_payment_id AND h->>'recordType'='DepositReceiptAllocationV1' AND h->'state'->>'payerResidentId' IS NOT NULL;
  IF payer IS NULL THEN RETURN NEW; END IF;
  IF NEW.beneficiary_kind<>'RESIDENT' OR NEW.beneficiary_resident_id::text IS DISTINCT FROM payer->>'payerResidentId' OR NEW.source_deposit_contract_id IS NOT NULL THEN
    RAISE EXCEPTION 'Deposit receipt excess must return to the actual Resident payer' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('REQUESTED','APPROVED','COMPLETED') THEN
    SELECT COALESCE(sum(amount),0) INTO allocated FROM payment_allocations WHERE source_payment_id=NEW.source_payment_id;
    SELECT COALESCE(sum(requested_amount),0) INTO reserved FROM refund_requests WHERE source_payment_id=NEW.source_payment_id AND id<>NEW.id AND status IN ('REQUESTED','APPROVED','COMPLETED');
    IF allocated<=0 OR reserved+NEW.requested_amount>receipt_amount-allocated THEN RAISE EXCEPTION 'Deposit receipt refund exceeds its remaining excess' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER refund_deposit_receipt_guard BEFORE INSERT OR UPDATE ON refund_requests FOR EACH ROW EXECUTE FUNCTION bhome24_deposit_receipt_refund_guard();

CREATE FUNCTION bhome24_deposit_refund_valid(refund_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM refund_requests r JOIN payments p ON p.id=r.source_payment_id
    JOIN payment_allocations a ON a.source_payment_id=p.id AND a.target_deposit_contract_id IS NOT NULL
    JOIN residents person ON person.id=r.beneficiary_resident_id
    LEFT JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1') payer ON true
    CROSS JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
      WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1) proof
    WHERE r.id=refund_id AND r.status='COMPLETED' AND r.beneficiary_kind='RESIDENT' AND r.source_deposit_contract_id IS NULL AND p.status='VERIFIED'
      AND (payer.state->>'payerResidentId'=person.id::text AND payer.state->>'allocationId'=a.id::text
        AND payer.state->>'contractId'=a.target_deposit_contract_id::text AND (payer.state->>'allocatedAmount')::numeric=a.amount
        OR payer.state IS NULL AND a.paid_by_user_id=person.user_id)
      AND proof.state->>'classification'='ExcessReceiptRefundV1' AND r.executed_at IS NOT NULL
      AND proof.state->'upload'->>'objectKey'=r.execution_evidence_key AND proof.state->'upload'->>'externalReference'=r.external_refund_reference
      AND proof.state->'upload'->>'sha256' ~ '^[A-F0-9]{64}$'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(proof.state->'events')='array' THEN proof.state->'events' ELSE '[]'::jsonb END) e WHERE e->>'action'='Completed')
      AND p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id)
        >=(SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_payment_id=p.id AND rr.status='COMPLETED'))
$fn$;
