-- Preserve exact Owner approval, room, budget, immutable history and balance checks.
CREATE OR REPLACE FUNCTION bhome24_settlement_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE charge jsonb; approval jsonb; approval_contract uuid; source_room uuid; target_room uuid;
  budget numeric; outstanding numeric; allocated numeric; invoice_contract uuid; invoice_state smallint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  IF NEW.target_settlement_contract_id IS NOT NULL THEN
    SELECT h->'state',c.room_id INTO charge,target_room FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
      WHERE c.id=NEW.target_settlement_contract_id AND h->>'recordType'='SettlementReceivableV1' AND h->>'recordKey'=NEW.settlement_receivable_id::text;
    IF charge IS NULL OR (charge->>'contractId')::uuid<>NEW.target_settlement_contract_id OR (charge->>'roomId')::uuid<>target_room
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=(charge->>'approvedByUserId')::uuid AND 'Owner'=ANY(roles)) THEN
      RAISE EXCEPTION 'Approved settlement source required' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(sum(amount),0) INTO allocated FROM payment_allocations WHERE target_settlement_contract_id=NEW.target_settlement_contract_id AND settlement_receivable_id=NEW.settlement_receivable_id;
    outstanding:=(charge->>'amount')::numeric-allocated;
    IF allocated+NEW.amount<0 OR NEW.amount>outstanding THEN RAISE EXCEPTION 'Settlement allocation exceeds obligation' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.deposit_offset_approval_id IS NOT NULL THEN
    SELECT h->'state',c.id,c.room_id INTO approval,approval_contract,target_room FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
      WHERE h->>'recordType'='DepositOffsetApprovalV1' AND h->>'recordKey'=NEW.deposit_offset_approval_id::text;
    IF approval IS NULL OR NEW.source_payment_id IS NOT NULL OR NEW.source_deposit_contract_id IS NULL OR NEW.target_deposit_contract_id IS NOT NULL OR NEW.amount<=0
      OR (approval->>'allocationId')::uuid IS DISTINCT FROM NEW.id OR (approval->>'sourceDepositContractId')::uuid IS DISTINCT FROM NEW.source_deposit_contract_id
      OR (approval->>'receivableId')::uuid IS DISTINCT FROM NEW.settlement_receivable_id OR (approval->>'invoiceId')::uuid IS DISTINCT FROM NEW.target_invoice_id
      OR (approval->>'amount')::numeric IS DISTINCT FROM NEW.amount OR (approval->>'approvedByUserId')::uuid IS DISTINCT FROM NEW.created_by_user_id
      OR (NEW.target_settlement_contract_id IS NOT NULL AND NEW.target_settlement_contract_id<>approval_contract)
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by_user_id AND is_active AND 'Owner'=ANY(roles)) THEN
      RAISE EXCEPTION 'Exact Owner deposit approval required' USING ERRCODE='23514';
    END IF;
    SELECT room_id INTO source_room FROM contracts WHERE id=NEW.source_deposit_contract_id AND contract_type='MAIN';
    IF source_room IS DISTINCT FROM target_room THEN RAISE EXCEPTION 'Deposit must belong to the same Room' USING ERRCODE='23514'; END IF;
    SELECT COALESCE((SELECT sum(amount) FROM payment_allocations WHERE target_deposit_contract_id=NEW.source_deposit_contract_id),0)
      -COALESCE((SELECT sum(amount) FROM payment_allocations WHERE source_deposit_contract_id=NEW.source_deposit_contract_id),0)
      -COALESCE((SELECT sum(requested_amount) FROM refund_requests WHERE source_deposit_contract_id=NEW.source_deposit_contract_id AND status IN ('REQUESTED','APPROVED','COMPLETED')),0) INTO budget;
    IF NEW.amount>budget THEN RAISE EXCEPTION 'Deposit is spent or reserved' USING ERRCODE='23514'; END IF;
    IF NEW.target_invoice_id IS NOT NULL THEN
      SELECT room_id,contract_id,status,base_total_amount INTO source_room,invoice_contract,invoice_state,outstanding FROM invoices WHERE id=NEW.target_invoice_id;
      IF source_room IS DISTINCT FROM target_room OR invoice_state IS DISTINCT FROM 1 OR NOT EXISTS(
        WITH RECURSIVE versions AS (SELECT id,previous_contract_id,start_date FROM contracts WHERE id=approval_contract
          UNION ALL SELECT c.id,c.previous_contract_id,c.start_date FROM contracts c JOIN versions v ON c.id=v.previous_contract_id)
        SELECT 1 FROM invoices i JOIN contracts c ON c.id=approval_contract
        WHERE i.id=NEW.target_invoice_id AND (EXISTS(SELECT 1 FROM versions WHERE id=invoice_contract)
          OR i.invoice_type='PERIODIC' AND c.tenant_user_id=ANY(i.recipient_user_ids)
            AND i.billing_period>=date_trunc('month',(SELECT min(start_date) FROM versions))::date
            AND i.billing_period<=date_trunc('month',COALESCE(
              (SELECT ((h->'state'->>'observedSnapshot')::jsonb->>'date')::date
                FROM jsonb_array_elements(COALESCE(c.move_out->'inspections','[]'::jsonb)) h
                ORDER BY (h->'state'->>'version')::int DESC LIMIT 1),c.actual_end_date,c.end_date))::date)) THEN RAISE EXCEPTION 'Invoice outside deposit tenancy' USING ERRCODE='23514'; END IF;
      outstanding:=outstanding+COALESCE((SELECT sum(approved_delta_amount) FROM invoice_adjustments WHERE invoice_id=NEW.target_invoice_id AND status IN ('APPROVED','APPLIED') AND decision_snapshot->>'invoiceStatus'='1'),0)
        -COALESCE((SELECT sum(amount) FROM payment_allocations WHERE target_invoice_id=NEW.target_invoice_id),0);
      IF NEW.amount>outstanding THEN RAISE EXCEPTION 'Offset exceeds invoice balance' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF NEW.source_deposit_contract_id IS NOT NULL AND NEW.target_deposit_contract_id IS NULL THEN
    RAISE EXCEPTION 'Deposit offset approval required' USING ERRCODE='23514';
  END IF;
  IF NEW.reversal_of_allocation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_allocations original
    WHERE original.id=NEW.reversal_of_allocation_id AND original.target_settlement_contract_id IS NOT DISTINCT FROM NEW.target_settlement_contract_id
      AND original.settlement_receivable_id IS NOT DISTINCT FROM NEW.settlement_receivable_id) THEN
    RAISE EXCEPTION 'Reversal must preserve settlement target' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
