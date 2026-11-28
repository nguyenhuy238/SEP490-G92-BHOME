using System.Text.Json;
using BHome.Domain.Common;
using BHome.Domain.IncidentMaintenance;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

// Explicit scalar snapshot DTOs retain the persisted v1 JSON shape. Computed
// business properties are not stored; no EF projection metadata is used.
internal static class IncidentSnapshots
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static JsonElement Latest(JsonElement history, string kind) =>
        history.EnumerateArray().Reverse().Where(e => e.ValueKind == JsonValueKind.Object &&
            e.TryGetProperty("recordType", out var type) && type.GetString() == kind)
            .Select(e => e.GetProperty("state")).FirstOrDefault();
    private sealed record Envelope<T>(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, T State);
    internal static string EnvelopeJson(AuditableEntity row, JsonElement state, bool deleted = false) =>
        JsonSerializer.Serialize(new Envelope<JsonElement>(1, row.GetType().Name, row.Id.ToString(), deleted, state), Json);
    internal static JsonElement State(AuditableEntity row) => row switch
    {
        IncidentReport value => JsonSerializer.SerializeToElement(IncidentReportState.From(value), Json),
        MaintenanceWorkOrder value => JsonSerializer.SerializeToElement(MaintenanceWorkOrderState.From(value), Json),
        FastRepairPolicy value => JsonSerializer.SerializeToElement(FastRepairPolicyState.From(value), Json),
        IncidentActivity value => JsonSerializer.SerializeToElement(IncidentActivityState.From(value), Json),
        IncidentEvidence value => JsonSerializer.SerializeToElement(IncidentEvidenceState.From(value), Json),
        EmergencyAction value => JsonSerializer.SerializeToElement(EmergencyActionState.From(value), Json),
        MaintenanceExpense value => JsonSerializer.SerializeToElement(MaintenanceExpenseState.From(value), Json),
        MaintenanceHistory value => JsonSerializer.SerializeToElement(MaintenanceHistoryState.From(value), Json),
        IncidentCommand value => JsonSerializer.SerializeToElement(IncidentCommandState.From(value), Json),
        IncidentNotification value => JsonSerializer.SerializeToElement(IncidentNotificationState.From(value), Json),
        MaintenanceCompensation value => JsonSerializer.SerializeToElement(MaintenanceCompensationState.From(value), Json),
        IncidentFileUpload value => JsonSerializer.SerializeToElement(IncidentFileUploadState.From(value), Json),
        _ => throw new InvalidOperationException("Unsupported incident snapshot.")
    };
    internal sealed record IncidentReportState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid LocationId, Guid? RoomId, string? CommonArea, Guid? AssetId, Guid? ContractId, Guid ReporterId, string ReporterRole, string Description, IncidentSeverity Severity, IncidentStatus Status, string? Type, string? Category, Guid? DuplicateOfId, Guid? AcknowledgedById, DateTimeOffset? AcknowledgedAt, DateTimeOffset? OwnerDecisionAt, string? ResolutionNote, DateTimeOffset? ResolvedAt, int Version)
    {
        internal static IncidentReportState From(IncidentReport value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.LocationId, value.RoomId, value.CommonArea, value.AssetId, value.ContractId, value.ReporterId, value.ReporterRole, value.Description, value.Severity, value.Status, value.Type, value.Category, value.DuplicateOfId, value.AcknowledgedById, value.AcknowledgedAt, value.OwnerDecisionAt, value.ResolutionNote, value.ResolvedAt, value.Version);
        internal IncidentReport ToDomain()
        {
            var row = IncidentReport.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.LocationId = LocationId;
            row.RoomId = RoomId;
            row.CommonArea = CommonArea;
            row.AssetId = AssetId;
            row.ContractId = ContractId;
            row.ReporterId = ReporterId;
            row.ReporterRole = ReporterRole;
            row.Description = Description;
            row.Severity = Severity;
            row.Status = Status;
            row.Type = Type;
            row.Category = Category;
            row.DuplicateOfId = DuplicateOfId;
            row.AcknowledgedById = AcknowledgedById;
            row.AcknowledgedAt = AcknowledgedAt;
            row.OwnerDecisionAt = OwnerDecisionAt;
            row.ResolutionNote = ResolutionNote;
            row.ResolvedAt = ResolvedAt;
            row.Version = Version;
            return row;
        }
    }

    internal sealed record MaintenanceWorkOrderState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? IncidentId, string Source, string Description, string? CommonArea, Guid LocationId, Guid? RoomId, Guid? AssetId, Guid AssignedStaffId, string ExpectedOutcome, DateTimeOffset TargetCompletionAt, WorkOrderStatus Status, string? InspectionResult, string? ProposedSolution, string? Vendor, int? EstimatedMinutes, decimal? EstimatedCost, bool UsesMaterials, int? FastRepairPolicyVersion, string? FastRepairCategory, DateTimeOffset? FastRepairAuthorizedAt, Guid? ProposedAssetId, string? ProposedAssetName, string? ProposedAssetCategory, string? ProposedAssetCondition, bool AssetProposalPending, int ProposalVersion, int? ApprovedProposalVersion, Guid? ApprovedById, DateTimeOffset? ApprovedAt, string? Result, Guid? CompletionActivityId, decimal? ActualCost, Guid? VerifiedById, DateTimeOffset? VerifiedAt, int Version)
    {
        internal static MaintenanceWorkOrderState From(MaintenanceWorkOrder value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.Source, value.Description, value.CommonArea, value.LocationId, value.RoomId, value.AssetId, value.AssignedStaffId, value.ExpectedOutcome, value.TargetCompletionAt, value.Status, value.InspectionResult, value.ProposedSolution, value.Vendor, value.EstimatedMinutes, value.EstimatedCost, value.UsesMaterials, value.FastRepairPolicyVersion, value.FastRepairCategory, value.FastRepairAuthorizedAt, value.ProposedAssetId, value.ProposedAssetName, value.ProposedAssetCategory, value.ProposedAssetCondition, value.AssetProposalPending, value.ProposalVersion, value.ApprovedProposalVersion, value.ApprovedById, value.ApprovedAt, value.Result, value.CompletionActivityId, value.ActualCost, value.VerifiedById, value.VerifiedAt, value.Version);
        internal MaintenanceWorkOrder ToDomain()
        {
            var row = MaintenanceWorkOrder.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.Source = Source;
            row.Description = Description;
            row.CommonArea = CommonArea;
            row.LocationId = LocationId;
            row.RoomId = RoomId;
            row.AssetId = AssetId;
            row.AssignedStaffId = AssignedStaffId;
            row.ExpectedOutcome = ExpectedOutcome;
            row.TargetCompletionAt = TargetCompletionAt;
            row.Status = Status;
            row.InspectionResult = InspectionResult;
            row.ProposedSolution = ProposedSolution;
            row.Vendor = Vendor;
            row.EstimatedMinutes = EstimatedMinutes;
            row.EstimatedCost = EstimatedCost;
            row.UsesMaterials = UsesMaterials;
            row.FastRepairPolicyVersion = FastRepairPolicyVersion;
            row.FastRepairCategory = FastRepairCategory;
            row.FastRepairAuthorizedAt = FastRepairAuthorizedAt;
            row.ProposedAssetId = ProposedAssetId;
            row.ProposedAssetName = ProposedAssetName;
            row.ProposedAssetCategory = ProposedAssetCategory;
            row.ProposedAssetCondition = ProposedAssetCondition;
            row.AssetProposalPending = AssetProposalPending;
            row.ProposalVersion = ProposalVersion;
            row.ApprovedProposalVersion = ApprovedProposalVersion;
            row.ApprovedById = ApprovedById;
            row.ApprovedAt = ApprovedAt;
            row.Result = Result;
            row.CompletionActivityId = CompletionActivityId;
            row.ActualCost = ActualCost;
            row.VerifiedById = VerifiedById;
            row.VerifiedAt = VerifiedAt;
            row.Version = Version;
            return row;
        }
    }

    internal sealed record FastRepairPolicyState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        int Version, string CategoriesJson, Guid ApprovedById, DateTimeOffset ApprovedAt)
    {
        internal static FastRepairPolicyState From(FastRepairPolicy value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.Version, value.CategoriesJson, value.ApprovedById, value.ApprovedAt);
        internal FastRepairPolicy ToDomain()
        {
            var row = FastRepairPolicy.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.Version = Version;
            row.CategoriesJson = CategoriesJson;
            row.ApprovedById = ApprovedById;
            row.ApprovedAt = ApprovedAt;
            return row;
        }
    }

    internal sealed record IncidentActivityState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? IncidentId, Guid? WorkOrderId, Guid ActorId, string Action, string Note, bool TenantVisible, string DataJson, DateTimeOffset OccurredAt)
    {
        internal static IncidentActivityState From(IncidentActivity value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.WorkOrderId, value.ActorId, value.Action, value.Note, value.TenantVisible, value.DataJson, value.OccurredAt);
        internal IncidentActivity ToDomain()
        {
            var row = IncidentActivity.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.WorkOrderId = WorkOrderId;
            row.ActorId = ActorId;
            row.Action = Action;
            row.Note = Note;
            row.TenantVisible = TenantVisible;
            row.DataJson = DataJson;
            row.OccurredAt = OccurredAt;
            return row;
        }
    }

    internal sealed record IncidentEvidenceState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? IncidentId, Guid? WorkOrderId, Guid? ActivityId, Guid UploadedById, IncidentEvidenceKind Kind, string ObjectKey, string ContentType, string Sha256, long Length)
    {
        internal static IncidentEvidenceState From(IncidentEvidence value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.WorkOrderId, value.ActivityId, value.UploadedById, value.Kind, value.ObjectKey, value.ContentType, value.Sha256, value.Length);
        internal IncidentEvidence ToDomain()
        {
            var row = IncidentEvidence.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.WorkOrderId = WorkOrderId;
            row.ActivityId = ActivityId;
            row.UploadedById = UploadedById;
            row.Kind = Kind;
            row.ObjectKey = ObjectKey;
            row.ContentType = ContentType;
            row.Sha256 = Sha256;
            row.Length = Length;
            return row;
        }
    }

    internal sealed record EmergencyActionState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid IncidentId, Guid ActivityId, Guid ActorId, decimal? RequestedCost, bool? CostApproved, Guid? CostDecidedById, DateTimeOffset? CostDecidedAt)
    {
        internal static EmergencyActionState From(EmergencyAction value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.ActivityId, value.ActorId, value.RequestedCost, value.CostApproved, value.CostDecidedById, value.CostDecidedAt);
        internal EmergencyAction ToDomain()
        {
            var row = EmergencyAction.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.ActivityId = ActivityId;
            row.ActorId = ActorId;
            row.RequestedCost = RequestedCost;
            row.CostApproved = CostApproved;
            row.CostDecidedById = CostDecidedById;
            row.CostDecidedAt = CostDecidedAt;
            return row;
        }
    }

    internal sealed record MaintenanceExpenseState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? IncidentId, Guid LocationId, Guid? RoomId, Guid? AssetId, Guid? WorkOrderId, Guid? EmergencyActionId, string Category, string SourceType, Guid SourceId, decimal Amount, DateOnly ExpenseDate, Guid ConfirmedById, DateTimeOffset ConfirmedAt)
    {
        internal static MaintenanceExpenseState From(MaintenanceExpense value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.LocationId, value.RoomId, value.AssetId, value.WorkOrderId, value.EmergencyActionId, value.Category, value.SourceType, value.SourceId, value.Amount, value.ExpenseDate, value.ConfirmedById, value.ConfirmedAt);
        internal MaintenanceExpense ToDomain()
        {
            var row = MaintenanceExpense.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.LocationId = LocationId;
            row.RoomId = RoomId;
            row.AssetId = AssetId;
            row.WorkOrderId = WorkOrderId;
            row.EmergencyActionId = EmergencyActionId;
            row.Category = Category;
            row.SourceType = SourceType;
            row.SourceId = SourceId;
            row.Amount = Amount;
            row.ExpenseDate = ExpenseDate;
            row.ConfirmedById = ConfirmedById;
            row.ConfirmedAt = ConfirmedAt;
            return row;
        }
    }

    internal sealed record MaintenanceHistoryState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? IncidentId, Guid? WorkOrderId, Guid ActivityId, Guid LocationId, Guid? RoomId, Guid? AssetId, string? ConditionBefore, string? ConditionAfter, string? StatusBefore, string? StatusAfter, decimal ActualCost, Guid VerifiedById, DateTimeOffset VerifiedAt)
    {
        internal static MaintenanceHistoryState From(MaintenanceHistory value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.WorkOrderId, value.ActivityId, value.LocationId, value.RoomId, value.AssetId, value.ConditionBefore, value.ConditionAfter, value.StatusBefore, value.StatusAfter, value.ActualCost, value.VerifiedById, value.VerifiedAt);
        internal MaintenanceHistory ToDomain()
        {
            var row = MaintenanceHistory.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.WorkOrderId = WorkOrderId;
            row.ActivityId = ActivityId;
            row.LocationId = LocationId;
            row.RoomId = RoomId;
            row.AssetId = AssetId;
            row.ConditionBefore = ConditionBefore;
            row.ConditionAfter = ConditionAfter;
            row.StatusBefore = StatusBefore;
            row.StatusAfter = StatusAfter;
            row.ActualCost = ActualCost;
            row.VerifiedById = VerifiedById;
            row.VerifiedAt = VerifiedAt;
            return row;
        }
    }

    internal sealed record IncidentCommandState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid ActorId, Guid Key, Guid? IncidentId, string Fingerprint, string ResponseJson)
    {
        internal static IncidentCommandState From(IncidentCommand value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.ActorId, value.Key, value.IncidentId, value.Fingerprint, value.ResponseJson);
        internal IncidentCommand ToDomain()
        {
            var row = IncidentCommand.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.ActorId = ActorId;
            row.Key = Key;
            row.IncidentId = IncidentId;
            row.Fingerprint = Fingerprint;
            row.ResponseJson = ResponseJson;
            return row;
        }
    }

    internal sealed record IncidentNotificationState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? IncidentId, Guid? WorkOrderId, Guid LocationId, Guid ActivityId, Guid RecipientId, string Event, bool HighPriority, DateTimeOffset? ReadAt, string DeliveryState, string? DeliveryReference, string? DeliveryError)
    {
        internal static IncidentNotificationState From(IncidentNotification value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.IncidentId, value.WorkOrderId, value.LocationId, value.ActivityId, value.RecipientId, value.Event, value.HighPriority, value.ReadAt, value.DeliveryState, value.DeliveryReference, value.DeliveryError);
        internal IncidentNotification ToDomain()
        {
            var row = IncidentNotification.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.IncidentId = IncidentId;
            row.WorkOrderId = WorkOrderId;
            row.LocationId = LocationId;
            row.ActivityId = ActivityId;
            row.RecipientId = RecipientId;
            row.Event = Event;
            row.HighPriority = HighPriority;
            row.ReadAt = ReadAt;
            row.DeliveryState = DeliveryState;
            row.DeliveryReference = DeliveryReference;
            row.DeliveryError = DeliveryError;
            return row;
        }
    }

    internal sealed record IncidentFileUploadState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid LocationId, string ObjectKey, DateTimeOffset CleanupAfter)
    {
        internal static IncidentFileUploadState From(IncidentFileUpload value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.LocationId, value.ObjectKey, value.CleanupAfter);
        internal IncidentFileUpload ToDomain()
        {
            var row = IncidentFileUpload.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.LocationId = LocationId;
            row.ObjectKey = ObjectKey;
            row.CleanupAfter = CleanupAfter;
            return row;
        }
    }

    internal sealed record MaintenanceCompensationState(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid WorkOrderId, Guid? IncidentId, Guid LocationId, Guid RoomId, Guid ContractId, Guid DepositContractId, decimal ActualRepairCost, decimal Amount, string CollectionMethod, string Status, string Reason, string EvidenceIdsJson, Guid DecidedById, DateTimeOffset DecidedAt, Guid? InvoiceId, DateTimeOffset? DeductedAt, int Version)
    {
        internal static MaintenanceCompensationState From(MaintenanceCompensation value) => new(value.Id, value.CreatedAt, value.UpdatedAt,
            value.WorkOrderId, value.IncidentId, value.LocationId, value.RoomId, value.ContractId, value.DepositContractId, value.ActualRepairCost, value.Amount, value.CollectionMethod, value.Status, value.Reason, value.EvidenceIdsJson, value.DecidedById, value.DecidedAt, value.InvoiceId, value.DeductedAt, value.Version);
        internal MaintenanceCompensation ToDomain()
        {
            var row = MaintenanceCompensation.Rehydrate(Id, CreatedAt, UpdatedAt);
            row.WorkOrderId = WorkOrderId;
            row.IncidentId = IncidentId;
            row.LocationId = LocationId;
            row.RoomId = RoomId;
            row.ContractId = ContractId;
            row.DepositContractId = DepositContractId;
            row.ActualRepairCost = ActualRepairCost;
            row.Amount = Amount;
            row.CollectionMethod = CollectionMethod;
            row.Status = Status;
            row.Reason = Reason;
            row.EvidenceIdsJson = EvidenceIdsJson;
            row.DecidedById = DecidedById;
            row.DecidedAt = DecidedAt;
            row.InvoiceId = InvoiceId;
            row.DeductedAt = DeductedAt;
            row.Version = Version;
            return row;
        }
    }

}
