ALTER TABLE payment_allocations ALTER COLUMN created_by_user_id DROP NOT NULL;
CREATE INDEX ix_sepay_bank_reference ON payments ((upper(btrim(verification_data->'sepay'->>'bankReference'))))
  WHERE provider_code IN ('SEPAY:TEST','SEPAY:LIVE') AND verification_method='AUTO';
CREATE INDEX ix_manual_bank_reference ON payments ((upper(btrim(transaction_reference))))
  WHERE provider_code NOT IN ('SEPAY:TEST','SEPAY:LIVE');
CREATE UNIQUE INDEX ux_sepay_obligation_code ON operational_tasks
  ((task_data->'state'->>'mode'),(task_data->'state'->>'kind'),(task_data->'state'->>'obligationId'))
  WHERE task_data->>'recordType'='PaymentCodeV1';
CREATE UNIQUE INDEX ux_sepay_event_identity ON operational_tasks
  ((task_data->>'mode'),upper(task_data->'transaction'->>'gateway'),(task_data->'transaction'->>'accountNumber'),(task_data->'transaction'->>'id'))
  WHERE task_data->>'recordType'='SePayEventV1';

CREATE FUNCTION bhome24_sepay_technical_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
    ELSIF state->>'kind'='Deposit' THEN SELECT r.location_id INTO target_location FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.id=(state->>'obligationId')::uuid;
    END IF;
    IF NEW.task_type<>'COMMAND' OR NEW.status<>'Issued' OR COALESCE(state->>'code','') !~ '^BH[0-9]{8}$' OR
      COALESCE(state->>'mode','') NOT IN ('Test','Live') OR NEW.source_key IS DISTINCT FROM 'payment-code:'||(state->>'code') OR
      target_location IS NULL OR target_location IS DISTINCT FROM NEW.location_id OR target_location::text IS DISTINCT FROM state->>'locationId' THEN
      RAISE EXCEPTION 'Payment code must bind one scoped obligation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER sepay_technical_guard BEFORE INSERT OR UPDATE OR DELETE ON operational_tasks FOR EACH ROW EXECUTE FUNCTION bhome24_sepay_technical_guard();

CREATE FUNCTION bhome24_sepay_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE event jsonb;
BEGIN
  IF NEW.verification_method<>'AUTO' OR NEW.provider_code NOT IN ('SEPAY:TEST','SEPAY:LIVE') THEN RETURN NEW; END IF;
  SELECT task_data INTO event FROM operational_tasks WHERE id=(NEW.verification_data->'sepay'->>'eventId')::uuid AND task_data->>'recordType'='SePayEventV1';
  IF event IS NULL OR NEW.verified_by_user_id IS NOT NULL OR event->>'mode' IS DISTINCT FROM NEW.verification_data->'sepay'->>'mode' OR
    NEW.verification_data->'sepay'->>'bankReference' IS DISTINCT FROM event->'transaction'->>'referenceCode' OR
    NEW.provider_code IS DISTINCT FROM 'SEPAY:'||upper(event->>'mode') OR event->'transaction'->>'transferType'<>'in' OR
    NEW.amount IS DISTINCT FROM (event->'transaction'->>'transferAmount')::numeric OR
    NEW.receiving_account_key IS DISTINCT FROM (event->>'mode')||':'||upper(event->'transaction'->>'gateway')||':'||(event->'transaction'->>'accountNumber') THEN
    RAISE EXCEPTION 'Automatic receipt requires durable matching provider evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER sepay_receipt_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bhome24_sepay_receipt_guard();

CREATE FUNCTION bhome24_allocation_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.created_by_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.id=NEW.source_payment_id
    AND p.status='VERIFIED' AND p.verification_method='AUTO' AND p.provider_code IN ('SEPAY:TEST','SEPAY:LIVE') AND p.verification_data ? 'sepay') THEN
    RAISE EXCEPTION 'Allocation requires a human actor or verified provider source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_actor_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_allocation_actor_guard();

CREATE FUNCTION bhome24_sepay_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE receipt payments%ROWTYPE; reference text;
BEGIN
  IF NEW.source_payment_id IS NULL OR NEW.amount<=0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT * INTO receipt FROM payments WHERE id=NEW.source_payment_id;
  IF receipt.provider_code IN ('SEPAY:TEST','SEPAY:LIVE') AND receipt.verification_method='AUTO' THEN
    reference:=upper(btrim(receipt.verification_data->'sepay'->>'bankReference'));
    IF reference IS NULL OR EXISTS(SELECT 1 FROM payments p WHERE p.provider_code NOT IN ('SEPAY:TEST','SEPAY:LIVE')
      AND upper(btrim(p.transaction_reference))=reference) THEN
      RAISE EXCEPTION 'Unscoped bank reference requires manual review' USING ERRCODE='23514';
    END IF;
  ELSE
    reference:=upper(btrim(receipt.transaction_reference));
    IF EXISTS(SELECT 1 FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
      WHERE p.provider_code IN ('SEPAY:TEST','SEPAY:LIVE') AND p.verification_method='AUTO'
        AND upper(btrim(p.verification_data->'sepay'->>'bankReference'))=reference) THEN
      RAISE EXCEPTION 'Bank transaction already allocated through provider verification' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_sepay_reference_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_sepay_reference_guard();
