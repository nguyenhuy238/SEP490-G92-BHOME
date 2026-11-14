-- BHOME compact target design: exactly the 24 tables in the supplied Word design.
-- JSON diagram BHOME_Database_Design.json synchronized with this schema: 24 tables,
-- 386 columns, 83 FK relations. Original source layout format/version retained.
-- User decision 2026-11-03: keep 24 tables and retain existing security/evidence data.
-- Compact24 runtime schema, version compact24-2026-11-04. Backend native adapters implemented.
-- Run only in a NEW EMPTY database; this DDL does not convert existing data.
-- Use the separate offline Compact24 migration tool for controlled 70-to-24 conversion.
-- UUIDs, password hashes, encryption envelopes and business evidence must survive import.
-- No accounts, credentials, policy deadlines, fees or financial-success defaults are seeded.
BEGIN;
DO $preflight$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') THEN
        RAISE EXCEPTION 'Use a new empty database; this is not an in-place migration';
    END IF;
END $preflight$;

-- 01 Account + Identity security state + saved certificate metadata.
CREATE TABLE users (
    id uuid PRIMARY KEY,
    username varchar(256) NOT NULL,
    normalized_username varchar(256) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    email varchar(256),
    normalized_email varchar(256),
    email_confirmed boolean NOT NULL DEFAULT false,
    phone varchar(30),
    phone_confirmed boolean NOT NULL DEFAULT false,
    full_name varchar(150),
    roles text[] NOT NULL CHECK (cardinality(roles)>0 AND array_ndims(roles)=1 AND array_position(roles,NULL) IS NULL AND roles <@ ARRAY['Owner','Staff','Tenant']::text[]),
    is_active boolean NOT NULL DEFAULT true,
    security_stamp varchar(256) NOT NULL,
    concurrency_stamp varchar(256) NOT NULL,
    access_failed_count integer NOT NULL DEFAULT 0 CHECK (access_failed_count>=0),
    lockout_enabled boolean NOT NULL DEFAULT true,
    lockout_end timestamptz,
    two_factor_enabled boolean NOT NULL DEFAULT false,
    reset_token_hash varchar(64),
    reset_expires_at timestamptz,
    reset_consumed_at timestamptz,
    business_profile jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(business_profile)='object'),
    signing_credentials jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(signing_credentials)='array'),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array')
);
CREATE UNIQUE INDEX ux_users_email ON users(normalized_email) WHERE normalized_email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_single_owner ON users((1)) WHERE 'Owner'=ANY(roles);

-- 02 One physical store for session headers and rotating refresh token rows.
CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    record_kind varchar(10) NOT NULL CHECK (record_kind IN ('SESSION','TOKEN')),
    session_id uuid REFERENCES refresh_tokens(id),
    token_hash varchar(64),
    security_stamp varchar(256),
    device_label varchar(256),
    issued_at timestamptz NOT NULL,
    last_activity_at timestamptz,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    revocation_reason varchar(50),
    replaced_by_token_id uuid REFERENCES refresh_tokens(id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (expires_at>issued_at),
    CHECK ((record_kind='SESSION' AND session_id IS NULL AND token_hash IS NULL AND security_stamp IS NOT NULL) OR
           (record_kind='TOKEN' AND session_id IS NOT NULL AND session_id<>id AND token_hash IS NOT NULL AND security_stamp IS NULL)),
    CHECK (replaced_by_token_id IS NULL OR replaced_by_token_id<>id)
);
CREATE UNIQUE INDEX ux_refresh_hash ON refresh_tokens(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX ix_refresh_session ON refresh_tokens(session_id);
CREATE INDEX ix_refresh_user ON refresh_tokens(user_id,record_kind,revoked_at);

-- 03 Retained from the source design; no automatic payroll/reward policy is assumed.
CREATE TABLE staff_employments (
    id uuid PRIMARY KEY,
    staff_user_id uuid NOT NULL REFERENCES users(id),
    contract_number varchar(100),
    start_date date NOT NULL,
    end_date date,
    salary_type varchar(20),
    base_rate numeric(18,0) CHECK (base_rate>=0),
    reward_penalty_policy jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(reward_penalty_policy)='object'),
    status varchar(25) NOT NULL,
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK (end_date IS NULL OR end_date>=start_date)
);

-- 04 Effective Staff assignments and reusable Room Type catalog embedded per Location.
CREATE TABLE locations (
    id uuid PRIMARY KEY,
    name varchar(200) NOT NULL,
    address text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    staff_assignments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(staff_assignments)='array'),
    operating_settings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(operating_settings)='object'),
    public_profile jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(public_profile)='object'),
    published_at timestamptz,
    published_by_user_id uuid REFERENCES users(id),
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array')
);

-- 05 Rooms belong directly to Locations; RoomType is retired by the 2026-11-04 decision.
CREATE TABLE rooms (
    id uuid PRIMARY KEY,
    location_id uuid NOT NULL REFERENCES locations(id),
    room_number varchar(50) NOT NULL,
    floor varchar(30),
    capacity smallint NOT NULL CHECK (capacity>0),
    status smallint NOT NULL CHECK (status BETWEEN 0 AND 3),
    billing_representatives jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(billing_representatives)='array'),
    public_profile jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(public_profile)='object'),
    published_at timestamptz,
    published_by_user_id uuid REFERENCES users(id),
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    UNIQUE(location_id,room_number), UNIQUE(id,location_id)
);

-- 06 Assets keep relational scope, flexible purchase details and maintenance history.
CREATE TABLE assets (
    id uuid PRIMARY KEY,
    location_id uuid NOT NULL REFERENCES locations(id),
    room_id uuid,
    common_area varchar(200),
    asset_code varchar(80),
    name varchar(150) NOT NULL,
    category varchar(80) NOT NULL,
    condition text NOT NULL,
    status smallint NOT NULL CHECK (status BETWEEN 0 AND 3),
    purchase_info jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(purchase_info)='object'),
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    UNIQUE(id,location_id),
    FOREIGN KEY(room_id,location_id) REFERENCES rooms(id,location_id),
    CHECK ((room_id IS NOT NULL AND common_area IS NULL) OR (room_id IS NULL AND common_area IS NOT NULL AND length(btrim(common_area))>0))
);

-- 07 Preserve the existing encrypted identity envelope and AAD scope; no ID photos.
CREATE TABLE residents (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users(id),
    contact_email varchar(256),
    current_room_id uuid REFERENCES rooms(id),
    identity_owner_scope_id uuid NOT NULL REFERENCES users(id),
    display_label varchar(150) NOT NULL,
    identity_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(identity_data)='object'),
    identity_hmac varchar(64),
    hmac_key_version varchar(32),
    verification_status smallint NOT NULL CHECK (verification_status BETWEEN 0 AND 2),
    verified_by_user_id uuid REFERENCES users(id),
    verified_at timestamptz,
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array')
);
CREATE UNIQUE INDEX ux_resident_identity ON residents(identity_owner_scope_id,hmac_key_version,identity_hmac) WHERE identity_hmac IS NOT NULL;
CREATE UNIQUE INDEX ux_resident_contact_email ON residents(lower(btrim(contact_email))) WHERE contact_email IS NOT NULL;

-- 08 One Contract table: documents, handovers, inspections and settlement are typed snapshots.
CREATE TABLE contracts (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL REFERENCES rooms(id),
    representative_resident_id uuid NOT NULL REFERENCES residents(id),
    tenant_user_id uuid REFERENCES users(id),
    owner_signer_id uuid NOT NULL REFERENCES users(id),
    contract_type varchar(12) NOT NULL CHECK (contract_type IN ('MAIN','RENEWAL','HOLDING','ADDENDUM')),
    previous_contract_id uuid REFERENCES contracts(id),
    parent_contract_id uuid REFERENCES contracts(id),
    source_holding_contract_id uuid REFERENCES contracts(id),
    start_date date NOT NULL,
    end_date date NOT NULL,
    holding_expiry_at timestamptz,
    monthly_rent numeric(18,0) CHECK (monthly_rent>=0),
    deposit_required numeric(18,0) NOT NULL CHECK (deposit_required>=0),
    applied_holding_deposit numeric(18,0) NOT NULL DEFAULT 0 CHECK (applied_holding_deposit>=0),
    reserved_capacity smallint CHECK (reserved_capacity>0),
    terms text NOT NULL,
    snapshot_hash varchar(64),
    draft_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(draft_metadata)='object'),
    documents jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(documents)='array'),
    handover jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(handover)='object'),
    move_out jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(move_out)='object'),
    settlement jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settlement)='object'),
    status smallint NOT NULL,
    activated_at timestamptz,
    activated_by_user_id uuid REFERENCES users(id),
    actual_end_date date,
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK (end_date>start_date),
    CHECK (tenant_user_id IS NULL OR tenant_user_id<>owner_signer_id),
    CONSTRAINT ck_contract_active_metadata CHECK (status<>3 OR (activated_at IS NOT NULL AND activated_by_user_id IS NOT NULL)),
    CHECK (previous_contract_id IS NULL OR previous_contract_id<>id),
    CHECK (parent_contract_id IS NULL OR parent_contract_id<>id),
    CHECK (source_holding_contract_id IS NULL OR source_holding_contract_id<>id)
);
CREATE UNIQUE INDEX ux_contract_holding ON contracts(source_holding_contract_id) WHERE source_holding_contract_id IS NOT NULL;
CREATE INDEX ix_contract_room_period ON contracts(room_id,start_date,end_date);

-- 09 Keep provider request state and complete prepared/signed evidence, no private keys.
CREATE TABLE contract_signings (
    id uuid PRIMARY KEY,
    contract_id uuid NOT NULL REFERENCES contracts(id),
    signer_user_id uuid NOT NULL REFERENCES users(id),
    certificate_id uuid NOT NULL,
    certificate_snapshot jsonb NOT NULL CHECK (jsonb_typeof(certificate_snapshot)='object'),
    provider_code varchar(50) NOT NULL,
    provider_reference varchar(200),
    signing_status smallint NOT NULL,
    snapshot_hash varchar(64) NOT NULL,
    source_hash varchar(64),
    prepared_hash varchar(64),
    prepared_object_key varchar(250),
    signed_object_key varchar(250),
    signed_hash varchar(64),
    signing_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(signing_data)='object'),
    requested_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    signed_at timestamptz,
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK (expires_at>requested_at)
);
CREATE UNIQUE INDEX ux_signing_provider_ref ON contract_signings(provider_code,provider_reference) WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX ux_signing_current ON contract_signings(contract_id,signer_user_id) WHERE signing_status<>4;

-- 10 No separate residence registration table; actual stay and external result per occupant.
CREATE TABLE contract_residents (
    contract_id uuid NOT NULL REFERENCES contracts(id),
    resident_id uuid NOT NULL REFERENCES residents(id),
    resident_role smallint NOT NULL CHECK (resident_role IN (0,1)),
    residence_from date NOT NULL,
    residence_to date,
    actual_residence_from date,
    actual_move_out_date date,
    registration_status varchar(25),
    registration_evidence_key varchar(250),
    registration_result_at timestamptz,
    owner_confirmed_by_user_id uuid REFERENCES users(id),
    owner_confirmed_at timestamptz,
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    PRIMARY KEY(contract_id,resident_id),
    CHECK (residence_to IS NULL OR residence_to>=residence_from),
    CONSTRAINT ck_resident_actual_dates CHECK (actual_move_out_date IS NULL OR actual_residence_from IS NULL OR actual_move_out_date>=actual_residence_from)
);

-- 11 Independent incident lifecycle; child Work Orders use operational_tasks.
CREATE TABLE incident_reports (
    id uuid PRIMARY KEY,
    location_id uuid NOT NULL REFERENCES locations(id),
    room_id uuid,
    asset_id uuid,
    reporter_user_id uuid NOT NULL REFERENCES users(id),
    severity varchar(12) NOT NULL CHECK (severity IN ('NORMAL','EMERGENCY')),
    summary varchar(250) NOT NULL,
    description text NOT NULL,
    status varchar(30) NOT NULL,
    evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)<=5),
    emergency_actions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(emergency_actions)='array'),
    duplicate_of_report_id uuid REFERENCES incident_reports(id),
    owner_decision jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(owner_decision)='object'),
    reported_at timestamptz NOT NULL,
    resolved_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    FOREIGN KEY(room_id,location_id) REFERENCES rooms(id,location_id),
    FOREIGN KEY(asset_id,location_id) REFERENCES assets(id,location_id),
    CHECK (duplicate_of_report_id IS NULL OR duplicate_of_report_id<>id)
);
CREATE INDEX ix_incident_scope ON incident_reports(location_id,status,reported_at);

-- 12 Existing staff work, Work Orders, shift entries, durable jobs and command receipts.
-- SYSTEM_JOB / COMMAND never appear on Staff task lists or productivity reports.
CREATE TABLE operational_tasks (
    id uuid PRIMARY KEY,
    task_type varchar(20) NOT NULL CHECK (task_type IN ('METER_READ','GENERAL','WORK_ORDER','STAFF_SHIFT','SYSTEM_JOB','COMMAND')),
    location_id uuid REFERENCES locations(id),
    room_id uuid,
    asset_id uuid,
    assigned_user_id uuid REFERENCES users(id),
    contract_id uuid REFERENCES contracts(id),
    incident_report_id uuid REFERENCES incident_reports(id),
    meter_id uuid,
    billing_period date,
    source_key varchar(250),
    title varchar(200),
    description text,
    priority varchar(12),
    status varchar(30) NOT NULL,
    assigned_at timestamptz,
    starts_at timestamptz,
    ends_at timestamptz,
    due_at timestamptz,
    next_run_at timestamptz,
    locked_until timestamptz,
    lease_token uuid,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
    task_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(task_data)='object'),
    evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence)='array'),
    estimated_cost numeric(18,0) CHECK (estimated_cost>=0),
    approved_cost numeric(18,0) CHECK (approved_cost>=0),
    cost_approved_by_user_id uuid REFERENCES users(id),
    cost_approved_at timestamptz,
    verified_by_user_id uuid REFERENCES users(id),
    verified_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    FOREIGN KEY(room_id,location_id) REFERENCES rooms(id,location_id),
    FOREIGN KEY(asset_id,location_id) REFERENCES assets(id,location_id),
    CHECK (task_type IN ('SYSTEM_JOB','COMMAND') OR location_id IS NOT NULL),
    CHECK (task_type NOT IN ('SYSTEM_JOB','COMMAND') OR source_key IS NOT NULL),
    CHECK (task_type<>'METER_READ' OR meter_id IS NOT NULL),
    CHECK (task_type<>'WORK_ORDER' OR incident_report_id IS NOT NULL),
    CHECK (task_type<>'STAFF_SHIFT' OR (assigned_user_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at>starts_at))
);
CREATE UNIQUE INDEX ux_task_source ON operational_tasks(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX ix_task_board ON operational_tasks(location_id,task_type,status,due_at);
CREATE INDEX ix_job_due ON operational_tasks(status,next_run_at) WHERE task_type='SYSTEM_JOB';

-- 13 Device history stays here; initial/final values are confirmed meter_readings.
CREATE TABLE meters (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL REFERENCES rooms(id),
    utility_type smallint NOT NULL CHECK (utility_type IN (0,1)),
    meter_code varchar(80) NOT NULL,
    display_type smallint NOT NULL CHECK (display_type IN (0,1)),
    decimal_places smallint NOT NULL CHECK (decimal_places BETWEEN 0 AND 4),
    installed_on date NOT NULL,
    removed_on date,
    previous_meter_id uuid REFERENCES meters(id),
    is_active boolean NOT NULL,
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK (removed_on IS NULL OR removed_on>=installed_on),
    CHECK (previous_meter_id IS NULL OR previous_meter_id<>id)
);
CREATE UNIQUE INDEX ux_meter_active ON meters(room_id,utility_type) WHERE is_active;
ALTER TABLE operational_tasks ADD CONSTRAINT fk_task_meter FOREIGN KEY(meter_id) REFERENCES meters(id);

-- 14 Human-confirmed readings; OCR and file metadata remain distinguishable.
CREATE TABLE meter_readings (
    id uuid PRIMARY KEY,
    meter_id uuid NOT NULL REFERENCES meters(id),
    operational_task_id uuid NOT NULL UNIQUE REFERENCES operational_tasks(id),
    reading_purpose smallint NOT NULL CHECK (reading_purpose IN (0,1,2)),
    billing_period date,
    reading_at timestamptz NOT NULL,
    previous_value numeric(18,4),
    ocr_proposed_value numeric(18,4),
    confirmed_value numeric(18,4) NOT NULL CHECK (confirmed_value>=0),
    consumption numeric(18,4) CHECK (consumption>=0),
    confirmed_by_user_id uuid NOT NULL REFERENCES users(id),
    confirmed_at timestamptz NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence)='object'),
    status smallint NOT NULL CHECK (status IN (0,1)),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK (previous_value IS NULL OR confirmed_value>=previous_value),
    CHECK ((reading_purpose=1 AND billing_period IS NOT NULL AND EXTRACT(DAY FROM billing_period)=1) OR (reading_purpose<>1 AND billing_period IS NULL))
);
CREATE UNIQUE INDEX ux_reading_period ON meter_readings(meter_id,billing_period) WHERE reading_purpose=1;

-- 15 Retain existing inclusive dates until the team approves a conversion to [from,to).
CREATE TABLE billing_policies (
    id uuid PRIMARY KEY,
    location_id uuid NOT NULL REFERENCES locations(id),
    room_id uuid,
    charge_code varchar(80) NOT NULL,
    category smallint NOT NULL CHECK (category BETWEEN 0 AND 3),
    calculation_method varchar(30) NOT NULL,
    rate numeric(18,4) NOT NULL CHECK (rate>=0),
    parameters jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parameters)='object'),
    effective_from date NOT NULL,
    effective_to date,
    first_used_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    FOREIGN KEY(room_id,location_id) REFERENCES rooms(id,location_id),
    CHECK (effective_to IS NULL OR effective_to>=effective_from),
    CONSTRAINT ck_billing_policy_calculation_method CHECK (
      (category = 0 AND calculation_method = 'FIXED_PER_ROOM_PER_MONTH') OR
      (category IN (1, 2) AND calculation_method = 'METERED') OR
      (category = 3 AND calculation_method IN ('FIXED_PER_ROOM_PER_MONTH', 'FIXED_PER_PERSON_PER_MONTH'))
    )
);
CREATE INDEX ix_policy_effective ON billing_policies(location_id,charge_code,effective_from);

-- 16 Room/month invoice decision of 01/11 retained; recipients are a historical snapshot.
CREATE TABLE invoices (
    id uuid PRIMARY KEY,
    location_id uuid NOT NULL REFERENCES locations(id),
    room_id uuid NOT NULL,
    contract_id uuid NOT NULL REFERENCES contracts(id),
    representative_tenant_user_id uuid NOT NULL REFERENCES users(id),
    invoice_type varchar(12) NOT NULL DEFAULT 'PERIODIC' CHECK (invoice_type IN ('PERIODIC','FINAL','AD_HOC')),
    billing_period date NOT NULL CHECK (EXTRACT(DAY FROM billing_period)=1),
    recipient_user_ids uuid[] NOT NULL CHECK (cardinality(recipient_user_ids)>0 AND array_position(recipient_user_ids,NULL) IS NULL),
    base_total_amount numeric(18,0) NOT NULL CHECK (base_total_amount>=0),
    status smallint NOT NULL CHECK (status IN (0,1)),
    missing_inputs text[] NOT NULL DEFAULT '{}',
    billing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(billing_snapshot)='object'),
    payment_requests jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(payment_requests)='array'),
    scheduled_final_date date NOT NULL,
    due_date date NOT NULL,
    finalized_at timestamptz,
    finalized_by_user_id uuid REFERENCES users(id),
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    FOREIGN KEY(room_id,location_id) REFERENCES rooms(id,location_id),
    CHECK (status=0 OR (finalized_at IS NOT NULL AND finalized_by_user_id IS NOT NULL AND cardinality(missing_inputs)=0 AND due_date>=scheduled_final_date))
);
CREATE UNIQUE INDEX ux_periodic_invoice ON invoices(room_id,billing_period) WHERE invoice_type='PERIODIC';
CREATE INDEX ix_invoice_recipients ON invoices USING gin(recipient_user_ids);

-- 17 No separate line snapshots table: all rate/reading evidence is on each item.
CREATE TABLE invoice_items (
    id uuid PRIMARY KEY,
    invoice_id uuid NOT NULL REFERENCES invoices(id),
    charge_code varchar(80) NOT NULL,
    description varchar(255) NOT NULL,
    billing_policy_id uuid REFERENCES billing_policies(id),
    meter_reading_id uuid REFERENCES meter_readings(id),
    quantity numeric(18,4) NOT NULL CHECK (quantity>=0),
    unit_price numeric(18,4) NOT NULL CHECK (unit_price>=0),
    amount numeric(18,0) NOT NULL CHECK (amount>=0),
    calculation_snapshot jsonb NOT NULL CHECK (jsonb_typeof(calculation_snapshot)='object'),
    UNIQUE(invoice_id,charge_code)
);

-- 18 Request and Owner decision on one record; before/after + decision history preserved.
CREATE TABLE invoice_adjustments (
    id uuid PRIMARY KEY,
    invoice_id uuid NOT NULL REFERENCES invoices(id),
    requested_by_user_id uuid NOT NULL REFERENCES users(id),
    requested_at timestamptz NOT NULL,
    reason text NOT NULL,
    request_snapshot jsonb NOT NULL CHECK (jsonb_typeof(request_snapshot)='object'),
    proposed_changes jsonb NOT NULL CHECK (jsonb_typeof(proposed_changes)='object'),
    evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence)='array'),
    status varchar(12) NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','APPLIED')),
    approved_delta_amount numeric(18,0),
    decided_by_user_id uuid REFERENCES users(id),
    decided_at timestamptz,
    decision_reason text,
    decision_snapshot jsonb,
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK (decision_snapshot IS NULL OR jsonb_typeof(decision_snapshot)='object'),
    CHECK (status='REQUESTED' OR (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)),
    CHECK (status NOT IN ('APPROVED','APPLIED') OR approved_delta_amount IS NOT NULL)
);

-- 19 Canonical bank receipt and reconciliation history for both invoice and deposit money.
CREATE TABLE payments (
    id uuid PRIMARY KEY,
    provider_code varchar(80) NOT NULL,
    receiving_account_key varchar(200) NOT NULL,
    transaction_reference varchar(150) NOT NULL,
    effect_key varchar(250),
    received_at timestamptz NOT NULL,
    amount numeric(18,0) NOT NULL CHECK (amount>0),
    currency varchar(3) NOT NULL CHECK (currency='VND'),
    remittance_info text,
    beneficiary_resident_id uuid REFERENCES residents(id),
    status varchar(12) NOT NULL CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
    verification_method varchar(10) CHECK (verification_method IN ('MANUAL','AUTO')),
    verified_by_user_id uuid REFERENCES users(id),
    verified_at timestamptz,
    verification_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(verification_data)='object'),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    UNIQUE(provider_code,receiving_account_key,transaction_reference),
    CHECK (status<>'VERIFIED' OR (effect_key IS NOT NULL AND verified_at IS NOT NULL AND verification_method IS NOT NULL AND (verification_method='AUTO' OR verified_by_user_id IS NOT NULL)))
);
CREATE UNIQUE INDEX ux_payment_effect ON payments(effect_key) WHERE effect_key IS NOT NULL;

-- 20 Append-only money allocation. Policy decides eligible operations, not this DDL.
CREATE TABLE payment_allocations (
    id uuid PRIMARY KEY,
    source_payment_id uuid REFERENCES payments(id),
    source_deposit_contract_id uuid REFERENCES contracts(id),
    target_invoice_id uuid REFERENCES invoices(id),
    target_deposit_contract_id uuid REFERENCES contracts(id),
    target_settlement_contract_id uuid REFERENCES contracts(id),
    settlement_receivable_id uuid,
    deposit_offset_approval_id uuid,
    amount numeric(18,0) NOT NULL CHECK (amount<>0),
    reversal_of_allocation_id uuid UNIQUE REFERENCES payment_allocations(id),
    operation_key uuid NOT NULL,
    line_number smallint NOT NULL CHECK (line_number>0),
    paid_by_user_id uuid REFERENCES users(id),
    created_by_user_id uuid REFERENCES users(id),
    allocated_at timestamptz NOT NULL,
    reason text NOT NULL,
    UNIQUE(operation_key,line_number),
    CHECK ((source_payment_id IS NULL)<>(source_deposit_contract_id IS NULL)),
    CONSTRAINT ck_allocation_one_target CHECK (num_nonnulls(target_invoice_id,target_deposit_contract_id,target_settlement_contract_id)=1),
    CONSTRAINT ck_allocation_receivable_target CHECK ((target_settlement_contract_id IS NULL)=(settlement_receivable_id IS NULL)),
    CHECK ((amount>0 AND reversal_of_allocation_id IS NULL) OR (amount<0 AND reversal_of_allocation_id IS NOT NULL)),
    CHECK (source_deposit_contract_id IS NULL OR target_deposit_contract_id IS NULL OR source_deposit_contract_id<>target_deposit_contract_id),
    CHECK (reversal_of_allocation_id IS NULL OR reversal_of_allocation_id<>id)
);
CREATE UNIQUE INDEX ux_allocation_offset_approval ON payment_allocations(deposit_offset_approval_id) WHERE deposit_offset_approval_id IS NOT NULL;
CREATE INDEX ix_allocation_receivable ON payment_allocations(target_settlement_contract_id,settlement_receivable_id);
CREATE INDEX ix_allocation_invoice ON payment_allocations(target_invoice_id);
CREATE INDEX ix_allocation_source ON payment_allocations(source_payment_id,source_deposit_contract_id);

-- 21 Explicit refund workflow. No automatic deadline/deduction/credit policy.
CREATE TABLE refund_requests (
    id uuid PRIMARY KEY,
    source_payment_id uuid REFERENCES payments(id),
    source_deposit_contract_id uuid REFERENCES contracts(id),
    beneficiary_resident_id uuid REFERENCES residents(id),
    beneficiary_kind varchar(12) NOT NULL DEFAULT 'RESIDENT',
    external_payer_attestation_id uuid,
    requested_by_user_id uuid NOT NULL REFERENCES users(id),
    requested_at timestamptz NOT NULL,
    requested_amount numeric(18,0) NOT NULL CHECK (requested_amount>0),
    reason text NOT NULL,
    status varchar(12) NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','COMPLETED','CANCELLED')),
    decided_by_user_id uuid REFERENCES users(id),
    decided_at timestamptz,
    decision_reason text,
    executed_at timestamptz,
    external_refund_reference varchar(200),
    execution_evidence_key varchar(250),
    operation_key uuid NOT NULL UNIQUE,
    version integer NOT NULL DEFAULT 1 CHECK (version>0),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    CHECK ((source_payment_id IS NULL)<>(source_deposit_contract_id IS NULL)),
    CONSTRAINT ck_refund_beneficiary CHECK ((beneficiary_kind='RESIDENT' AND beneficiary_resident_id IS NOT NULL AND external_payer_attestation_id IS NULL) OR
      (beneficiary_kind='EXTERNAL' AND beneficiary_resident_id IS NULL AND external_payer_attestation_id IS NOT NULL AND source_payment_id IS NOT NULL)),
    CHECK (status NOT IN ('APPROVED','REJECTED','COMPLETED') OR (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)),
    CHECK (status<>'COMPLETED' OR (executed_at IS NOT NULL AND external_refund_reference IS NOT NULL AND execution_evidence_key IS NOT NULL))
);

-- 22 One table for actual initial investment and operating costs.
CREATE TABLE expenses (
    id uuid PRIMARY KEY,
    location_id uuid NOT NULL REFERENCES locations(id),
    room_id uuid,
    asset_id uuid,
    incident_report_id uuid REFERENCES incident_reports(id),
    task_id uuid REFERENCES operational_tasks(id),
    expense_type varchar(20) NOT NULL CHECK (expense_type IN ('INITIAL_INVESTMENT','OPERATING')),
    category varchar(60) NOT NULL,
    amount numeric(18,0) NOT NULL CHECK (amount>0),
    occurred_on date NOT NULL,
    note text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence)='array'),
    source_key varchar(250),
    recorded_by_user_id uuid NOT NULL REFERENCES users(id),
    history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history)='array'),
    FOREIGN KEY(room_id,location_id) REFERENCES rooms(id,location_id),
    FOREIGN KEY(asset_id,location_id) REFERENCES assets(id,location_id)
);
CREATE UNIQUE INDEX ux_expense_source ON expenses(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX ix_expense_report ON expenses(location_id,occurred_on,expense_type);

-- 23 Saved what-if inputs/baseline/results; never the actual financial ledger.
CREATE TABLE financial_scenarios (
    id uuid PRIMARY KEY,
    location_id uuid REFERENCES locations(id),
    name varchar(150) NOT NULL,
    baseline_from date NOT NULL,
    baseline_to date NOT NULL,
    forecast_months smallint NOT NULL CHECK (forecast_months>0),
    assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions)='object'),
    baseline_snapshot jsonb NOT NULL CHECK (jsonb_typeof(baseline_snapshot)='object'),
    result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot)='object'),
    calculation_version varchar(40) NOT NULL,
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    calculated_at timestamptz NOT NULL,
    CHECK (baseline_to>=baseline_from)
);

-- 24 Durable inbox, transactional notification intent and independent audit events.
-- AUDIT rows have no recipient and are never returned by notification APIs.
CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    record_kind varchar(10) NOT NULL CHECK (record_kind IN ('INBOX','OUTBOX','AUDIT')),
    recipient_user_id uuid REFERENCES users(id),
    actor_user_id uuid REFERENCES users(id),
    location_id uuid REFERENCES locations(id),
    event_key varchar(250) NOT NULL,
    notification_type varchar(80) NOT NULL,
    related_entity_type varchar(50),
    related_entity_id uuid,
    title varchar(200),
    message text,
    event_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(event_data)='object'),
    event_at timestamptz NOT NULL,
    read_at timestamptz,
    delivery_status varchar(25),
    next_delivery_at timestamptz,
    locked_until timestamptz,
    lease_token uuid,
    delivery_history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(delivery_history)='array'),
    CHECK ((record_kind='INBOX' AND recipient_user_id IS NOT NULL) OR (record_kind IN ('OUTBOX','AUDIT') AND recipient_user_id IS NULL))
);
CREATE UNIQUE INDEX ux_notification_inbox ON notifications(recipient_user_id,event_key) WHERE record_kind='INBOX';
CREATE UNIQUE INDEX ux_notification_system ON notifications(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT');
CREATE INDEX ix_notification_list ON notifications(recipient_user_id,event_at) WHERE record_kind='INBOX';
CREATE INDEX ix_audit_target ON notifications(related_entity_type,related_entity_id,event_at) WHERE record_kind='AUDIT';

-- Incident API writes reuse these native aggregates. Validate critical workflow
-- invariants even if an administrative writer bypasses the application service.
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
CREATE TRIGGER work_order_consistent BEFORE INSERT OR UPDATE ON operational_tasks FOR EACH ROW EXECUTE FUNCTION bhome24_work_order_guard();

-- Runtime migration 2026-11-04: retain the existing normalized property keys and
-- inclusive, deferred policy exclusion. These add no table, column or foreign key.
CREATE UNIQUE INDEX ux_room_normalized_number ON rooms(location_id,upper(btrim(room_number)));
CREATE UNIQUE INDEX ux_asset_normalized_code ON assets(location_id,upper(btrim(asset_code))) WHERE asset_code IS NOT NULL;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE billing_policies ADD CONSTRAINT ex_policy_scope_charge_period EXCLUDE USING gist (
    location_id WITH =,
    (COALESCE(room_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    charge_code WITH =,
    daterange(effective_from,effective_to,'[]') WITH &&
) DEFERRABLE INITIALLY DEFERRED;

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
CREATE TRIGGER policy_history_immutable BEFORE UPDATE OR DELETE ON billing_policies FOR EACH ROW EXECUTE FUNCTION bhome24_policy_history_guard();

-- Keep revocation atomic even for a controlled administrative SQL update. Restoring an
-- old role/stamp or reactivating an account must not resurrect a previously revoked session.
CREATE FUNCTION bhome24_user_security_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE reason text; event_id uuid := gen_random_uuid();
BEGIN
    IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active AND NEW.security_stamp IS NOT DISTINCT FROM OLD.security_stamp
       AND NEW.roles IS NOT DISTINCT FROM OLD.roles THEN RETURN NEW; END IF;
    reason := CASE WHEN NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        CASE WHEN NEW.is_active THEN 'AccountActivated' ELSE 'AccountDeactivated' END
        WHEN NEW.security_stamp IS DISTINCT FROM OLD.security_stamp THEN 'SecurityStampChanged' ELSE 'RoleChanged' END;
    UPDATE refresh_tokens SET revoked_at=CURRENT_TIMESTAMP,revocation_reason=reason
      WHERE user_id=NEW.id AND record_kind='SESSION' AND revoked_at IS NULL;
    INSERT INTO notifications(id,record_kind,event_key,notification_type,related_entity_type,related_entity_id,event_data,event_at)
      VALUES(event_id,'AUDIT','identity:'||event_id::text,reason,'User',NEW.id,
        jsonb_build_object('schemaVersion',1,'recordType','SecurityAuditRecord','succeeded',true,'origin','database',
          'state',jsonb_build_object('id',event_id,'event',reason,'targetType','User','targetId',NEW.id,'targetUserId',NEW.id,'succeeded',true)),CURRENT_TIMESTAMP);
    RETURN NEW;
END $fn$;
CREATE TRIGGER user_security_revokes_sessions AFTER UPDATE OF roles,is_active,security_stamp ON users FOR EACH ROW EXECUTE FUNCTION bhome24_user_security_guard();

-- Append-only JSON arrays are protected at DB level, not just convention.
CREATE FUNCTION bhome24_array_is_extension(old_value jsonb,new_value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
    SELECT jsonb_typeof(new_value)='array' AND jsonb_array_length(new_value)>=jsonb_array_length(old_value)
       AND NOT EXISTS (SELECT 1 FROM generate_series(0,jsonb_array_length(old_value)-1) i WHERE old_value->i IS DISTINCT FROM new_value->i);
$fn$;
CREATE FUNCTION bhome24_history_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE old_json jsonb; new_json jsonb; column_name text;
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Business history cannot be deleted'; END IF;
    old_json:=to_jsonb(OLD); new_json:=to_jsonb(NEW);
    FOREACH column_name IN ARRAY TG_ARGV LOOP
        IF NOT bhome24_array_is_extension(old_json->column_name,new_json->column_name) THEN
            RAISE EXCEPTION 'History array % must only be appended',column_name;
        END IF;
    END LOOP;
    RETURN NEW;
END $fn$;
DO $history$
DECLARE target text;
BEGIN
    FOREACH target IN ARRAY ARRAY['users','staff_employments','locations','rooms','assets','residents','contracts','contract_signings','contract_residents','operational_tasks','meters','meter_readings','billing_policies','invoices','invoice_adjustments','payments','refund_requests','expenses'] LOOP
        EXECUTE format('CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION bhome24_history_guard(''history'')',target);
    END LOOP;
END $history$;
CREATE TRIGGER incident_history_append_only BEFORE UPDATE OR DELETE ON incident_reports FOR EACH ROW EXECUTE FUNCTION bhome24_history_guard('history','emergency_actions');
CREATE TRIGGER representatives_append_only BEFORE UPDATE OR DELETE ON rooms FOR EACH ROW EXECUTE FUNCTION bhome24_history_guard('billing_representatives');
CREATE TRIGGER delivery_history_append_only BEFORE UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION bhome24_history_guard('delivery_history');

-- Preserve source handover confirmation/immutability and reading references after
-- embedding the baseline/history in Contract JSON. No additional columns or FKs.
CREATE FUNCTION bhome24_handover_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE baseline jsonb := NEW.handover->'current'; previous jsonb; entry jsonb; reading_id text;
BEGIN
    IF TG_OP='UPDATE' THEN
        previous:=OLD.handover->'current';
        IF previous IS NOT NULL AND baseline IS NULL THEN
            RAISE EXCEPTION 'Handover baseline cannot be removed' USING ERRCODE='23514';
        END IF;
        IF previous->>'status'='2' AND (previous-'updatedAt') IS DISTINCT FROM (baseline-'updatedAt') THEN
            RAISE EXCEPTION 'Confirmed handover baseline is immutable' USING ERRCODE='23514';
        END IF;
    END IF;
    IF baseline IS NOT NULL THEN
        IF COALESCE((baseline->>'version')::int,0)<=0 OR COALESCE((baseline->>'status')::int,-1) NOT BETWEEN 0 AND 2 OR
           (baseline->>'tenantConfirmedVersion' IS NOT NULL AND baseline->>'tenantConfirmedVersion'<>baseline->>'version') OR
           (baseline->>'status'='2' AND (baseline->>'tenantConfirmedVersion' IS NULL OR
             baseline->>'tenantConfirmedVersion'<>baseline->>'version' OR baseline->>'tenantConfirmedAt' IS NULL OR
             baseline->>'staffConfirmedAt' IS NULL OR baseline->>'tenantConfirmedBy' IS NULL OR baseline->>'staffConfirmedBy' IS NULL)) THEN
            RAISE EXCEPTION 'Handover confirmations must belong to the same version' USING ERRCODE='23514';
        END IF;
    END IF;
    FOR entry IN SELECT baseline WHERE baseline IS NOT NULL
        UNION ALL SELECT h->'state' FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ContractHandoverHistory'
    LOOP
        IF (entry->>'contractId') IS DISTINCT FROM NEW.id::text THEN
            RAISE EXCEPTION 'Handover Contract reference mismatch' USING ERRCODE='23503';
        END IF;
        FOREACH reading_id IN ARRAY ARRAY[entry->>'electricityReadingId',entry->>'waterReadingId'] LOOP
            IF reading_id IS NULL OR NOT EXISTS(SELECT 1 FROM meter_readings WHERE id=reading_id::uuid) THEN
                RAISE EXCEPTION 'Handover confirmed reading reference missing' USING ERRCODE='23503';
            END IF;
        END LOOP;
    END LOOP;
    RETURN NEW;
END $fn$;
CREATE TRIGGER contract_handover_guard BEFORE INSERT OR UPDATE OF handover,history ON contracts FOR EACH ROW EXECUTE FUNCTION bhome24_handover_guard();

CREATE FUNCTION bhome24_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'Append-only record cannot be updated, deleted or truncated'; END $fn$;
CREATE TRIGGER allocation_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION bhome24_immutable_guard();

CREATE FUNCTION bhome24_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Event records cannot be deleted'; END IF;
    IF OLD.record_kind='AUDIT' OR NEW.record_kind<>OLD.record_kind THEN RAISE EXCEPTION 'Audit events are immutable'; END IF;
    IF NEW.event_key<>OLD.event_key OR NEW.event_data IS DISTINCT FROM OLD.event_data OR NEW.event_at<>OLD.event_at OR
       NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id THEN RAISE EXCEPTION 'Event identity and payload are immutable'; END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER notification_event_guard BEFORE UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION bhome24_audit_guard();

CREATE FUNCTION bhome24_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status<>0 THEN RAISE EXCEPTION 'Create Draft before finalization'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP='DELETE' OR OLD.status=1 THEN RAISE EXCEPTION 'Final invoice is immutable'; END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER invoice_immutable BEFORE INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION bhome24_invoice_guard();
CREATE FUNCTION bhome24_invoice_item_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE parent_id uuid; parent_status smallint;
BEGIN
    IF TG_OP<>'INSERT' THEN
        SELECT status INTO parent_status FROM invoices WHERE id=OLD.invoice_id FOR UPDATE;
        IF parent_status=1 THEN RAISE EXCEPTION 'Final invoice items are immutable'; END IF;
    END IF;
    IF TG_OP<>'DELETE' THEN
        parent_id:=NEW.invoice_id;
        SELECT status INTO parent_status FROM invoices WHERE id=parent_id FOR UPDATE;
        IF parent_status=1 THEN RAISE EXCEPTION 'Final invoice items are immutable'; END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END $fn$;
CREATE TRIGGER invoice_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION bhome24_invoice_item_guard();

CREATE FUNCTION bhome24_allocation_source_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE source_status text; original payment_allocations%ROWTYPE;
BEGIN
    IF NEW.source_payment_id IS NOT NULL THEN
        SELECT status INTO source_status FROM payments WHERE id=NEW.source_payment_id FOR UPDATE;
        IF source_status IS DISTINCT FROM 'VERIFIED' THEN RAISE EXCEPTION 'Only verified bank money can be allocated'; END IF;
    END IF;
    IF NEW.reversal_of_allocation_id IS NOT NULL THEN
        SELECT * INTO original FROM payment_allocations WHERE id=NEW.reversal_of_allocation_id FOR UPDATE;
        IF NOT FOUND OR original.amount<=0 OR NEW.amount<>-original.amount OR
           NEW.source_payment_id IS DISTINCT FROM original.source_payment_id OR
           NEW.source_deposit_contract_id IS DISTINCT FROM original.source_deposit_contract_id OR
           NEW.target_invoice_id IS DISTINCT FROM original.target_invoice_id OR
           NEW.target_deposit_contract_id IS DISTINCT FROM original.target_deposit_contract_id THEN
            RAISE EXCEPTION 'Reversal must exactly negate the original allocation';
        END IF;
    END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_verified_source BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_allocation_source_guard();

CREATE FUNCTION bhome24_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.status='VERIFIED' AND (to_jsonb(NEW)-'history') IS DISTINCT FROM (to_jsonb(OLD)-'history') THEN
        RAISE EXCEPTION 'Verified bank receipt cannot be rewritten';
    END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER payment_verified_immutable BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bhome24_payment_guard();

CREATE FUNCTION bhome24_refresh_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE parent refresh_tokens%ROWTYPE;
BEGIN
    IF NEW.record_kind='TOKEN' THEN
        SELECT * INTO parent FROM refresh_tokens WHERE id=NEW.session_id;
        IF NOT FOUND OR parent.record_kind<>'SESSION' OR parent.user_id<>NEW.user_id OR NEW.expires_at>parent.expires_at THEN
            RAISE EXCEPTION 'Refresh token must belong to the same user session and its absolute lifetime';
        END IF;
    END IF;
    RETURN NEW;
END $fn$;
CREATE TRIGGER refresh_session_parent BEFORE INSERT OR UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION bhome24_refresh_parent_guard();

-- TRUNCATE must not bypass business history, audit or invoice protection.
DO $truncate_guard$
DECLARE target text;
BEGIN
    FOR target IN SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' LOOP
        EXECUTE format('CREATE TRIGGER no_business_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bhome24_immutable_guard()',target);
    END LOOP;
END $truncate_guard$;

DO $count$
BEGIN
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')<>24 THEN
        RAISE EXCEPTION 'Compact design must contain exactly 24 tables';
    END IF;
END $count$;
CREATE FUNCTION bhome24_settlement_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
        WITH RECURSIVE versions AS (SELECT id,previous_contract_id FROM contracts WHERE id=approval_contract
          UNION ALL SELECT c.id,c.previous_contract_id FROM contracts c JOIN versions v ON c.id=v.previous_contract_id)
        SELECT 1 FROM versions WHERE id=invoice_contract) THEN RAISE EXCEPTION 'Invoice outside deposit tenancy' USING ERRCODE='23514'; END IF;
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
CREATE TRIGGER allocation_settlement_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_settlement_allocation_guard();

CREATE FUNCTION bhome24_settlement_bank_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
CREATE TRIGGER allocation_settlement_bank_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_settlement_bank_guard();

CREATE FUNCTION bhome24_receipt_disposition_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
CREATE TRIGGER allocation_receipt_disposition_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_receipt_disposition_guard();

-- Runtime guards shared verbatim with the canonical fresh DDL.
CREATE OR REPLACE FUNCTION bhome24_external_payer_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE payer jsonb; old_payer jsonb; entries integer;
BEGIN
  SELECT count(*),jsonb_agg(h->'state')->0 INTO entries,payer FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1';
  IF entries=0 THEN RETURN NEW; END IF;
  IF entries<>1 THEN RAISE EXCEPTION 'External payer attestation is immutable and unique per receipt' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    SELECT h->'state' INTO old_payer FROM jsonb_array_elements(OLD.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1';
    IF old_payer IS NOT NULL THEN
      IF old_payer IS DISTINCT FROM payer THEN RAISE EXCEPTION 'External payer attestation cannot be replaced' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.status<>'VERIFIED' OR payer->>'transferId' IS DISTINCT FROM NEW.id::text OR
    payer->>'normalizedBankReference' IS DISTINCT FROM upper(btrim(NEW.transaction_reference)) OR
    COALESCE(payer->>'receiptAmount','') !~ '^[0-9]+$' OR COALESCE(payer->>'transferFingerprint','') !~ '^[A-F0-9]{64}$' OR
    nullif(btrim(payer->>'payerLabel'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=payer->>'verifiedByUserId' AND u.is_active AND 'Owner'=ANY(u.roles)) THEN
    RAISE EXCEPTION 'External payer requires an Owner-verified bank receipt' USING ERRCODE='23514';
  END IF;
  IF (payer->>'receiptAmount')::numeric<>NEW.amount OR EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=NEW.id AND a.paid_by_user_id IS NOT NULL) OR
    EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_payment_id=NEW.id AND r.status IN ('REQUESTED','APPROVED','COMPLETED')) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ReceiptExcessDispositionV1' AND h->'state'->>'payerResidentId' IS NOT NULL) THEN
    RAISE EXCEPTION 'Receipt already has a different payer or refund obligation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER payment_external_payer_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bhome24_external_payer_guard();

CREATE OR REPLACE FUNCTION bhome24_external_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.source_payment_id IS NOT NULL AND NEW.paid_by_user_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h WHERE p.id=NEW.source_payment_id AND h->>'recordType'='ExternalPaymentPayerV1') THEN
    RAISE EXCEPTION 'External payer receipt cannot be relabeled as a Tenant payment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_external_payer_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_external_allocation_guard();

CREATE OR REPLACE FUNCTION bhome24_external_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE receipt payments%ROWTYPE; payer jsonb; state jsonb; allocated numeric; reserved numeric;
BEGIN
  IF TG_OP='UPDATE' AND ROW(OLD.source_payment_id,OLD.source_deposit_contract_id,OLD.beneficiary_kind,OLD.beneficiary_resident_id,OLD.external_payer_attestation_id,OLD.requested_amount)
    IS DISTINCT FROM ROW(NEW.source_payment_id,NEW.source_deposit_contract_id,NEW.beneficiary_kind,NEW.beneficiary_resident_id,NEW.external_payer_attestation_id,NEW.requested_amount) THEN
    RAISE EXCEPTION 'Refund source, beneficiary and amount are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.beneficiary_kind<>'EXTERNAL' OR NEW.status NOT IN ('REQUESTED','APPROVED','COMPLETED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT * INTO receipt FROM payments WHERE id=NEW.source_payment_id AND status='VERIFIED';
  SELECT h->'state' INTO payer FROM jsonb_array_elements(receipt.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1' AND h->'state'->>'id'=NEW.external_payer_attestation_id::text;
  SELECT h->'state' INTO state FROM jsonb_array_elements(NEW.history) WITH ORDINALITY e(h,n) WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1;
  IF receipt.id IS NULL OR payer IS NULL OR state->>'classification' IS DISTINCT FROM 'ExcessReceiptRefundV1' OR
    state->>'externalPayerAttestationId' IS DISTINCT FROM NEW.external_payer_attestation_id::text OR EXISTS(
      SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=receipt.id AND a.paid_by_user_id IS NOT NULL) OR NOT (
      EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=receipt.id) OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(receipt.history) h WHERE h->>'recordType'='ReceiptExcessDispositionV1'
          AND h->'state'->>'externalPayerAttestationId'=NEW.external_payer_attestation_id::text AND h->'state'->>'payerResidentId' IS NULL
          AND h->'state'->>'id'=state->>'receiptExcessDispositionId')) THEN
    RAISE EXCEPTION 'External refund requires the exact verified payer and allocated or whole excess source' USING ERRCODE='23514';
  END IF;
  IF NEW.status='COMPLETED' AND (state->'upload'->>'objectKey' IS DISTINCT FROM NEW.execution_evidence_key OR
    state->'upload'->>'externalReference' IS DISTINCT FROM NEW.external_refund_reference OR COALESCE(state->'upload'->>'sha256','') !~ '^[A-F0-9]{64}$' OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'events')='array' THEN state->'events' ELSE '[]'::jsonb END) event WHERE event->>'action'='Completed')) THEN
    RAISE EXCEPTION 'External refund completion requires matching execution evidence metadata' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO allocated FROM payment_allocations WHERE source_payment_id=receipt.id;
  SELECT COALESCE(sum(requested_amount),0) INTO reserved FROM refund_requests WHERE source_payment_id=receipt.id AND id<>NEW.id AND status IN ('REQUESTED','APPROVED','COMPLETED');
  IF allocated+reserved+NEW.requested_amount>receipt.amount THEN RAISE EXCEPTION 'External refund exceeds unallocated receipt funds' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER refund_external_payer_guard BEFORE INSERT OR UPDATE ON refund_requests FOR EACH ROW EXECUTE FUNCTION bhome24_external_refund_guard();

CREATE OR REPLACE FUNCTION bhome24_external_refund_valid(refund_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM refund_requests r JOIN payments p ON p.id=r.source_payment_id
    JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
      WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1) proof ON true
    JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1'
      AND h->'state'->>'id'=r.external_payer_attestation_id::text) payer ON true
    WHERE r.id=refund_id AND r.status='COMPLETED' AND r.beneficiary_kind='EXTERNAL' AND r.beneficiary_resident_id IS NULL AND r.source_deposit_contract_id IS NULL
      AND p.status='VERIFIED' AND payer.state->>'transferId'=p.id::text AND payer.state->>'normalizedBankReference'=upper(btrim(p.transaction_reference))
      AND CASE WHEN payer.state->>'receiptAmount' ~ '^[0-9]+$' THEN (payer.state->>'receiptAmount')::numeric END=p.amount
      AND payer.state->>'transferFingerprint' ~ '^[A-F0-9]{64}$' AND nullif(btrim(payer.state->>'payerLabel'),'') IS NOT NULL
      AND proof.state->>'classification'='ExcessReceiptRefundV1' AND proof.state->>'externalPayerAttestationId'=r.external_payer_attestation_id::text
      AND r.executed_at IS NOT NULL AND proof.state->'upload'->>'objectKey'=r.execution_evidence_key
      AND proof.state->'upload'->>'externalReference'=r.external_refund_reference AND proof.state->'upload'->>'sha256' ~ '^[A-F0-9]{64}$'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(proof.state->'events')='array' THEN proof.state->'events' ELSE '[]'::jsonb END) event WHERE event->>'action'='Completed')
      AND NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id AND a.paid_by_user_id IS NOT NULL)
      AND (EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
        WHERE h->>'recordType'='ReceiptExcessDispositionV1' AND h->'state'->>'id'=proof.state->>'receiptExcessDispositionId'
          AND h->'state'->>'externalPayerAttestationId'=r.external_payer_attestation_id::text AND h->'state'->>'payerResidentId' IS NULL))
      AND p.amount>=(SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a WHERE a.source_payment_id=p.id)
        +(SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_payment_id=p.id AND rr.status='COMPLETED'))
$fn$;

COMMIT;

-- No rewrite of existing receipts/allocations. New writes respect the agreed deposit budget.
CREATE FUNCTION bhome24_deposit_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE old_records jsonb; records jsonb; record jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(h),'[]'::jsonb) INTO records FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1';
  IF TG_OP='UPDATE' THEN
    SELECT COALESCE(jsonb_agg(h),'[]'::jsonb) INTO old_records FROM jsonb_array_elements(OLD.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1';
    IF old_records<>'[]'::jsonb AND old_records IS DISTINCT FROM records THEN RAISE EXCEPTION 'Deposit payer snapshot is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF jsonb_array_length(records)>1 THEN RAISE EXCEPTION 'Only one deposit allocation per receipt' USING ERRCODE='23514'; END IF;
  IF records='[]'::jsonb THEN RETURN NEW; END IF;
  record:=records->0->'state';
  IF record->>'payerResidentId' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1') THEN
    RAISE EXCEPTION 'Resident depositor cannot be relabeled as an external payer' USING ERRCODE='23514';
  END IF;
  IF old_records=records THEN RETURN NEW; END IF;
  IF NEW.status<>'VERIFIED' OR record->>'transferId' IS DISTINCT FROM NEW.id::text OR
    record->>'normalizedBankReference' IS DISTINCT FROM upper(btrim(NEW.transaction_reference)) OR
    COALESCE(record->>'receiptAmount','') !~ '^[0-9]+$' OR COALESCE(record->>'allocatedAmount','') !~ '^[0-9]+$' OR
    COALESCE(record->>'transferFingerprint','') !~ '^[A-F0-9]{64}$' OR
    (record->>'receiptAmount')::numeric<>NEW.amount OR (record->>'allocatedAmount')::numeric<=0 OR (record->>'allocatedAmount')::numeric>NEW.amount OR
    (record->>'payerResidentId' IS NULL)=(record->>'externalPayerAttestationId' IS NULL) OR
    NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=record->>'verifiedByUserId' AND u.is_active AND 'Owner'=ANY(u.roles)) THEN
    RAISE EXCEPTION 'Deposit receipt requires a verified source and explicit payer' USING ERRCODE='23514';
  END IF;
  IF record->>'payerResidentId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM residents r JOIN contract_residents cr ON cr.resident_id=r.id
    WHERE r.id::text=record->>'payerResidentId' AND cr.contract_id::text=record->>'contractId' AND r.verification_status=1
      AND r.user_id::text IS NOT DISTINCT FROM record->>'payerUserId') THEN
    RAISE EXCEPTION 'Deposit payer must be a verified contract Resident' USING ERRCODE='23514';
  END IF;
  IF record->>'externalPayerAttestationId' IS NOT NULL AND (record->>'payerUserId' IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(NEW.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1' AND h->'state'->>'id'=record->>'externalPayerAttestationId')) THEN
    RAISE EXCEPTION 'Deposit external payer must match its attestation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER payment_deposit_receipt_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bhome24_deposit_receipt_guard();

CREATE FUNCTION bhome24_deposit_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE required numeric; received numeric; receipt_amount numeric; record jsonb;
BEGIN
  IF NEW.target_deposit_contract_id IS NULL OR NEW.amount<=0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT deposit_required INTO required FROM contracts WHERE id=NEW.target_deposit_contract_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO received FROM payment_allocations WHERE target_deposit_contract_id=NEW.target_deposit_contract_id;
  IF NEW.amount>required-received THEN RAISE EXCEPTION 'Deposit allocation exceeds agreed remaining funds' USING ERRCODE='23514'; END IF;
  IF NEW.source_payment_id IS NOT NULL THEN
    SELECT amount INTO receipt_amount FROM payments WHERE id=NEW.source_payment_id;
    IF NEW.amount<>LEAST(receipt_amount,required-received) THEN RAISE EXCEPTION 'Deposit receipt allocation must preserve its excess' USING ERRCODE='23514'; END IF;
    SELECT h->'state' INTO record FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
      WHERE p.id=NEW.source_payment_id AND h->>'recordType'='DepositReceiptAllocationV1';
    IF record IS NOT NULL AND (record->>'allocationId' IS DISTINCT FROM NEW.id::text OR record->>'contractId' IS DISTINCT FROM NEW.target_deposit_contract_id::text OR
      (record->>'allocatedAmount')::numeric<>NEW.amount OR record->>'payerUserId' IS DISTINCT FROM NEW.paid_by_user_id::text OR record->>'verifiedByUserId' IS DISTINCT FROM NEW.created_by_user_id::text) THEN
      RAISE EXCEPTION 'Deposit allocation must match immutable payer snapshot' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER allocation_deposit_budget_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bhome24_deposit_allocation_guard();

CREATE FUNCTION bhome24_deposit_receipt_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE payer jsonb; receipt_amount numeric; allocated numeric; reserved numeric;
BEGIN
  IF NEW.source_payment_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0));
  SELECT h->'state',p.amount INTO payer,receipt_amount FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
    WHERE p.id=NEW.source_payment_id AND h->>'recordType'='DepositReceiptAllocationV1' AND h->'state'->>'payerResidentId' IS NOT NULL;
  IF payer IS NULL THEN RETURN NEW; END IF;
  IF NEW.beneficiary_kind<>'RESIDENT' OR NEW.beneficiary_resident_id::text IS DISTINCT FROM payer->>'payerResidentId' OR NEW.source_deposit_contract_id IS NOT NULL THEN
    RAISE EXCEPTION 'Deposit receipt excess must return to the actual Resident payer' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('REQUESTED','APPROVED','COMPLETED') THEN
    SELECT COALESCE(sum(amount),0) INTO allocated FROM payment_allocations WHERE source_payment_id=NEW.source_payment_id;
    SELECT COALESCE(sum(requested_amount),0) INTO reserved FROM refund_requests WHERE source_payment_id=NEW.source_payment_id AND id<>NEW.id AND status IN ('REQUESTED','APPROVED','COMPLETED');
    IF allocated<=0 OR reserved+NEW.requested_amount>receipt_amount-allocated THEN RAISE EXCEPTION 'Deposit receipt refund exceeds its remaining excess' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER refund_deposit_receipt_guard BEFORE INSERT OR UPDATE ON refund_requests FOR EACH ROW EXECUTE FUNCTION bhome24_deposit_receipt_refund_guard();

CREATE FUNCTION bhome24_deposit_refund_valid(refund_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS(SELECT 1 FROM refund_requests r JOIN payments p ON p.id=r.source_payment_id
    JOIN payment_allocations a ON a.source_payment_id=p.id AND a.target_deposit_contract_id IS NOT NULL
    JOIN residents person ON person.id=r.beneficiary_resident_id
    LEFT JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1') payer ON true
    CROSS JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
      WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1) proof
    WHERE r.id=refund_id AND r.status='COMPLETED' AND r.beneficiary_kind='RESIDENT' AND r.source_deposit_contract_id IS NULL AND p.status='VERIFIED'
      AND (payer.state->>'payerResidentId'=person.id::text AND payer.state->>'allocationId'=a.id::text
        AND payer.state->>'contractId'=a.target_deposit_contract_id::text AND (payer.state->>'allocatedAmount')::numeric=a.amount
        OR payer.state IS NULL AND a.paid_by_user_id=person.user_id)
      AND proof.state->>'classification'='ExcessReceiptRefundV1' AND r.executed_at IS NOT NULL
      AND proof.state->'upload'->>'objectKey'=r.execution_evidence_key AND proof.state->'upload'->>'externalReference'=r.external_refund_reference
      AND proof.state->'upload'->>'sha256' ~ '^[A-F0-9]{64}$'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(proof.state->'events')='array' THEN proof.state->'events' ELSE '[]'::jsonb END) e WHERE e->>'action'='Completed')
      AND p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id)
        >=(SELECT COALESCE(sum(rr.requested_amount),0) FROM refund_requests rr WHERE rr.source_payment_id=p.id AND rr.status='COMPLETED'))
$fn$;

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
