-- Explicit Compact24 v1 -> Location/Room schema upgrade. No new table or column.
-- Apply only through the Development CLI; all preconditions and DDL roll back together.
SET LOCAL lock_timeout='5s';
LOCK TABLE locations,rooms,billing_policies,operational_tasks,incident_reports IN ACCESS EXCLUSIVE MODE;
DO $guard$
DECLARE expected_columns integer := current_setting('bhome.property_upgrade_column_count',true)::integer;
BEGIN
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')<>24 OR
       expected_columns IS NULL OR
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public') NOT IN (expected_columns,expected_columns+3) OR
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND
        ((table_name='locations' AND column_name='room_types') OR (table_name IN ('rooms','billing_policies') AND column_name='room_type_id'))) NOT IN (0,3) THEN
        RAISE EXCEPTION 'Expected previous Compact24 schema' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='locations' AND column_name='room_types') THEN
    IF EXISTS(SELECT 1 FROM locations WHERE room_types<>'[]'::jsonb) OR
       EXISTS(SELECT 1 FROM rooms WHERE room_type_id IS NOT NULL) OR
       EXISTS(SELECT 1 FROM billing_policies WHERE room_type_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Retired catalog data requires explicit migration; nothing removed' USING ERRCODE='23514';
    END IF;
    END IF;
END $guard$;
DROP TRIGGER IF EXISTS location_catalog_consistent ON locations;
DROP TRIGGER IF EXISTS room_catalog_reference ON rooms;
DROP TRIGGER IF EXISTS policy_catalog_reference ON billing_policies;
DROP FUNCTION IF EXISTS bhome24_location_catalog_guard();
DROP FUNCTION IF EXISTS bhome24_property_catalog_reference_guard();
DROP TRIGGER IF EXISTS policy_history_immutable ON billing_policies;
DROP FUNCTION IF EXISTS bhome24_policy_history_guard();
ALTER TABLE billing_policies DROP CONSTRAINT IF EXISTS ex_policy_scope_charge_period;
ALTER TABLE locations DROP COLUMN IF EXISTS room_types;
ALTER TABLE rooms DROP COLUMN IF EXISTS room_type_id;
ALTER TABLE billing_policies DROP COLUMN IF EXISTS room_type_id;
DROP TRIGGER IF EXISTS work_order_consistent ON operational_tasks;
DROP FUNCTION IF EXISTS bhome24_work_order_guard();
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE FUNCTION bhome24_work_order_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE s jsonb := NEW.task_data->'state'; report_location uuid;
BEGIN
    IF NEW.task_type<>'WORK_ORDER' THEN RETURN NEW; END IF;
    SELECT location_id INTO report_location FROM incident_reports WHERE id=NEW.incident_report_id;
    IF report_location IS DISTINCT FROM NEW.location_id OR NEW.assigned_user_id IS NULL OR
       NEW.status NOT IN ('Assigned','PendingApproval','InProgress','PendingVerification','Verified','Cancelled') OR
       s IS NULL OR (s->>'incidentId')::uuid IS DISTINCT FROM NEW.incident_report_id OR
       (s->>'assignedStaffId')::uuid IS DISTINCT FROM NEW.assigned_user_id THEN
        RAISE EXCEPTION 'Invalid Work Order scope or state' USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('InProgress','PendingVerification','Verified') AND
       (NEW.cost_approved_at IS NULL OR NEW.cost_approved_by_user_id IS NULL OR
        s->>'approvedProposalVersion' IS NULL OR s->>'approvedProposalVersion' IS DISTINCT FROM s->>'proposalVersion') THEN
        RAISE EXCEPTION 'Work Order requires approved current plan' USING ERRCODE='23514';
    END IF;
    IF NEW.status='Verified' AND (NEW.verified_at IS NULL OR NEW.verified_by_user_id IS NULL OR
       s->>'actualCost' IS NULL OR s->>'completionActivityId' IS NULL) THEN
        RAISE EXCEPTION 'Work Order requires completion and verification' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $fn$;
CREATE FUNCTION bhome24_policy_history_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE business_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Policy history cannot be deleted' USING ERRCODE='23514'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.location_id IS DISTINCT FROM OLD.location_id OR
       NEW.room_id IS DISTINCT FROM OLD.room_id OR
       NEW.charge_code IS DISTINCT FROM OLD.charge_code OR NEW.category IS DISTINCT FROM OLD.category OR
       NEW.calculation_method IS DISTINCT FROM OLD.calculation_method THEN
        RAISE EXCEPTION 'Policy scope and charging method are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.first_used_at IS NOT NULL AND NEW.first_used_at IS DISTINCT FROM OLD.first_used_at THEN
        RAISE EXCEPTION 'First policy usage is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.first_used_at IS NULL AND NEW.first_used_at IS NOT NULL THEN
        IF (to_jsonb(NEW)-ARRAY['first_used_at','version','history']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['first_used_at','version','history']) THEN
            RAISE EXCEPTION 'Record usage separately from changing policy terms' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.effective_from>business_today AND OLD.first_used_at IS NULL THEN
        IF NEW.effective_from<=business_today THEN RAISE EXCEPTION 'Future policy cannot become retroactive' USING ERRCODE='23514'; END IF;
        RETURN NEW;
    END IF;
    IF (to_jsonb(NEW)-ARRAY['effective_to','version','history']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['effective_to','version','history']) OR NEW.effective_to IS NULL OR
       NEW.effective_to<business_today OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>OLD.effective_to) THEN
        RAISE EXCEPTION 'Create a new policy version; used/effective terms are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER work_order_consistent BEFORE INSERT OR UPDATE ON operational_tasks FOR EACH ROW EXECUTE FUNCTION bhome24_work_order_guard();
CREATE TRIGGER policy_history_immutable BEFORE UPDATE OR DELETE ON billing_policies FOR EACH ROW EXECUTE FUNCTION bhome24_policy_history_guard();
ALTER TABLE billing_policies ADD CONSTRAINT ex_policy_scope_charge_period EXCLUDE USING gist (
    location_id WITH =,
    (COALESCE(room_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    charge_code WITH =,
    daterange(effective_from,effective_to,'[]') WITH &&
) DEFERRABLE INITIALLY DEFERRED;
