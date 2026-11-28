-- Extend immutable, location-bound SePay payment-code support to a real
-- verified move-out receivable. The existing bank-allocation guards remain
-- authoritative for a single source payment and its net remaining balance.
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
    IF NEW.task_type<>'COMMAND' OR NEW.status<>'Issued' OR COALESCE(state->>'code','') !~ '^BH[0-9]{8}$' OR
      COALESCE(state->>'mode','') NOT IN ('Test','Live') OR NEW.source_key IS DISTINCT FROM 'payment-code:'||(state->>'code') OR
      target_location IS NULL OR target_location IS DISTINCT FROM NEW.location_id OR target_location::text IS DISTINCT FROM state->>'locationId' THEN
      RAISE EXCEPTION 'Payment code must bind one scoped obligation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
