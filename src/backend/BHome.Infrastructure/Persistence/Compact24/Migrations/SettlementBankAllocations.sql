CREATE OR REPLACE FUNCTION bhome24_settlement_bank_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE charge jsonb; receipt_amount numeric; receipt_ref text; outstanding numeric;
BEGIN
  IF NEW.target_settlement_contract_id IS NULL OR NEW.source_payment_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT h->'state' INTO charge FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
    WHERE c.id=NEW.target_settlement_contract_id AND h->>'recordType'='SettlementReceivableV1' AND h->>'recordKey'=NEW.settlement_receivable_id::text;
  SELECT amount,upper(btrim(transaction_reference)) INTO receipt_amount,receipt_ref FROM payments WHERE id=NEW.source_payment_id AND status='VERIFIED';
  outstanding:=(charge->>'amount')::numeric-COALESCE((SELECT sum(amount) FROM payment_allocations
    WHERE target_settlement_contract_id=NEW.target_settlement_contract_id AND settlement_receivable_id=NEW.settlement_receivable_id),0);
  IF charge IS NULL OR receipt_amount IS NULL OR NEW.amount<=0 OR NEW.amount<>LEAST(receipt_amount,outstanding)
    OR EXISTS(SELECT 1 FROM payment_allocations WHERE source_payment_id=NEW.source_payment_id)
    OR (NEW.paid_by_user_id IS NOT NULL AND NOT (charge->'recipientUserIds' @> jsonb_build_array(NEW.paid_by_user_id::text)))
    OR EXISTS(SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
      WHERE h->>'recordType'='BankReferenceClaim' AND h->'state'->>'normalizedReference'=receipt_ref) THEN
    RAISE EXCEPTION 'Bank receipt must be verified, unclaimed and allocated once to its remaining settlement obligation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS allocation_settlement_bank_guard ON payment_allocations;
CREATE TRIGGER allocation_settlement_bank_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_settlement_bank_guard();
