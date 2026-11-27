using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private sealed record RejectedMoveOutSnapshot(MoveOutView Request, string Reason);
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
    private void MoveOutEvent(ContractMoveOut m, string action, string? rejectionReason = null,
        Guid? authorizedOwner = null) => repository.Add(new ContractMoveOutHistory
        {
            ContractId = m.ContractId,
            Version = m.Version,
            Action = action,
            Snapshot = rejectionReason is null ? System.Text.Json.JsonSerializer.Serialize(View(m))
            : System.Text.Json.JsonSerializer.Serialize(new RejectedMoveOutSnapshot(View(m), rejectionReason)),
            ActorId = authorizedOwner ?? Actor,
            OccurredAt = clock.GetUtcNow()
        });
    public async Task<IReadOnlyList<MoveOutHistoryView>> MoveOutHistoryAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var owner = user.IsInRole(Roles.Owner);
        return (await repository.MoveOutHistoryAsync(id, t)).Select(h => new MoveOutHistoryView(
            h.Version, h.Action, h.ActorId, h.OccurredAt, !owner && (h.Action == "Rejected" || h.Action.StartsWith("Consent", StringComparison.Ordinal)) ? "{}" : h.Snapshot)).ToArray();
    }

    public async Task<TerminationReview> GetTerminationReviewAsync(Guid id, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner], t);
        var move = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        var tenant = (await repository.OccupantsAsync(id, t)).FirstOrDefault(o => o.Representative)?.Label;
        var rejected = move.Status == MoveOutStatus.Rejected
            ? (await repository.MoveOutHistoryAsync(id, t)).FirstOrDefault(h => h.Action == "Rejected" && h.Version == move.Version)
            : null;
        var actor = rejected?.ActorId ?? move.ApprovedByUserId;
        var status = move.Status is MoveOutStatus.Requested or MoveOutStatus.Rejected or MoveOutStatus.AwaitingConsent ? move.Status.ToString() : "Approved";
        return new(status, move.Version, contract.Room.Location.Name, contract.Room.RoomNumber, tenant, contract.StartDate, contract.EndDate,
            move.ProposedDate, move.Reason, rejected?.OccurredAt ?? move.ApprovedAt,
            actor is { } actorId ? await repository.DecisionActorNameAsync(actorId, t) : null,
            rejected is null ? null : System.Text.Json.JsonSerializer.Deserialize<RejectedMoveOutSnapshot>(rejected.Snapshot)?.Reason);
    }

    public Task<MoveOutView> RejectTerminationAsync(Guid id, TerminationRejection input, Guid key, CancellationToken t)
    {
        Validate(input);
        var reason = input.Reason.Trim();
        if (reason.Length == 0) throw ContractException.Invalid("move_out_rejection_reason_required");
        var fingerprint = new { id, reason, input.ExpectedVersion };
        return Mutate(id, [Roles.Owner], async contract =>
        {
            var move = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (await Replay(key, "terminate-reject", fingerprint, t) is not null) return View(move);
            if (contract.Status != ContractStatus.Active || move.Status != MoveOutStatus.Requested ||
                input.ExpectedVersion is { } version && move.Version != version)
                throw ContractException.Conflict("move_out_not_pending_approval");
            var consent = await ReadConsent(id, t);
            var linkedMoves = new List<ContractMoveOut> { move };
            if (consent is not null)
            {
                if (consent.PrimaryContractId != id || !consent.Unanimous)
                    throw ContractException.Conflict("move_out_consent_required");
                foreach (var contractId in consent.ContractIds.Where(contractId => contractId != id))
                {
                    var linked = await repository.MoveOutAsync(contractId, t);
                    if (linked?.Status != MoveOutStatus.AwaitingConsent ||
                        (await ReadConsent(contractId, t))?.RequestId != consent.RequestId)
                        throw ContractException.Conflict("move_out_group_changed");
                    linkedMoves.Add(linked);
                }
            }
            // Tenant-facing status keeps the decision reason; the immutable audit
            // snapshot retains the original text even after a later resubmission.
            foreach (var linked in linkedMoves)
            {
                linked.Status = MoveOutStatus.Rejected;
                linked.PendingReason = reason;
                linked.Version++;
                MoveOutEvent(linked, "Rejected", reason);
            }
            Audit("ContractMoveOutRejected", id);
            Remember(key, "terminate-reject", fingerprint, move.Id);
            return View(move);
        }, t);
    }
    public Task<IReadOnlyList<MoveOutAssignment>> AssignmentsAsync(CancellationToken t)
    { Role(Roles.Staff); return repository.AssignmentsAsync(Actor, Today, t); }
    public Task<OwnerMoveOutInboxPage> OwnerMoveOutInboxAsync(int page, int pageSize,
        Guid? locationId, string? status, string? room, CancellationToken t,
        Guid? roomId = null, string? stage = null)
    {
        Role(Roles.Owner);
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100 || room?.Length > 100 ||
            locationId == Guid.Empty || roomId == Guid.Empty || (roomId.HasValue && !locationId.HasValue) || !InboxStage.Valid(stage))
            throw ContractException.Invalid("invalid_pagination");
        MoveOutStatus? state = null;
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<MoveOutStatus>(status, true, out var parsed) || !Enum.IsDefined(parsed))
                throw ContractException.Invalid("invalid_move_out_status");
            state = parsed;
        }
        return repository.OwnerMoveOutInboxAsync(page, pageSize, locationId, state, room?.Trim(), t, roomId, stage);
    }
    public Task<IReadOnlyList<ContractChoice>> MoveOutInboxRoomsAsync(Guid locationId, CancellationToken t)
    {
        Role(Roles.Owner);
        if (locationId == Guid.Empty) throw ContractException.Invalid("invalid_pagination");
        return repository.MoveOutInboxRoomsAsync(locationId, t);
    }
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
