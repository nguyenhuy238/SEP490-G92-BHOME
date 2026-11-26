-- Receiving channels share the normal financial ledger. Preserve all money and evidence.
DROP TRIGGER IF EXISTS a_sepay_deposit_mode_guard ON payment_allocations;
DROP FUNCTION IF EXISTS bhome24_sepay_deposit_mode_guard();
CREATE OR REPLACE FUNCTION bhome24_sepay_technical_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE state jsonb; target_location uuid;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.task_data->>'recordType' IN ('PaymentCodeV1','PaymentObligationV1') THEN
    RAISE EXCEPTION 'Issued payment codes are immutable and cannot be reused' USING ERRCODE='23514';
  END IF;
  IF TG_OP<>'INSERT' AND OLD.task_data->>'recordType'='SePayEventV1' THEN
    IF TG_OP='DELETE' OR NEW.task_type<>'COMMAND' OR NEW.task_data->>'recordType' IS DISTINCT FROM 'SePayEventV1' OR ROW(OLD.id,OLD.source_key,OLD.task_data->'transaction',OLD.task_data->>'mode',OLD.task_data->>'ownerId') IS DISTINCT FROM
      ROW(NEW.id,NEW.source_key,NEW.task_data->'transaction',NEW.task_data->>'mode',NEW.task_data->>'ownerId') THEN
      RAISE EXCEPTION 'Provider event identity and evidence are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.task_data->>'recordType'='PaymentObligationV1' THEN
    state:=NEW.task_data->'state';
    SELECT location_id INTO target_location FROM invoices WHERE id=(state->>'obligationId')::uuid;
    IF NEW.task_type<>'COMMAND' OR NEW.status<>'Frozen' OR state->>'kind'<>'Invoice' OR
      COALESCE(state->>'mode','') NOT IN ('Test','Live') OR target_location IS NULL OR
      target_location IS DISTINCT FROM NEW.location_id OR target_location::text IS DISTINCT FROM state->>'locationId' OR
      NEW.source_key IS DISTINCT FROM 'payment-obligation:Invoice:'||(state->>'obligationId') THEN
      RAISE EXCEPTION 'Legacy payment obligation must remain scoped' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.task_data->>'recordType'='PaymentCodeV1' THEN
    state:=NEW.task_data->'state';
    PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
    IF state->>'instanceCode' IS NOT NULL AND (
      state->>'instanceCode' !~ '^[A-Z0-9]{4}$' OR
      left(state->>'code',7) IS DISTINCT FROM 'BH'||(state->>'instanceCode')||CASE state->>'mode' WHEN 'Test' THEN 'T' ELSE 'L' END OR
      state->'accountSnapshot' IS NULL OR state->'accountSnapshot'='null'::jsonb OR
      COALESCE((state->'accountSnapshot'->>'isDevelopmentDemo')::bool,false) IS DISTINCT FROM (state->>'mode'='Test') OR
      NOT COALESCE((state->'accountSnapshot'->>'enabled')::bool,false)) THEN
      RAISE EXCEPTION 'Mode and receiving snapshot must match issued code' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM operational_tasks t WHERE t.task_data->>'recordType'='PaymentObligationV1'
      AND t.task_data->'state'->>'kind'=state->>'kind'
      AND t.task_data->'state'->>'obligationId'=state->>'obligationId'
      AND t.task_data->'state'->>'mode' IS DISTINCT FROM state->>'mode') THEN
      RAISE EXCEPTION 'Issued payment obligation mode cannot change' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM operational_tasks t WHERE t.task_data->>'recordType'='PaymentCodeV1'
      AND t.task_data->'state'->>'kind'=state->>'kind'
      AND t.task_data->'state'->>'obligationId'=state->>'obligationId') THEN
      RAISE EXCEPTION 'Obligation already has an immutable payment mode' USING ERRCODE='23514';
    END IF;
    IF state->>'kind'='Invoice' THEN
      SELECT location_id INTO target_location FROM invoices WHERE id=(state->>'obligationId')::uuid;
    ELSIF state->>'kind' IN ('Deposit','MainInitial') THEN
      SELECT r.location_id INTO target_location FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE c.id=(state->>'obligationId')::uuid;
    ELSIF state->>'kind'='Settlement' THEN
      SELECT r.location_id INTO target_location
      FROM contracts c JOIN rooms r ON r.id=c.room_id
      WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) charge
        WHERE charge->>'recordType'='SettlementReceivableV1'
          AND charge->'state'->>'id'=state->>'obligationId'
          AND charge->'state'->>'contractId'=c.id::text);
    END IF;
    IF NEW.task_type<>'COMMAND' OR NEW.status<>'Issued' OR COALESCE(state->>'code','') !~ '^BH([0-9]{8}|[A-Z0-9]{4}[TL][A-F0-9]{16})$' OR
      COALESCE(state->>'mode','') NOT IN ('Test','Live') OR NEW.source_key IS DISTINCT FROM 'payment-code:'||(state->>'code') OR
      target_location IS NULL OR target_location IS DISTINCT FROM NEW.location_id OR target_location::text IS DISTINCT FROM state->>'locationId' THEN
      RAISE EXCEPTION 'Payment code must bind one scoped obligation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION bhome24_contract_payment_mode(target uuid) RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(h.value->'state'->>'paymentMode',
    CASE WHEN COALESCE((h.value->'state'->>'isDevelopmentDemo')::bool,false) THEN 'Test' ELSE 'Live' END)
  FROM contracts c LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(c.history) WITH ORDINALITY x(value,n)
    WHERE value->>'recordType'='Contract' ORDER BY n DESC LIMIT 1) h ON true WHERE c.id=target
$fn$;

-- Signing fixtures remain distinct from payment channels. A genuinely signed Test
-- contract follows exactly the same accounting rules as a genuinely signed Live contract.
CREATE OR REPLACE FUNCTION bhome24_contract_is_simulation(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE((h.value->'state'->>'isDevelopmentDemo')::bool,false)
  FROM contracts c LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(c.history) WITH ORDINALITY x(value,n)
    WHERE value->>'recordType'='Contract' ORDER BY n DESC LIMIT 1) h ON true WHERE c.id=target
$fn$;
