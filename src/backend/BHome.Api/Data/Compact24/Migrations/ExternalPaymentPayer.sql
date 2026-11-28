ALTER TABLE refund_requests ALTER COLUMN beneficiary_resident_id DROP NOT NULL;
ALTER TABLE refund_requests ADD COLUMN beneficiary_kind varchar(12) NOT NULL DEFAULT 'RESIDENT';
ALTER TABLE refund_requests ADD COLUMN external_payer_attestation_id uuid;
ALTER TABLE refund_requests ADD CONSTRAINT ck_refund_beneficiary CHECK (
  (beneficiary_kind='RESIDENT' AND beneficiary_resident_id IS NOT NULL AND external_payer_attestation_id IS NULL) OR
  (beneficiary_kind='EXTERNAL' AND beneficiary_resident_id IS NULL AND external_payer_attestation_id IS NOT NULL AND source_payment_id IS NOT NULL));

-- Runtime guards shared verbatim with the canonical fresh DDL.
CREATE OR REPLACE FUNCTION bhome24_external_payer_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE payer jsonb; old_payer jsonb; entries integer;
BEGIN
  SELECT count(*),jsonb_agg(h->'state')->0 INTO entries,payer FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1';
  IF entries=0 THEN RETURN NEW; END IF;
  IF entries<>1 THEN RAISE EXCEPTION 'External payer attestation is immutable and unique per receipt' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    SELECT h->'state' INTO old_payer FROM jsonb_array_elements(OLD.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1';
    IF old_payer IS NOT NULL THEN
      IF old_payer IS DISTINCT FROM payer THEN RAISE EXCEPTION 'External payer attestation cannot be replaced' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.status<>'VERIFIED' OR payer->>'transferId' IS DISTINCT FROM NEW.id::text OR
    payer->>'normalizedBankReference' IS DISTINCT FROM upper(btrim(NEW.transaction_reference)) OR
    COALESCE(payer->>'receiptAmount','') !~ '^[0-9]+$' OR COALESCE(payer->>'transferFingerprint','') !~ '^[A-F0-9]{64}$' OR
    nullif(btrim(payer->>'payerLabel'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=payer->>'verifiedByUserId' AND u.is_active AND 'Owner'=ANY(u.roles)) THEN
    RAISE EXCEPTION 'External payer requires an Owner-verified bank receipt' USING ERRCODE='23514';
  END IF;
  IF (payer->>'receiptAmount')::numeric<>NEW.amount OR EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=NEW.id AND a.paid_by_user_id IS NOT NULL) OR
    EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_payment_id=NEW.id AND r.status IN ('REQUESTED','APPROVED','COMPLETED')) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ReceiptExcessDispositionV1' AND h->'state'->>'payerResidentId' IS NOT NULL) THEN
    RAISE EXCEPTION 'Receipt already has a different payer or refund obligation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER payment_external_payer_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bhome24_external_payer_guard();

CREATE OR REPLACE FUNCTION bhome24_external_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.source_payment_id IS NOT NULL AND NEW.paid_by_user_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h WHERE p.id=NEW.source_payment_id AND h->>'recordType'='ExternalPaymentPayerV1') THEN
    RAISE EXCEPTION 'External payer receipt cannot be relabeled as a Tenant payment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_external_payer_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_external_allocation_guard();

CREATE OR REPLACE FUNCTION bhome24_external_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE receipt payments%ROWTYPE; payer jsonb; state jsonb; allocated numeric; reserved numeric;
BEGIN
  IF TG_OP='UPDATE' AND ROW(OLD.source_payment_id,OLD.source_deposit_contract_id,OLD.beneficiary_kind,OLD.beneficiary_resident_id,OLD.external_payer_attestation_id,OLD.requested_amount)
    IS DISTINCT FROM ROW(NEW.source_payment_id,NEW.source_deposit_contract_id,NEW.beneficiary_kind,NEW.beneficiary_resident_id,NEW.external_payer_attestation_id,NEW.requested_amount) THEN
    RAISE EXCEPTION 'Refund source, beneficiary and amount are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.beneficiary_kind<>'EXTERNAL' OR NEW.status NOT IN ('REQUESTED','APPROVED','COMPLETED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT * INTO receipt FROM payments WHERE id=NEW.source_payment_id AND status='VERIFIED';
  SELECT h->'state' INTO payer FROM jsonb_array_elements(receipt.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1' AND h->'state'->>'id'=NEW.external_payer_attestation_id::text;
  SELECT h->'state' INTO state FROM jsonb_array_elements(NEW.history) WITH ORDINALITY e(h,n) WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1;
  IF receipt.id IS NULL OR payer IS NULL OR state->>'classification' IS DISTINCT FROM 'ExcessReceiptRefundV1' OR
    state->>'externalPayerAttestationId' IS DISTINCT FROM NEW.external_payer_attestation_id::text OR EXISTS(
      SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=receipt.id AND a.paid_by_user_id IS NOT NULL) OR NOT (
      EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=receipt.id) OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(receipt.history) h WHERE h->>'recordType'='ReceiptExcessDispositionV1'
          AND h->'state'->>'externalPayerAttestationId'=NEW.external_payer_attestation_id::text AND h->'state'->>'payerResidentId' IS NULL
          AND h->'state'->>'id'=state->>'receiptExcessDispositionId')) THEN
    RAISE EXCEPTION 'External refund requires the exact verified payer and allocated or whole excess source' USING ERRCODE='23514';
  END IF;
  IF NEW.status='COMPLETED' AND (state->'upload'->>'objectKey' IS DISTINCT FROM NEW.execution_evidence_key OR
    state->'upload'->>'externalReference' IS DISTINCT FROM NEW.external_refund_reference OR COALESCE(state->'upload'->>'sha256','') !~ '^[A-F0-9]{64}$' OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'events')='array' THEN state->'events' ELSE '[]'::jsonb END) event WHERE event->>'action'='Completed')) THEN
    RAISE EXCEPTION 'External refund completion requires matching execution evidence metadata' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO allocated FROM payment_allocations WHERE source_payment_id=receipt.id;
  SELECT COALESCE(sum(requested_amount),0) INTO reserved FROM refund_requests WHERE source_payment_id=receipt.id AND id<>NEW.id AND status IN ('REQUESTED','APPROVED','COMPLETED');
  IF allocated+reserved+NEW.requested_amount>receipt.amount THEN RAISE EXCEPTION 'External refund exceeds unallocated receipt funds' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER refund_external_payer_guard BEFORE INSERT OR UPDATE ON refund_requests FOR EACH ROW EXECUTE FUNCTION bhome24_external_refund_guard();

CREATE OR REPLACE FUNCTION bhome24_external_refund_valid(refund_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM refund_requests r JOIN payments p ON p.id=r.source_payment_id
    JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
      WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1) proof ON true
    JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1'
      AND h->'state'->>'id'=r.external_payer_attestation_id::text) payer ON true
    WHERE r.id=refund_id AND r.status='COMPLETED' AND r.beneficiary_kind='EXTERNAL' AND r.beneficiary_resident_id IS NULL AND r.source_deposit_contract_id IS NULL
      AND p.status='VERIFIED' AND payer.state->>'transferId'=p.id::text AND payer.state->>'normalizedBankReference'=upper(btrim(p.transaction_reference))
      AND CASE WHEN payer.state->>'receiptAmount' ~ '^[0-9]+$' THEN (payer.state->>'receiptAmount')::numeric END=p.amount
      AND payer.state->>'transferFingerprint' ~ '^[A-F0-9]{64}$' AND nullif(btrim(payer.state->>'payerLabel'),'') IS NOT NULL
      AND proof.state->>'classification'='ExcessReceiptRefundV1' AND proof.state->>'externalPayerAttestationId'=r.external_payer_attestation_id::text
      AND r.executed_at IS NOT NULL AND proof.state->'upload'->>'objectKey'=r.execution_evidence_key
      AND proof.state->'upload'->>'externalReference'=r.external_refund_reference AND proof.state->'upload'->>'sha256' ~ '^[A-F0-9]{64}$'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(proof.state->'events')='array' THEN proof.state->'events' ELSE '[]'::jsonb END) event WHERE event->>'action'='Completed')
      AND NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id AND a.paid_by_user_id IS NOT NULL)
      AND (EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
        WHERE h->>'recordType'='ReceiptExcessDispositionV1' AND h->'state'->>'id'=proof.state->>'receiptExcessDispositionId'
          AND h->'state'->>'externalPayerAttestationId'=r.external_payer_attestation_id::text AND h->'state'->>'payerResidentId' IS NULL))
      AND p.amount>=(SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a WHERE a.source_payment_id=p.id)
        +(SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_payment_id=p.id AND rr.status='COMPLETED'))
$fn$;
