-- Keep existing Incident Work Orders and permit explicitly sourced proactive maintenance.
DO $fn$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN SELECT conname FROM pg_constraint
        WHERE conrelid='operational_tasks'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%task_type%WORK_ORDER%incident_report_id IS NOT NULL%'
    LOOP
        EXECUTE format('ALTER TABLE operational_tasks DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $fn$;
ALTER TABLE operational_tasks ADD CONSTRAINT ck_work_order_source CHECK
    (task_type<>'WORK_ORDER' OR incident_report_id IS NOT NULL OR task_data->'state'->>'source'='Proactive');

CREATE OR REPLACE FUNCTION bhome24_work_order_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE s jsonb := NEW.task_data->'state'; report_location uuid;
BEGIN
    IF NEW.task_type<>'WORK_ORDER' THEN RETURN NEW; END IF;
    IF NEW.incident_report_id IS NOT NULL THEN
        SELECT location_id INTO report_location FROM incident_reports WHERE id=NEW.incident_report_id;
        IF report_location IS DISTINCT FROM NEW.location_id OR COALESCE(s->>'source','Incident')<>'Incident' THEN
            RAISE EXCEPTION 'Invalid incident Work Order scope' USING ERRCODE='23514';
        END IF;
    ELSIF s->>'source' IS DISTINCT FROM 'Proactive' OR
        ((NEW.room_id IS NOT NULL) = (NULLIF(btrim(s->>'commonArea'),'') IS NOT NULL)) THEN
        RAISE EXCEPTION 'Invalid proactive Work Order scope' USING ERRCODE='23514';
    END IF;
    IF NEW.assigned_user_id IS NULL OR NEW.location_id IS NULL OR
       NEW.status NOT IN ('Assigned','PendingApproval','InProgress','PendingVerification','Verified','Cancelled') OR
       s IS NULL OR (s->>'incidentId')::uuid IS DISTINCT FROM NEW.incident_report_id OR
       (s->>'assignedStaffId')::uuid IS DISTINCT FROM NEW.assigned_user_id OR
       (NEW.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rooms WHERE id=NEW.room_id AND location_id=NEW.location_id)) OR
       (NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assets WHERE id=NEW.asset_id AND location_id=NEW.location_id
            AND room_id IS NOT DISTINCT FROM NEW.room_id)) THEN
        RAISE EXCEPTION 'Invalid Work Order scope or state' USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('InProgress','PendingVerification','Verified') AND NOT (
       (NEW.cost_approved_at IS NOT NULL AND NEW.cost_approved_by_user_id IS NOT NULL AND
        s->>'approvedProposalVersion' IS NOT NULL AND s->>'approvedProposalVersion'=s->>'proposalVersion') OR
       (COALESCE((s->>'fastRepairPolicyVersion')::int,0)>0 AND s->>'fastRepairAuthorizedAt' IS NOT NULL AND
        NULLIF(btrim(s->>'fastRepairCategory'),'') IS NOT NULL AND
        (s->>'estimatedCost')::numeric=0 AND (s->>'usesMaterials')::boolean=FALSE AND
        (NEW.status<>'Verified' OR (s->>'actualCost')::numeric=0))) THEN
        RAISE EXCEPTION 'Work Order requires approved current plan' USING ERRCODE='23514';
    END IF;
    IF NEW.status='Verified' AND (NEW.verified_at IS NULL OR NEW.verified_by_user_id IS NULL OR
       s->>'actualCost' IS NULL OR s->>'completionActivityId' IS NULL) THEN
        RAISE EXCEPTION 'Work Order requires completion and verification' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $fn$;
