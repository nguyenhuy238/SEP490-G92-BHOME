using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.Contracts;

// A financial proposal is an auditable offer, not an approved receivable,
// deposit deduction, refund, payment or financial close.
public sealed record MoveOutChargeProposalItem(string Kind, Guid? AssetId, string? RoomCheckCode,
    string? AccessType, string Label, string? Baseline, string? Observed, bool Chargeable,
    Guid[] EvidenceIds, Guid[] BaselineEvidenceIds);

[JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
public sealed record MoveOutProposedCharge(string Kind, Guid? AssetId, string? RoomCheckCode,
    string? AccessType, decimal Amount, string Reason);

public sealed record MoveOutChargeProposalInput(string ExpectedReference, Guid InspectionId, int InspectionVersion,
    MoveOutProposedCharge[] Items, string? Note = null);

public sealed record MoveOutChargeProposalDisputedItem(string Kind, Guid? AssetId, string? RoomCheckCode,
    string? AccessType, string Reason);

public sealed record MoveOutChargeProposalFeedbackInput(Guid ProposalId, string ExpectedReference,
    bool Confirmed, string? Reason = null, MoveOutChargeProposalDisputedItem[]? DisputedItems = null);

public sealed record MoveOutChargeProposalReconcileInput(Guid ProposalId);

[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record MoveOutProposalSettlement(string Status, decimal PayableAmount, decimal RefundAmount,
    Guid? PayableReceivableId, Guid[] CreatedReceivableIds, Guid[] DepositOffsetIds, string? Reason = null);

public sealed record MoveOutChargeProposalFeedback(Guid Id, Guid ContractId, Guid ProposalId, bool Confirmed,
    string Reason, Guid TenantUserId, DateTimeOffset RespondedAt, Guid OperationKey, string Fingerprint,
    MoveOutChargeProposalDisputedItem[]? DisputedItems = null, MoveOutProposalSettlement? Settlement = null,
    string VerifiedPhysicalReference = "");

public sealed record MoveOutChargeProposalSettlementResolution(Guid Id, Guid ContractId, Guid ProposalId,
    Guid FeedbackId, MoveOutProposalSettlement Settlement, DateTimeOffset ReconciledAt, Guid TenantUserId,
    string PhysicalReference);

[JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
public sealed record MoveOutChargeProposal(Guid Id, Guid ContractId, string SourceReference,
    Guid InspectionId, int InspectionVersion, MoveOutProposedCharge[] Items, decimal VerifiedDeposit,
    decimal AvailableDeposit, decimal TotalCharges, decimal SignedBalance, string? Note,
    Guid OwnerUserId, DateTimeOffset SentAt, Guid[] RecipientUserIds, Guid OperationKey,
    string Fingerprint, bool IsDevelopmentDemo = false,
    MoveOutChargeProposalFeedback? TenantFeedback = null, decimal ExistingOutstanding = 0,
    string PhysicalReference = "");

[JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
public sealed record MoveOutChargeProposalPreview(Guid ContractId, string Reference,
    Guid InspectionId, int InspectionVersion, decimal VerifiedDeposit, decimal AvailableDeposit,
    IReadOnlyList<MoveOutChargeProposalItem> Items, MoveOutChargeProposal? LatestProposal, string Status,
    decimal ExistingOutstanding = 0, Guid? BaselineContractId = null);

public sealed record MoveOutChargeProposalSource(SettlementChargeContext Context,
    MoveOutChargeProposalItem[] Items, string Reference, bool StaffInspectionReady,
    Guid? BaselineContractId = null, string PhysicalReference = "");

public sealed partial class SettlementReceivablesService
{
    private static string ProposalItemKey(string kind, Guid? assetId, string? roomCheckCode, string? accessType) =>
        kind switch
        {
            "Asset" when assetId is { } id && id != Guid.Empty && roomCheckCode is null && accessType is null => "Asset:" + id.ToString("N"),
            "RoomCheck" when assetId is null && accessType is null && roomCheckCode is { } code && HandoverRoomChecklist.RequiredCodes.Contains(code) => "RoomCheck:" + code,
            "Access" when assetId is null && roomCheckCode is null && accessType == "RoomKey" => "Access:RoomKey",
            _ => throw ContractException.Invalid("invalid_move_out_proposal_item")
        };

    private static string ProposalFingerprint(Guid id, object input) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { contractId = id, input })));

    // Older immutable offers predate the explicit physicalReference field.
    // Their reconciliation records pin a verified Staff Final snapshot before
    // any money is written. A missing pin alone cannot authorize a payment.
    private static bool MatchesAcceptedPhysical(MoveOutChargeProposal proposal,
        MoveOutChargeProposalFeedback? feedback, MoveOutChargeProposalSource source)
    {
        var pinned = string.IsNullOrWhiteSpace(proposal.PhysicalReference)
            ? feedback?.VerifiedPhysicalReference : proposal.PhysicalReference;
        return !string.IsNullOrWhiteSpace(pinned) && pinned == source.PhysicalReference;
    }

    public static MoveOutChargeProposalDisputedItem[] NormalizeDisputedItems(
        MoveOutChargeProposalDisputedItem[]? items, MoveOutProposedCharge[] offered, bool confirmed)
    {
        if (items is null or { Length: 0 }) return [];
        if (confirmed || items.Length > 250 || items.Any(item => item is null ||
            string.IsNullOrWhiteSpace(item.Reason) || item.Reason.Length > 2000))
            throw ContractException.Invalid("invalid_move_out_proposal_disputed_items");
        var allowed = offered.Select(item => ProposalItemKey(item.Kind, item.AssetId, item.RoomCheckCode, item.AccessType))
            .ToHashSet(StringComparer.Ordinal);
        var normalized = items.Select(item => (Key: ProposalItemKey(item.Kind, item.AssetId,
            item.RoomCheckCode, item.AccessType), Item: item with { Reason = item.Reason.Trim() }))
            .OrderBy(item => item.Key, StringComparer.Ordinal).ToArray();
        if (normalized.Any(item => !allowed.Contains(item.Key)) ||
            normalized.Select(item => item.Key).Distinct(StringComparer.Ordinal).Count() != normalized.Length)
            throw ContractException.Invalid("invalid_move_out_proposal_disputed_items");
        return normalized.Select(item => item.Item).ToArray();
    }

    private async Task<MoveOutChargeProposalPreview> ProposalPreviewAsync(Guid id, CancellationToken token)
    {
        var source = await repository.ProposalSourceAsync(id, token);
        // Access to an older receivable is not permission to inspect the
        // current move-out proposal or its private opening/closing photo IDs.
        if (!user.IsInRole(Roles.Owner) && !source.Context.RecipientUserIds.Contains(Actor))
            throw ContractException.Missing();
        if (source.Context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true)
            throw ContractException.Conflict("development_payment_unavailable");
        var latest = await repository.LatestProposalAsync(id, token);
        var feedback = latest is null ? null : await repository.ProposalFeedbackAsync(id, latest.Id, token);
        if (latest is not null) latest = latest with { TenantFeedback = feedback };
        if (latest is not null && !user.IsInRole(Roles.Owner) && !latest.RecipientUserIds.Contains(Actor))
            latest = null;
        else if (latest is not null && !user.IsInRole(Roles.Owner))
            latest = latest with
            {
                OwnerUserId = Guid.Empty,
                RecipientUserIds = [],
                OperationKey = Guid.Empty,
                Fingerprint = "",
                TenantFeedback = feedback is null ? null : feedback with
                { TenantUserId = Guid.Empty, OperationKey = Guid.Empty, Fingerprint = "" }
            };
        var settledQuoteStillPhysical = feedback?.Confirmed == true && feedback.Settlement is { Status: not "PendingOwnerReview" } &&
            latest is not null && MatchesAcceptedPhysical(latest, feedback, source);
        var status = latest is null ? "None" : latest.SourceReference != source.Reference && !settledQuoteStillPhysical
            ? "Outdated" : feedback is null ? "PendingTenant" : feedback.Confirmed ? "Accepted" : "Disputed";
        return new(id, source.Reference, source.Context.InspectionId, source.Context.InspectionVersion,
            source.Context.VerifiedDeposit, source.Context.View.AvailableDeposit, source.Items, latest, status,
            source.Context.View.Receivables.Sum(row => row.Outstanding), source.BaselineContractId);
    }

    public async Task<MoveOutChargeProposalPreview> GetProposalAsync(Guid id, CancellationToken token)
    {
        await AuthorizeAsync(id, false, token);
        return await ProposalPreviewAsync(id, token);
    }

    // A confirmed proposal's physical snapshot stays immutable after deposit
    // offsets, but its monetary balance may change when later ledger activity
    // reserves/refunds deposit or creates a new invoice. A refund petition must
    // be validated against today's verified ledger, not only that snapshot.
    public async Task<bool> HasCurrentMoveOutRefundBalanceAsync(Guid id, decimal expectedAmount,
        CancellationToken token)
    {
        await AuthorizeAsync(id, false, token);
        var source = await repository.ProposalSourceAsync(id, token);
        var proposal = await repository.LatestProposalAsync(id, token);
        if (proposal is null)
            return false;
        var feedback = await repository.ProposalFeedbackAsync(id, proposal.Id, token);
        if (feedback?.Confirmed != true || feedback.Settlement?.Status != "RefundEligible" ||
            feedback.Settlement.RefundAmount != expectedAmount ||
            !MatchesAcceptedPhysical(proposal, feedback, source))
            return false;
        var context = await repository.ContextAsync(id, token);
        return MoveOutProposalSettlementRules.MatchesCurrentRefundBalance(context, expectedAmount);
    }

    // Reconcile an older, already-accepted proposal whose original response was
    // stored before the owner-fee-proposal rule replaced the physical Owner
    // review gate. This is an authenticated POST because it can create ledger
    // entries. The Tenant's original consent and response are immutable.
    public async Task<MoveOutChargeProposalFeedback> ReconcileAcceptedProposalAsync(
        Guid id, MoveOutChargeProposalReconcileInput input, CancellationToken token)
    {
        if (!user.IsInRole(Roles.Tenant)) throw new ContractException(403, "tenant_required");
        await AuthorizeAsync(id, false, token);
        if (input is null || input.ProposalId == Guid.Empty)
            throw ContractException.Invalid("invalid_move_out_proposal_reconciliation");
        return await repository.TransactionAsync(id, async () =>
        {
            await AuthorizeAsync(id, false, token);
            if (await repository.LatestFinancialCloseAsync(id, token) is not null)
                throw ContractException.Conflict("settlement_financial_already_closed");
            var latest = await repository.LatestProposalAsync(id, token);
            if (latest is null || latest.Id != input.ProposalId ||
                !latest.RecipientUserIds.Contains(Actor))
                throw ContractException.Conflict("move_out_proposal_changed");
            var feedback = await repository.ProposalFeedbackAsync(id, latest.Id, token);
            if (feedback?.Confirmed != true || feedback.TenantUserId != Actor)
                throw ContractException.Conflict("move_out_proposal_tenant_confirmation_required");
            if (feedback.Settlement is { Status: "Payable" or "RefundEligible" or "Settled" })
                return feedback;
            var source = await repository.ProposalSourceAsync(id, token);
            if (source.Reference != latest.SourceReference ||
                !string.IsNullOrWhiteSpace(latest.PhysicalReference) &&
                source.PhysicalReference != latest.PhysicalReference ||
                source.Context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true)
                throw ContractException.Conflict("move_out_proposal_changed");
            var settlement = await MaterializeAcceptedProposalAsync(id, latest, source, token);
            if (settlement.Status == "PendingOwnerReview")
                return feedback with { Settlement = settlement };
            await repository.SaveProposalSettlementResolutionAsync(new(
                Guid.NewGuid(), id, latest.Id, feedback.Id, settlement, clock.GetUtcNow(), Actor,
                source.PhysicalReference), token);
            return feedback with { Settlement = settlement, VerifiedPhysicalReference = source.PhysicalReference };
        }, token);
    }

    public async Task<MoveOutChargeProposal> SendProposalAsync(Guid id, MoveOutChargeProposalInput input,
        Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || input is null || string.IsNullOrWhiteSpace(input.ExpectedReference) ||
            input.InspectionId == Guid.Empty || input.InspectionVersion < 1 || input.Items is null or { Length: > 250 } ||
            input.Note?.Length > 2000 || input.Items.Any(item => item is null ||
                !PaymentRules.ValidMoney(item.Amount) || string.IsNullOrWhiteSpace(item.Reason) || item.Reason.Length > 2000))
            throw ContractException.Invalid("invalid_move_out_proposal");
        var items = input.Items.Select(item => item with { Reason = item.Reason.Trim() })
            .OrderBy(item => ProposalItemKey(item.Kind, item.AssetId, item.RoomCheckCode, item.AccessType), StringComparer.Ordinal)
            .ToArray();
        var keys = items.Select(item => ProposalItemKey(item.Kind, item.AssetId, item.RoomCheckCode, item.AccessType)).ToArray();
        if (keys.Distinct(StringComparer.Ordinal).Count() != keys.Length)
            throw ContractException.Invalid("duplicate_move_out_proposal_item");
        var normalized = input with { Items = items, Note = input.Note?.Trim() };
        var fingerprint = ProposalFingerprint(id, normalized);
        return await repository.TransactionAsync(id, async () =>
        {
            var previous = await repository.ProposalOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.ContractId != id || previous.Fingerprint != fingerprint)
                    throw ContractException.Conflict("settlement_idempotency_conflict");
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true)
                    throw ContractException.Conflict("development_payment_unavailable");
                return previous;
            }
            await AuthorizeAsync(id, true, token);
            if (await repository.LatestFinancialCloseAsync(id, token) is not null)
                throw ContractException.Conflict("settlement_financial_already_closed");
            var source = await repository.ProposalSourceAsync(id, token);
            var context = source.Context;
            // Owner sending priced charges is the financial approval. Staff's
            // completed Final inspection is authoritative physical evidence;
            // the Owner inspection-review action is not a second prerequisite.
            if (!source.StaffInspectionReady || context.HasLegacyDeductions || context.RecipientUserIds.Length == 0 ||
                context.InspectionId != normalized.InspectionId || context.InspectionVersion != normalized.InspectionVersion ||
                source.Reference != normalized.ExpectedReference || context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true)
                throw ContractException.Conflict("move_out_proposal_source_changed");
            var choices = source.Items.Where(i => i.Chargeable).ToDictionary(i =>
                ProposalItemKey(i.Kind, i.AssetId, i.RoomCheckCode, i.AccessType));
            if (keys.Any(itemKey => !choices.ContainsKey(itemKey)))
                throw ContractException.Conflict("move_out_proposal_item_not_eligible");
            var latest = await repository.LatestProposalAsync(id, token);
            if (latest?.SourceReference == source.Reference)
            {
                var feedback = await repository.ProposalFeedbackAsync(id, latest.Id, token);
                if (feedback is null || feedback.Confirmed)
                    throw ContractException.Conflict("move_out_proposal_already_sent");
            }
            var total = items.Sum(item => item.Amount);
            var existingOutstanding = context.View.Receivables.Sum(row => row.Outstanding);
            var proposal = new MoveOutChargeProposal(Guid.NewGuid(), id, source.Reference, context.InspectionId,
                context.InspectionVersion, items, context.VerifiedDeposit, context.View.AvailableDeposit,
                total, context.View.AvailableDeposit - total - existingOutstanding, normalized.Note, Actor,
                clock.GetUtcNow(), context.RecipientUserIds.Order().ToArray(), key, fingerprint,
                context.IsDevelopmentDemo, ExistingOutstanding: existingOutstanding,
                PhysicalReference: source.PhysicalReference);
            await repository.SaveProposalAsync(proposal, token);
            return proposal;
        }, token);
    }

    public async Task<MoveOutChargeProposalFeedback> RespondToProposalAsync(Guid id,
        MoveOutChargeProposalFeedbackInput input, Guid key, CancellationToken token)
    {
        if (!user.IsInRole(Roles.Tenant)) throw new ContractException(403, "tenant_required");
        await AuthorizeAsync(id, false, token);
        if (key == Guid.Empty || input is null || input.ProposalId == Guid.Empty ||
            string.IsNullOrWhiteSpace(input.ExpectedReference) || input.Reason?.Length > 2000 ||
            !input.Confirmed && string.IsNullOrWhiteSpace(input.Reason) && input.DisputedItems is not { Length: > 0 })
            throw ContractException.Invalid("invalid_move_out_proposal_feedback");
        if (input.DisputedItems is { Length: > 250 } || input.Confirmed && input.DisputedItems is { Length: > 0 })
            throw ContractException.Invalid("invalid_move_out_proposal_disputed_items");
        return await repository.TransactionAsync(id, async () =>
        {
            var previous = await repository.ProposalFeedbackOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                var offered = (previous.DisputedItems ?? []).Select(item =>
                    new MoveOutProposedCharge(item.Kind, item.AssetId, item.RoomCheckCode, item.AccessType, 0, "")).ToArray();
                var replay = input with
                {
                    Reason = input.Reason?.Trim(),
                    DisputedItems = NormalizeDisputedItems(input.DisputedItems, offered, input.Confirmed)
                };
                if (previous.ContractId != id || previous.Fingerprint != ProposalFingerprint(id, replay))
                    throw ContractException.Conflict("settlement_idempotency_conflict");
                return previous;
            }
            var source = await repository.ProposalSourceAsync(id, token);
            var latest = await repository.LatestProposalAsync(id, token);
            if (latest is null || latest.Id != input.ProposalId ||
                latest.SourceReference != input.ExpectedReference || source.Reference != latest.SourceReference ||
                !latest.RecipientUserIds.Contains(Actor))
                throw ContractException.Conflict("move_out_proposal_changed");
            var normalized = input with
            {
                Reason = input.Reason?.Trim(),
                DisputedItems = NormalizeDisputedItems(input.DisputedItems, latest.Items, input.Confirmed)
            };
            var fingerprint = ProposalFingerprint(id, normalized);
            await AuthorizeAsync(id, false, token);
            if (await repository.LatestFinancialCloseAsync(id, token) is not null)
                throw ContractException.Conflict("settlement_financial_already_closed");
            if (await repository.ProposalFeedbackAsync(id, latest.Id, token) is not null)
                throw ContractException.Conflict("move_out_proposal_already_answered");
            var response = new MoveOutChargeProposalFeedback(Guid.NewGuid(), id, latest.Id, normalized.Confirmed,
                normalized.Reason ?? "", Actor, clock.GetUtcNow(), key, fingerprint, normalized.DisputedItems,
                normalized.Confirmed ? await MaterializeAcceptedProposalAsync(id, latest, source, token) : null);
            await repository.SaveProposalFeedbackAsync(response, token);
            return response;
        }, token);
    }
}
