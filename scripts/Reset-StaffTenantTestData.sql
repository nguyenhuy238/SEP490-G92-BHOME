-- Local Compact24 development database only.
-- Run through Reset-StaffTenantTestData.ps1 after a verified pg_dump backup.
-- This intentionally removes demo Staff/Tenant history (including local audit rows).
-- Never use against staging, production, or data with real financial activity.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '90s';

-- Schema locks prevent the running API from writing partial test data during reset.
LOCK TABLE users, locations, rooms, assets, billing_policies, operational_tasks,
    notifications, refresh_tokens, staff_employments, residents, contracts,
    contract_residents, contract_signings, incident_reports, meter_readings,
    invoices, invoice_items, invoice_adjustments, payments, payment_allocations,
    refund_requests, expenses, financial_scenarios IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
    IF current_database() <> 'bhome' OR current_user <> 'bhome_local' THEN
        RAISE EXCEPTION 'Reset is restricted to the local bhome/bhome_local fixture';
    END IF;
    IF (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') <> 24 THEN
        RAISE EXCEPTION 'Unexpected database schema; reset cancelled';
    END IF;
    IF (SELECT COUNT(*) FROM users WHERE 'Owner'=ANY(roles)) <> 1 OR
       EXISTS(SELECT 1 FROM users WHERE 'Owner'=ANY(roles) AND ('Staff'=ANY(roles) OR 'Tenant'=ANY(roles))) OR
       EXISTS(SELECT 1 FROM users WHERE NOT (roles && ARRAY['Owner','Staff','Tenant']::text[])) THEN
        RAISE EXCEPTION 'Unexpected role mix or Owner count; reset cancelled';
    END IF;
    -- Financial ledgers / invoices are append-only. Do not silently erase money.
    IF EXISTS(SELECT 1 FROM invoices) OR EXISTS(SELECT 1 FROM invoice_items) OR
       EXISTS(SELECT 1 FROM invoice_adjustments) OR EXISTS(SELECT 1 FROM payments) OR
       EXISTS(SELECT 1 FROM payment_allocations) OR EXISTS(SELECT 1 FROM refund_requests) OR
       EXISTS(SELECT 1 FROM expenses) OR EXISTS(SELECT 1 FROM financial_scenarios) THEN
        RAISE EXCEPTION 'Financial rows exist; a separately reviewed reset is required';
    END IF;
    IF EXISTS(SELECT 1 FROM locations WHERE published_by_user_id IN
                (SELECT id FROM users WHERE roles && ARRAY['Staff','Tenant']::text[])) OR
       EXISTS(SELECT 1 FROM rooms WHERE published_by_user_id IN
                (SELECT id FROM users WHERE roles && ARRAY['Staff','Tenant']::text[])) OR
       EXISTS(SELECT 1 FROM residents WHERE identity_owner_scope_id IN
                (SELECT id FROM users WHERE roles && ARRAY['Staff','Tenant']::text[])) OR
       EXISTS(SELECT 1 FROM operational_tasks WHERE
              ((task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
               (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%'))
              AND (contract_id IS NOT NULL OR incident_report_id IS NOT NULL OR
                   assigned_user_id IN (SELECT id FROM users WHERE roles && ARRAY['Staff','Tenant']::text[]))) THEN
        RAISE EXCEPTION 'Protected setup references Staff/Tenant; reset cancelled';
    END IF;
END;
$guard$;

-- Capture fingerprints of the data that must be exactly retained.
CREATE TEMP TABLE _bhome_reset_preserved AS
SELECT
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM assets a) AS assets_hash,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text,'[]')) FROM billing_policies b) AS billing_hash,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(r)-'status'-'version' ORDER BY r.id)::text,'[]')) FROM rooms r) AS room_config_hash,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(l)-'staff_assignments'-'history'-'version' ORDER BY l.id)::text,'[]')) FROM locations l) AS location_config_hash,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) FROM operational_tasks t
      WHERE (task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
            (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%')) AS owner_setup_hash,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id)::text,'[]')) FROM users u WHERE 'Owner'=ANY(roles)) AS owner_hash;

-- Explicitly and temporarily suspend only the row-level immutability triggers on
-- tables being purged. PostgreSQL foreign keys remain enabled and enforced.
ALTER TABLE notifications DISABLE TRIGGER notification_event_guard;
ALTER TABLE notifications DISABLE TRIGGER delivery_history_append_only;
ALTER TABLE operational_tasks DISABLE TRIGGER history_append_only;
ALTER TABLE operational_tasks DISABLE TRIGGER main_initial_order_immutable;
ALTER TABLE operational_tasks DISABLE TRIGGER sepay_technical_guard;
ALTER TABLE contract_signings DISABLE TRIGGER history_append_only;
ALTER TABLE contract_residents DISABLE TRIGGER history_append_only;
ALTER TABLE contracts DISABLE TRIGGER history_append_only;
ALTER TABLE incident_reports DISABLE TRIGGER incident_history_append_only;
ALTER TABLE meter_readings DISABLE TRIGGER history_append_only;
ALTER TABLE residents DISABLE TRIGGER history_append_only;
ALTER TABLE staff_employments DISABLE TRIGGER history_append_only;
ALTER TABLE users DISABLE TRIGGER history_append_only;
ALTER TABLE locations DISABLE TRIGGER history_append_only;

-- Clean test workflow artifacts; preserve all Owner setup, asset metadata,
-- catalog, and Owner-verified room/common-area inventory in SYSTEM_JOB Setup*.
DELETE FROM notifications;
DELETE FROM meter_readings;
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE roles && ARRAY['Staff','Tenant']::text[]);
DELETE FROM contract_signings;
DELETE FROM contract_residents;
DELETE FROM operational_tasks
 WHERE ((task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
        (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%')) IS NOT TRUE;
DELETE FROM incident_reports;
DELETE FROM contracts;
DELETE FROM residents;
DELETE FROM staff_employments;

-- Staff assignments are stored as JSON on the Location; remove their former
-- Staff assignment events but not Location/Room/asset setup snapshots.
UPDATE locations l
SET staff_assignments='[]'::jsonb,
    history=coalesce((
      SELECT jsonb_agg(e.value ORDER BY e.ordinality)
      FROM jsonb_array_elements(l.history) WITH ORDINALITY e(value, ordinality)
      WHERE coalesce(e.value->>'action','') NOT LIKE 'Staff%'
        AND coalesce(e.value->>'recordType','') <> 'StaffLocationAssignment'
        AND coalesce(e.value->'state'->>'staffUserId','')=''
    ),'[]'::jsonb),
    version=version+1
WHERE staff_assignments <> '[]'::jsonb OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(l.history) e
             WHERE coalesce(e->>'action','') LIKE 'Staff%' OR
                   e->>'recordType'='StaffLocationAssignment' OR
                   coalesce(e->'state'->>'staffUserId','')<>'');

-- A previously held/occupied room must be selectable for a new Tenant test.
-- Other room settings, history, and Owner-confirmed inventory remain intact.
UPDATE rooms SET status=0, version=version+1 WHERE status IN (1,2);
DELETE FROM users WHERE roles && ARRAY['Staff','Tenant']::text[];

DO $verify$
DECLARE p record;
BEGIN
    SELECT * INTO p FROM _bhome_reset_preserved;
    IF p.assets_hash IS DISTINCT FROM
         (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM assets a) OR
       p.billing_hash IS DISTINCT FROM
         (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text,'[]')) FROM billing_policies b) OR
       p.room_config_hash IS DISTINCT FROM
         (SELECT md5(coalesce(jsonb_agg(to_jsonb(r)-'status'-'version' ORDER BY r.id)::text,'[]')) FROM rooms r) OR
       p.location_config_hash IS DISTINCT FROM
         (SELECT md5(coalesce(jsonb_agg(to_jsonb(l)-'staff_assignments'-'history'-'version' ORDER BY l.id)::text,'[]')) FROM locations l) OR
       p.owner_setup_hash IS DISTINCT FROM
         (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) FROM operational_tasks t
           WHERE (task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
                 (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%')) OR
       p.owner_hash IS DISTINCT FROM
         (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id)::text,'[]')) FROM users u WHERE 'Owner'=ANY(roles)) THEN
        RAISE EXCEPTION 'Protected Owner/Location/Room/asset configuration was changed: rollback';
    END IF;
    IF (SELECT count(*) FROM users) <> 1 OR (SELECT count(*) FROM residents) <> 0 OR
       (SELECT count(*) FROM staff_employments) <> 0 OR (SELECT count(*) FROM contracts) <> 0 OR
       (SELECT count(*) FROM operational_tasks WHERE
           ((task_type='SYSTEM_JOB' AND task_data->>'recordType' LIKE 'Setup%') OR
            (task_type='COMMAND' AND task_data->>'recordType' LIKE 'SharedConfiguration%')) IS NOT TRUE) <> 0 OR
       (SELECT count(*) FROM notifications) <> 0 OR
       (SELECT count(*) FROM locations WHERE staff_assignments<>'[]'::jsonb) <> 0 OR
       (SELECT count(*) FROM rooms WHERE status IN (1,2)) <> 0 THEN
        RAISE EXCEPTION 'Post-reset verification failed: rollback';
    END IF;
    RAISE NOTICE 'Reset verified; Owner/location/room/assets/billing/Owner-confirmed inventory preserved';
END;
$verify$;

-- Restore all guards before the transaction is committed.
ALTER TABLE notifications ENABLE TRIGGER notification_event_guard;
ALTER TABLE notifications ENABLE TRIGGER delivery_history_append_only;
ALTER TABLE operational_tasks ENABLE TRIGGER history_append_only;
ALTER TABLE operational_tasks ENABLE TRIGGER main_initial_order_immutable;
ALTER TABLE operational_tasks ENABLE TRIGGER sepay_technical_guard;
ALTER TABLE contract_signings ENABLE TRIGGER history_append_only;
ALTER TABLE contract_residents ENABLE TRIGGER history_append_only;
ALTER TABLE contracts ENABLE TRIGGER history_append_only;
ALTER TABLE incident_reports ENABLE TRIGGER incident_history_append_only;
ALTER TABLE meter_readings ENABLE TRIGGER history_append_only;
ALTER TABLE residents ENABLE TRIGGER history_append_only;
ALTER TABLE staff_employments ENABLE TRIGGER history_append_only;
ALTER TABLE users ENABLE TRIGGER history_append_only;
ALTER TABLE locations ENABLE TRIGGER history_append_only;
COMMIT;
