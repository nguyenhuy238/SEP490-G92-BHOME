using System.Text.Json;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.Contracts;

public static class MoveOutProposalSettlementRules
{
    public static bool MatchesCurrentRefundBalance(SettlementChargeContext context, decimal expectedAmount) =>
        expectedAmount > 0 && !context.HasLegacyDeductions &&
        context.View.AvailableDeposit == expectedAmount &&
        context.View.Receivables.All(r => r.Outstanding == 0) &&
        context.View.Invoices?.All(i => i.Outstanding == 0) != false;

    // A single bank transfer can be assigned to one settlement receivable in the
    // existing verified payment ledger. Apply the deposit to the smallest fees
    // first, leaving at most one net payable fee for one SePay QR.
    public static bool OnePayableAfterDeposit(IEnumerable<decimal> charges, decimal deposit)
    {
        var amounts = charges.Order().ToArray();
        if (deposit < 0 || amounts.Any(a => !PaymentRules.ValidMoney(a))) return false;
        return amounts.Length <= 1 || deposit >= amounts.Take(amounts.Length - 1).Sum();
    }
}

public sealed partial class SettlementReceivablesService
{
    private static MoveOutProposalSettlement NeedsReview(string reason) =>
        new("PendingOwnerReview", 0, 0, null, [], [], reason);

    private async Task<MoveOutProposalSettlement> MaterializeAcceptedProposalAsync(Guid id,
        MoveOutChargeProposal proposal, MoveOutChargeProposalSource source, CancellationToken token)
    {
        var context = source.Context;
        if (!source.StaffInspectionReady || context.HasLegacyDeductions ||
            proposal.InspectionId != context.InspectionId || proposal.InspectionVersion != context.InspectionVersion ||
            (context.NoAdditionalCharges && proposal.Items.Length > 0))
            return NeedsReview("verified_staff_final_inspection_required");
        // The invoice/deposit ledger is authoritative. This command cannot
        // silently spend a deposit already needed for an unpaid invoice or an
        // independently approved receivable.
        if (context.View.Receivables.Any(r => r.Outstanding > 0) ||
            context.View.Invoices?.Any(i => i.Outstanding > 0) == true ||
            proposal.ExistingOutstanding != 0 || proposal.AvailableDeposit != context.View.AvailableDeposit)
            return NeedsReview("existing_obligations_require_owner_review");
        if (!MoveOutProposalSettlementRules.OnePayableAfterDeposit(
                proposal.Items.Select(item => item.Amount), context.View.AvailableDeposit))
            return NeedsReview("multiple_payable_obligations_require_review");

        var offered = source.Items.ToDictionary(item =>
            ProposalItemKey(item.Kind, item.AssetId, item.RoomCheckCode, item.AccessType));
        var proofPlans = new List<(MoveOutProposedCharge Item, Guid[] Evidence, string SourceKey,
            Guid? AssetId, string? RoomCheckCode)>();
        foreach (var charge in proposal.Items)
        {
            var key = ProposalItemKey(charge.Kind, charge.AssetId, charge.RoomCheckCode, charge.AccessType);
            if (!offered.TryGetValue(key, out var observed) || !observed.Chargeable)
                return NeedsReview("move_out_proposal_item_changed");
            var code = charge.Kind == "Access" ? "access_room_key" : charge.RoomCheckCode;
            // Each fee must have private Staff Final photos linked to that exact
            // physical item. Owner price approval plus Tenant consent never
            // turns an unrelated overall photo into evidence for a charge.
            var proofs = observed.EvidenceIds.Distinct().Order().ToArray();
            if (proofs.Length is < 1 or > 5 ||
                !proofs.All(id => context.EvidenceIds.Contains(id)))
                return NeedsReview("verified_item_evidence_required");
            var sourceKey = $"damage:{id:N}:{charge.AssetId?.ToString("N") ?? code ?? "room"}";
            if (context.View.Receivables.Any(r => r.Charge.SourceKey == sourceKey))
                return NeedsReview("settlement_source_already_charged");
            proofPlans.Add((charge, proofs, sourceKey, charge.AssetId, code));
        }

        // All safety checks occur before any ledger mutation. This transaction
        // remains atomic, including private evidence verification, immutable
        // Owner-approved charges and verified deposit allocations.
        var created = new List<SettlementReceivable>();
        var channel = await NewPaymentModeAsync(id, token);
        foreach (var plan in proofPlans)
        {
            var proofs = await evidence.CaptureAsync(id, plan.Evidence, token);
            var sourceKey = ProposalItemKey(plan.Item.Kind, plan.Item.AssetId,
                plan.Item.RoomCheckCode, plan.Item.AccessType);
            var now = clock.GetUtcNow();
            var record = new SettlementReceivable(Guid.NewGuid(), id, context.View.RoomId, "TenantDamage",
                plan.SourceKey, context.InspectionId, context.InspectionVersion, plan.AssetId, plan.Item.Amount,
                plan.Item.Reason, "OwnerApprovedTenantAcceptedMoveOutProposal/v1:" + proposal.Id.ToString("N"),
                proofs, context.RecipientUserIds.Order().ToArray(), proposal.OwnerUserId, now,
                SettlementFinancialCloseRules.ChildKey(proposal.OperationKey, proposal.Id, "charge:" + sourceKey),
                ProposalFingerprint(id, new { proposal.Id, sourceKey, plan.Item }), channel is null ? context.IsDevelopmentDemo : channel == "Test",
                RoomCheckCode: plan.RoomCheckCode, PaymentMode: channel);
            await repository.SaveChargeAsync(record, token);
            created.Add(record);
        }

        var offsets = new List<Guid>();
        foreach (var charge in created.OrderBy(c => c.Amount).ThenBy(c => c.Id))
        {
            var current = await repository.ContextAsync(id, token);
            var outstanding = current.View.Receivables.Single(r => r.Charge.Id == charge.Id).Outstanding;
            var amount = Math.Min(current.View.AvailableDeposit, outstanding);
            if (amount <= 0) continue;
            var at = clock.GetUtcNow();
            var offset = new DepositOffsetApproval(Guid.NewGuid(), id, current.DepositContractId,
                charge.Id, null, amount, "Cấn trừ cọc theo đề xuất Owner và xác nhận Tenant", proposal.OwnerUserId,
                at, Guid.NewGuid(), SettlementFinancialCloseRules.ChildKey(proposal.OperationKey, charge.Id, "deposit-offset"),
                ProposalFingerprint(id, new { ChargeId = charge.Id, amount, ProposalId = proposal.Id }), current.View.Reference,
                JsonSerializer.Serialize(new
                {
                    ProposalId = proposal.Id,
                    proposal.SourceReference,
                    ChargeId = charge.Id,
                    Amount = amount,
                    AvailableBefore = current.View.AvailableDeposit
                }), context.IsDevelopmentDemo);
            await repository.SaveOffsetAsync(offset, token);
            offsets.Add(offset.Id);
        }

        var result = await repository.ContextAsync(id, token);
        var remaining = result.View.Receivables.Where(r => r.Outstanding > 0).ToArray();
        if (remaining.Length > 1 || result.View.Invoices?.Any(i => i.Outstanding > 0) == true)
            throw ContractException.Conflict("move_out_net_settlement_integrity_failed");
        var payable = remaining.SingleOrDefault();
        return new(payable is not null ? "Payable" : result.View.AvailableDeposit > 0 ? "RefundEligible" : "Settled",
            payable?.Outstanding ?? 0, payable is null ? result.View.AvailableDeposit : 0,
            payable?.Charge.Id, created.Select(c => c.Id).ToArray(), offsets.ToArray());
    }
}
