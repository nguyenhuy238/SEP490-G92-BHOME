using System.Text.Json;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.Billing;

namespace BHome.Application.Contracts;

public static class MoveOutProposalSettlementRules
{
    public static bool MatchesCurrentRefundBalance(SettlementChargeContext context, decimal expectedAmount) =>
        expectedAmount > 0 && !context.HasLegacyDeductions &&
        context.View.AvailableDeposit == expectedAmount &&
        context.View.Receivables.All(r => r.Outstanding == 0) &&
        context.View.Invoices?.All(i => i.Outstanding == 0) != false;

    // Each outstanding obligation has its own verified transfer reference.
    // Preserve compatibility with accepted quotes recorded before multiple QR support.
    public static bool IsQuotedPayable(MoveOutProposalSettlement settlement, Guid receivableId) =>
        settlement.Status == "Payable" && settlement.CreatedReceivableIds.Contains(receivableId) &&
        (settlement.PayableReceivableId == receivableId ||
            settlement.PayableReceivables?.Any(row => row.Id == receivableId) == true);
}

public sealed partial class SettlementReceivablesService
{
    private sealed record AutomaticChargePlan(MoveOutAutomaticCharge Line,
        UtilityType? Type = null, FinalUtilityPreview? Utility = null, FinalFixedChargePreview? Fixed = null);

    private async Task<AutomaticChargePlan[]> AutomaticChargePlansAsync(Guid id, CancellationToken token)
    {
        var result = new List<AutomaticChargePlan>();
        foreach (var type in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var preview = await UtilityPreviewAsync(id, type, token, staffProposal: true);
            var line = new MoveOutAutomaticCharge("FinalUtility", type.ToString(),
                type == UtilityType.Electricity ? "Điện chốt khi trả phòng" : "Nước chốt khi trả phòng",
                preview.ExistingReceivableId is null ? preview.Amount : 0, preview.Reference,
                preview.MissingInputs, preview.ExistingReceivableId, preview.Quantity,
                preview.Baseline?.Value, preview.Final?.Value);
            result.Add(new(line, type, preview));
        }
        foreach (var preview in await FixedPreviewAsync(id, token, staffProposal: true, servicesOnly: true))
        {
            var line = new MoveOutAutomaticCharge("FinalFixed", preview.ChargeCode, preview.Name,
                preview.ExistingReceivableId is null ? preview.Amount : 0, preview.Reference,
                preview.MissingInputs, preview.ExistingReceivableId);
            result.Add(new(line, Fixed: preview));
        }
        return result.ToArray();
    }

    private async Task<MoveOutChargeProposalSource> ProposalSourceWithChargesAsync(Guid id, CancellationToken token)
    {
        var source = await repository.ProposalSourceAsync(id, token);
        if (!source.StaffInspectionReady || source.Forced) return source;
        var lines = (await AutomaticChargePlansAsync(id, token)).Select(plan => plan.Line).ToArray();
        return source with
        {
            AutomaticCharges = lines,
            Reference = "PROPOSAL-" + ProposalFingerprint(id, new { source.Reference, AutomaticCharges = lines })
        };
    }

    private static MoveOutProposalSettlement NeedsReview(string reason) =>
        new("PendingOwnerReview", 0, 0, null, [], [], reason);

    private async Task<MoveOutProposalSettlement> MaterializeAcceptedProposalAsync(Guid id,
        MoveOutChargeProposal proposal, MoveOutChargeProposalSource source, CancellationToken token)
    {
        var context = source.Context;
        if (source.Forced || !source.StaffInspectionReady || context.HasLegacyDeductions ||
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
        // The automatic charges are part of the approved quote, not mutable
        // client-entered fees. Revalidate before creating any financial record.
        var automaticPlans = await AutomaticChargePlansAsync(id, token);
        var automaticLines = automaticPlans.Select(plan => plan.Line).ToArray();
        if (proposal.AutomaticCharges is null ||
            ProposalFingerprint(id, proposal.AutomaticCharges) != ProposalFingerprint(id, automaticLines) ||
            automaticLines.Any(row => row.Amount is null || row.MissingInputs.Count > 0))
            return NeedsReview("move_out_automatic_charge_inputs_changed");

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
        foreach (var plan in automaticPlans.Where(p => p.Line.ExistingReceivableId is null))
        {
            var key = SettlementFinancialCloseRules.ChildKey(proposal.OperationKey, proposal.Id, "automatic:" + plan.Line.Kind + ":" + plan.Line.Code);
            var fingerprint = ProposalFingerprint(id, new { proposal.Id, plan.Line });
            var charge = plan.Utility is { } utility && plan.Type is { } type
                ? await BuildFinalUtilityChargeAsync(id, type, utility, proposal.OwnerUserId, key, fingerprint, token)
                : await BuildFinalFixedChargeAsync(id, plan.Fixed!, proposal.OwnerUserId, key, fingerprint, token);
            created.Add(charge);
        }
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
                ProposalFingerprint(id, new { proposal.Id, sourceKey, plan.Item }), context.IsDevelopmentDemo,
                RoomCheckCode: plan.RoomCheckCode);
            created.Add(record);
        }
        foreach (var record in created) await repository.SaveChargeAsync(record, token);

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
        if (result.View.Invoices?.Any(i => i.Outstanding > 0) == true)
            throw ContractException.Conflict("move_out_net_settlement_integrity_failed");
        var payables = remaining.OrderBy(r => r.Charge.Id).Select(r =>
            new MoveOutPayableReceivable(r.Charge.Id, r.Outstanding, r.Charge.Description)).ToArray();
        return new(payables.Length > 0 ? "Payable" : result.View.AvailableDeposit > 0 ? "RefundEligible" : "Settled",
            payables.Sum(row => row.Amount), payables.Length == 0 ? result.View.AvailableDeposit : 0,
            payables.Length == 1 ? payables[0].Id : null, created.Select(c => c.Id).ToArray(), offsets.ToArray(),
            PayableReceivables: payables);
    }
}
