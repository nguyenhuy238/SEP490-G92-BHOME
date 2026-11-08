using Microsoft.AspNetCore.Identity;

namespace BHome.Infrastructure.Persistence.Compact24;

internal static class Compact24Records
{
    private static readonly IReadOnlyDictionary<string, CompactRecordSql> Records = Build();
    internal static CompactRecordSql For(Type type) => Records.TryGetValue(type.Name, out var value)
        ? value : throw new InvalidOperationException("Unmapped Compact24 domain record: " + type.Name);

    private static IReadOnlyDictionary<string, CompactRecordSql> Build()
    {
        var records = new Dictionary<string, CompactRecordSql>(StringComparer.Ordinal);
        CompactRecordSql Add(string name, string table, CompactRecordKind kind = CompactRecordKind.Root)
        {
            var spec = new CompactRecordSql(name, table, kind); records.Add(name, spec); return spec;
        }
        void Fields(CompactRecordSql spec, string mapping)
        {
            foreach (var pair in mapping.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = pair.Split(':'); spec.Map(parts[0], parts[1]);
            }
        }
        CompactRecordSql Root(string name, string table, string mapping)
        { var s = Add(name, table); s.Map("Id", "id"); Fields(s, mapping); return s; }
        CompactRecordSql Array(string name, string table, string container, string parent)
        { var s = Add(name, table, CompactRecordKind.Array); s.Container = container; s.Parent = parent; return s; }
        CompactRecordSql History(string name, string table, string parent, string container = "history")
        {
            var s = Add(name, table, CompactRecordKind.History); s.Parent = parent; s.Container = container;
            s.Where = "COALESCE(s.deleted,'false')<>'true'"; return s;
        }
        CompactRecordSql Object(string name, string table, string container, string? path, string parent)
        {
            var s = Add(name, table, CompactRecordKind.Object); s.Container = container; s.Path = path; s.Parent = parent;
            s.Where = $"t.{container}" + (path is null ? "" : "->'" + path + "'") + " IS NOT NULL"; return s;
        }
        CompactRecordSql Technical(string name, bool command = false)
        {
            var s = Add(name, "operational_tasks", CompactRecordKind.Technical);
            s.Where = $"t.task_type='{(command ? "COMMAND" : "SYSTEM_JOB")}' AND t.task_data->>'recordType'='{name}' AND COALESCE(t.task_data->>'deleted','false')<>'true'";
            return s;
        }
        CompactRecordSql Notification(string name, string kind = "OUTBOX")
        {
            var s = Add(name, "notifications", CompactRecordKind.Notification);
            s.Where = $"t.record_kind='{kind}' AND t.event_data->>'recordType'='{name}'"; return s;
        }

        Object("Chain", "users", "business_profile", "chain", "Id");
        var location = Root("Location", "locations", "Name:name Address:address IsActive:is_active Version:version");
        location.Read["ContractSettings"] = "COALESCE(t.operating_settings->'contractSettings','[]'::jsonb)";
        // Historical import only: no RoomType column, API or operational dependency.
        Array("RoomType", "locations", "operating_settings", "LocationId").Path = "legacyRoomTypes";
        var assignment = Array("StaffLocationAssignment", "locations", "staff_assignments", "LocationId");
        assignment.Read["LocationId"] = "t.id";
        assignment.Read["CreatedByUserId"] = "COALESCE(e.data->>'createdByUserId',e.data->>'actorId')::uuid";
        assignment.Read["CreatedAt"] = "COALESCE(e.data->>'createdAt',e.data->>'recordedAt')::timestamptz";
        assignment.Read["UpdatedAt"] = "COALESCE(e.data->>'updatedAt',e.data->>'recordedAt')::timestamptz";
        Root("Room", "rooms", "LocationId:location_id RoomNumber:room_number Floor:floor Capacity:capacity Status:status Version:version");
        Root("Asset", "assets", "LocationId:location_id RoomId:room_id CommonArea:common_area Code:asset_code Name:name Category:category Condition:condition Status:status Version:version");
        Root("Resident", "residents", "TenantUserId:user_id RoomId:current_room_id OwnerUserId:identity_owner_scope_id DisplayLabel:display_label IdentityHmac:identity_hmac HmacKeyVersion:hmac_key_version VerificationStatus:verification_status ConfirmedByUserId:verified_by_user_id ConfirmedAt:verified_at")
            .Map("IdentityData", "identity_data", write: "COALESCE((@state::jsonb->>'identityData')::jsonb,'{}'::jsonb)");
        var policy = Root("BillingPolicy", "billing_policies", "LocationId:location_id RoomId:room_id ChargeCode:charge_code Category:category Rate:rate EffectiveFrom:effective_from EffectiveTo:effective_to FirstUsedAt:first_used_at Version:version");
        policy.Map("Method", "calculation_method", "CASE t.calculation_method WHEN 'METERED' THEN 1 ELSE 0 END", "CASE WHEN (@state::jsonb->>'method')::int=1 THEN 'METERED' ELSE 'FIXED_PER_ROOM_PER_MONTH' END");
        var contract = Root("Contract", "contracts", "RoomId:room_id RepresentativeResidentId:representative_resident_id TenantUserId:tenant_user_id OwnerSignerId:owner_signer_id PreviousContractId:previous_contract_id HoldingContractId:source_holding_contract_id HoldingExpiryAt:holding_expiry_at ReservedCapacity:reserved_capacity StartDate:start_date EndDate:end_date MonthlyRent:monthly_rent RequiredDeposit:deposit_required AppliedHoldingDeposit:applied_holding_deposit Terms:terms SnapshotHash:snapshot_hash Status:status ActivatedAt:activated_at ActivatedByUserId:activated_by_user_id ActualEndDate:actual_end_date DraftVersion:version");
        contract.Where = "t.contract_type IN ('MAIN','RENEWAL','HOLDING')";
        contract.Map("Kind", "contract_type", "CASE t.contract_type WHEN 'RENEWAL' THEN 1 WHEN 'HOLDING' THEN 2 ELSE 0 END", "CASE (@state::jsonb->>'kind')::int WHEN 1 THEN 'RENEWAL' WHEN 2 THEN 'HOLDING' ELSE 'MAIN' END");
        contract.Map("DraftMetadata", "draft_metadata", write: "(@state::jsonb->>'draftMetadata')::jsonb");
        var signing = Root("ContractSignature", "contract_signings", "ContractId:contract_id SignerUserId:signer_user_id CertificateId:certificate_id ProviderReference:provider_reference Status:signing_status SnapshotHash:snapshot_hash SourceHash:source_hash PreparedHash:prepared_hash PreparedObjectKey:prepared_object_key SignedObjectKey:signed_object_key SignedHash:signed_hash CreatedAt:requested_at ExpiresAt:expires_at SignedAt:signed_at");
        signing.Write["provider_code"] = "COALESCE((SELECT e->>'provider' FROM users u CROSS JOIN LATERAL jsonb_array_elements(u.signing_credentials) e WHERE u.id=(@state::jsonb->>'signerUserId')::uuid AND e->>'id'=@state::jsonb->>'certificateId'),'EVIDENCE_WITHOUT_DIRECTORY')";
        signing.Write["certificate_snapshot"] = "COALESCE((SELECT e FROM users u CROSS JOIN LATERAL jsonb_array_elements(u.signing_credentials) e WHERE u.id=(@state::jsonb->>'signerUserId')::uuid AND e->>'id'=@state::jsonb->>'certificateId'),jsonb_build_object('id',@state::jsonb->'certificateId','unresolvedDirectoryReference',true,'certificateChain',@state::jsonb->'certificateChain','providerUserId',@state::jsonb->'providerUserId','credentialId',@state::jsonb->'credentialId'))";
        signing.CustomFrom = "contract_signings t"; signing.CustomState = "t.signing_data->'compactState'";
        signing.Write["signing_data"] = "jsonb_build_object('schemaVersion',1,'compactState',@state::jsonb)";
        var occupants = Add("ContractResident", "contract_residents");
        Fields(occupants, "ContractId:contract_id ResidentId:resident_id Role:resident_role ResidenceFrom:residence_from ResidenceTo:residence_to");
        Array("SigningCertificate", "users", "signing_credentials", "OwnerUserId");
        Array("ContractDocumentFile", "contracts", "documents", "ContractId");
        Object("ContractHandover", "contracts", "handover", "current", "ContractId");
        Object("ContractMoveOut", "contracts", "move_out", "current", "ContractId");
        foreach (var name in new[] { "ContractHandoverHistory", "ContractMoveOutHistory" }) History(name, "contracts", "ContractId").AppendOnly = true;
        Array("ContractFinalInspection", "contracts", "move_out", "ContractId").Path = "inspections";
        Array("ContractInspectionEvidence", "contracts", "move_out", "ContractId").Path = "evidence";
        Array("ContractSettlementReview", "contracts", "settlement", "ContractId").Path = "reviews";
        Technical("ContractFileUpload"); Technical("ContractOperation", true);
        Notification("ContractExpiryNotice");

        var task = Root("OperationalTask", "operational_tasks", "LocationId:location_id MeterId:meter_id ContractId:contract_id AssignedStaffUserId:assigned_user_id BillingPeriod:billing_period Title:title Requirements:description AssignedAt:assigned_at DueAt:due_at VerifiedByUserId:verified_by_user_id VerifiedAt:verified_at Version:version");
        task.Where = "t.task_type IN ('METER_READ','GENERAL')";
        task.Map("Kind", "task_type", "CASE t.task_type WHEN 'GENERAL' THEN 1 ELSE 0 END", "CASE WHEN (@state::jsonb->>'kind')::int=1 THEN 'GENERAL' ELSE 'METER_READ' END");
        task.Map("Status", "status", "t.status::integer"); task.Map("Priority", "priority", "t.priority::integer");
        task.Write["task_data"] = "jsonb_build_object('schemaVersion',1,'recordType','OperationalTask','state',@state::jsonb)";
        task.Write["room_id"] = "(SELECT room_id FROM meters WHERE id=(@state::jsonb->>'meterId')::uuid)";
        task.Write["source_key"] = "CASE WHEN @state::jsonb->>'kind'='0' AND @state::jsonb->>'status'<>'3' THEN CASE @state::jsonb->>'purpose' WHEN '0' THEN 'meter-initial:'||(@state::jsonb->>'meterId') WHEN '1' THEN 'meter-period:'||(@state::jsonb->>'billingRoomId')||':'||(@state::jsonb->>'billingUtilityType')||':'||(@state::jsonb->>'billingPeriod') WHEN '2' THEN 'meter-final:'||(@state::jsonb->>'meterId')||':'||(@state::jsonb->>'contractId') END END";
        task.CustomFrom = "operational_tasks t"; task.CustomState = "t.task_data->'state'";
        foreach (var name in new[] { "OperationalTaskEvidence", "MeterEvidence" })
            Array(name, "operational_tasks", "evidence", "TaskId").Where = $"e.data->>'recordType'='{name}'";
        History("OperationalTaskHistory", "operational_tasks", "TaskId").AppendOnly = true;
        Technical("OperationalTaskCommand", true).AppendOnly = true;
        Technical("OperationalTaskFileUpload");
        var taskNotice = Notification("OperationalTaskNotification");
        taskNotice.Read["ReadAt"] = "t.read_at";
        taskNotice.CustomFrom = "notifications t LEFT JOIN LATERAL (SELECT h->'state' AS data FROM jsonb_array_elements(t.delivery_history) WITH ORDINALITY a(h,n) WHERE h->>'recordType'='OperationalTaskNotification' ORDER BY n DESC LIMIT 1) s ON TRUE";
        taskNotice.CustomState = "COALESCE(s.data,t.event_data->'state')";
        Root("Meter", "meters", "RoomId:room_id Code:meter_code UtilityType:utility_type Display:display_type DecimalPlaces:decimal_places InstalledOn:installed_on IsActive:is_active");
        var reading = Root("MeterReading", "meter_readings", "MeterId:meter_id TaskId:operational_task_id PreviousValue:previous_value OcrProposedValue:ocr_proposed_value ConfirmedValue:confirmed_value Consumption:consumption ConfirmedByUserId:confirmed_by_user_id ConfirmedAt:confirmed_at Status:status");
        reading.Write["reading_purpose"] = "(SELECT (task_data->'state'->>'purpose')::int FROM operational_tasks WHERE id=(@state::jsonb->>'taskId')::uuid)";
        reading.Write["billing_period"] = "(SELECT billing_period FROM operational_tasks WHERE id=(@state::jsonb->>'taskId')::uuid)";
        reading.Write["reading_at"] = "(SELECT (task_data->'state'->>'readingDate')::date::timestamptz FROM operational_tasks WHERE id=(@state::jsonb->>'taskId')::uuid)";
        reading.Write["evidence"] = "(SELECT e FROM operational_tasks t CROSS JOIN LATERAL jsonb_array_elements(t.evidence) e WHERE t.id=(@state::jsonb->>'taskId')::uuid AND e->>'id'=@state::jsonb->>'evidenceId')";

        Object("BillingSchedule", "locations", "operating_settings", "billingSchedule", "LocationId");
        var plan = Array("BillingAutomationPlan", "locations", "operating_settings", "LocationId");
        plan.Path = "automationPlanVersions"; plan.AppendOnly = true;
        Array("ReceivingBankAccount", "locations", "operating_settings", "LocationId").Path = "receivingBankAccounts";
        History("BillingRepresentativeSelection", "rooms", "RoomId", "billing_representatives").AppendOnly = true;
        Technical("BillingAutomationExecution"); History("BillingAutomationAttempt", "operational_tasks", "ExecutionId").AppendOnly = true;
        var invoice = Root("Invoice", "invoices", "LocationId:location_id RoomId:room_id RepresentativeContractId:contract_id RepresentativeTenantUserId:representative_tenant_user_id BillingPeriod:billing_period Total:base_total_amount Status:status ScheduledFinalDate:scheduled_final_date DueDate:due_date FinalizedAt:finalized_at FinalizedByUserId:finalized_by_user_id Version:version");
        invoice.Map("MissingInputs", "missing_inputs", write: "@state::jsonb->'missingInputs'");
        invoice.Write["billing_snapshot"] = "jsonb_build_object('schemaVersion',1,'compactState',@state::jsonb)";
        invoice.CustomFrom = "invoices t"; invoice.CustomState = "t.billing_snapshot->'compactState'";
        var line = Root("InvoiceLine", "invoice_items", "InvoiceId:invoice_id ChargeCode:charge_code Name:description PolicyId:billing_policy_id MeterReadingId:meter_reading_id Quantity:quantity Rate:unit_price Amount:amount");
        line.CustomFrom = "invoice_items t"; line.CustomState = "t.calculation_snapshot->'compactState'";
        line.Write["calculation_snapshot"] = "jsonb_build_object('schemaVersion',1,'compactState',@state::jsonb)";
        var recipients = Add("InvoiceRecipient", "invoices", CompactRecordKind.Computed);
        recipients.CustomFrom = "invoices t CROSS JOIN LATERAL unnest(t.recipient_user_ids) r(user_id)";
        recipients.Read["InvoiceId"] = "t.id"; recipients.Read["TenantUserId"] = "r.user_id";
        var request = Root("InvoiceAdjustmentRequest", "invoice_adjustments", "InvoiceId:invoice_id RequesterId:requested_by_user_id SubmittedAt:requested_at Reason:reason");
        request.CustomFrom = "invoice_adjustments t"; request.CustomState = "t.request_snapshot->'compactState'";
        request.Write["request_snapshot"] = "jsonb_build_object('schemaVersion',1,'compactState',@state::jsonb)";
        request.Write["proposed_changes"] = "jsonb_build_object('chargeCode',@state::jsonb->'chargeCode','proposedAmount',@state::jsonb->'proposedAmount')";
        request.Write["status"] = "'REQUESTED'";
        Object("InvoiceAdjustmentDecision", "invoice_adjustments", "decision_snapshot", null, "RequestId").AppendOnly = true;
        // Unlinked uploads cannot belong to a request yet. Keep their durable cleanup intent as a technical job.
        Technical("InvoiceAdjustmentEvidence"); Technical("InvoiceAdjustmentCommand", true).AppendOnly = true;
        Notification("InvoiceAdjustmentEvent"); Notification("InvoiceIssuedEvent");

        var payment = Root("PaymentTransfer", "payments", "ProviderIdentity:provider_code BankReference:transaction_reference OccurredAt:received_at Amount:amount Currency:currency TransferDescription:remittance_info VerifiedByUserId:verified_by_user_id VerifiedAt:verified_at");
        payment.CustomFrom = "payments t"; payment.CustomState = "t.verification_data->'compactState'";
        payment.Where = "t.verification_data ? 'compactState'";
        payment.Write["receiving_account_key"] = "'legacy-unscoped'";
        payment.Write["status"] = "'VERIFIED'"; payment.Write["verification_method"] = "'MANUAL'";
        payment.Write["effect_key"] = "'receipt:'||(@state::jsonb->>'providerIdentity')||':'||(@state::jsonb->>'normalizedReference')";
        payment.Write["verification_data"] = "jsonb_build_object('schemaVersion',1,'compactState',@state::jsonb)";
        History("PaymentReconciliation", "payments", "TransferId").AppendOnly = true;
        History("BankReferenceClaim", "payments", "AllocationId").AppendOnly = true;
        var allocation = Root("PaymentAllocation", "payment_allocations", "TransferId:source_payment_id SourceDepositContractId:source_deposit_contract_id InvoiceId:target_invoice_id TargetDepositContractId:target_deposit_contract_id Amount:amount PaidByUserId:paid_by_user_id VerifiedByUserId:created_by_user_id AllocatedAt:allocated_at");
        allocation.CustomFrom = "payment_allocations t LEFT JOIN payments p ON p.id=t.source_payment_id LEFT JOIN LATERAL (SELECT h->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY a(h,n) WHERE h->>'recordType'='PaymentAllocation' AND h->>'recordKey'=t.id::text ORDER BY n DESC LIMIT 1) s ON TRUE";
        allocation.CustomState = "s.data";
        // Include verified bank receipts allocated to a deposit as well as invoice payments
        // and Holding-to-Main transfers; otherwise the Holding ledger cannot see received money.
        allocation.Where = "(t.target_invoice_id IS NOT NULL AND t.source_payment_id IS NOT NULL) OR (t.target_deposit_contract_id IS NOT NULL AND (t.source_payment_id IS NOT NULL OR t.source_deposit_contract_id IS NOT NULL))";
        allocation.Read["CreatedAt"] = "COALESCE((s.data->>'createdAt')::timestamptz,t.allocated_at)";
        allocation.Read["UpdatedAt"] = "COALESCE((s.data->>'updatedAt')::timestamptz,t.allocated_at)";
        allocation.Write["operation_key"] = "@state::jsonb->>'id'"; allocation.Write["line_number"] = "1";
        allocation.Write["reason"] = "CASE WHEN @state::jsonb->>'sourceDepositContractId' IS NOT NULL THEN 'Applied verified Holding Deposit to Main Contract' ELSE 'Verified invoice bank receipt' END"; allocation.AppendOnly = true;
        // Deposit receipts use a canonical payment plus an allocation, preserving the original receipt UUID.
        History("DepositVerification", "payments", "Id").AppendOnly = true;
        Technical("PaymentCommand", true).AppendOnly = true; Notification("PaymentConfirmedEvent");

        // Incident aggregates reuse the native report/task/expense tables. Child records
        // retain typed histories; no legacy incident tables are created.
        var incident = Root("IncidentReport", "incident_reports", "LocationId:location_id RoomId:room_id AssetId:asset_id ReporterId:reporter_user_id Description:description DuplicateOfId:duplicate_of_report_id ResolvedAt:resolved_at Version:version");
        incident.Map("Severity", "severity", "CASE t.severity WHEN 'EMERGENCY' THEN 1 ELSE 0 END", "CASE WHEN (@state::jsonb->>'severity')::int=1 THEN 'EMERGENCY' ELSE 'NORMAL' END");
        incident.Map("Status", "status", "CASE t.status WHEN 'Submitted' THEN 0 WHEN 'InProgress' THEN 1 WHEN 'Resolved' THEN 2 WHEN 'Rejected' THEN 3 WHEN 'Duplicate' THEN 4 WHEN 'Cancelled' THEN 5 END",
            "(ARRAY['Submitted','InProgress','Resolved','Rejected','Duplicate','Cancelled'])[(@state::jsonb->>'status')::int+1]");
        incident.Write["summary"] = "left(@state::jsonb->>'description',250)";
        incident.Map("CreatedAt", "reported_at");
        incident.Write["owner_decision"] = "jsonb_build_object('type',@state::jsonb->'type','category',@state::jsonb->'category','decidedAt',@state::jsonb->'ownerDecisionAt','resolutionNote',@state::jsonb->'resolutionNote')";
        var workOrder = Root("MaintenanceWorkOrder", "operational_tasks", "IncidentId:incident_report_id LocationId:location_id RoomId:room_id AssetId:asset_id AssignedStaffId:assigned_user_id TargetCompletionAt:due_at EstimatedCost:estimated_cost ApprovedById:cost_approved_by_user_id ApprovedAt:cost_approved_at VerifiedById:verified_by_user_id VerifiedAt:verified_at Version:version");
        workOrder.Where = "t.task_type='WORK_ORDER'";
        workOrder.CustomFrom = "operational_tasks t"; workOrder.CustomState = "t.task_data->'state'";
        workOrder.Map("Status", "status", "CASE t.status WHEN 'Assigned' THEN 0 WHEN 'PendingApproval' THEN 1 WHEN 'InProgress' THEN 2 WHEN 'PendingVerification' THEN 3 WHEN 'Verified' THEN 4 WHEN 'Cancelled' THEN 5 END",
            "(ARRAY['Assigned','PendingApproval','InProgress','PendingVerification','Verified','Cancelled'])[(@state::jsonb->>'status')::int+1]");
        workOrder.Write["task_type"] = "'WORK_ORDER'";
        workOrder.Write["assigned_at"] = "(@state::jsonb->>'createdAt')::timestamptz";
        workOrder.Write["task_data"] = "jsonb_build_object('schemaVersion',1,'recordType','MaintenanceWorkOrder','state',@state::jsonb)";
        workOrder.Write["approved_cost"] = "CASE WHEN @state::jsonb->>'approvedAt' IS NOT NULL THEN (@state::jsonb->>'estimatedCost')::numeric END";
        History("IncidentActivity", "incident_reports", "IncidentId").AppendOnly = true;
        History("IncidentEvidence", "incident_reports", "IncidentId");
        History("EmergencyAction", "incident_reports", "IncidentId");
        History("MaintenanceHistory", "incident_reports", "IncidentId").AppendOnly = true;
        Technical("IncidentCommand", true).AppendOnly = true;
        Technical("IncidentFileUpload");
        var incidentNotice = Notification("IncidentNotification");
        incidentNotice.Read["ReadAt"] = "t.read_at";
        incidentNotice.CustomFrom = "notifications t LEFT JOIN LATERAL (SELECT h->'state' AS data FROM jsonb_array_elements(t.delivery_history) WITH ORDINALITY a(h,n) WHERE h->>'recordType'='IncidentNotification' ORDER BY n DESC LIMIT 1) s ON TRUE";
        incidentNotice.CustomState = "COALESCE(s.data,t.event_data->'state')";
        var expense = Root("MaintenanceExpense", "expenses", "IncidentId:incident_report_id LocationId:location_id RoomId:room_id AssetId:asset_id WorkOrderId:task_id Category:category Amount:amount ExpenseDate:occurred_on ConfirmedById:recorded_by_user_id");
        expense.Where = "t.expense_type='OPERATING' AND t.category='Maintenance'";
        expense.Write["expense_type"] = "'OPERATING'";
        expense.Write["note"] = "'Owner-confirmed maintenance expense'";
        expense.Write["source_key"] = "(@state::jsonb->>'sourceType')||':'||(@state::jsonb->>'sourceId')";
        expense.AppendOnly = true;

        Notification("PropertyChange", "AUDIT").AppendOnly = true;
        var audit = Notification("SecurityAuditRecord", "AUDIT"); audit.AppendOnly = true;
        Fields(audit, "Id:id UserId:actor_user_id Event:notification_type TargetType:related_entity_type TargetId:related_entity_id OccurredAt:event_at");
        audit.Where = "t.record_kind='AUDIT' AND (t.event_data->>'recordType'='SecurityAuditRecord' OR t.event_key LIKE 'auth:%' OR t.event_key LIKE 'migration:audit:%')";
        audit.Read["UserId"] = "COALESCE((t.event_data->'state'->>'userId')::uuid,t.actor_user_id)";
        audit.Read["TargetType"] = "CASE WHEN t.event_data->'state' ? 'targetType' THEN t.event_data->'state'->>'targetType' ELSE t.related_entity_type END";
        audit.Read["TargetId"] = "CASE WHEN t.event_data->'state' ? 'targetId' THEN (t.event_data->'state'->>'targetId')::uuid ELSE t.related_entity_id END";
        audit.Read["Succeeded"] = "COALESCE((t.event_data->'state'->>'succeeded')::boolean,(t.event_data->>'succeeded')::boolean,TRUE)";
        var inbox = Notification("UserNotification", "INBOX");
        Fields(inbox, "Id:id RecipientUserId:recipient_user_id LocationId:location_id EventKey:event_key Title:title Summary:message RelatedObjectType:related_entity_type RelatedObjectId:related_entity_id CreatedAt:event_at ReadAt:read_at DeliveryState:delivery_status NextDeliveryAt:next_delivery_at DeliveryLockedUntil:locked_until DeliveryLeaseToken:lease_token");
        inbox.Read["AudienceRole"] = "t.event_data->>'audienceRole'";
        inbox.Read["Category"] = "t.event_data->>'category'";
        inbox.CustomFrom = "notifications t LEFT JOIN LATERAL (SELECT h->'state' AS data FROM jsonb_array_elements(t.delivery_history) WITH ORDINALITY a(h,n) WHERE h->>'recordType'='UserNotification' ORDER BY n DESC LIMIT 1) s ON TRUE";
        inbox.CustomState = "COALESCE(s.data,t.event_data->'state')";
        inbox.Where = "t.record_kind='INBOX'";
        History("NotificationDeliveryAttempt", "notifications", "NotificationId", "delivery_history").AppendOnly = true;
        Notification("NotificationPublication");
        var job = Technical("BackgroundJobRecord");
        job.Where = "t.task_type='SYSTEM_JOB' AND t.task_data ? 'name'";
        Fields(job, "Id:id State:status Attempts:attempt_count AvailableAt:next_run_at LockedUntil:locked_until LockToken:lease_token");
        job.Read["Name"] = "t.task_data->>'name'"; job.Read["IdempotencyKey"] = "t.task_data->>'idempotencyKey'";
        job.Read["PayloadJson"] = "t.task_data->'payload'"; job.Read["LastErrorCode"] = "t.task_data->>'lastErrorCode'";

        var role = Add(typeof(IdentityRole<Guid>).Name, "users", CompactRecordKind.Computed);
        const string catalog = "COALESCE((SELECT business_profile->'identityRoles' FROM users WHERE 'Owner'=ANY(roles)),jsonb_build_array(jsonb_build_object('id','00000000-0000-0000-0000-000000000001','name','Owner','normalizedName','OWNER'),jsonb_build_object('id','00000000-0000-0000-0000-000000000002','name','Staff','normalizedName','STAFF'),jsonb_build_object('id','00000000-0000-0000-0000-000000000003','name','Tenant','normalizedName','TENANT')))";
        role.CustomFrom = "jsonb_to_recordset(" + catalog + ") r(id uuid,name text,\"normalizedName\" text,\"concurrencyStamp\" text)";
        role.Read["Id"] = "r.id"; role.Read["Name"] = "r.name"; role.Read["NormalizedName"] = "r.\"normalizedName\"";
        role.Read["ConcurrencyStamp"] = "r.\"concurrencyStamp\"";
        var grant = Add(typeof(IdentityUserRole<Guid>).Name, "users", CompactRecordKind.Computed);
        grant.CustomFrom = "users t CROSS JOIN LATERAL unnest(t.roles) r(name)";
        grant.Read["UserId"] = "t.id";
        grant.Read["RoleId"] = "(SELECT (item->>'id')::uuid FROM jsonb_array_elements(" + catalog + ") item WHERE item->>'name'=r.name)";
        return records;
    }
}
