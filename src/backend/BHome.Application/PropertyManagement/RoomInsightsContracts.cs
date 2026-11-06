using System.ComponentModel.DataAnnotations;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

public enum RoomReadinessPurpose { Holding, MoveIn }

public sealed record ReadinessFinding(string Code, string Message);
public sealed record RoomReadinessDto(Guid RoomId, string Purpose, string Status, bool IsReady,
    DateOnly EffectiveOn, DateTimeOffset CheckedAt, IReadOnlyList<ReadinessFinding> Blockers,
    IReadOnlyList<ReadinessFinding> Warnings, IReadOnlyList<ReadinessFinding> UnverifiedConditions);

public sealed class RoomHistoryQuery
{
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
    [StringLength(50)] public string? EventType { get; set; }
}

public sealed record RoomHistoryEvent(Guid Id, string EventType, string Source, DateTimeOffset OccurredAt,
    Guid? RelatedId, string Summary);
public sealed record RoomHistoryPage(IReadOnlyList<RoomHistoryEvent> Items, int Page, int PageSize,
    int TotalCount, string Completeness, IReadOnlyList<string> Limitations);

public sealed class OccupancySummaryQuery
{
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
}
public sealed record OccupancySnapshot(int TotalRooms, int AvailableRooms, int OccupiedRooms,
    int OnHoldRooms, int UnavailableRooms, int RoomsWithCurrentVerifiedOccupants,
    int RoomsWithActiveTenancyObligations);
public sealed record HistoricalOccupancy(string Status, DateOnly? From, DateOnly? To,
    int? OccupiedRoomDays, int? RentableRoomDays, decimal? OccupancyRate,
    IReadOnlyList<string> Limitations);
public sealed record OccupancySummaryDto(Guid LocationId, DateOnly AsOf, OccupancySnapshot Snapshot,
    HistoricalOccupancy Historical);

public sealed record MoveInContractEvidence(bool Exists, bool BelongsToRoom, bool PendingActivation,
    bool InEffectivePeriod, int ResidentCount, int VerifiedResidentCount, bool RepresentativeVerified,
    bool HasContractConflict, bool HasConfirmedHandover);
public sealed record RoomReadinessEvidence(bool LocationActive, RoomStatus RoomStatus, int Capacity,
    RoomObligations Obligations, bool HasRentPolicy, int CurrentOccupantCount,
    bool HasElectricityMeter, bool HasWaterMeter, bool HasElectricityBaseline, bool HasWaterBaseline,
    bool HasBlockingAsset, MoveInContractEvidence? Contract);

public sealed record RoomHistoryReadResult(IReadOnlyList<RoomHistoryEvent> Items, int TotalCount,
    bool HasCompletePropertyAudit);
public sealed record OccupancyInterval(Guid RoomId, DateOnly From, DateOnly To);
public sealed record StatusEvidence(Guid TargetId, DateOnly EffectiveOn, DateTimeOffset RecordedAt, int Status);
public sealed record OccupancyReadModel(OccupancySnapshot Snapshot, IReadOnlyList<Guid> RoomIds,
    IReadOnlyList<StatusEvidence> RoomStatuses, IReadOnlyList<StatusEvidence> LocationStatuses,
    IReadOnlyList<OccupancyInterval> OccupancyIntervals, bool CompleteAvailabilityEvidence);

public interface IRoomInsightsRepository
{
    Task<RoomReadinessEvidence> ReadinessAsync(Guid roomId, Guid? contractId, DateOnly effectiveOn,
        CancellationToken token);
    Task<RoomHistoryReadResult> HistoryAsync(Guid roomId, RoomHistoryQuery query,
        DateTimeOffset? fromInclusive, DateTimeOffset? toExclusive, CancellationToken token);
    Task<OccupancyReadModel> OccupancyAsync(Guid locationId, DateOnly today, DateOnly? from,
        DateOnly? to, CancellationToken token);
}
