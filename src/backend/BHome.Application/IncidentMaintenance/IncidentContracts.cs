using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record IncidentSubmit(Guid LocationId, Guid? RoomId, string? CommonArea, Guid? AssetId,
    IncidentSeverity Severity, string Description);
public sealed record IncidentImage(byte[] Content);
public sealed record IncidentPage<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);
public sealed class IncidentQuery
{
    [Range(1, 1000000)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? IncidentId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? AssetId { get; set; }
    public IncidentStatus? Status { get; set; }
    public IncidentSeverity? Severity { get; set; }
    public WorkOrderStatus? WorkOrderStatus { get; set; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record IncidentReview(int Version, string Type, string Category);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record IncidentDecision(int Version, string Reason, Guid? DuplicateOfId = null,
    AssetStatus? AssetStatus = null, string? AssetCondition = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WorkOrderAssign(int Version, Guid StaffId, string ExpectedOutcome,
    [property: JsonConverter(typeof(BHome.Application.StaffOperations.TaskOffsetConverter))] DateTimeOffset TargetCompletionAt);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WorkOrderReassign(int Version, Guid StaffId, string Reason);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RepairProposal(int Version, string InspectionResult, string Solution, int EstimatedMinutes,
    decimal? EstimatedCost, Guid[] EvidenceIds);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PlanDecision(int Version, [Required] bool? Approve, string? Reason = null, string? Vendor = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WorkOrderAction(int Version, string? Note = null, Guid[]? EvidenceIds = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MaintenanceVerification(int Version, [Required] decimal? ActualCost, string Result, string? CostVarianceReason,
    string? AssetCondition, AssetStatus AssetStatus = AssetStatus.Active);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DirectCompletion(int Version, [Required] decimal? ActualCost, string Result, Guid[] EvidenceIds,
    string? AssetCondition, AssetStatus AssetStatus = AssetStatus.Active);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record EmergencyEntry(int Version, string Note, Guid[] EvidenceIds, decimal? RequestedCost = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record EmergencyCostDecision(int Version, [Required] bool? Approve, string Reason);

// Tenant views never include internal proposal, vendor, amounts, actor IDs or internal event data.
public sealed record IncidentView(Guid Id, string Code, Guid LocationId, Guid? RoomId, string? CommonArea,
    Guid? AssetId, string Description, string Severity, string Status, string? Type, string? Category,
    DateTimeOffset? AcknowledgedAt, string? ResolutionNote, int Version, DateTimeOffset CreatedAt,
    bool? StaffAvailable, bool EscalationEnabled = false);
public sealed record WorkOrderView(Guid Id, Guid IncidentId, Guid LocationId, Guid? RoomId, Guid? AssetId,
    Guid AssignedStaffId, string ExpectedOutcome, DateTimeOffset TargetCompletionAt, bool IsOverdue,
    string Status, string? InspectionResult, string? ProposedSolution, int? EstimatedMinutes, decimal? EstimatedCost,
    string? Vendor, int ProposalVersion, bool PlanApproved, bool CanStart, Guid? ApprovedById,
    DateTimeOffset? ApprovedAt, string? Result, decimal? ActualCost, Guid? VerifiedById, DateTimeOffset? VerifiedAt, int Version);
public sealed record IncidentActivityView(Guid Id, Guid? WorkOrderId, string Action, string Note,
    DateTimeOffset OccurredAt, Guid? ActorId, string? DataJson);
public sealed record IncidentEvidenceView(Guid Id, Guid? WorkOrderId, Guid? ActivityId, string Kind,
    string ContentType, long Length);
public sealed record IncidentNotificationView(Guid Id, Guid IncidentId, string Event, bool HighPriority,
    DateTimeOffset CreatedAt, DateTimeOffset? ReadAt, string DeliveryState);
public sealed record EmergencyActionView(Guid Id, Guid ActivityId, decimal? RequestedCost, bool? CostApproved);
public sealed record MaintenanceHistoryView(Guid Id, Guid ActivityId, string Action, Guid IncidentId, Guid? WorkOrderId, Guid? RoomId, Guid? AssetId,
    string? ConditionBefore, string? ConditionAfter, string? StatusBefore, string? StatusAfter,
    decimal ActualCost, Guid VerifiedById, DateTimeOffset VerifiedAt);
public sealed record ExpenseView(Guid Id, Guid IncidentId, Guid? WorkOrderId, Guid? EmergencyActionId,
    string Category, decimal Amount, DateOnly ExpenseDate);
public sealed record IncidentCommandResult(Guid IncidentId, Guid? WorkOrderId = null, Guid? ResourceId = null);
public sealed record IncidentScope(Guid ActorId, bool Owner, bool Staff, bool Tenant, DateOnly Today);
public sealed class IncidentLookupQuery
{
    [Range(1, 1000000)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
}
public sealed record IncidentReportingRoom(Guid RoomId, string RoomNumber, Guid LocationId, string LocationName);
public sealed record IncidentReportingAsset(Guid AssetId, string Name, string Category, string Status,
    Guid LocationId, Guid? RoomId, string? CommonArea);
public sealed record IncidentRoom(Guid Id, Guid LocationId);
public sealed record IncidentTenancy(Guid ContractId, Guid RoomId);

public sealed class IncidentException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static IncidentException Invalid(string code) => new(400, code);
    public static IncidentException Missing() => new(404, "incident_resource_not_found");
    public static IncidentException Conflict(string code) => new(409, code);
}

public interface IIncidentFiles
{
    string Validate(byte[] content);
    Task PutAsync(Guid locationId, string key, byte[] content, string contentType, CancellationToken token);
    Task CopyAsync(string key, Stream output, CancellationToken token);
}

public interface IIncidentRepository
{
    Task<T> TransactionAsync<T>(Guid locationId, Guid? roomId, Guid actorId, Guid key, Func<Task<T>> work, CancellationToken t);
    Task<bool> ActiveRoleAsync(Guid actor, string role, CancellationToken t);
    Task<bool> ActiveLocationAsync(Guid id, CancellationToken t);
    Task<bool> StaffAssignedAsync(Guid actor, Guid location, DateOnly today, CancellationToken t);
    Task<bool> StaffAvailableAsync(Guid location, DateOnly today, CancellationToken t);
    Task<IReadOnlyList<Guid>> RecipientsAsync(Guid location, DateOnly today, bool includeStaff, CancellationToken t);
    Task<IncidentRoom?> RoomAsync(Guid id, CancellationToken t);
    Task<IncidentTenancy?> TenancyAsync(Guid actor, Guid location, Guid? room, DateOnly date, CancellationToken t);
    Task<Guid?> ContractRoomAsync(Guid contract, CancellationToken t);
    Task<Asset?> AssetAsync(Guid id, CancellationToken t);
    Task<IncidentReport?> IncidentAsync(Guid id, CancellationToken t);
    Task<MaintenanceWorkOrder?> WorkOrderAsync(Guid id, CancellationToken t);
    Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersAsync(Guid incident, CancellationToken t);
    Task<bool> OtherAssetWorkAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t);
    Task<bool> OtherAssetExecutionAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t);
    Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t);
    Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid incident, CancellationToken t);
    Task<IReadOnlyList<EmergencyAction>> EmergencyActionsAsync(Guid incident, CancellationToken t);
    Task<IncidentPage<IncidentView>> ListAsync(IncidentScope scope, IncidentQuery query, CancellationToken t);
    Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t);
    Task<IncidentPage<IncidentReportingAsset>> ReportingAssetsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t);
    Task<IncidentPage<WorkOrderView>> ListWorkOrdersAsync(IncidentScope scope, IncidentQuery query, DateTimeOffset now, CancellationToken t);
    Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid incident, IncidentScope scope, int page, int size, CancellationToken t);
    Task<IncidentPage<MaintenanceHistoryView>> MaintenanceAsync(IncidentScope scope, IncidentQuery query, CancellationToken t);
    Task<IReadOnlyList<ExpenseView>> ExpensesAsync(Guid incident, CancellationToken t);
    Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(IncidentScope scope, int page, int size, CancellationToken t);
    Task<IncidentNotification?> NotificationAsync(Guid id, Guid actor, CancellationToken t);
    Task FlushAsync(CancellationToken t);
    void Add(object entity);
    void Audit(Guid actor, string action, Guid activityId, DateTimeOffset now);
}
