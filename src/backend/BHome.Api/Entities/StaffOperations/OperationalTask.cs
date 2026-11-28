using System.ComponentModel.DataAnnotations.Schema;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Common;
using BHome.Domain.StaffOperations;

namespace BHome.Domain.Billing;

public sealed class OperationalTask : AuditableEntity
{
    public OperationalTask() { }
    public OperationalTask(Guid id)
    {
        if (id == Guid.Empty) throw new ArgumentException("A task identifier is required.", nameof(id));
        Id = id;
    }
    public OperationalTaskKind Kind { get; set; }
    public Guid LocationId { get => StoredLocationId.GetValueOrDefault(); set => StoredLocationId = value; }
    public BHome.Domain.Locations.Location Location { get; set; } = null!;
    public string Title { get => StoredTitle ?? ""; set => StoredTitle = value; }
    public string Requirements { get => Description ?? ""; set => Description = value; }
    public OperationalTaskPriority Priority { get => (OperationalTaskPriority)int.Parse(StoredPriority ?? "0", CultureInfo.InvariantCulture); set => StoredPriority = ((int)value).ToString(CultureInfo.InvariantCulture); }
    public DateTimeOffset? DueAt { get; set; }
    public bool EvidenceRequired { get; set; }
    public Guid? AssignedStaffUserId { get => AssignedUserId; set => AssignedUserId = value; }
    public Guid? AssignmentId { get; set; }
    public DateTimeOffset? AssignedAt { get; set; }
    public string? Result { get; set; }
    public Guid? VerifiedByUserId { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public int Version { get; set; } = 1;
    // Optional Owner-defined work target. These are independent of meter/contract fields.
    public Guid? TargetRoomId { get; set; }
    public Guid? TargetAssetId { get; set; }
    public string? TargetCommonArea { get; set; }
    public string? TargetLabel { get; set; }
    // Meter details remain in the existing table to preserve reading/evidence FKs and API IDs.
    // Kind and database constraints distinguish these from Owner-verified operational work.
    public Guid? ContractId { get; set; }
    // Stored inside Compact24 operational_tasks.task_data.state; no second asset ledger.
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string MoveInInventoryJson { get; set; } = "";
    // Frozen checklist for Location-owned work. AssignmentId tracks current responsibility;
    // Compact24 persists this snapshot in task_data.state across Staff replacements.
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string LocationAssetInventoryJson { get; set; } = "";
    public Guid? BillingRoomId { get; set; }
    public UtilityType? BillingUtilityType { get; set; }
    public Guid? AutomationPlanId { get; set; }
    public Guid? MeterId { get; set; }
    public Meter Meter { get; set; } = null!;
    public ReadingPurpose Purpose { get; set; }
    public DateOnly ReadingDate { get; set; }
    public DateOnly? BillingPeriod { get; set; }
    public MeterTaskStatus Status { get => (MeterTaskStatus)int.Parse(StoredStatus, CultureInfo.InvariantCulture); set => StoredStatus = ((int)value).ToString(CultureInfo.InvariantCulture); }
    public decimal? OcrProposedValue { get; set; }
    public string? OcrImageHash { get; set; }
    public string? OcrEngineVersion { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }

    // Storage fields cover every task discriminator. Staff/meter accessors retain their original typed contract.
    [NotMapped, JsonIgnore] public string TaskType { get; set; } = "";
    [NotMapped, JsonIgnore] public Guid? StoredLocationId { get; set; }
    [NotMapped, JsonIgnore] public Guid? RoomId { get; set; }
    [NotMapped, JsonIgnore] public Guid? AssetId { get; set; }
    [NotMapped, JsonIgnore] public Guid? AssignedUserId { get; set; }
    [NotMapped, JsonIgnore] public Guid? IncidentReportId { get; set; }
    [NotMapped, JsonIgnore] public string? SourceKey { get; set; }
    [NotMapped, JsonIgnore] public string? StoredTitle { get; set; }
    [NotMapped, JsonIgnore] public string? Description { get; set; }
    [NotMapped, JsonIgnore] public string? StoredPriority { get; set; }
    [NotMapped, JsonIgnore] public string StoredStatus { get; set; } = "0";
    [NotMapped, JsonIgnore] public DateTimeOffset? StartsAt { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? EndsAt { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? NextRunAt { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? LockedUntil { get; set; }
    [NotMapped, JsonIgnore] public Guid? LeaseToken { get; set; }
    [NotMapped, JsonIgnore] public int AttemptCount { get; set; }
    [NotMapped, JsonIgnore] public JsonElement TaskData { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement Evidence { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public decimal? EstimatedCost { get; set; }
    [NotMapped, JsonIgnore] public decimal? ApprovedCost { get; set; }
    [NotMapped, JsonIgnore] public Guid? CostApprovedByUserId { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset? CostApprovedAt { get; set; }
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());

    public bool IsOverdue(DateTimeOffset now) => DueAt < now && Status is not (MeterTaskStatus.Completed or MeterTaskStatus.Cancelled);

    public void ApplyAction(string action, DateTimeOffset now, Guid actor)
    {
        if (Kind == OperationalTaskKind.MoveInInventory && action != "start")
            throw new InvalidOperationException("move_in_inventory_workflow_required");
        if (Kind == OperationalTaskKind.LocationAssetHandover && action is not ("start" or "progress" or "blockers" or "submit" or "coordinate"))
            throw new InvalidOperationException("location_asset_handover_workflow_required");
        if (Kind is not (OperationalTaskKind.AdHoc or OperationalTaskKind.MoveInInventory or OperationalTaskKind.LocationAssetHandover))
            throw new InvalidOperationException("meter_workflow_required");
        Status = (action, Status) switch
        {
            ("start", MeterTaskStatus.Assigned) => MeterTaskStatus.InProgress,
            ("progress" or "blockers", MeterTaskStatus.InProgress) => MeterTaskStatus.InProgress,
            ("coordinate", MeterTaskStatus.Assigned or MeterTaskStatus.InProgress or MeterTaskStatus.PendingVerification) => Status,
            ("submit", MeterTaskStatus.InProgress) => MeterTaskStatus.PendingVerification,
            ("verify", MeterTaskStatus.PendingVerification) => MeterTaskStatus.Completed,
            ("rework", MeterTaskStatus.PendingVerification) => MeterTaskStatus.InProgress,
            ("cancel", MeterTaskStatus.Assigned or MeterTaskStatus.InProgress or MeterTaskStatus.PendingVerification) => MeterTaskStatus.Cancelled,
            _ => throw new InvalidOperationException("invalid_task_transition")
        };
        if (action == "verify") { VerifiedByUserId = actor; VerifiedAt = now; CompletedAt = now; }
    }
}
