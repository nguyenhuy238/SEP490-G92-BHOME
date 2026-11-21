using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using BHome.Application.Finance;

namespace BHome.Application.Contracts;

// Scoped only around the Owner final-close transaction already opened by the
// ContractRepository ordered-lock implementation. Other money commands still
// open their own proper transactions and MUST NOT silently join arbitrary ones.
public static class SettlementFinancialCloseTransactionContext
{
    private static readonly AsyncLocal<int> Depth = new();
    public static bool Active => Depth.Value > 0;
    public static IDisposable Enter()
    {
        Depth.Value++;
        return new Exit();
    }
    private sealed class Exit : IDisposable
    {
        private bool disposed;
        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            Depth.Value--;
        }
    }
}

// An authenticated Owner approves the final set of prices and explicit waivers
// once. No background job receives Owner credentials or chooses the beneficiary.
public sealed record SettlementFinancialCloseInput(string ExpectedReference, Guid? ExpectedChargeReviewId,
    Guid? BeneficiaryResidentId, bool BeneficiaryVerified, string[] WaivedIssueKeys,
    string Reason, bool HumanConfirmed);

[JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
public sealed record SettlementFinancialClose(Guid Id, Guid ContractId, string Reference, Guid[] OffsetIds,
    Guid? RefundRequestId, string? RefundStatus, decimal OutstandingAmount, decimal RemainingDeposit,
    Guid ApprovedByUserId, DateTimeOffset ApprovedAt, Guid OperationKey, string Fingerprint,
    Guid? ChargeReviewId, string[] WaivedIssueKeys, Guid? BeneficiaryResidentId);

public static class SettlementFinancialCloseRules
{
    public static Guid ChildKey(Guid operationKey, Guid source, string kind)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"move-out-final-close:{kind}:{operationKey:N}:{source:N}"));
        return new Guid(bytes.AsSpan(0, 16));
    }

    public static bool CompletePricing(IEnumerable<string> actualIssues, IEnumerable<string> priced,
        IEnumerable<string> waived)
    {
        var issues = actualIssues.ToHashSet(StringComparer.Ordinal);
        var charged = priced.ToHashSet(StringComparer.Ordinal);
        var exceptions = waived.ToArray();
        return exceptions.Length == exceptions.Distinct(StringComparer.Ordinal).Count() &&
            issues.Except(charged, StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal)
                .SetEquals(exceptions) &&
            !charged.Overlaps(exceptions) && !exceptions.Except(issues, StringComparer.Ordinal).Any();
    }

    public static bool ReviewComplete(bool noAdditionalCharges, int count, bool current,
        Guid? approvedReviewId, Guid? expectedReviewId) =>
        (noAdditionalCharges && count == 0 ||
            current && approvedReviewId is not null) &&
        (noAdditionalCharges ? expectedReviewId is null :
            approvedReviewId is not null && expectedReviewId == approvedReviewId);
}

public sealed partial class SettlementReceivablesService
{
    public async Task<SettlementFinancialClose> FinalCloseAsync(Guid id, SettlementFinancialCloseInput input,
        Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (refunds is null) throw new ContractException(503, "deposit_refund_service_unavailable");
        if (key == Guid.Empty || !input.HumanConfirmed ||
            string.IsNullOrWhiteSpace(input.ExpectedReference) ||
            string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000 ||
            input.WaivedIssueKeys is null || input.WaivedIssueKeys.Length > 210 ||
            input.WaivedIssueKeys.Any(string.IsNullOrWhiteSpace) ||
            input.WaivedIssueKeys.Distinct(StringComparer.Ordinal).Count() != input.WaivedIssueKeys.Length ||
            input.BeneficiaryResidentId == Guid.Empty)
            throw ContractException.Invalid("move_out_financial_close_confirmation_required");
        var normalized = input with
        {
            Reason = input.Reason.Trim(),
            WaivedIssueKeys = input.WaivedIssueKeys.Order(StringComparer.Ordinal).ToArray()
        };
        var fingerprint = Fingerprint(id, normalized);

        // ContractRepository owns the payment ledger -> Location -> Room lock;
        // the two existing money services join THIS transaction and never open
        // nested transactions or make intermediate writes visible on failure.
        return await repository.TransactionAsync(id, async () =>
        {
            using var joined = SettlementFinancialCloseTransactionContext.Enter();
            if (await repository.FinancialCloseOperationAsync(Actor, key, token) is { } existing)
            {
                if (existing.ContractId != id || existing.Fingerprint != fingerprint)
                    throw ContractException.Conflict("settlement_idempotency_conflict");
                return existing;
            }
            if (await repository.LatestFinancialCloseAsync(id, token) is not null)
                throw ContractException.Conflict("settlement_financial_already_closed");

            await AuthorizeAsync(id, true, token);
            var review = await ChargeReviewPreviewAsync(id, token);
            var context = (await repository.ChargeReviewAsync(id, token)).Context;
            if (context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true)
                throw ContractException.Conflict("development_payment_unavailable");
            if (!context.InspectionConfirmed || context.HasLegacyDeductions ||
                context.View.Reference != normalized.ExpectedReference ||
                review.MissingInputs.Count > 0)
                throw ContractException.Conflict("settlement_financial_close_not_ready");

            // NoAdditionalCharges waives only damage pricing, NOT final rent,
            // utility or fee source approval. Any existing receivable still
            // needs the current Owner-approved charge review.
            var reviewId = context.NoAdditionalCharges ? (Guid?)null : review.Review?.Id;
            if (!SettlementFinancialCloseRules.ReviewComplete(context.NoAdditionalCharges,
                context.View.Receivables.Count, review.IsCurrent, review.Review?.Id,
                normalized.ExpectedChargeReviewId))
                throw ContractException.Conflict("settlement_charge_review_required");

            // A priced item and an explicit Owner waiver are mutually exclusive.
            // A missing item cannot be silently considered free by a generic
            // 'all charges reviewed' checkbox.
            var issueKeys = (context.IssueAssetEvidence?.Keys.Select(k => $"asset:{k:D}") ?? [])
                .Concat(context.IssueRoomCheckEvidence?.Keys.Select(k => $"room:{k}") ?? [])
                .ToHashSet(StringComparer.Ordinal);
            var pricedKeys = context.View.Receivables.Where(r => r.Charge.Kind == "TenantDamage")
                .Select(r => r.Charge.AssetId is { } asset ? $"asset:{asset:D}" :
                    r.Charge.RoomCheckCode is { } room ? $"room:{room}" : "room:legacy")
                .ToHashSet(StringComparer.Ordinal);
            if (!SettlementFinancialCloseRules.CompletePricing(issueKeys, pricedKeys, normalized.WaivedIssueKeys))
                throw ContractException.Conflict("move_out_issues_require_price_or_waiver");
            if (context.NoAdditionalCharges && context.View.Receivables.Any(r => r.Charge.Kind == "TenantDamage"))
                throw ContractException.Conflict("move_out_damage_review_conflict");

            var offsets = new List<Guid>();
            // Stable allocation order; each step recomputes the financial
            // reference/actual balance under the same ledger/Room lock.
            foreach (var balance in context.View.Receivables
                .Where(r => r.Charge.Kind == "TenantDamage" && r.Outstanding > 0)
                .OrderBy(r => r.Charge.ApprovedAt).ThenBy(r => r.Charge.Id))
            {
                var current = await repository.ContextAsync(id, token);
                var outstanding = current.View.Receivables.Single(r => r.Charge.Id == balance.Charge.Id).Outstanding;
                var amount = Math.Min(current.View.AvailableDeposit, outstanding);
                if (amount <= 0) break;
                var approval = await ApproveOffsetAsync(id,
                    new(current.View.Reference, balance.Charge.Id, null, amount,
                        $"Owner chốt quyết toán: {normalized.Reason}", true),
                    SettlementFinancialCloseRules.ChildKey(key, balance.Charge.Id, "offset"), token);
                offsets.Add(approval.Id);
            }

            var final = await repository.ContextAsync(id, token);
            var damagesOutstanding = final.View.Receivables
                .Where(r => r.Charge.Kind == "TenantDamage").Sum(r => r.Outstanding);
            if (final.View.Receivables.Any(r => r.Charge.Kind != "TenantDamage" && r.Outstanding > 0))
                throw ContractException.Conflict("settlement_other_obligations_unpaid");
            if (damagesOutstanding > 0 && final.View.AvailableDeposit > 0)
                throw ContractException.Conflict("settlement_deposit_allocation_incomplete");

            // The existing refund source verifies invoice coverage, reviewed
            // final charges, proof integrity, reservation and deposit position.
            // Its only permissible blocker for a no-refund overage is the
            // remaining TenantDamage receivable on this SAME obligation.
            var source = await refunds.DepositSourceAsync(id, token);
            if (source.DepositDeductions is not null ||
                source.Blockers is { } blockers && blockers.Any(b =>
                    b != "settlement_receivable_outstanding") ||
                source.AvailableAmount is null || source.AvailableAmount < 0)
                throw ContractException.Conflict("settlement_financial_close_not_ready");
            if (source.Requests.Any(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED"))
                throw ContractException.Conflict("deposit_refund_already_requested");

            Guid? refundId = null;
            string? refundStatus = null;
            if (source.AvailableAmount > 0)
            {
                if (damagesOutstanding > 0 || source.Blockers?.Count > 0)
                    throw ContractException.Conflict("deposit_refund_not_ready");
                if (!normalized.BeneficiaryVerified ||
                    normalized.BeneficiaryResidentId is not { } beneficiary ||
                    !source.Beneficiaries.Any(p => p.Id == beneficiary))
                    throw ContractException.Conflict("refund_beneficiary_owner_confirmation_required");
                var deductions = source.ApprovedDepositOffsets + source.MaintenanceDeductions > 0;
                var requested = await refunds.CreateDepositAsync(id,
                    new(new(beneficiary, source.AvailableAmount.Value, normalized.Reason, true),
                        source.FinancialReference!, true, !deductions, null, deductions),
                    SettlementFinancialCloseRules.ChildKey(key, id, "refund"), token);
                if (requested.Status != "REQUESTED")
                    throw ContractException.Conflict("refund_request_not_created");
                refundId = requested.Id;
                refundStatus = requested.Status;
            }
            else if (normalized.BeneficiaryResidentId is not null &&
                (!normalized.BeneficiaryVerified ||
                !source.Beneficiaries.Any(p => p.Id == normalized.BeneficiaryResidentId)))
                throw ContractException.Conflict("refund_beneficiary_owner_confirmation_required");

            var record = new SettlementFinancialClose(Guid.NewGuid(), id, final.View.Reference,
                offsets.ToArray(), refundId, refundStatus, damagesOutstanding, source.AvailableAmount.Value,
                Actor, clock.GetUtcNow(), key, fingerprint, reviewId, normalized.WaivedIssueKeys,
                normalized.BeneficiaryResidentId);
            await repository.SaveFinancialCloseAsync(record, token);
            return record;
        }, token);
    }
}
