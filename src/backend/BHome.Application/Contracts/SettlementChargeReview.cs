using System.Security.Cryptography;
using System.Text.Json;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed record SettlementChargeReview(Guid Id, Guid ContractId, string SourceReference, Guid[] ChargeIds, string Reason,
    Guid ApprovedByUserId, DateTimeOffset ApprovedAt, Guid OperationKey, string Fingerprint, bool IsDevelopmentDemo = false);
public sealed record SettlementChargeReviewContext(SettlementChargeContext Context, string SourceReference, SettlementChargeReview? Latest);
public sealed record SettlementChargeReviewPreview(string Reference, SettlementChargeReview? Review, bool IsCurrent,
    IReadOnlyList<string> MissingInputs);
public sealed record SettlementChargeReviewInput(string ExpectedReference, string Reason, bool AllChargesConfirmed);
public static class SettlementChargeReviewRules
{
    public static string Reference(Guid contractId, ContractFinalInspection? inspection, IEnumerable<SettlementReceivable> charges) =>
        "CHARGES-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            contractId,
            inspection = inspection is null ? null : new
            {
                inspection.Id,
                inspection.Version,
                inspection.ObservedSnapshot,
                inspection.OwnerDecision,
                inspection.OwnerId,
                inspection.OwnerReason,
                inspection.ReviewedAt,
                inspection.NoAdditionalCharges
            },
            charges = charges.OrderBy(c => c.Id).ToArray()
        })));
}
public sealed partial class SettlementReceivablesService
{
    private async Task<SettlementChargeReviewPreview> ChargeReviewPreviewAsync(Guid id, CancellationToken token)
    {
        var source = await repository.ChargeReviewAsync(id, token); var missing = new List<string>();
        if (!source.Context.InspectionConfirmed) missing.Add("owner_confirmed_inspection_required");
        if (source.Context.HasLegacyDeductions) missing.Add("legacy_deduction_requires_migration_review");
        if (source.Context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
        foreach (var utility in await PreviewFinalUtilitiesAsync(id, token))
        {
            missing.AddRange(utility.MissingInputs);
            if (utility.ExistingReceivableId is null) missing.Add("final_utility_charge_review_required:" + utility.UtilityType);
        }
        foreach (var charge in await FixedPreviewAsync(id, token))
        {
            missing.AddRange(charge.MissingInputs);
            if (charge.ExistingReceivableId is null) missing.Add("final_fixed_charge_review_required:" + charge.ChargeCode);
        }
        return new(source.SourceReference, source.Latest, source.Latest?.SourceReference == source.SourceReference,
            missing.Distinct().Order().ToArray());
    }
    public async Task<SettlementChargeReviewPreview> PreviewChargeReviewAsync(Guid id, CancellationToken token)
    { await AuthorizeAsync(id, true, token); return await ChargeReviewPreviewAsync(id, token); }
    public async Task<SettlementChargeReview> ApproveChargeReviewAsync(Guid id, SettlementChargeReviewInput input, Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || !input.AllChargesConfirmed || string.IsNullOrWhiteSpace(input.ExpectedReference) || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000)
            throw ContractException.Invalid("settlement_charge_review_confirmation_required");
        return await repository.TransactionAsync(id, async () =>
        {
            var fingerprint = Fingerprint(id, input); var previous = await repository.ReviewOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.ContractId != id || previous.Fingerprint != fingerprint) throw ContractException.Conflict("settlement_idempotency_conflict");
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                return previous;
            }
            await AuthorizeAsync(id, true, token); var preview = await ChargeReviewPreviewAsync(id, token);
            if (preview.Reference != input.ExpectedReference) throw ContractException.Conflict("settlement_review_changed");
            if (preview.MissingInputs.Count > 0) throw ContractException.Conflict("settlement_charge_sources_incomplete");
            var source = await repository.ChargeReviewAsync(id, token);
            if (preview.IsCurrent) throw ContractException.Conflict("settlement_charge_review_already_current");
            foreach (var charge in source.Context.View.Receivables) await VerifyChargeAsync(charge.Charge, token);
            var review = new SettlementChargeReview(Guid.NewGuid(), id, preview.Reference,
                source.Context.View.Receivables.Select(c => c.Charge.Id).Order().ToArray(), input.Reason.Trim(), Actor, clock.GetUtcNow(), key,
                fingerprint, source.Context.IsDevelopmentDemo);
            await repository.SaveReviewAsync(review, token); return review;
        }, token);
    }
}
