using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    public Task<ContractSettlementSummary> SettlementSummaryAsync(Guid id, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
    {
        var summary = ledger is IContractSettlementDetails details ? await details.SummaryAsync(id, t) : throw new ContractException(503, "settlement_summary_unavailable");
        return user.IsInRole(Roles.Owner) ? summary : summary with
        {
            ChargeReview = summary.ChargeReview is { } review ? review with { OperationKey = Guid.Empty, Fingerprint = "", ChargeIds = summary.Receivables?.Where(r => r.Charge.RecipientUserIds.Contains(Actor)).Select(r => r.Charge.Id).ToArray() ?? [] } : null,
            Receivables = summary.Receivables?.Where(r => r.Charge.RecipientUserIds.Contains(Actor))
                .Select(r => r with { Charge = r.Charge with { RecipientUserIds = [], OperationKey = Guid.Empty, Fingerprint = "" } }).ToArray()
        };
    }, t);
    private void MoveOutEvent(ContractMoveOut m, string action) => repository.Add(new ContractMoveOutHistory
    {
        ContractId = m.ContractId,
        Version = m.Version,
        Action = action,
        Snapshot = System.Text.Json.JsonSerializer.Serialize(View(m)),
        ActorId = Actor,
        OccurredAt = clock.GetUtcNow()
    });
    public async Task<IReadOnlyList<MoveOutHistoryView>> MoveOutHistoryAsync(Guid id, CancellationToken t)
    { await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t); return (await repository.MoveOutHistoryAsync(id, t)).Select(h => new MoveOutHistoryView(h.Version, h.Action, h.ActorId, h.OccurredAt, h.Snapshot)).ToArray(); }
    public Task<IReadOnlyList<MoveOutAssignment>> AssignmentsAsync(CancellationToken t)
    { Role(Roles.Staff); return repository.AssignmentsAsync(Actor, Today, t); }
    public async Task<IReadOnlyList<ContractVersionView>> VersionsAsync(Guid id, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        if (contract.TenantUserId is null)
            return [new(contract.Id, contract.PreviousContractId, contract.Kind.ToString(), contract.Status.ToString(),
                contract.StartDate, contract.EndDate, contract.MonthlyRent, contract.Terms)];
        var all = await repository.VersionsAsync(contract.RoomId, contract.TenantUserId.Value, t);
        if (all.Count > 500) throw ContractException.Conflict("contract_version_review_required");
        var chain = new HashSet<Guid> { id }; bool changed;
        do { changed = false; foreach (var row in all) if (chain.Contains(row.Id) && row.PreviousContractId is { } parent) changed |= chain.Add(parent); else if (row.PreviousContractId is { } p && chain.Contains(p)) changed |= chain.Add(row.Id); } while (changed);
        return all.Where(c => chain.Contains(c.Id)).Select(c => new ContractVersionView(c.Id, c.PreviousContractId, c.Kind.ToString(), c.Status.ToString(), c.StartDate, c.EndDate,
            user.IsInRole(Roles.Owner) || user.IsInRole(Roles.Tenant) && Actor == c.TenantUserId ? c.MonthlyRent : null,
            user.IsInRole(Roles.Owner) || user.IsInRole(Roles.Tenant) && Actor == c.TenantUserId ? c.Terms : "")).ToArray();
    }
}
