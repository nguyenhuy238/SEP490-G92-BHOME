using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BHome.Application.StaffOperations;

// Immutable expected quantities captured when the first Main contract activates.
// AssetId can be absent when a configured asset has not yet been physically provisioned.
public sealed record MoveInInventoryItem(Guid Id, Guid? AssetId, string Name, int ExpectedQuantity,
    int? ActualQuantity = null, string? Condition = null, string? Notes = null,
    Guid[]? EvidenceIds = null, Guid? IncidentId = null);
public sealed record MoveInInventorySnapshot(string SourceToken, MoveInInventoryItem[] Items,
    Guid[]? ReinspectionItemIds = null, DateTimeOffset? ReinspectionRequestedAt = null,
    Guid[]? RecheckedItemIds = null);

public sealed record MoveInInventoryView(Guid TaskId, Guid ContractId, Guid RoomId, Guid LocationId,
    string Status, string? Outcome, int Version, DateTimeOffset? DueAt, DateTimeOffset? CompletedAt,
    bool ReadyForHandover, IReadOnlyList<MoveInInventoryItem> Items,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid[]? ReinspectionItemIds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? ReinspectionRequestedAt = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid[]? RecheckedItemIds = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MoveInInventoryItemWrite(int Version, [Range(0, 1000000)] int ActualQuantity,
    [Required] string Condition, [StringLength(2000)] string? Notes = null,
    [MaxLength(5)] Guid[]? EvidenceIds = null, Guid? IncidentId = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MoveInInventoryComplete(int Version, [StringLength(2000)] string? Note = null,
    bool ConfirmNoAssets = false);
