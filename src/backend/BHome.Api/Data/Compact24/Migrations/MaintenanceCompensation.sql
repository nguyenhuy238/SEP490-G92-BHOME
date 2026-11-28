-- Compensation decisions remain in the Work Order's append-only history.
-- The latest version is a projection. Original decisions and invoice/payment rows stay intact.
CREATE OR REPLACE FUNCTION bhome24_compensation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE row_data jsonb; prior_data jsonb; decision_count integer;
BEGIN
    IF NEW.task_type<>'WORK_ORDER' THEN RETURN NEW; END IF;
    SELECT count(*) INTO decision_count FROM (
        SELECT DISTINCT h->>'recordKey' FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='MaintenanceCompensation'
    ) q;
    IF decision_count=0 THEN RETURN NEW; END IF;
    IF decision_count<>1 THEN RAISE EXCEPTION 'One exclusive compensation decision per Work Order' USING ERRCODE='23514'; END IF;
    SELECT h->'state' INTO row_data FROM jsonb_array_elements(NEW.history) WITH ORDINALITY a(h,n)
        WHERE h->>'recordType'='MaintenanceCompensation' ORDER BY n DESC LIMIT 1;
    IF TG_OP='UPDATE' THEN
        SELECT h->'state' INTO prior_data FROM jsonb_array_elements(OLD.history) WITH ORDINALITY a(h,n)
            WHERE h->>'recordType'='MaintenanceCompensation' ORDER BY n DESC LIMIT 1;
        IF row_data IS NOT DISTINCT FROM prior_data THEN RETURN NEW; END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
    IF NEW.status<>'Verified' OR NEW.room_id IS NULL OR
        (row_data->>'workOrderId')::uuid IS DISTINCT FROM NEW.id OR
        (row_data->>'roomId')::uuid IS DISTINCT FROM NEW.room_id OR
        (row_data->>'locationId')::uuid IS DISTINCT FROM NEW.location_id OR
        (row_data->>'amount')::numeric<=0 OR
        (row_data->>'amount')::numeric>(NEW.task_data->'state'->>'actualCost')::numeric OR
        NOT EXISTS(SELECT 1 FROM contracts WHERE id=(row_data->>'contractId')::uuid AND room_id=NEW.room_id AND activated_at IS NOT NULL) OR
        row_data->>'collectionMethod' NOT IN ('Invoice','Deposit') THEN
        RAISE EXCEPTION 'Invalid compensation scope or amount' USING ERRCODE='23514';
    END IF;
    IF row_data->>'collectionMethod'='Invoice' THEN
        IF row_data->>'status'<>'InvoiceIssued' OR row_data->>'deductedAt' IS NOT NULL OR NOT EXISTS(
            SELECT 1 FROM invoices WHERE id=(row_data->>'invoiceId')::uuid AND invoice_type='AD_HOC' AND status=1
              AND contract_id=(row_data->>'contractId')::uuid AND room_id=NEW.room_id
              AND base_total_amount=(row_data->>'amount')::numeric) THEN
            RAISE EXCEPTION 'Compensation invoice must be exclusive' USING ERRCODE='23514';
        END IF;
    ELSIF row_data->>'invoiceId' IS NOT NULL OR row_data->>'status' NOT IN ('DepositPending','Deducted','Cancelled') OR
        ((row_data->>'status'='Deducted') IS DISTINCT FROM (row_data->>'deductedAt' IS NOT NULL)) THEN
        RAISE EXCEPTION 'Compensation deposit must be exclusive' USING ERRCODE='23514';
    END IF;
    IF prior_data IS NOT NULL AND (
        prior_data->>'status'<>'DepositPending' OR
        (prior_data-'status'-'reason'-'decidedById'-'decidedAt'-'deductedAt'-'version'-'updatedAt'-'createdAt') IS DISTINCT FROM
        (row_data-'status'-'reason'-'decidedById'-'decidedAt'-'deductedAt'-'version'-'updatedAt'-'createdAt') OR
        (row_data->>'version')::int<>(prior_data->>'version')::int+1) THEN
        RAISE EXCEPTION 'Completed compensation cannot be overwritten' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER maintenance_compensation_consistent BEFORE INSERT OR UPDATE ON operational_tasks
FOR EACH ROW EXECUTE FUNCTION bhome24_compensation_guard();

CREATE OR REPLACE FUNCTION bhome24_maintenance_deposit_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE reserved numeric; budget numeric; requested numeric; source uuid; excluded_refund uuid; excluded_allocation uuid;
BEGIN
    source:=NEW.source_deposit_contract_id;
    IF source IS NULL THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='refund_requests' THEN
        IF NEW.status NOT IN ('REQUESTED','APPROVED','COMPLETED') THEN RETURN NEW; END IF;
        requested:=NEW.requested_amount; excluded_refund:=NEW.id;
    ELSE
        IF NEW.amount<=0 THEN RETURN NEW; END IF;
        requested:=NEW.amount; excluded_allocation:=NEW.id;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
    SELECT COALESCE(sum((q.state->>'amount')::numeric),0) INTO reserved FROM operational_tasks task
    CROSS JOIN LATERAL (
        SELECT h->'state' AS state FROM jsonb_array_elements(task.history) WITH ORDINALITY e(h,n)
        WHERE h->>'recordType'='MaintenanceCompensation' ORDER BY n DESC LIMIT 1
    ) q WHERE task.task_type='WORK_ORDER' AND (q.state->>'depositContractId')::uuid=source
        AND q.state->>'status' IN ('DepositPending','Deducted');
    IF reserved=0 THEN RETURN NEW; END IF;
    SELECT COALESCE((SELECT sum(amount) FROM payment_allocations WHERE target_deposit_contract_id=source),0)
        -COALESCE((SELECT sum(amount) FROM payment_allocations WHERE source_deposit_contract_id=source AND id IS DISTINCT FROM excluded_allocation),0)
        -COALESCE((SELECT sum(requested_amount) FROM refund_requests WHERE source_deposit_contract_id=source
            AND status IN ('REQUESTED','APPROVED','COMPLETED') AND id IS DISTINCT FROM excluded_refund),0)-reserved INTO budget;
    IF requested>budget THEN RAISE EXCEPTION 'Deposit reserved for maintenance compensation' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER maintenance_deposit_allocation_guard BEFORE INSERT ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION bhome24_maintenance_deposit_guard();
CREATE TRIGGER maintenance_deposit_refund_guard BEFORE INSERT OR UPDATE ON refund_requests
FOR EACH ROW EXECUTE FUNCTION bhome24_maintenance_deposit_guard();
