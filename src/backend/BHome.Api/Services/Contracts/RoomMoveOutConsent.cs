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

    internal const string PersonalTerminationScheduled = "personal_termination_scheduled";
    internal const string PersonalTerminationCompleted = "personal_termination_completed";

    private Task<MoveOutView> RequestRoomTerminationAsync(Guid id, TerminationInput input, Guid key, CancellationToken t) =>
        Mutate(id, [Roles.Tenant], async contract =>
        {
            if (contract.TenantUserId != Actor) throw ContractException.Missing();
            var fingerprint = new { id, x = input };
            if (await Replay(key, "terminate-request", fingerprint, t) is not null)
                return View(await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing());
            if (contract.Status != ContractStatus.Active || contract.Kind is not (ContractKind.Main or ContractKind.Renewal) ||
                await repository.OpenRenewalAsync(id, t))
                throw ContractException.Conflict("contract_not_terminable");
            if (Today < contract.StartDate) throw ContractException.Conflict("move_out_residence_not_started");
            if (string.IsNullOrWhiteSpace(input.Reason)) throw ContractException.Invalid("invalid_contract_input");
            if (input.ProposedDate < Today.AddDays(30) || input.ProposedDate < contract.StartDate || input.ProposedDate >= contract.EndDate)
                throw ContractException.Invalid("invalid_move_out_date");
            var previous = await repository.MoveOutAsync(id, t);
            if (previous is not null && previous.Status is not (MoveOutStatus.Rejected or MoveOutStatus.AwaitingConsent))
                throw ContractException.Conflict("move_out_already_requested");
            var move = previous ?? new ContractMoveOut { ContractId = id };
            move.ProposedDate = input.ProposedDate;
            move.Reason = input.Reason.Trim();
            move.RequestedByUserId = Actor;
            move.IsExpiry = false;
            move.Status = MoveOutStatus.Requested;
            move.ApprovedByUserId = null;
            move.ApprovedAt = null;
            move.PendingReason = "personal_termination_requested";
            if (previous is null) repository.Add(move); else move.Version++;
            MoveOutEvent(move, "Requested");
            Audit("ContractPersonalTerminationRequested", id);
            Remember(key, "terminate-request", fingerprint, move.Id);
            return View(move);
        }, t);

    // Kept as an explicit rejection for old clients; no shared consent mutation.
    public Task<MoveOutView> ConfirmRoomTerminationAsync(Guid id, MoveOutConsentInput input, Guid key, CancellationToken t) =>
        throw new ContractException(410, "move_out_consent_retired");

    internal static async Task<bool> HasContinuingLeaseAsync(IContractRepository repository, Contract contract,
        DateOnly effectiveDate, CancellationToken t)
    {
        foreach (var other in await repository.RoomActiveContractsAsync(contract.RoomId, t))
        {
            if (other.Id == contract.Id || other.StartDate > effectiveDate) continue;
            var move = await repository.MoveOutAsync(other.Id, t);
            var end = move is { Status: MoveOutStatus.Approved } && move.ProposedDate < other.EndDate
                ? move.ProposedDate : other.EndDate;
            if (end > effectiveDate || end == effectiveDate && other.Id.CompareTo(contract.Id) > 0)
                return true;
        }
        return false;
    }

    private async Task SchedulePersonalTerminationAsync(Contract contract, ContractMoveOut move, CancellationToken t)
    {
        var continuing = await HasContinuingLeaseAsync(repository, contract, move.ProposedDate, t);
        move.PendingReason = continuing ? PersonalTerminationScheduled : "inspection_and_financial_dependencies";
        if (continuing && move.ProposedDate <= Today)
        {
            contract.Status = ContractStatus.Terminated;
            contract.ActualEndDate = move.ProposedDate;
            contract.LifecycleActorId = Actor;
            contract.LifecycleAt = clock.GetUtcNow();
            contract.LifecycleReason = PersonalTerminationCompleted;
            foreach (var resident in contract.Residents) resident.ResidenceTo = move.ProposedDate;
            move.Status = MoveOutStatus.Completed;
            move.PendingReason = PersonalTerminationCompleted;
            await repository.CloseResidenceAsync(contract, move.ProposedDate, Actor, clock.GetUtcNow(), t);
            Audit("ContractPersonalTerminationCompleted", contract.Id);
        }
        if (!continuing)
        {
            move.InspectionScheduledAt = new DateTimeOffset(move.ProposedDate.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
            if (handoverRepository is not null)
                await handoverRepository.EnsureMoveOutTaskAsync(contract, move, Actor, clock.BusinessUtcNow(), t);
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
