using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

// Shared only by the contract and handover repositories, scoped to one command.
internal sealed class NativeContractSidecars
{
    private Compact24DbContext? db;
    private readonly Dictionary<Guid, MoveEntry> moves = [];
    private readonly Dictionary<Guid, HandoverEntry> handovers = [];
    private readonly Dictionary<Guid, InspectionEntry> inspections = [];
    private readonly Dictionary<Guid, EvidenceEntry> evidence = [];
    private readonly List<ContractMoveOutHistory> moveHistory = [];
    private readonly List<ContractHandoverHistory> handoverHistory = [];
    private readonly List<ContractSettlementReview> reviews = [];
    private sealed record MoveEntry(ContractMoveOut Value, NativeContractMoveOutPersistence.MoveState? Original);
    private sealed record HandoverEntry(ContractHandover Value, NativeContractMoveOutPersistence.HandoverState? Original);
    private sealed record InspectionEntry(ContractFinalInspection Value, NativeContractMoveOutPersistence.InspectionState? Original);
    private sealed record EvidenceEntry(ContractInspectionEvidence Value, NativeContractMoveOutPersistence.EvidenceState? Original);

    internal bool Active => db is not null;
    internal void Begin(Compact24DbContext context)
    {
        Clear();
        db = context;
    }
    internal void Clear()
    {
        db = null; moves.Clear(); handovers.Clear(); inspections.Clear(); evidence.Clear();
        moveHistory.Clear(); handoverHistory.Clear(); reviews.Clear();
    }
    internal async Task<ContractMoveOut?> MoveAsync(Guid id, CancellationToken t)
    {
        if (moves.TryGetValue(id, out var entry)) return entry.Value;
        var value = await NativeContractMoveOutPersistence.MoveAsync(db!, id, t);
        if (value is not null) moves.Add(id, new(value, NativeContractMoveOutPersistence.Snapshot(value)));
        return value;
    }
    internal async Task<ContractHandover?> HandoverAsync(Guid id, CancellationToken t)
    {
        if (handovers.TryGetValue(id, out var entry)) return entry.Value;
        var value = await NativeContractMoveOutPersistence.HandoverAsync(db!, id, t);
        if (value is not null) handovers.Add(id, new(value, NativeContractMoveOutPersistence.Snapshot(value)));
        return value;
    }
    internal async Task<ContractFinalInspection[]> InspectionsAsync(Guid id, CancellationToken t)
    {
        foreach (var value in await NativeContractMoveOutPersistence.InspectionsAsync(db!, id, t))
            inspections.TryAdd(value.Id, new(value, NativeContractMoveOutPersistence.Snapshot(value)));
        return inspections.Values.Select(e => e.Value).Where(v => v.ContractId == id).OrderByDescending(v => v.Version).Take(100).ToArray();
    }
    internal async Task<ContractInspectionEvidence[]> EvidenceAsync(Guid id, CancellationToken t)
    {
        foreach (var value in await NativeContractMoveOutPersistence.EvidenceAsync(db!, id, t))
            evidence.TryAdd(value.Id, new(value, NativeContractMoveOutPersistence.Snapshot(value)));
        return evidence.Values.Select(e => e.Value).Where(v => v.ContractId == id).Take(50).ToArray();
    }
    internal void Add(ContractMoveOut m) => moves.Add(m.ContractId, new(m, null));
    internal void Add(ContractHandover h) => handovers.Add(h.ContractId, new(h, null));
    internal void Add(ContractFinalInspection i) => inspections.Add(i.Id, new(i, null));
    internal void Add(ContractInspectionEvidence e) => evidence.Add(e.Id, new(e, null));
    internal void Add(ContractMoveOutHistory h) => moveHistory.Add(h);
    internal void Add(ContractHandoverHistory h) => handoverHistory.Add(h);
    internal void Add(ContractSettlementReview r) => reviews.Add(r);

    internal async Task FlushAsync(CancellationToken t)
    {
        if (db is null) return;
        foreach (var (id, entry) in moves.ToArray())
        {
            if (entry.Original == NativeContractMoveOutPersistence.Snapshot(entry.Value)) continue;
            await NativeContractMoveOutPersistence.SaveMoveAsync(db, entry.Value, entry.Original?.Version, t);
            moves[id] = new(entry.Value, NativeContractMoveOutPersistence.Snapshot(entry.Value));
        }
        foreach (var (id, entry) in handovers.ToArray())
        {
            if (entry.Original == NativeContractMoveOutPersistence.Snapshot(entry.Value)) continue;
            await NativeContractMoveOutPersistence.SaveHandoverAsync(db, entry.Value, entry.Original?.Version, t);
            handovers[id] = new(entry.Value, NativeContractMoveOutPersistence.Snapshot(entry.Value));
        }
        foreach (var (id, entry) in inspections.ToArray())
        {
            if (entry.Original == NativeContractMoveOutPersistence.Snapshot(entry.Value)) continue;
            await NativeContractMoveOutPersistence.SaveInspectionAsync(db, entry.Value, entry.Original is null, t);
            inspections[id] = new(entry.Value, NativeContractMoveOutPersistence.Snapshot(entry.Value));
        }
        foreach (var (id, entry) in evidence.ToArray())
        {
            if (entry.Original == NativeContractMoveOutPersistence.Snapshot(entry.Value)) continue;
            await NativeContractMoveOutPersistence.SaveEvidenceAsync(db, entry.Value, entry.Original is null, t);
            evidence[id] = new(entry.Value, NativeContractMoveOutPersistence.Snapshot(entry.Value));
        }
        foreach (var h in moveHistory) await NativeContractMoveOutPersistence.AppendHistoryAsync(db, h, t);
        foreach (var h in handoverHistory) await NativeContractMoveOutPersistence.AppendHistoryAsync(db, h, t);
        foreach (var r in reviews) await NativeContractMoveOutPersistence.AppendReviewAsync(db, r, t);
        moveHistory.Clear(); handoverHistory.Clear(); reviews.Clear();
    }
}
