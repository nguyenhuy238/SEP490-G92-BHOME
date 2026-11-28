using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

// Explicit physical model. Historical projections are used only by offline tooling/fixtures.
internal static class Compact24NativeModel
{
    // Identity users and refresh rows have their own write path in Compact24DbContext.
    internal static bool IsNative(Type type) => type == typeof(Native.StaffEmployment) ||
        type == typeof(Native.Expense) ||
        type == typeof(Native.FinancialScenario) ||
        type == typeof(Native.Notification) ||
        type == typeof(Native.RefundRequest) ||
        type == typeof(BHome.Domain.Billing.InvoiceAdjustment) ||
        type == typeof(BHome.Domain.Billing.OperationalTask) ||
        type == typeof(BHome.Domain.IncidentMaintenance.IncidentReport) ||
        type == typeof(BHome.Domain.PaymentsDebt.PaymentAllocation) ||
        type == typeof(BHome.Domain.PaymentsDebt.Payment) ||
        type == typeof(BHome.Domain.TenantContracts.ContractResident) ||
        type == typeof(BHome.Domain.Locations.Location) ||
        type == typeof(BHome.Domain.PropertyManagement.Room) ||
        type == typeof(BHome.Domain.PropertyManagement.Asset) ||
        type == typeof(BHome.Domain.PropertyManagement.BillingPolicy) ||
        type == typeof(BHome.Domain.TenantContracts.Resident) ||
        type == typeof(BHome.Domain.TenantContracts.ContractSigning) ||
        type == typeof(BHome.Domain.TenantContracts.Contract) ||
        type == typeof(BHome.Domain.Billing.Meter) ||
        type == typeof(BHome.Domain.Billing.MeterReading) ||
        type == typeof(BHome.Domain.Billing.Invoice) ||
        type == typeof(BHome.Domain.Billing.InvoiceItem);

    internal static void Configure(ModelBuilder model, bool archive = false)
    {
        model.Entity<Native.StaffEmployment>().ToTable("staff_employments", "public", t => t.ExcludeFromMigrations());
        if (!archive)
        {
            var location = model.Entity<BHome.Domain.Locations.Location>();
            location.ToTable("locations", "public", t => t.ExcludeFromMigrations());
            location.Ignore(x => x.Chain);
            location.Ignore(x => x.ChainId);
            location.Ignore(x => x.ContractSettings);
            location.Ignore(x => x.CreatedAt);
            location.Ignore(x => x.UpdatedAt);
            location.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            location.Property(x => x.Name).HasColumnName("name").HasColumnType("varchar(200)").IsRequired();
            location.Property(x => x.Address).HasColumnName("address").HasColumnType("text").IsRequired();
            location.Property(x => x.IsActive).HasColumnName("is_active").HasColumnType("boolean");
            location.Property(x => x.StaffAssignments).HasColumnName("staff_assignments").HasColumnType("jsonb");
            location.Property(x => x.OperatingSettings).HasColumnName("operating_settings").HasColumnType("jsonb");
            location.Property(x => x.PublicProfile).HasColumnName("public_profile").HasColumnType("jsonb");
            location.Property(x => x.PublishedAt).HasColumnName("published_at").HasColumnType("timestamptz");
            location.Property(x => x.PublishedByUserId).HasColumnName("published_by_user_id").HasColumnType("uuid");
            location.Property(x => x.Version).HasColumnName("version").HasColumnType("integer").IsConcurrencyToken();
            location.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var room = model.Entity<BHome.Domain.PropertyManagement.Room>();
            room.ToTable("rooms", "public", t => t.ExcludeFromMigrations());
            room.Ignore(x => x.Location);
            room.Ignore(x => x.RoomType);
            room.Ignore(x => x.RoomTypeId);
            room.Ignore(x => x.CreatedAt);
            room.Ignore(x => x.UpdatedAt);
            room.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            room.Property(x => x.LocationId).HasColumnName("location_id").HasColumnType("uuid");
            room.Property(x => x.RoomNumber).HasColumnName("room_number").HasColumnType("varchar(50)").IsRequired();
            room.Property(x => x.Floor).HasColumnName("floor").HasColumnType("varchar(30)");
            room.Property(x => x.Capacity).HasConversion<short>().HasColumnName("capacity").HasColumnType("smallint");
            room.Property(x => x.Status).HasConversion<short>().HasColumnName("status").HasColumnType("smallint");
            room.Property(x => x.BillingRepresentatives).HasColumnName("billing_representatives").HasColumnType("jsonb");
            room.Property(x => x.PublicProfile).HasColumnName("public_profile").HasColumnType("jsonb");
            room.Property(x => x.PublishedAt).HasColumnName("published_at").HasColumnType("timestamptz");
            room.Property(x => x.PublishedByUserId).HasColumnName("published_by_user_id").HasColumnType("uuid");
            room.Property(x => x.Version).HasColumnName("version").HasColumnType("integer").IsConcurrencyToken();
            room.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");

            var asset = model.Entity<BHome.Domain.PropertyManagement.Asset>();
            asset.ToTable("assets", "public", t => t.ExcludeFromMigrations());
            asset.Ignore(x => x.CreatedAt);
            asset.Ignore(x => x.UpdatedAt);
            asset.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            asset.Property(x => x.LocationId).HasColumnName("location_id").HasColumnType("uuid");
            asset.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            asset.Property(x => x.CommonArea).HasColumnName("common_area").HasColumnType("varchar(200)");
            asset.Ignore(x => x.Code);
            asset.Property(x => x.AssetCode).HasColumnName("asset_code").HasColumnType("varchar(80)");
            asset.Property(x => x.Name).HasColumnName("name").HasColumnType("varchar(150)").IsRequired();
            asset.Property(x => x.Category).HasColumnName("category").HasColumnType("varchar(80)").IsRequired();
            asset.Property(x => x.Condition).HasColumnName("condition").HasColumnType("text").IsRequired();
            asset.Property(x => x.Status).HasConversion<short>().HasColumnName("status").HasColumnType("smallint");
            asset.Property(x => x.PurchaseInfo).HasColumnName("purchase_info").HasColumnType("jsonb");
            asset.Property(x => x.Version).HasColumnName("version").HasColumnType("integer").IsConcurrencyToken();
            asset.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var resident = model.Entity<BHome.Domain.TenantContracts.Resident>();
            resident.ToTable("residents", "public", t => t.ExcludeFromMigrations());
            resident.Ignore(x => x.Room);
            resident.Ignore(x => x.ResidentType);
            resident.Ignore(x => x.CreatedAt);
            resident.Ignore(x => x.UpdatedAt);
            resident.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            resident.Ignore(x => x.TenantUserId);
            resident.Property(x => x.UserId).HasColumnName("user_id").HasColumnType("uuid");
            resident.Property(x => x.ContactEmail).HasColumnName("contact_email").HasColumnType("varchar(256)");
            resident.Ignore(x => x.RoomId);
            resident.Ignore(x => x.OwnerUserId);
            resident.Property(x => x.CurrentRoomId).HasColumnName("current_room_id").HasColumnType("uuid");
            resident.Property(x => x.IdentityOwnerScopeId).HasColumnName("identity_owner_scope_id").HasColumnType("uuid");
            resident.Property(x => x.DisplayLabel).HasColumnName("display_label").HasColumnType("varchar(150)").IsRequired();
            resident.Property(x => x.IdentityData).HasColumnName("identity_data").HasColumnType("jsonb").IsRequired();
            resident.Property(x => x.IdentityHmac).HasColumnName("identity_hmac").HasColumnType("varchar(64)");
            resident.Property(x => x.HmacKeyVersion).HasColumnName("hmac_key_version").HasColumnType("varchar(32)");
            resident.Property(x => x.VerificationStatus).HasConversion<short>().HasColumnName("verification_status").HasColumnType("smallint");
            resident.Ignore(x => x.ConfirmedByUserId);
            resident.Ignore(x => x.ConfirmedAt);
            resident.Property(x => x.VerifiedByUserId).HasColumnName("verified_by_user_id").HasColumnType("uuid");
            resident.Property(x => x.VerifiedAt).HasColumnName("verified_at").HasColumnType("timestamptz");
            resident.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var contract = model.Entity<BHome.Domain.TenantContracts.Contract>();
            contract.ToTable("contracts", "public", t => t.ExcludeFromMigrations());
            contract.Ignore(x => x.Room);
            contract.Ignore(x => x.Residents);
            contract.Ignore(x => x.Signatures);
            contract.Ignore(x => x.CreatedAt);
            contract.Ignore(x => x.UpdatedAt);
            contract.Ignore(x => x.RentAmount);
            contract.Ignore(x => x.SnapshotHashOrEmpty);
            contract.Ignore(x => x.HoldingAllocationReference);
            contract.Ignore(x => x.ApprovedByUserId);
            contract.Ignore(x => x.ApprovedAt);
            contract.Ignore(x => x.ApprovalReason);
            contract.Ignore(x => x.AgreedPriceSnapshot);
            contract.Ignore(x => x.PriceLockTrigger);
            contract.Ignore(x => x.PriceLockedAt);
            contract.Ignore(x => x.ConvertedMainContractId);
            contract.Ignore(x => x.LifecycleActorId);
            contract.Ignore(x => x.LifecycleAt);
            contract.Ignore(x => x.LifecycleReason);
            contract.Ignore(x => x.IsDevelopmentDemo);
            contract.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            contract.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            contract.Property(x => x.RepresentativeResidentId).HasColumnName("representative_resident_id").HasColumnType("uuid");
            contract.Property(x => x.TenantUserId).HasColumnName("tenant_user_id").HasColumnType("uuid");
            contract.Property(x => x.OwnerSignerId).HasColumnName("owner_signer_id").HasColumnType("uuid");
            contract.Ignore(x => x.Kind);
            contract.Property(x => x.ContractType).HasConversion(
                value => value == BHome.Domain.TenantContracts.ContractKind.Main ? "MAIN" :
                    value == BHome.Domain.TenantContracts.ContractKind.Renewal ? "RENEWAL" :
                    value == BHome.Domain.TenantContracts.ContractKind.Holding ? "HOLDING" :
                    value == BHome.Domain.TenantContracts.ContractKind.Addendum ? "ADDENDUM" : "INVALID",
                value => value == "MAIN" ? BHome.Domain.TenantContracts.ContractKind.Main :
                    value == "RENEWAL" ? BHome.Domain.TenantContracts.ContractKind.Renewal :
                    value == "HOLDING" ? BHome.Domain.TenantContracts.ContractKind.Holding :
                    value == "ADDENDUM" ? BHome.Domain.TenantContracts.ContractKind.Addendum :
                    (BHome.Domain.TenantContracts.ContractKind)(-1)).HasColumnName("contract_type").HasColumnType("varchar(12)");
            contract.Property(x => x.PreviousContractId).HasColumnName("previous_contract_id").HasColumnType("uuid");
            contract.Property(x => x.ParentContractId).HasColumnName("parent_contract_id").HasColumnType("uuid");
            contract.Ignore(x => x.HoldingContractId);
            contract.Property(x => x.SourceHoldingContractId).HasColumnName("source_holding_contract_id").HasColumnType("uuid");
            contract.Property(x => x.StartDate).HasColumnName("start_date").HasColumnType("date");
            contract.Property(x => x.EndDate).HasColumnName("end_date").HasColumnType("date");
            contract.Property(x => x.HoldingExpiryAt).HasColumnName("holding_expiry_at").HasColumnType("timestamptz");
            contract.Property(x => x.MonthlyRent).HasColumnName("monthly_rent").HasColumnType("numeric(18,0)");
            contract.Ignore(x => x.RequiredDeposit);
            contract.Property(x => x.DepositRequired).HasColumnName("deposit_required").HasColumnType("numeric(18,0)");
            contract.Property(x => x.AppliedHoldingDeposit).HasColumnName("applied_holding_deposit").HasColumnType("numeric(18,0)");
            contract.Property(x => x.ReservedCapacity).HasColumnName("reserved_capacity").HasColumnType("smallint");
            contract.Property(x => x.Terms).HasColumnName("terms").HasColumnType("text").IsRequired();
            contract.Property(x => x.SnapshotHash).HasColumnName("snapshot_hash").HasColumnType("varchar(64)");
            contract.Property(x => x.DraftMetadata).HasColumnName("draft_metadata").HasColumnType("jsonb").IsRequired();
            contract.Property(x => x.Documents).HasColumnName("documents").HasColumnType("jsonb");
            contract.Property(x => x.Handover).HasColumnName("handover").HasColumnType("jsonb");
            contract.Property(x => x.MoveOut).HasColumnName("move_out").HasColumnType("jsonb");
            contract.Property(x => x.Settlement).HasColumnName("settlement").HasColumnType("jsonb");
            contract.Property(x => x.Status).HasConversion<short>().HasColumnName("status").HasColumnType("smallint");
            contract.Property(x => x.ActivatedAt).HasColumnName("activated_at").HasColumnType("timestamptz");
            contract.Property(x => x.ActivatedByUserId).HasColumnName("activated_by_user_id").HasColumnType("uuid");
            contract.Property(x => x.ActualEndDate).HasColumnName("actual_end_date").HasColumnType("date");
            contract.Ignore(x => x.DraftVersion);
            contract.Property(x => x.Version).HasColumnName("version").HasColumnType("integer");
            contract.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var signature = model.Entity<BHome.Domain.TenantContracts.ContractSigning>();
            signature.ToTable("contract_signings", "public", t => t.ExcludeFromMigrations());
            signature.Ignore(x => x.UpdatedAt);
            signature.Ignore(x => x.SourceHashOrEmpty);
            signature.Ignore(x => x.PreparedHashOrEmpty);
            signature.Ignore(x => x.PreparedObjectKeyOrEmpty);
            signature.Ignore(x => x.FieldName);
            signature.Ignore(x => x.DocumentDigest);
            signature.Ignore(x => x.DataToSignDigest);
            signature.Ignore(x => x.CertificateChain);
            signature.Ignore(x => x.ProviderUserId);
            signature.Ignore(x => x.CredentialId);
            signature.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            signature.Property(x => x.ContractId).HasColumnName("contract_id").HasColumnType("uuid");
            signature.Property(x => x.SignerUserId).HasColumnName("signer_user_id").HasColumnType("uuid");
            signature.Property(x => x.CertificateId).HasColumnName("certificate_id").HasColumnType("uuid");
            signature.Property(x => x.CertificateSnapshot).HasColumnName("certificate_snapshot").HasColumnType("jsonb");
            signature.Property(x => x.ProviderCode).HasColumnName("provider_code").HasColumnType("varchar(50)").IsRequired();
            signature.Property(x => x.ProviderReference).HasColumnName("provider_reference").HasColumnType("varchar(200)");
            signature.Ignore(x => x.Status);
            signature.Property(x => x.SigningStatus).HasConversion<short>().HasColumnName("signing_status").HasColumnType("smallint");
            signature.Property(x => x.SnapshotHash).HasColumnName("snapshot_hash").HasColumnType("varchar(64)").IsRequired();
            signature.Property(x => x.SourceHash).HasColumnName("source_hash").HasColumnType("varchar(64)");
            signature.Property(x => x.PreparedHash).HasColumnName("prepared_hash").HasColumnType("varchar(64)");
            signature.Property(x => x.PreparedObjectKey).HasColumnName("prepared_object_key").HasColumnType("varchar(250)");
            signature.Property(x => x.SignedObjectKey).HasColumnName("signed_object_key").HasColumnType("varchar(250)");
            signature.Property(x => x.SignedHash).HasColumnName("signed_hash").HasColumnType("varchar(64)");
            signature.Property(x => x.SigningData).HasColumnName("signing_data").HasColumnType("jsonb");
            signature.Ignore(x => x.CreatedAt);
            signature.Property(x => x.RequestedAt).HasColumnName("requested_at").HasColumnType("timestamptz");
            signature.Property(x => x.ExpiresAt).HasColumnName("expires_at").HasColumnType("timestamptz");
            signature.Property(x => x.SignedAt).HasColumnName("signed_at").HasColumnType("timestamptz");
            signature.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var members = model.Entity<BHome.Domain.TenantContracts.ContractResident>();
            members.ToTable("contract_residents", "public", t => t.ExcludeFromMigrations());
            members.HasKey(x => new { x.ContractId, x.ResidentId });
            members.Ignore(x => x.Role);
            members.Property(x => x.ResidentRole).HasConversion<short>().HasColumnName("resident_role").HasColumnType("smallint");
            members.Property(x => x.ActualResidenceFrom).HasColumnName("actual_residence_from").HasColumnType("date");
            members.Property(x => x.ActualMoveOutDate).HasColumnName("actual_move_out_date").HasColumnType("date");
            members.Property(x => x.RegistrationStatus).HasColumnName("registration_status").HasColumnType("varchar(25)");
            members.Property(x => x.RegistrationEvidenceKey).HasColumnName("registration_evidence_key").HasColumnType("varchar(250)");
            members.Property(x => x.RegistrationResultAt).HasColumnName("registration_result_at").HasColumnType("timestamptz");
            members.Property(x => x.OwnerConfirmedByUserId).HasColumnName("owner_confirmed_by_user_id").HasColumnType("uuid");
            members.Property(x => x.OwnerConfirmedAt).HasColumnName("owner_confirmed_at").HasColumnType("timestamptz");
            members.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
            members.Property(x => x.ContractId).HasColumnName("contract_id").HasColumnType("uuid");
            members.Property(x => x.ResidentId).HasColumnName("resident_id").HasColumnType("uuid");
            members.Property(x => x.ResidenceFrom).HasColumnName("residence_from").HasColumnType("date");
            members.Property(x => x.ResidenceTo).HasColumnName("residence_to").HasColumnType("date");
        }
        if (!archive)
        {
            var incident = model.Entity<BHome.Domain.IncidentMaintenance.IncidentReport>();
            incident.ToTable("incident_reports", "public", t => t.ExcludeFromMigrations());
            incident.Ignore(x => x.CommonArea);
            incident.Ignore(x => x.ContractId);
            incident.Ignore(x => x.ReporterRole);
            incident.Ignore(x => x.Type);
            incident.Ignore(x => x.Category);
            incident.Ignore(x => x.AcknowledgedById);
            incident.Ignore(x => x.AcknowledgedAt);
            incident.Ignore(x => x.OwnerDecisionAt);
            incident.Ignore(x => x.ResolutionNote);
            incident.Ignore(x => x.UpdatedAt);
            incident.Ignore(x => x.IsOpen);
            incident.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            incident.Property(x => x.LocationId).HasColumnName("location_id").HasColumnType("uuid");
            incident.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            incident.Property(x => x.AssetId).HasColumnName("asset_id").HasColumnType("uuid");
            incident.Ignore(x => x.ReporterId);
            incident.Property(x => x.ReporterUserId).HasColumnName("reporter_user_id").HasColumnType("uuid");
            incident.Property(x => x.Severity).HasConversion(
                x => x == BHome.Domain.IncidentMaintenance.IncidentSeverity.Emergency ? "EMERGENCY" : "NORMAL",
                x => x == "EMERGENCY" ? BHome.Domain.IncidentMaintenance.IncidentSeverity.Emergency : BHome.Domain.IncidentMaintenance.IncidentSeverity.Normal)
                .HasColumnName("severity").HasColumnType("varchar(12)");
            incident.Property(x => x.Summary).HasColumnName("summary").HasColumnType("varchar(250)").IsRequired();
            incident.Property(x => x.Description).HasColumnName("description").HasColumnType("text").IsRequired();
            incident.Property(x => x.Status).HasConversion<string>().HasColumnName("status").HasColumnType("varchar(30)");
            incident.Property(x => x.Evidence).HasColumnName("evidence").HasColumnType("jsonb");
            incident.Property(x => x.EmergencyActions).HasColumnName("emergency_actions").HasColumnType("jsonb");
            incident.Ignore(x => x.DuplicateOfId);
            incident.Property(x => x.DuplicateOfReportId).HasColumnName("duplicate_of_report_id").HasColumnType("uuid");
            incident.Property(x => x.OwnerDecision).HasColumnName("owner_decision").HasColumnType("jsonb");
            incident.Ignore(x => x.CreatedAt);
            incident.Property(x => x.ReportedAt).HasColumnName("reported_at").HasColumnType("timestamptz");
            incident.Property(x => x.ResolvedAt).HasColumnName("resolved_at").HasColumnType("timestamptz");
            incident.Property(x => x.Version).HasColumnName("version").HasColumnType("integer").IsConcurrencyToken();
            incident.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var task = model.Entity<BHome.Domain.Billing.OperationalTask>();
            task.ToTable("operational_tasks", "public", t => t.ExcludeFromMigrations());
            task.Ignore(x => x.Kind);
            task.Ignore(x => x.RequiredLocationId);
            task.Ignore(x => x.Location);
            task.Ignore(x => x.TaskTitle);
            task.Ignore(x => x.Requirements);
            task.Ignore(x => x.TaskPriority);
            task.Ignore(x => x.MeterStatus);
            task.Ignore(x => x.AssignedStaffUserId);
            task.Ignore(x => x.EvidenceRequired);
            task.Ignore(x => x.AssignmentId);
            task.Ignore(x => x.Result);
            task.Ignore(x => x.TargetRoomId);
            task.Ignore(x => x.TargetAssetId);
            task.Ignore(x => x.TargetCommonArea);
            task.Ignore(x => x.TargetLabel);
            task.Ignore(x => x.MoveInInventoryJson);
            task.Ignore(x => x.LocationAssetInventoryJson);
            task.Ignore(x => x.BillingRoomId);
            task.Ignore(x => x.BillingUtilityType);
            task.Ignore(x => x.AutomationPlanId);
            task.Ignore(x => x.Meter);
            task.Ignore(x => x.Purpose);
            task.Ignore(x => x.ReadingDate);
            task.Ignore(x => x.OcrProposedValue);
            task.Ignore(x => x.OcrImageHash);
            task.Ignore(x => x.OcrEngineVersion);
            task.Ignore(x => x.CompletedAt);
            task.Ignore(x => x.CreatedAt);
            task.Ignore(x => x.UpdatedAt);
            task.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            task.Property(x => x.TaskType).HasColumnName("task_type").HasColumnType("varchar(20)").IsRequired();
            task.Property(x => x.LocationId).HasColumnName("location_id").HasColumnType("uuid");
            task.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            task.Property(x => x.AssetId).HasColumnName("asset_id").HasColumnType("uuid");
            task.Property(x => x.AssignedUserId).HasColumnName("assigned_user_id").HasColumnType("uuid");
            task.Property(x => x.ContractId).HasColumnName("contract_id").HasColumnType("uuid");
            task.Property(x => x.IncidentReportId).HasColumnName("incident_report_id").HasColumnType("uuid");
            task.Property(x => x.MeterId).HasColumnName("meter_id").HasColumnType("uuid");
            task.Property(x => x.BillingPeriod).HasColumnName("billing_period").HasColumnType("date");
            task.Property(x => x.SourceKey).HasColumnName("source_key").HasColumnType("varchar(250)");
            task.Property(x => x.Title).HasColumnName("title").HasColumnType("varchar(200)");
            task.Property(x => x.Description).HasColumnName("description").HasColumnType("text");
            task.Property(x => x.Priority).HasColumnName("priority").HasColumnType("varchar(12)");
            task.Property(x => x.Status).HasColumnName("status").HasColumnType("varchar(30)").IsRequired();
            task.Property(x => x.AssignedAt).HasColumnName("assigned_at").HasColumnType("timestamptz");
            task.Property(x => x.StartsAt).HasColumnName("starts_at").HasColumnType("timestamptz");
            task.Property(x => x.EndsAt).HasColumnName("ends_at").HasColumnType("timestamptz");
            task.Property(x => x.DueAt).HasColumnName("due_at").HasColumnType("timestamptz");
            task.Property(x => x.NextRunAt).HasColumnName("next_run_at").HasColumnType("timestamptz");
            task.Property(x => x.LockedUntil).HasColumnName("locked_until").HasColumnType("timestamptz");
            task.Property(x => x.LeaseToken).HasColumnName("lease_token").HasColumnType("uuid");
            task.Property(x => x.AttemptCount).HasColumnName("attempt_count").HasColumnType("integer");
            task.Property(x => x.TaskData).HasColumnName("task_data").HasColumnType("jsonb");
            task.Property(x => x.Evidence).HasColumnName("evidence").HasColumnType("jsonb");
            task.Property(x => x.EstimatedCost).HasColumnName("estimated_cost").HasColumnType("numeric(18,0)");
            task.Property(x => x.ApprovedCost).HasColumnName("approved_cost").HasColumnType("numeric(18,0)");
            task.Property(x => x.CostApprovedByUserId).HasColumnName("cost_approved_by_user_id").HasColumnType("uuid");
            task.Property(x => x.CostApprovedAt).HasColumnName("cost_approved_at").HasColumnType("timestamptz");
            task.Property(x => x.VerifiedByUserId).HasColumnName("verified_by_user_id").HasColumnType("uuid");
            task.Property(x => x.VerifiedAt).HasColumnName("verified_at").HasColumnType("timestamptz");
            task.Property(x => x.Version).HasColumnName("version").HasColumnType("integer");
            task.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var meter = model.Entity<BHome.Domain.Billing.Meter>();
            meter.ToTable("meters", "public", t => t.ExcludeFromMigrations());
            meter.Ignore(x => x.Room);
            meter.Ignore(x => x.CreatedAt);
            meter.Ignore(x => x.UpdatedAt);
            meter.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            meter.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            meter.Property(x => x.UtilityType).HasConversion<short>().HasColumnName("utility_type").HasColumnType("smallint");
            meter.Ignore(x => x.Code);
            meter.Property(x => x.MeterCode).HasColumnName("meter_code").HasColumnType("varchar(80)").IsRequired();
            meter.Ignore(x => x.Display);
            meter.Property(x => x.DisplayType).HasConversion<short>().HasColumnName("display_type").HasColumnType("smallint");
            meter.Property(x => x.DecimalPlaces).HasConversion<short>().HasColumnName("decimal_places").HasColumnType("smallint");
            meter.Property(x => x.InstalledOn).HasColumnName("installed_on").HasColumnType("date");
            meter.Property(x => x.RemovedOn).HasColumnName("removed_on").HasColumnType("date");
            meter.Property(x => x.PreviousMeterId).HasColumnName("previous_meter_id").HasColumnType("uuid");
            meter.Property(x => x.IsActive).HasColumnName("is_active").HasColumnType("boolean");
            meter.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb").UsePropertyAccessMode(PropertyAccessMode.Property);

            var reading = model.Entity<BHome.Domain.Billing.MeterReading>();
            reading.ToTable("meter_readings", "public", t => t.ExcludeFromMigrations());
            reading.Ignore(x => x.CreatedAt);
            reading.Ignore(x => x.UpdatedAt);
            reading.Ignore(x => x.EvidenceId);
            reading.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            reading.Property(x => x.MeterId).HasColumnName("meter_id").HasColumnType("uuid");
            reading.Ignore(x => x.TaskId);
            reading.Property(x => x.OperationalTaskId).HasColumnName("operational_task_id").HasColumnType("uuid");
            reading.Property(x => x.ReadingPurpose).HasConversion<short>().HasColumnName("reading_purpose").HasColumnType("smallint");
            reading.Property(x => x.BillingPeriod).HasColumnName("billing_period").HasColumnType("date");
            reading.Property(x => x.ReadingAt).HasColumnName("reading_at").HasColumnType("timestamptz");
            reading.Property(x => x.PreviousValue).HasColumnName("previous_value").HasColumnType("numeric(18,4)");
            reading.Property(x => x.OcrProposedValue).HasColumnName("ocr_proposed_value").HasColumnType("numeric(18,4)");
            reading.Property(x => x.ConfirmedValue).HasColumnName("confirmed_value").HasColumnType("numeric(18,4)");
            reading.Property(x => x.Consumption).HasColumnName("consumption").HasColumnType("numeric(18,4)");
            reading.Property(x => x.ConfirmedByUserId).HasColumnName("confirmed_by_user_id").HasColumnType("uuid");
            reading.Property(x => x.ConfirmedAt).HasColumnName("confirmed_at").HasColumnType("timestamptz");
            reading.Property(x => x.Evidence).HasColumnName("evidence").HasColumnType("jsonb");
            reading.Property(x => x.Status).HasConversion<short>().HasColumnName("status").HasColumnType("smallint");
            reading.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb").UsePropertyAccessMode(PropertyAccessMode.Property);
        }
        if (!archive)
        {
            var policy = model.Entity<BHome.Domain.PropertyManagement.BillingPolicy>();
            policy.ToTable("billing_policies", "public", t => t.ExcludeFromMigrations());
            policy.Ignore(x => x.CreatedAt);
            policy.Ignore(x => x.UpdatedAt);
            policy.Ignore(x => x.RoomTypeId);
            policy.Ignore(x => x.Name);
            policy.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            policy.Property(x => x.LocationId).HasColumnName("location_id").HasColumnType("uuid");
            policy.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            policy.Property(x => x.ChargeCode).HasColumnName("charge_code").HasColumnType("varchar(80)").IsRequired();
            policy.Property(x => x.Category).HasConversion<short>().HasColumnName("category").HasColumnType("smallint");
            policy.Ignore(x => x.Method);
            policy.Property(x => x.CalculationMethod).HasConversion(
                method => method == BHome.Domain.PropertyManagement.ChargingMethod.Metered ? "METERED" :
                    method == BHome.Domain.PropertyManagement.ChargingMethod.FixedPerPersonPerMonth ? "FIXED_PER_PERSON_PER_MONTH" :
                    method == BHome.Domain.PropertyManagement.ChargingMethod.FixedPerRoomPerMonth ? "FIXED_PER_ROOM_PER_MONTH" : "INVALID",
                value => value == "METERED" ? BHome.Domain.PropertyManagement.ChargingMethod.Metered :
                    value == "FIXED_PER_PERSON_PER_MONTH" ? BHome.Domain.PropertyManagement.ChargingMethod.FixedPerPersonPerMonth :
                    value == "FIXED_PER_ROOM_PER_MONTH" ? BHome.Domain.PropertyManagement.ChargingMethod.FixedPerRoomPerMonth :
                    (BHome.Domain.PropertyManagement.ChargingMethod)(-1)).HasColumnName("calculation_method").HasColumnType("varchar(30)");
            policy.Property(x => x.Rate).HasColumnName("rate").HasColumnType("numeric(18,4)");
            policy.Property(x => x.Parameters).HasColumnName("parameters").HasColumnType("jsonb");
            policy.Property(x => x.EffectiveFrom).HasColumnName("effective_from").HasColumnType("date");
            policy.Property(x => x.EffectiveTo).HasColumnName("effective_to").HasColumnType("date");
            policy.Property(x => x.FirstUsedAt).HasColumnName("first_used_at").HasColumnType("timestamptz");
            policy.Property(x => x.Version).HasColumnName("version").HasColumnType("integer").IsConcurrencyToken();
            policy.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var invoice = model.Entity<BHome.Domain.Billing.Invoice>();
            invoice.ToTable("invoices", "public", t => t.ExcludeFromMigrations());
            invoice.Ignore(x => x.CreatedAt);
            invoice.Ignore(x => x.UpdatedAt);
            invoice.Ignore(x => x.AutomationPlanId);
            invoice.Ignore(x => x.AutomationFinalizationPlanId);
            invoice.Ignore(x => x.RoomNumber);
            invoice.Ignore(x => x.LocationName);
            invoice.Ignore(x => x.ScheduleSnapshot);
            invoice.Ignore(x => x.CreatedByUserId);
            invoice.Ignore(x => x.Lines);
            invoice.Ignore(x => x.Recipients);
            invoice.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            invoice.Property(x => x.LocationId).HasColumnName("location_id").HasColumnType("uuid");
            invoice.Property(x => x.RoomId).HasColumnName("room_id").HasColumnType("uuid");
            invoice.Ignore(x => x.RepresentativeContractId);
            invoice.Property(x => x.ContractId).HasColumnName("contract_id").HasColumnType("uuid");
            invoice.Property(x => x.RepresentativeTenantUserId).HasColumnName("representative_tenant_user_id").HasColumnType("uuid");
            invoice.Ignore(x => x.Type);
            invoice.Property(x => x.InvoiceType).HasColumnName("invoice_type").HasColumnType("varchar(12)").IsRequired();
            invoice.Property(x => x.BillingPeriod).HasColumnName("billing_period").HasColumnType("date");
            invoice.Property(x => x.RecipientUserIds).HasColumnName("recipient_user_ids").HasColumnType("uuid[]").IsRequired();
            invoice.Ignore(x => x.Total);
            invoice.Property(x => x.BaseTotalAmount).HasColumnName("base_total_amount").HasColumnType("numeric(18,0)");
            invoice.Property(x => x.Status).HasConversion<short>().HasColumnName("status").HasColumnType("smallint");
            invoice.Property(x => x.MissingInputs).HasColumnName("missing_inputs").HasColumnType("text[]").IsRequired();
            invoice.Property(x => x.BillingSnapshot).HasColumnName("billing_snapshot").HasColumnType("jsonb").UsePropertyAccessMode(PropertyAccessMode.Property);
            invoice.Property(x => x.PaymentRequests).HasColumnName("payment_requests").HasColumnType("jsonb");
            invoice.Property(x => x.ScheduledFinalDate).HasColumnName("scheduled_final_date").HasColumnType("date");
            invoice.Property(x => x.DueDate).HasColumnName("due_date").HasColumnType("date");
            invoice.Property(x => x.FinalizedAt).HasColumnName("finalized_at").HasColumnType("timestamptz");
            invoice.Property(x => x.FinalizedByUserId).HasColumnName("finalized_by_user_id").HasColumnType("uuid");
            invoice.Property(x => x.Version).HasColumnName("version").HasColumnType("integer").IsConcurrencyToken();
            invoice.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");

            var item = model.Entity<BHome.Domain.Billing.InvoiceItem>();
            item.ToTable("invoice_items", "public", t => t.ExcludeFromMigrations());
            item.Ignore(x => x.Category);
            item.Ignore(x => x.PolicyVersion);
            item.Ignore(x => x.RateDate);
            item.Ignore(x => x.OccupiedDays);
            item.Ignore(x => x.PeriodDays);
            item.Ignore(x => x.CalculatedAmount);
            item.Ignore(x => x.CorrectionRequestId);
            item.Ignore(x => x.PreviousReading);
            item.Ignore(x => x.ConfirmedReading);
            item.Ignore(x => x.UtilityCalculationSnapshot);
            item.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            item.Property(x => x.InvoiceId).HasColumnName("invoice_id").HasColumnType("uuid");
            item.Property(x => x.ChargeCode).HasColumnName("charge_code").HasColumnType("varchar(80)").IsRequired();
            item.Ignore(x => x.Name);
            item.Property(x => x.Description).HasColumnName("description").HasColumnType("varchar(255)").IsRequired();
            item.Ignore(x => x.PolicyId);
            item.Property(x => x.BillingPolicyId).HasColumnName("billing_policy_id").HasColumnType("uuid");
            item.Property(x => x.MeterReadingId).HasColumnName("meter_reading_id").HasColumnType("uuid");
            item.Property(x => x.Quantity).HasColumnName("quantity").HasColumnType("numeric(18,4)");
            item.Ignore(x => x.Rate);
            item.Property(x => x.UnitPrice).HasColumnName("unit_price").HasColumnType("numeric(18,4)");
            item.Property(x => x.Amount).HasColumnName("amount").HasColumnType("numeric(18,0)");
            item.Property(x => x.CalculationSnapshot).HasColumnName("calculation_snapshot").HasColumnType("jsonb").UsePropertyAccessMode(PropertyAccessMode.Property);
        }
        if (!archive)
        {
            var adjustment = model.Entity<BHome.Domain.Billing.InvoiceAdjustment>();
            adjustment.ToTable("invoice_adjustments", "public", t => t.ExcludeFromMigrations());
            adjustment.Ignore(x => x.Invoice);
            adjustment.Ignore(x => x.InvoiceLineId);
            adjustment.Ignore(x => x.ChargeCode);
            adjustment.Ignore(x => x.CurrentAmount);
            adjustment.Ignore(x => x.ProposedAmount);
            adjustment.Ignore(x => x.InvoiceSnapshot);
            adjustment.Ignore(x => x.InvoiceStatus);
            adjustment.Ignore(x => x.InvoiceVersion);
            adjustment.Ignore(x => x.FinancialVersion);
            adjustment.Ignore(x => x.CreatedAt);
            adjustment.Ignore(x => x.UpdatedAt);
            adjustment.Ignore(x => x.EvidenceItems);
            adjustment.Ignore(x => x.Decision);
            adjustment.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            adjustment.Property(x => x.InvoiceId).HasColumnName("invoice_id").HasColumnType("uuid");
            adjustment.Ignore(x => x.RequesterId);
            adjustment.Property(x => x.RequestedByUserId).HasColumnName("requested_by_user_id").HasColumnType("uuid");
            adjustment.Ignore(x => x.SubmittedAt);
            adjustment.Property(x => x.RequestedAt).HasColumnName("requested_at").HasColumnType("timestamptz");
            adjustment.Property(x => x.Reason).HasColumnName("reason").HasColumnType("text").IsRequired();
            adjustment.Property(x => x.RequestSnapshot).HasColumnName("request_snapshot").HasColumnType("jsonb");
            adjustment.Property(x => x.ProposedChanges).HasColumnName("proposed_changes").HasColumnType("jsonb");
            adjustment.Property(x => x.Evidence).HasColumnName("evidence").HasColumnType("jsonb");
            adjustment.Property(x => x.Status).HasColumnName("status").HasColumnType("varchar(12)").IsRequired();
            adjustment.Property(x => x.ApprovedDeltaAmount).HasColumnName("approved_delta_amount").HasColumnType("numeric(18,0)");
            adjustment.Property(x => x.DecidedByUserId).HasColumnName("decided_by_user_id").HasColumnType("uuid");
            adjustment.Property(x => x.DecidedAt).HasColumnName("decided_at").HasColumnType("timestamptz");
            adjustment.Property(x => x.DecisionReason).HasColumnName("decision_reason").HasColumnType("text");
            adjustment.Property(x => x.DecisionSnapshot).HasColumnName("decision_snapshot").HasColumnType("jsonb");
            adjustment.Property(x => x.Version).HasColumnName("version").HasColumnType("integer");
            adjustment.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var payment = model.Entity<BHome.Domain.PaymentsDebt.Payment>();
            payment.ToTable("payments", "public", t => t.ExcludeFromMigrations());
            payment.Ignore(x => x.NormalizedReference);
            payment.Ignore(x => x.TransferDescription);
            payment.Ignore(x => x.StatementReference);
            payment.Ignore(x => x.StatementEvidenceObjectKey);
            payment.Ignore(x => x.StatementEvidenceSha256);
            payment.Ignore(x => x.StatementEvidenceContentType);
            payment.Ignore(x => x.StatementEvidenceLength);
            payment.Ignore(x => x.VerificationReason);
            payment.Ignore(x => x.VerificationSource);
            payment.Ignore(x => x.ReceiptVerifiedByUserId);
            payment.Ignore(x => x.ReceiptVerifiedAt);
            payment.Ignore(x => x.ProposedInvoiceId);
            payment.Ignore(x => x.ProposedDepositContractId);
            payment.Ignore(x => x.IsDevelopmentDemo);
            payment.Ignore(x => x.CreatedAt);
            payment.Ignore(x => x.UpdatedAt);
            payment.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            payment.Ignore(x => x.ProviderIdentity);
            payment.Property(x => x.ProviderCode).HasColumnName("provider_code").HasColumnType("varchar(80)").IsRequired();
            payment.Property(x => x.ReceivingAccountKey).HasColumnName("receiving_account_key").HasColumnType("varchar(200)").IsRequired();
            payment.Ignore(x => x.BankReference);
            payment.Property(x => x.TransactionReference).HasColumnName("transaction_reference").HasColumnType("varchar(150)").IsRequired();
            payment.Property(x => x.EffectKey).HasColumnName("effect_key").HasColumnType("varchar(250)");
            payment.Ignore(x => x.OccurredAt);
            payment.Property(x => x.ReceivedAt).HasColumnName("received_at").HasColumnType("timestamptz");
            payment.Property(x => x.Amount).HasColumnName("amount").HasColumnType("numeric(18,0)");
            payment.Property(x => x.Currency).HasColumnName("currency").HasColumnType("varchar(3)").IsRequired();
            payment.Property(x => x.RemittanceInfo).HasColumnName("remittance_info").HasColumnType("text");
            payment.Property(x => x.BeneficiaryResidentId).HasColumnName("beneficiary_resident_id").HasColumnType("uuid");
            payment.Property(x => x.Status).HasColumnName("status").HasColumnType("varchar(12)").IsRequired();
            payment.Property(x => x.VerificationMethod).HasColumnName("verification_method").HasColumnType("varchar(10)");
            payment.Property(x => x.VerifiedByUserId).HasColumnName("verified_by_user_id").HasColumnType("uuid");
            payment.Property(x => x.VerifiedAt).HasColumnName("verified_at").HasColumnType("timestamptz");
            payment.Property(x => x.VerificationData).HasColumnName("verification_data").HasColumnType("jsonb");
            payment.Property(x => x.History).HasColumnName("history").HasColumnType("jsonb");
        }
        if (!archive)
        {
            var allocation = model.Entity<BHome.Domain.PaymentsDebt.PaymentAllocation>();
            allocation.ToTable("payment_allocations", "public", t => t.ExcludeFromMigrations());
            allocation.Ignore(x => x.CreatedAt);
            allocation.Ignore(x => x.UpdatedAt);
            allocation.Ignore(x => x.VerifiedByUserId);
            allocation.Property(x => x.Id).HasColumnName("id").HasColumnType("uuid");
            allocation.Ignore(x => x.TransferId);
            allocation.Property(x => x.SourcePaymentId).HasColumnName("source_payment_id").HasColumnType("uuid");
            allocation.Property(x => x.SourceDepositContractId).HasColumnName("source_deposit_contract_id").HasColumnType("uuid");
            allocation.Ignore(x => x.InvoiceId);
            allocation.Property(x => x.TargetInvoiceId).HasColumnName("target_invoice_id").HasColumnType("uuid");
            allocation.Property(x => x.TargetDepositContractId).HasColumnName("target_deposit_contract_id").HasColumnType("uuid");
            allocation.Property(x => x.TargetInitialContractId).HasColumnName("target_initial_contract_id").HasColumnType("uuid");
            allocation.Property(x => x.TargetSettlementContractId).HasColumnName("target_settlement_contract_id").HasColumnType("uuid");
            allocation.Property(x => x.SettlementReceivableId).HasColumnName("settlement_receivable_id").HasColumnType("uuid");
            allocation.Property(x => x.DepositOffsetApprovalId).HasColumnName("deposit_offset_approval_id").HasColumnType("uuid");
            allocation.Property(x => x.Amount).HasColumnName("amount").HasColumnType("numeric(18,0)");
            allocation.Property(x => x.ReversalOfAllocationId).HasColumnName("reversal_of_allocation_id").HasColumnType("uuid");
            allocation.Property(x => x.OperationKey).HasColumnName("operation_key").HasColumnType("uuid");
            allocation.Property(x => x.LineNumber).HasColumnName("line_number").HasColumnType("smallint");
            allocation.Property(x => x.PaidByUserId).HasColumnName("paid_by_user_id").HasColumnType("uuid");
            allocation.Property(x => x.CreatedByUserId).HasColumnName("created_by_user_id").HasColumnType("uuid");
            allocation.Property(x => x.AllocatedAt).HasColumnName("allocated_at").HasColumnType("timestamptz");
            allocation.Property(x => x.Reason).HasColumnName("reason").HasColumnType("text").IsRequired();
        }
        model.Entity<Native.RefundRequest>().ToTable("refund_requests", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Expense>().ToTable("expenses", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.FinancialScenario>().ToTable("financial_scenarios", "public", t => t.ExcludeFromMigrations());
        model.Entity<Native.Notification>().ToTable("notifications", "public", t => t.ExcludeFromMigrations());
        ConfigureRelationships(model, archive);
        foreach (var entity in model.Model.GetEntityTypes().Where(e => IsNative(e.ClrType) && e.GetSqlQuery() is null))
            foreach (var key in entity.FindPrimaryKey()!.Properties)
                key.ValueGenerated = Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.Never;
    }

    // Keep physical foreign keys visible; PostgreSQL remains the authority for
    // constraints, indexes and deferred checks. No cascade writes from this read model.
    private static void ConfigureRelationships(ModelBuilder model, bool archive)
    {
        model.Entity<RefreshToken>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<RefreshToken>().HasOne<RefreshToken>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<RefreshToken>().HasOne<RefreshToken>().WithMany().HasForeignKey(x => x.ReplacedByTokenId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.StaffEmployment>().HasOne<User>().WithMany().HasForeignKey(x => x.StaffUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Locations.Location>().HasOne<User>().WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.PropertyManagement.Room>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.PropertyManagement.Room>().HasOne<User>().WithMany().HasForeignKey(x => x.PublishedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.PropertyManagement.Asset>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.PropertyManagement.Asset>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Resident>().HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Resident>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => x.CurrentRoomId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Resident>().HasOne<User>().WithMany().HasForeignKey(x => x.IdentityOwnerScopeId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Resident>().HasOne<User>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<BHome.Domain.TenantContracts.Resident>().WithMany().HasForeignKey(x => x.RepresentativeResidentId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<User>().WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<User>().WithMany().HasForeignKey(x => x.OwnerSignerId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.PreviousContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.ParentContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.SourceHoldingContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.Contract>().HasOne<User>().WithMany().HasForeignKey(x => x.ActivatedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.ContractSigning>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.TenantContracts.ContractSigning>().HasOne<User>().WithMany().HasForeignKey(x => x.SignerUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive)
        {
            model.Entity<BHome.Domain.TenantContracts.ContractResident>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
            model.Entity<BHome.Domain.TenantContracts.ContractResident>().HasOne<BHome.Domain.TenantContracts.Resident>().WithMany().HasForeignKey(x => x.ResidentId).OnDelete(DeleteBehavior.NoAction);
            model.Entity<BHome.Domain.TenantContracts.ContractResident>().HasOne<User>().WithMany().HasForeignKey(x => x.OwnerConfirmedByUserId).OnDelete(DeleteBehavior.NoAction);
        }
        if (!archive)
        {
            var incident = model.Entity<BHome.Domain.IncidentMaintenance.IncidentReport>();
            incident.HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
            incident.HasOne<User>().WithMany().HasForeignKey(x => x.ReporterUserId).OnDelete(DeleteBehavior.NoAction);
            incident.HasOne<BHome.Domain.IncidentMaintenance.IncidentReport>().WithMany().HasForeignKey(x => x.DuplicateOfReportId).OnDelete(DeleteBehavior.NoAction);
            incident.HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
            incident.HasOne<BHome.Domain.PropertyManagement.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        }
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<User>().WithMany().HasForeignKey(x => x.AssignedUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<BHome.Domain.IncidentMaintenance.IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<User>().WithMany().HasForeignKey(x => x.CostApprovedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<User>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<BHome.Domain.PropertyManagement.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive)
        {
            model.Entity<BHome.Domain.Billing.Meter>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
            model.Entity<BHome.Domain.Billing.Meter>().HasOne<BHome.Domain.Billing.Meter>().WithMany().HasForeignKey(x => x.PreviousMeterId).OnDelete(DeleteBehavior.NoAction);
            model.Entity<BHome.Domain.Billing.MeterReading>().HasOne<BHome.Domain.Billing.Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.NoAction);
            model.Entity<BHome.Domain.Billing.MeterReading>().HasOne<BHome.Domain.Billing.OperationalTask>().WithOne().HasForeignKey<BHome.Domain.Billing.MeterReading>(x => x.OperationalTaskId).OnDelete(DeleteBehavior.NoAction);
            model.Entity<BHome.Domain.Billing.MeterReading>().HasOne<User>().WithMany().HasForeignKey(x => x.ConfirmedByUserId).OnDelete(DeleteBehavior.NoAction);
        }
        if (!archive) model.Entity<BHome.Domain.PropertyManagement.BillingPolicy>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.PropertyManagement.BillingPolicy>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.Invoice>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.Invoice>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.Invoice>().HasOne<User>().WithMany().HasForeignKey(x => x.RepresentativeTenantUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.Invoice>().HasOne<User>().WithMany().HasForeignKey(x => x.FinalizedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.Invoice>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.InvoiceItem>().HasOne<BHome.Domain.Billing.Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.InvoiceItem>().HasOne<BHome.Domain.PropertyManagement.BillingPolicy>().WithMany().HasForeignKey(x => x.BillingPolicyId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.InvoiceItem>().HasOne<BHome.Domain.Billing.MeterReading>().WithMany().HasForeignKey(x => x.MeterReadingId).OnDelete(DeleteBehavior.NoAction);
        if (!archive)
        {
            var adjustment = model.Entity<BHome.Domain.Billing.InvoiceAdjustment>();
            adjustment.HasOne<BHome.Domain.Billing.Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.NoAction);
            adjustment.HasOne<User>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
            adjustment.HasOne<User>().WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.NoAction);
        }
        if (!archive)
        {
            var payment = model.Entity<BHome.Domain.PaymentsDebt.Payment>();
            payment.HasOne<BHome.Domain.TenantContracts.Resident>().WithMany().HasForeignKey(x => x.BeneficiaryResidentId).OnDelete(DeleteBehavior.NoAction);
            payment.HasOne<User>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.NoAction);
        }
        if (!archive)
        {
            var allocation = model.Entity<BHome.Domain.PaymentsDebt.PaymentAllocation>();
            allocation.HasOne<BHome.Domain.PaymentsDebt.Payment>().WithMany().HasForeignKey(x => x.SourcePaymentId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<BHome.Domain.Billing.Invoice>().WithMany().HasForeignKey(x => x.TargetInvoiceId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.TargetDepositContractId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.TargetInitialContractId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.TargetSettlementContractId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<BHome.Domain.PaymentsDebt.PaymentAllocation>().WithOne().HasForeignKey<BHome.Domain.PaymentsDebt.PaymentAllocation>(x => x.ReversalOfAllocationId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<User>().WithMany().HasForeignKey(x => x.PaidByUserId).OnDelete(DeleteBehavior.NoAction);
            allocation.HasOne<User>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.NoAction);
        }
        if (!archive) model.Entity<Native.RefundRequest>().HasOne<BHome.Domain.PaymentsDebt.Payment>().WithMany().HasForeignKey(x => x.SourcePaymentId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.RefundRequest>().HasOne<BHome.Domain.TenantContracts.Contract>().WithMany().HasForeignKey(x => x.SourceDepositContractId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.RefundRequest>().HasOne<BHome.Domain.TenantContracts.Resident>().WithMany().HasForeignKey(x => x.BeneficiaryResidentId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<User>().WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.RefundRequest>().HasOne<User>().WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.Expense>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.Expense>().HasOne<BHome.Domain.IncidentMaintenance.IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.Expense>().HasOne<BHome.Domain.Billing.OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Expense>().HasOne<User>().WithMany().HasForeignKey(x => x.RecordedByUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.Expense>().HasOne<BHome.Domain.PropertyManagement.Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.Expense>().HasOne<BHome.Domain.PropertyManagement.Asset>().WithMany().HasForeignKey(x => new { x.AssetId, x.LocationId }).HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.FinancialScenario>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.FinancialScenario>().HasOne<User>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<User>().WithMany().HasForeignKey(x => x.RecipientUserId).OnDelete(DeleteBehavior.NoAction);
        model.Entity<Native.Notification>().HasOne<User>().WithMany().HasForeignKey(x => x.ActorUserId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<Native.Notification>().HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.NoAction);
        if (!archive) model.Entity<BHome.Domain.Billing.OperationalTask>().HasOne<BHome.Domain.Billing.Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.NoAction);
    }
}
