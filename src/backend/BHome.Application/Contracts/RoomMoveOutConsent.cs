using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

// The roster and each decision are written into the existing append-only
// move-out history, inside the room transaction. No client-supplied user IDs.
public sealed record MoveOutConsentMember(Guid ContractId, Guid ResidentId, Guid UserId);
public sealed record RoomMoveOutConsent(Guid RequestId, Guid PrimaryContractId, Guid InitiatorId,
    Guid[] ContractIds, MoveOutConsentMember[] Members, Guid[] AgreedUserIds)
{
    public Guid[] RequiredUserIds => Members.Select(m => m.UserId).Distinct().Order().ToArray();
    public bool Unanimous => RequiredUserIds.Length > 0 && RequiredUserIds.SequenceEqual(AgreedUserIds.Order());
}

public sealed partial class ContractService
{
    private const string ForcedInspectionPending = "forced_move_out_inspection";
    private const string ForcedInspectionSaved = "forced_move_out_inspected";
    private static bool Forced(ContractMoveOut move) =>
        move.PendingReason is ForcedInspectionPending or ForcedInspectionSaved;

    private async Task<MoveOutConsentMember[]> ConsentRoster(IReadOnlyList<Contract> contracts, CancellationToken t)
    {
        var members = new List<MoveOutConsentMember>();
        foreach (var contract in contracts)
        {
            var ids = contract.Residents.Where(r => r.ResidenceFrom <= Today &&
                (r.ResidenceTo == null || r.ResidenceTo >= Today)).Select(r => r.ResidentId).Distinct().ToArray();
            var residents = await repository.ResidentsAsync(contract.RoomId, ids, t);
            if (ids.Length == 0 || residents.Count != ids.Length)
                throw ContractException.Conflict("move_out_roster_unavailable");
            foreach (var resident in residents)
            {
                var account = resident.TenantUserId ??
                    (resident.Id == contract.RepresentativeResidentId ? contract.TenantUserId : null);
                if (account is not { } tenant || !await repository.ActiveUserInRoleAsync(tenant, Roles.Tenant, t))
                    throw ContractException.Conflict("move_out_member_account_required");
                members.Add(new(contract.Id, resident.Id, tenant));
            }
        }
        if (members.Count == 0 || members.GroupBy(m => m.UserId)
            .Any(g => g.Select(m => m.ResidentId).Distinct().Count() > 1))
            throw ContractException.Conflict("move_out_member_account_required");
        return members.OrderBy(m => m.ContractId).ThenBy(m => m.ResidentId).ToArray();
    }

    private async Task<RoomMoveOutConsent?> ReadConsent(Guid contractId, CancellationToken t)
    {
        var row = (await repository.MoveOutHistoryAsync(contractId, t)).FirstOrDefault(h =>
            h.Action is "ConsentOpened" or "ConsentReady" or "ConsentAgreed" or "ConsentLinked" or "ConsentRejected");
        return row is null ? null : JsonSerializer.Deserialize<RoomMoveOutConsent>(row.Snapshot)
            ?? throw ContractException.Conflict("move_out_consent_integrity_failed");
    }

    private async Task<bool> CurrentConsentMember(Contract contract, CancellationToken t)
    {
        if (contract.Status != ContractStatus.Active) return false;
        var ids = contract.Residents.Where(r => r.ResidenceFrom <= Today &&
            (r.ResidenceTo == null || r.ResidenceTo >= Today)).Select(r => r.ResidentId).ToArray();
        return (await repository.ResidentsAsync(contract.RoomId, ids, t)).Any(r => ids.Contains(r.Id) &&
            (r.TenantUserId ?? (r.Id == contract.RepresentativeResidentId ? contract.TenantUserId : null)) == Actor);
    }

    private void ConsentEvent(ContractMoveOut move, RoomMoveOutConsent consent, string action) =>
        repository.Add(new ContractMoveOutHistory
        {
            ContractId = move.ContractId, Version = move.Version, Action = action,
            Snapshot = JsonSerializer.Serialize(consent), ActorId = Actor, OccurredAt = clock.GetUtcNow()
        });

    private MoveOutView ConsentView(ContractMoveOut move, RoomMoveOutConsent? consent)
    {
        var view = View(move);
        if (consent is null || Forced(move) || move.IsExpiry) return view;
        var waiting = move.Status == MoveOutStatus.AwaitingConsent && !consent.Unanimous;
        return view with
        {
            Status = move.Status == MoveOutStatus.AwaitingConsent && consent.Unanimous
                ? MoveOutStatus.Requested.ToString() : view.Status,
            RequiredConsents = consent.RequiredUserIds.Length,
            ReceivedConsents = consent.AgreedUserIds.Length,
            CanConfirm = waiting && user.IsInRole(Roles.Tenant) &&
                consent.RequiredUserIds.Contains(Actor) && !consent.AgreedUserIds.Contains(Actor),
            IsGroupPrimary = consent.PrimaryContractId == move.ContractId,
            CanReject = waiting && user.IsInRole(Roles.Tenant) && consent.RequiredUserIds.Contains(Actor)
        };
    }

    private Task<MoveOutView> RequestRoomTerminationAsync(Guid id, TerminationInput input, Guid key, CancellationToken t) =>
        Mutate(id, [Roles.Tenant], async contract =>
        {
            var fingerprint = new { id, x = input };
            if (await Replay(key, "terminate-request", fingerprint, t) is not null)
            {
                var saved = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
                return ConsentView(saved, await ReadConsent(id, t));
            }
            var contracts = await repository.RoomActiveContractsAsync(contract.RoomId, t);
            if (!contracts.Any(c => c.Id == id) || string.IsNullOrWhiteSpace(input.Reason))
                throw ContractException.Conflict("contract_not_terminable");
            var roster = await ConsentRoster(contracts, t);
            if (!roster.Any(m => m.ContractId == id && m.UserId == Actor))
                throw ContractException.Missing();
            foreach (var c in contracts)
            {
                if (await repository.OpenRenewalAsync(c.Id, t))
                    throw ContractException.Conflict("contract_not_terminable");
                if (input.ProposedDate < Today || input.ProposedDate < c.StartDate || input.ProposedDate >= c.EndDate)
                    throw ContractException.Invalid("invalid_move_out_date");
                if (await repository.MoveOutAsync(c.Id, t) is { Status: not MoveOutStatus.Rejected })
                    throw ContractException.Conflict("move_out_already_requested");
            }
            var consent = new RoomMoveOutConsent(Guid.NewGuid(), id, Actor,
                contracts.Select(c => c.Id).Order().ToArray(), roster, [Actor]);
            ContractMoveOut? result = null;
            foreach (var c in contracts)
            {
                var previous = await repository.MoveOutAsync(c.Id, t);
                var move = previous ?? new ContractMoveOut { ContractId = c.Id };
                move.ProposedDate = input.ProposedDate;
                move.Reason = input.Reason.Trim();
                move.RequestedByUserId = Actor;
                move.IsExpiry = false;
                move.Status = consent.Unanimous && c.Id == id ? MoveOutStatus.Requested : MoveOutStatus.AwaitingConsent;
                move.ApprovedByUserId = null;
                move.ApprovedAt = null;
                move.PendingReason = consent.Unanimous ? "inspection_and_financial_dependencies" : "move_out_waiting_members";
                if (previous is null) repository.Add(move); else move.Version++;
                ConsentEvent(move, consent, c.Id == id
                    ? consent.Unanimous ? "ConsentReady" : "ConsentOpened" : "ConsentLinked");
                if (c.Id == id) result = move;
            }
            Audit("ContractRoomMoveOutConsentOpened", id);
            Remember(key, "terminate-request", fingerprint, result!.Id);
            return ConsentView(result!, consent);
        }, t);

    private async Task<IReadOnlyList<Contract>> ValidateConsentRoster(Contract contract, RoomMoveOutConsent consent, CancellationToken t)
    {
        var contracts = await repository.RoomActiveContractsAsync(contract.RoomId, t);
        if (!contracts.Select(c => c.Id).Order().SequenceEqual(consent.ContractIds) ||
            !(await ConsentRoster(contracts, t)).SequenceEqual(consent.Members))
            throw ContractException.Conflict("move_out_members_changed");
        foreach (var c in contracts)
            if (await repository.OpenRenewalAsync(c.Id, t))
                throw ContractException.Conflict("move_out_members_changed");
        return contracts;
    }

    public Task<MoveOutView> ConfirmRoomTerminationAsync(Guid id, MoveOutConsentInput input, Guid key, CancellationToken t) =>
        Mutate(id, [Roles.Tenant], async contract =>
        {
            var move = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            var consent = await ReadConsent(id, t) ?? throw ContractException.Conflict("move_out_consent_required");
            var fingerprint = new { id, input };
            if (await Replay(key, "move-out-consent", fingerprint, t) is not null)
                return ConsentView(move, consent);
            if (move.Status != MoveOutStatus.AwaitingConsent || consent.Unanimous ||
                !consent.Members.Any(m => m.ContractId == id && m.UserId == Actor))
                throw ContractException.Conflict("move_out_consent_not_pending");
            if (move.Version != input.ExpectedVersion)
                throw ContractException.Conflict("move_out_version_changed");
            if (input.Confirmed && consent.AgreedUserIds.Contains(Actor))
                throw ContractException.Conflict("move_out_already_consented");
            if (input.Confirmed) await ValidateConsentRoster(contract, consent, t);
            else
            {
                // Cancellation remains possible if the room roster changes.
                if (!await CurrentConsentMember(contract, t))
                    throw ContractException.Missing();
            }
            var next = input.Confirmed
                ? consent with { AgreedUserIds = consent.AgreedUserIds.Append(Actor).Distinct().Order().ToArray() }
                : consent;
            foreach (var contractId in consent.ContractIds)
            {
                var linked = await repository.MoveOutAsync(contractId, t) ?? throw ContractException.Conflict("move_out_group_changed");
                if (linked.Status != MoveOutStatus.AwaitingConsent ||
                    (await ReadConsent(contractId, t))?.RequestId != consent.RequestId)
                    throw ContractException.Conflict("move_out_group_changed");
                linked.Version++;
                linked.Status = !input.Confirmed ? MoveOutStatus.Rejected :
                    next.Unanimous && contractId == next.PrimaryContractId ? MoveOutStatus.Requested : MoveOutStatus.AwaitingConsent;
                linked.PendingReason = !input.Confirmed ? "move_out_member_rejected" :
                    next.Unanimous ? "inspection_and_financial_dependencies" : "move_out_waiting_members";
                ConsentEvent(linked, next, contractId != next.PrimaryContractId ? "ConsentLinked" :
                    !input.Confirmed ? "ConsentRejected" : next.Unanimous ? "ConsentReady" : "ConsentAgreed");
            }
            Audit(input.Confirmed ? "ContractRoomMoveOutConsentAgreed" : "ContractRoomMoveOutConsentRejected", id);
            Remember(key, "move-out-consent", fingerprint, move.Id);
            return ConsentView(move, next);
        }, t);

    private async Task ApproveConsentedRoom(Contract contract, RoomMoveOutConsent consent, CancellationToken t)
    {
        if (consent.PrimaryContractId != contract.Id || !consent.Unanimous)
            throw ContractException.Conflict("move_out_consent_required");
        var contracts = await ValidateConsentRoster(contract, consent, t);
        foreach (var c in contracts)
        {
            var linked = await repository.MoveOutAsync(c.Id, t) ?? throw ContractException.Conflict("move_out_group_changed");
            if (linked.Status != (c.Id == contract.Id ? MoveOutStatus.Requested : MoveOutStatus.AwaitingConsent) ||
                (await ReadConsent(c.Id, t))?.RequestId != consent.RequestId)
                throw ContractException.Conflict("move_out_group_changed");
            linked.Status = MoveOutStatus.Approved;
            linked.ApprovedByUserId = Actor;
            linked.ApprovedAt = clock.GetUtcNow();
            linked.Version++;
            MoveOutEvent(linked, "Approved");
            if (handoverRepository is not null)
                await handoverRepository.EnsureMoveOutTaskAsync(c, linked, Actor, clock.BusinessUtcNow(), t);
        }
    }

    public Task<MoveOutView> RequestForcedMoveOutAsync(Guid id, TerminationInput input, Guid key, CancellationToken t)
    {
        Validate(input);
        return Mutate(id, [Roles.Staff], async contract =>
        {
            var fingerprint = new { id, input };
            if (await Replay(key, "forced-move-out", fingerprint, t) is not null)
                return View(await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing());
            if (contract.Status != ContractStatus.Active || contract.Kind is not (ContractKind.Main or ContractKind.Renewal) ||
                input.ProposedDate != Today || string.IsNullOrWhiteSpace(input.Reason))
                throw ContractException.Conflict("forced_move_out_invalid");
            foreach (var c in await repository.RoomActiveContractsAsync(contract.RoomId, t))
                if (await repository.MoveOutAsync(c.Id, t) is { Status: not MoveOutStatus.Rejected } ||
                    await repository.OpenRenewalAsync(c.Id, t))
                    throw ContractException.Conflict("move_out_already_requested");
            var previous = await repository.MoveOutAsync(id, t);
            var move = previous ?? new ContractMoveOut { ContractId = id };
            move.ProposedDate = Today;
            move.Reason = input.Reason.Trim();
            move.RequestedByUserId = Actor;
            move.IsExpiry = false;
            move.Status = MoveOutStatus.Approved;
            move.ApprovedByUserId = null;
            move.ApprovedAt = null;
            move.PendingReason = ForcedInspectionPending;
            if (previous is null) repository.Add(move); else move.Version++;
            if (handoverRepository is not null)
                await handoverRepository.EnsureMoveOutTaskAsync(contract, move, Actor, clock.BusinessUtcNow(), t);
            MoveOutEvent(move, "ForcedOpened");
            Audit("ContractForcedMoveOutOpened", id);
            Remember(key, "forced-move-out", fingerprint, move.Id);
            return View(move);
        }, t);
    }
}
