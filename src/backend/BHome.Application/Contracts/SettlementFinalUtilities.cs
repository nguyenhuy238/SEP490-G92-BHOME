using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.Contracts;

public sealed record BillableMeterPoint(Guid ReadingId, Guid EvidenceId, DateOnly Date,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Value,
    string ImageHash, long Length, string SourceKind, Guid SourceId);
public sealed record SettlementUtilitySource(Guid MeterId, string UtilityType, DateOnly BillingPeriod,
    BillableMeterPoint Baseline, BillableMeterPoint Final,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal AlreadyBilledQuantity,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Quantity,
    string CumulativePricingSnapshot, Guid? PricePolicyId = null, int? PricePolicyVersion = null);
public sealed record FinalUtilityContext(SettlementChargeContext Context, Guid MeterId, UtilityType UtilityType, DateOnly BillingPeriod,
    BillableMeterPoint? Baseline, BillableMeterPoint? Final, decimal AlreadyBilledQuantity, string? PreviousPricingSnapshot,
    BillingSchedule? Schedule, Guid? ExistingReceivableId, IReadOnlyList<string> MissingInputs, bool FullyCovered = false,
    IReadOnlyList<PolicyDto>? ContractCharges = null);
public sealed record FinalUtilityPreview(Guid ContractId, string UtilityType, DateOnly BillingPeriod, string Reference,
    BillableMeterPoint? Baseline, BillableMeterPoint? Final,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal AlreadyBilledQuantity,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal? Quantity,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal? Amount,
    string CalculationSnapshot, Guid? ExistingReceivableId, IReadOnlyList<string> MissingInputs,
    Guid? PricePolicyId = null, int? PricePolicyVersion = null);
public sealed record FinalUtilityApprovalInput([property: JsonRequired] UtilityType UtilityType, string ExpectedReference, bool HumanConfirmed);
public interface ISettlementChargeEvidence
{
    Task<IReadOnlyList<DeductionEvidence>> CaptureUtilityAsync(Guid contractId, SettlementUtilitySource source, CancellationToken token);
    Task VerifyAsync(SettlementReceivable charge, CancellationToken token);
}

public sealed partial class SettlementReceivablesService
{
    private async Task<FinalUtilityPreview> UtilityPreviewAsync(Guid id, UtilityType type, CancellationToken token)
    {
        var source = await repository.FinalUtilityAsync(id, type, token);
        var missing = source.MissingInputs.ToList(); decimal? amount = null, quantity = null; string calculation = "";
        Guid? pricePolicyId = null; int? pricePolicyVersion = null;
        if (!source.Context.InspectionConfirmed) missing.Add("owner_confirmed_inspection_required");
        if (source.Context.HasLegacyDeductions) missing.Add("legacy_deduction_requires_migration_review");
        if (source.Schedule is null && !source.FullyCovered) missing.Add("billing_schedule_required");
        if (source.Context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
        if (source.Baseline is { } baseline && source.Final is { } final)
        {
            quantity = final.Value - baseline.Value;
            if (quantity < 0) missing.Add("final_reading_below_billed_baseline");
        }
        if (missing.Count == 0 && source.FullyCovered && quantity == 0)
        {
            amount = 0;
            calculation = JsonSerializer.Serialize(new { kind = "AlreadyPricedUtility/v1", source.Baseline, source.Final, source.AlreadyBilledQuantity, amount });
        }
        else if (missing.Count == 0)
        {
            try
            {
                var schedule = source.Schedule!;
                var category = type == UtilityType.Electricity ? ChargeCategory.Electricity : ChargeCategory.Water;
                var policies = (source.ContractCharges ?? []).Where(p => p.Category == category).ToArray();
                if (policies.Length != 1 || policies[0].Method != ChargingMethod.Metered) missing.Add("settlement_metered_policy_required");
                else
                {
                    var policy = policies[0];
                    pricePolicyId = policy.Id; pricePolicyVersion = policy.Version;
                    if (source.AlreadyBilledQuantity > 0 && !UtilityIncrementCalculation.FlatPolicyMatches(source.PreviousPricingSnapshot, policy.Id, policy.Version, policy.Rate, schedule.Rounding))
                        missing.Add("utility_increment_policy_changed");
                    amount = InvoiceMath.Amount(policy.Rate, quantity!.Value, 1, DateTime.DaysInMonth(source.BillingPeriod.Year, source.BillingPeriod.Month),
                        schedule.PartialMonth, schedule.Rounding, true);
                    calculation = ContractBillingPrices.FlatSnapshot(policy, schedule, quantity.Value, amount.Value);
                }
            }
            catch (PropertyException error) when (error.Status is 400 or 409) { missing.Add(error.Code); }
            catch (Exception error) when (error is OverflowException or ArgumentOutOfRangeException) { missing.Add("final_utility_amount_out_of_range"); }
        }
        var result = new FinalUtilityPreview(id, type.ToString(), source.BillingPeriod, "", source.Baseline, source.Final,
            source.AlreadyBilledQuantity, quantity, missing.Count == 0 ? amount : null, calculation, source.ExistingReceivableId, missing.Distinct().Order().ToArray(), pricePolicyId, pricePolicyVersion);
        return result with { Reference = "UTILITY-" + Fingerprint(id, new { source.Context.View.Reference, source.Context.RecipientUserIds, result }) };
    }
    public async Task<IReadOnlyList<FinalUtilityPreview>> PreviewFinalUtilitiesAsync(Guid id, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        return [await UtilityPreviewAsync(id, UtilityType.Electricity, token), await UtilityPreviewAsync(id, UtilityType.Water, token)];
    }
    public async Task<SettlementReceivable> ApproveFinalUtilityAsync(Guid id, FinalUtilityApprovalInput input, Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || !input.HumanConfirmed || !Enum.IsDefined(input.UtilityType) || string.IsNullOrWhiteSpace(input.ExpectedReference))
            throw ContractException.Invalid("invalid_final_utility_approval");
        var fingerprint = Fingerprint(id, input);
        return await repository.TransactionAsync(id, async () =>
        {
            var previous = await repository.ChargeOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                if (previous.ContractId != id || previous.Kind != "FinalUtility" || previous.Fingerprint != fingerprint) throw ContractException.Conflict("settlement_idempotency_conflict");
                return previous;
            }
            await AuthorizeAsync(id, true, token);
            var preview = await UtilityPreviewAsync(id, input.UtilityType, token);
            if (preview.Reference != input.ExpectedReference) throw ContractException.Conflict("settlement_review_changed");
            if (preview.ExistingReceivableId is not null) throw ContractException.Conflict("settlement_source_already_charged");
            if (preview.MissingInputs.Count != 0 || preview.Amount is null || preview.Quantity is null) throw ContractException.Conflict("final_utility_inputs_required");
            if (chargeEvidence is null) throw new ContractException(503, "settlement_evidence_unavailable");
            var source = await repository.FinalUtilityAsync(id, input.UtilityType, token);
            var calculation = new SettlementUtilitySource(source.MeterId, preview.UtilityType, preview.BillingPeriod, preview.Baseline!, preview.Final!,
                preview.AlreadyBilledQuantity, preview.Quantity.Value, source.FullyCovered ? source.PreviousPricingSnapshot ?? "" : preview.CalculationSnapshot,
                preview.PricePolicyId, preview.PricePolicyVersion);
            var proofs = await chargeEvidence.CaptureUtilityAsync(id, calculation, token);
            var charge = new SettlementReceivable(Guid.NewGuid(), id, source.Context.View.RoomId, "FinalUtility",
                $"utility:{source.MeterId:N}:{preview.Final!.ReadingId:N}", source.Context.InspectionId, source.Context.InspectionVersion, null,
                preview.Amount.Value, input.UtilityType == UtilityType.Electricity ? "Điện chốt khi trả phòng" : "Nước chốt khi trả phòng",
                preview.CalculationSnapshot, proofs, source.Context.RecipientUserIds.Order().ToArray(), Actor, clock.GetUtcNow(), key, fingerprint,
                source.Context.IsDevelopmentDemo, calculation);
            await repository.SaveChargeAsync(charge, token); return charge;
        }, token);
    }
    private async Task VerifyChargeAsync(SettlementReceivable charge, CancellationToken token)
    {
        if (chargeEvidence is not null) { await chargeEvidence.VerifyAsync(charge, token); return; }
        if (charge.Utility is not null) throw new ContractException(503, "settlement_evidence_unavailable");
        var current = await evidence.CaptureAsync(charge.ContractId, charge.Evidence.Select(e => e.Id).Order().ToArray(), token);
        if (!current.OrderBy(e => e.Id).SequenceEqual(charge.Evidence.OrderBy(e => e.Id))) throw ContractException.Conflict("settlement_evidence_integrity_failed");
    }
}
