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
    WHERE h->>'recordType'='BankReferenceClaim' AND h->'state'->>'normalizedReference'=receipt_ref) THEN
    RAISE EXCEPTION 'A refundable receipt or reserved refund cannot fund another allocation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS allocation_receipt_disposition_guard ON payment_allocations;
CREATE TRIGGER allocation_receipt_disposition_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_receipt_disposition_guard();
