using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
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
            move.Status = MoveOutStatus.Rejected;
            move.PendingReason = reason;
            move.Version++;
            MoveOutEvent(move, "Rejected", reason);
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
                contract.StartDate, contract.EndDate, contract.RentAmount, contract.Terms)];
        var all = await repository.VersionsAsync(contract.RoomId, contract.TenantUserId.Value, t);
        if (all.Count > 500) throw ContractException.Conflict("contract_version_review_required");
        var chain = new HashSet<Guid> { id }; bool changed;
        do { changed = false; foreach (var row in all) if (chain.Contains(row.Id) && row.PreviousContractId is { } parent) changed |= chain.Add(parent); else if (row.PreviousContractId is { } p && chain.Contains(p)) changed |= chain.Add(row.Id); } while (changed);
        return all.Where(c => chain.Contains(c.Id)).Select(c => new ContractVersionView(c.Id, c.PreviousContractId, c.Kind.ToString(), c.Status.ToString(), c.StartDate, c.EndDate,
            user.IsInRole(Roles.Owner) || user.IsInRole(Roles.Tenant) && Actor == c.TenantUserId ? c.RentAmount : null,
            user.IsInRole(Roles.Owner) || user.IsInRole(Roles.Tenant) && Actor == c.TenantUserId ? c.Terms : "")).ToArray();
    }

    public Task<MoveOutView> RequestTerminationAsync(Guid id, TerminationInput x, Guid key, bool expiry, CancellationToken t)
    {
        Validate(x);
        if (!expiry) return RequestRoomTerminationAsync(id, x, key, t);
        return Mutate(id, expiry ? [Roles.Owner] : [Roles.Tenant], async c =>
        {
            if (await Replay(key, expiry ? "expiry" : "terminate-request", new { id, x }, t) is not null) return View((await repository.MoveOutAsync(id, t))!);
            if (c.Status != ContractStatus.Active || await repository.OpenRenewalAsync(id, t)) throw ContractException.Conflict("contract_not_terminable");
            // This legacy expiry route only recovers an actual expired contract.
            // Owner-initiated early return uses the separate audited route.
            if (Today < c.EndDate) throw new ContractException(403, "owner_move_out_initiation_forbidden");
            if (x.ProposedDate < Today || x.ProposedDate < c.EndDate || x.ProposedDate < c.StartDate)
                throw ContractException.Invalid("invalid_move_out_date");
            var previous = await repository.MoveOutAsync(id, t);
            if (previous is not null && previous.Status != MoveOutStatus.Rejected)
                throw ContractException.Conflict("move_out_already_requested");
            // A rejected request can be resubmitted by the tenant or superseded by
            // an Owner-initiated move-out; prior decisions remain in append-only history.
            var m = previous ?? new ContractMoveOut { ContractId = id };
            m.ProposedDate = x.ProposedDate;
            m.Reason = x.Reason.Trim();
            m.RequestedByUserId = Actor;
            m.IsExpiry = expiry && x.ProposedDate >= c.EndDate;
            m.Status = expiry ? MoveOutStatus.Approved : MoveOutStatus.Requested;
            m.ApprovedByUserId = expiry ? Actor : null;
            m.ApprovedAt = expiry ? clock.GetUtcNow() : null;
            m.PendingReason = "inspection_and_financial_dependencies";
            if (previous is null) repository.Add(m);
            else m.Version++;
            if (expiry) await SchedulePersonalTerminationAsync(c, m, t);
            MoveOutEvent(m, expiry ? "OwnerMoveOutOpened" : "Requested");
            Audit(expiry ? "ContractOwnerMoveOutOpened" : "ContractMoveOutRequested", id);
            Remember(key, expiry ? "expiry" : "terminate-request", new { id, x }, m.Id);
            return View(m);
        }, t);
    }
    public Task<MoveOutView> RequestOwnerMoveOutAsync(Guid id, TerminationInput input, Guid key, CancellationToken t)
    {
        Validate(input);
        if (string.IsNullOrWhiteSpace(input.Reason)) throw ContractException.Invalid("invalid_contract_input");
        return Mutate(id, [Roles.Owner], async contract =>
        {
            var fingerprint = new { id, input };
            if (await Replay(key, "owner-move-out", fingerprint, t) is not null)
                return View(await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing());
            if (contract.Status != ContractStatus.Active || contract.Kind is not (ContractKind.Main or ContractKind.Renewal) ||
                await repository.OpenRenewalAsync(id, t))
                throw ContractException.Conflict("contract_not_terminable");
            if (input.ProposedDate < Today || input.ProposedDate < contract.EndDate || input.ProposedDate < contract.StartDate)
                throw ContractException.Invalid("invalid_move_out_date");
            // Physical room inspection and settlement must not overlap another active lease.
            var active = await repository.RoomActiveContractsAsync(contract.RoomId, t);
            if (active.Any(c => c.Id != id))
                throw ContractException.Conflict("owner_move_out_multiple_active_contracts");
            var previous = await repository.MoveOutAsync(id, t);
            if (previous is not null && previous.Status != MoveOutStatus.Rejected)
                throw ContractException.Conflict("move_out_already_requested");
            var move = previous ?? new ContractMoveOut { ContractId = id };
            move.ProposedDate = input.ProposedDate;
            move.Reason = input.Reason.Trim();
            move.RequestedByUserId = Actor;
            move.IsExpiry = input.ProposedDate >= contract.EndDate;
            move.Status = MoveOutStatus.Approved;
            move.ApprovedByUserId = Actor;
            move.ApprovedAt = clock.GetUtcNow();
            move.PendingReason = "inspection_and_financial_dependencies";
            if (previous is null) repository.Add(move); else move.Version++;
            await SchedulePersonalTerminationAsync(contract, move, t);
            MoveOutEvent(move, "OwnerMoveOutOpened");
            Audit("ContractOwnerMoveOutOpened", id);
            Remember(key, "owner-move-out", fingerprint, move.Id);
            return View(move);
        }, t);
    }
    public async Task<MoveOutView> GetMoveOutAsync(Guid id, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var move = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (user.IsInRole(Roles.Tenant) && contract.TenantUserId != Actor)
            throw ContractException.Missing();
        var view = View(move);
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault();
        view = view with
        {
            OwnerConfirmedInspection = inspection?.OwnerDecision == "Confirmed",
            FinancialReviewStatus = move.SettlementApprovedAt is null ? "PendingReview" : "OwnerReviewed"
        };
        return view with { EvidenceIds = (await repository.InspectionEvidenceAsync(id, t)).Where(e => e.IsLinked || e.UploadedByUserId == Actor).Select(e => e.Id).ToArray() };
    }
    public Task<MoveOutView> ApproveTerminationAsync(Guid id, Guid key, CancellationToken t, int? expectedVersion = null) => Mutate(id, [Roles.Owner], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        object fingerprint = expectedVersion is null ? id : new { id, expectedVersion };
        if (await Replay(key, "terminate-approve", fingerprint, t) is not null) return View(m);
        if (c.Status != ContractStatus.Active || m.Status != MoveOutStatus.Requested ||
            c.TenantUserId != m.RequestedByUserId || await repository.OpenRenewalAsync(c.Id, t) ||
            expectedVersion is { } version && m.Version != version)
            throw ContractException.Conflict("move_out_not_pending_approval");
        m.Status = MoveOutStatus.Approved;
        m.ApprovedByUserId = Actor;
        m.ApprovedAt = clock.GetUtcNow();
        m.Version++;
        await SchedulePersonalTerminationAsync(c, m, t);
        MoveOutEvent(m, m.Status == MoveOutStatus.Completed ? "PersonalTerminationCompletedByOwner" : "Approved");
        Audit("ContractMoveOutApproved", id); Remember(key, "terminate-approve", fingerprint, m.Id); return View(m);
    }, t);
    public Task<MoveOutView> ScheduleInspectionAsync(Guid id, InspectionScheduleInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Staff], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "inspection-schedule", new { id, x }, t) is not null) return View(m);
        if (m.Status != MoveOutStatus.Approved || m.PendingReason == PersonalTerminationScheduled || x.ScheduledAt < clock.BusinessUtcNow() || x.ScheduledAt.Offset != TimeSpan.Zero) throw ContractException.Invalid("invalid_inspection_schedule");
        if (x.ExpectedVersion is { } version && version != m.Version) throw ContractException.Conflict("move_out_version_changed");
        var staff = x.StaffUserId ?? (user.IsInRole(Roles.Staff) ? Actor : (Guid?)null);
        if (staff == Guid.Empty || staff is { } assignee && (!await repository.ActiveUserInRoleAsync(assignee, Roles.Staff, t) || !await repository.StaffAssignedAsync(assignee, c.Room.LocationId, Today, t))) throw ContractException.Invalid("inspection_staff_not_assigned");
        if (handoverRepository is not null)
            await handoverRepository.EnsureMoveOutTaskAssigneeAsync(id, staff, t);
        m.InspectionStaffId = staff; m.InspectionScheduledAt = x.ScheduledAt; m.Version++; MoveOutEvent(m, "Scheduled"); Audit("ContractInspectionScheduled", id); Remember(key, "inspection-schedule", new { id, x }, m.Id); return View(m);
    }, t);
    public Task<MoveOutView> InspectAsync(Guid id, InspectionInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Staff], async c =>
        {
            var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (await Replay(key, "inspection", new { id, x }, t) is not null) return View(m);
            if (m.Status != MoveOutStatus.Approved || m.PendingReason == PersonalTerminationScheduled || Today < m.ProposedDate)
                throw ContractException.Conflict("move_out_not_ready_for_inspection");
            if (m.InspectionStaffId is { } staff && staff != Actor) throw ContractException.Missing();
            if (x.ExpectedVersion is { } expected && expected != m.Version) throw ContractException.Conflict("move_out_version_changed");
            if (handoverRepository is not null)
                await handoverRepository.RequireMoveOutTaskStartedAsync(id, Actor, t);
            if (!await repository.ValidFinalReadingAsync(x.ElectricityReadingId, c.Id, c.RoomId, UtilityType.Electricity, Today, t) ||
                !await repository.ValidFinalReadingAsync(x.WaterReadingId, c.Id, c.RoomId, UtilityType.Water, Today, t))
                throw ContractException.Conflict("confirmed_final_readings_required");
            var generalEvidence = x.EvidenceIds ?? [];
            if (generalEvidence.Contains(Guid.Empty) || generalEvidence.Distinct().Count() != generalEvidence.Length)
                throw ContractException.Invalid("duplicate_inspection_evidence");
            var evidence = (await repository.InspectionEvidenceAsync(id, t)).Where(e => generalEvidence.Contains(e.Id)).ToArray();
            if (evidence.Length != generalEvidence.Length || evidence.Any(e => e.IsLinked || e.UploadedByUserId != Actor)) throw ContractException.Conflict("inspection_evidence_not_available");
            // RecordFinalInspection verifies, hashes and links every uploaded
            // photo together with its exact checklist category. Linking here
            // would make that later ownership/integrity check reject it.
            m.ElectricityReadingId = x.ElectricityReadingId; m.WaterReadingId = x.WaterReadingId; m.InspectionNotes = x.Notes?.Trim() ?? "";
            m.InspectedByUserId = Actor; m.InspectedAt = clock.BusinessUtcNow(); m.Status = MoveOutStatus.Inspected;
            var forced = Forced(m);
            await RecordFinalInspection(c, x, t); m.Version++;
            m.PendingReason = forced ? ForcedInspectionSaved : "financial_ledger_and_deposit_policy";
            MoveOutEvent(m, forced ? "ForcedInspected" : "Inspected");
            if (handoverRepository is not null)
            {
                if (forced) await handoverRepository.SubmitForcedMoveOutTaskAsync(id, Actor, clock.GetUtcNow(), t);
                else await handoverRepository.SubmitMoveOutTaskAsync(id, Actor, clock.GetUtcNow(), t);
            }
            Audit(forced ? "ContractForcedMoveOutInspected" : "ContractMoveOutInspected", id);
            Remember(key, "inspection", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public Task<MoveOutView> SettleAsync(Guid id, SettlementInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Owner], async c =>
        {
            var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (Forced(m)) throw ContractException.Conflict("forced_move_out_read_only");
            if (await Replay(key, "settlement", new { id, x }, t) is not null) return View(m);
            var physicallyCompleted = m.Status == MoveOutStatus.Completed && c.Status == ContractStatus.Terminated;
            if (!physicallyCompleted && (m.Status is not (MoveOutStatus.Inspected or MoveOutStatus.PendingSettlement or MoveOutStatus.Settled) || c.Status != ContractStatus.Active)) throw ContractException.Conflict("inspection_required");
            m.SettlementDecision = x.Decision.Trim();
            if (!physicallyCompleted) m.Status = MoveOutStatus.PendingSettlement;
            m.SettlementApprovedByUserId = null; m.SettlementApprovedAt = null; m.SettlementLedgerReference = null;
            var result = await ledger.ReadAsync(id, m.ElectricityReadingId!.Value, m.WaterReadingId!.Value, t);
            var summary = ledger is IContractSettlementDetails details ? await details.SummaryAsync(id, t) : null;
            if (summary is { Resolved: true } && x.ExpectedReference != summary.Reference) throw ContractException.Conflict("settlement_review_changed");
            if (result is { AllObligationsResolved: true, DepositResolved: true, TransfersVerified: true } && !string.IsNullOrWhiteSpace(result.DecisionReference))
            {
                if (!physicallyCompleted) m.Status = MoveOutStatus.Settled;
                m.SettlementApprovedByUserId = Actor; m.SettlementApprovedAt = clock.GetUtcNow(); m.PendingReason = "";
                m.SettlementLedgerReference = result.DecisionReference;
            }
            else m.PendingReason = summary?.UnresolvedItems.FirstOrDefault() ?? "financial_ledger_and_deposit_policy";
            m.Version++; MoveOutEvent(m, m.SettlementApprovedAt is not null ? "Settled" : "PendingSettlement");
            repository.Add(new ContractSettlementReview
            {
                ContractId = id,
                Decision = m.SettlementDecision,
                LedgerReference = m.SettlementLedgerReference,
                Settled = m.SettlementApprovedAt is not null,
                ReviewedByUserId = Actor,
                ReviewedAt = clock.GetUtcNow()
                ,
                FinancialSnapshot = summary is null ? "{}" : JsonSerializer.Serialize(summary)
            });
            Audit("ContractSettlementReviewed", id); Remember(key, "settlement", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public async Task<IReadOnlyList<SettlementReviewView>> SettlementHistoryAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Tenant], t);
        return (await repository.SettlementReviewsAsync(id, t)).Select(r => new SettlementReviewView(r.Id, r.Decision, r.Settled, r.ReviewedByUserId, r.ReviewedAt, r.FinancialSnapshot)).ToArray();
    }
    public Task<ContractView> CompleteAsync(Guid id, CompletionInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "complete", new { id, x }, t) is not null) return View(c);
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (Forced(m)) throw ContractException.Conflict("forced_move_out_read_only");
        if (c.Status != ContractStatus.Active || m.Status is not (MoveOutStatus.Inspected or MoveOutStatus.PendingSettlement or MoveOutStatus.Settled) || m.InspectedAt is null ||
            x.ActualEndDate < m.ProposedDate || x.ActualEndDate != DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(m.InspectedAt.Value, "Asia/Ho_Chi_Minh").DateTime) || x.ActualEndDate > Today)
            throw ContractException.Conflict("move_out_handover_required");
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault();
        if (inspection?.OwnerDecision != "Confirmed") throw ContractException.Conflict("owner_confirmed_inspection_required");
        var observed = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot) ?? throw ContractException.Conflict("inspection_snapshot_invalid");
        if (observed.Date != x.ActualEndDate || observed.Electricity.Id != m.ElectricityReadingId || observed.Water.Id != m.WaterReadingId)
            throw ContractException.Conflict("inspection_snapshot_invalid");
        await VerifyFinalMoveOutReadingsAsync(c, observed, x.ActualEndDate, t);
        c.Status = ContractStatus.Terminated; c.ActualEndDate = x.ActualEndDate;
        var otherActive = await repository.HasOtherActiveContractsAsync(c.RoomId, c.Id, t);
        if (!otherActive && handoverInventory is not null && x.RoomDisposition is not ("Available" or "Unavailable"))
            throw ContractException.Invalid("owner_room_disposition_required");
        if (x.RoomDisposition is not null && x.RoomDisposition is not ("Available" or "Unavailable")) throw ContractException.Invalid("invalid_room_disposition");
        ChangeRoomStatus(c, otherActive ? RoomStatus.Occupied : x.RoomDisposition == "Unavailable" ? RoomStatus.Unavailable : c.Room.Status == RoomStatus.Occupied ? RoomStatus.Available : c.Room.Status,
            RoomTransitionSource.ContractTermination, otherActive);
        // Move-Out records a versioned physical inspection, not a handover
        // document. The authoritative evidence is the persisted final-inspection
        // JSON, private linked photos, confirmed meter readings and Owner review.
        // Do not generate a PDF or attach Owner/Tenant signers to this workflow.
        m.Status = MoveOutStatus.Completed; m.Version++; MoveOutEvent(m, "Completed");
        foreach (var r in c.Residents) r.ResidenceTo = x.ActualEndDate;
        await repository.CloseResidenceAsync(c, x.ActualEndDate, Actor, clock.GetUtcNow(), t);
        Audit("ContractTerminationCompleted", id); Remember(key, "complete", new { id, x }, id); return View(c);
    }, t);

    public async Task<ContractId> UploadInspectionEvidenceAsync(Guid id, Stream input, CancellationToken t)
    {
        Role(Roles.Staff); await Load(id, [Roles.Staff], t);
        using var buffer = new MemoryStream();
        var block = new byte[81920];
        while (true)
        {
            var read = await input.ReadAsync(block, t); if (read == 0) break;
            if (buffer.Length + read > 5 * 1024 * 1024) throw new ContractException(413, "inspection_image_too_large");
            await buffer.WriteAsync(block.AsMemory(0, read), t);
        }
        var bytes = buffer.ToArray(); var type = images.Validate(bytes);
        return await Mutate(id, [Roles.Staff], async c =>
        {
            var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (m.Status != MoveOutStatus.Approved || (await repository.InspectionEvidenceAsync(id, t)).Count >= 50)
                throw ContractException.Conflict("inspection_upload_not_allowed");
            if (handoverRepository is not null)
                await handoverRepository.RequireMoveOutTaskStartedAsync(id, Actor, t);
            var e = new ContractInspectionEvidence { ContractId = id, UploadedByUserId = Actor, ContentType = type };
            e.ObjectKey = PrivateImageKeys.Evidence(c.Room.LocationId, c.RoomId, "move-out", id, e.Id);
            await files.PutAsync(c.RoomId, e.ObjectKey, bytes, type, t); repository.Add(e); Audit("ContractInspectionEvidenceAdded", id); return new ContractId(e.Id);
        }, t);
    }
    public async Task CopyInspectionEvidenceAsync(Guid id, Guid evidenceId, Stream output, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var evidence = (await repository.InspectionEvidenceAsync(id, t)).SingleOrDefault(e => e.Id == evidenceId)
            ?? throw ContractException.Missing();
        if (!evidence.IsLinked && evidence.UploadedByUserId != Actor)
        {
            var draft = user.IsInRole(Roles.Owner) ? await ReadOwnerMoveOutDraft(contract, t) : null;
            if (draft is null || draft.StaffUserId != evidence.UploadedByUserId ||
                !draft.EvidenceIds.Concat(draft.KeyEvidenceIds)
                    .Concat(draft.RoomChecks.SelectMany(check => check.EvidenceIds))
                    .Concat(draft.Assets.SelectMany(asset => asset.EvidenceIds ?? []))
                    .Concat((draft.PhysicalItemEvidence ?? []).SelectMany(item => item.EvidenceIds))
                    .Contains(evidenceId))
                throw ContractException.Missing();
        }
        using var bytes = new MemoryStream(); await storage.CopyToAsync(evidence.ObjectKey, bytes, t);
        var recorded = (await repository.FinalInspectionsAsync(id, t)).Select(i => JsonSerializer.Deserialize<HandoverSnapshot>(i.ObservedSnapshot))
            .FirstOrDefault(s => s?.EvidenceHashes?.ContainsKey(evidenceId) == true);
        if (recorded?.EvidenceHashes is { } hashes && FileHash(bytes) != hashes[evidenceId]) throw ContractException.Conflict("inspection_evidence_integrity_failed");
        bytes.Position = 0; await bytes.CopyToAsync(output, t);
    }
}
