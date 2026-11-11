using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.Contracts;

public sealed record FinalFixedChargeContext(SettlementChargeContext Context, Guid LocationId, DateOnly Period, DateOnly HandoverDate,
    BillingSchedule? Schedule, decimal MonthlyRent, string SignedContractHash, int OccupiedDays, Guid[] RecipientUserIds,
    IReadOnlyList<string> MissingInputs);
public sealed record FinalFixedChargePreview(string ChargeCode, string Name, DateOnly BillingPeriod, string Reference,
    [property: System.Text.Json.Serialization.JsonNumberHandling(System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString | System.Text.Json.Serialization.JsonNumberHandling.WriteAsString)] decimal? Amount,
    FixedChargeSource? Calculation, Guid? ExistingReceivableId, IReadOnlyList<string> MissingInputs);
public sealed record FinalFixedChargeApproval(string ChargeCode, string ExpectedReference, bool PolicyAppliesToSignedTermsConfirmed);

public sealed partial class SettlementReceivablesService
{
    private async Task<IReadOnlyList<FinalFixedChargePreview>> FixedPreviewAsync(Guid id, CancellationToken token)
    {
        if (properties is null || fixedCoverage is null) throw new ContractException(503, "fixed_charge_pricing_unavailable");
        var source = await repository.FinalFixedAsync(id, token); var missing = source.MissingInputs.ToList();
        if (!source.Context.InspectionConfirmed) missing.Add("owner_confirmed_inspection_required");
        if (source.Context.HasLegacyDeductions) missing.Add("legacy_deduction_requires_migration_review");
        if (source.Context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
        if (source.Schedule is null) missing.Add("billing_schedule_required");
        if (missing.Count > 0) return [new("", "Tiền thuê và phí cố định", source.Period, "", null, null, null, missing.Distinct().Order().ToArray())];
        var schedule = source.Schedule!;
        var rateDate = schedule.RateDate == BillingRateDate.PeriodStart ? source.Period : source.Period.AddMonths(1).AddDays(-1);
        var rates = await properties.ResolvePricesAsync(source.Context.View.RoomId, rateDate, token);
        var policies = rates.Charges.Where(p => p.Method == ChargingMethod.FixedPerRoomPerMonth &&
            (p.Category != ChargeCategory.Rent || schedule.RentSource == BillingRentSource.RoomPolicy)).ToList();
        if (schedule.RentSource == BillingRentSource.RepresentativeContract)
            policies.Add(new(Guid.Empty, source.LocationId, source.Context.View.RoomId, ChargeCategory.Rent, "RENT", "Tiền thuê theo hợp đồng đại diện",
                ChargingMethod.FixedPerRoomPerMonth, source.MonthlyRent, source.Period, null, 0));
        if (!policies.Any(p => p.Category == ChargeCategory.Rent)) missing.Add("rate_Rent");
        if (missing.Count > 0) return [new("", "Tiền thuê và phí cố định", source.Period, "", null, null, null, missing)];
        var result = new List<FinalFixedChargePreview>();
        foreach (var policy in policies.OrderBy(p => p.ChargeCode))
        {
            var coverage = await fixedCoverage.ReadAsync(source.Context.View.RoomId, source.Period, policy.ChargeCode, token);
            var calculated = FixedChargeCalculation.Calculate(source.Period, policy, schedule, source.SignedContractHash, source.OccupiedDays, coverage);
            var existing = source.Context.View.Receivables.FirstOrDefault(r => r.Charge.FixedCharge == calculated.Source)?.Charge.Id;
            // The latest cumulative source remains authoritative after a zero acknowledgement.
            if (existing is null && calculated.Amount == 0)
                existing = source.Context.View.Receivables.FirstOrDefault(r => r.Charge.FixedCharge is { } prior &&
                    prior.BillingPeriod == source.Period && prior.ChargeCode == policy.ChargeCode && prior.PolicyReference == calculated.Source.PolicyReference &&
                    prior.CumulativePricedAmount == calculated.Source.CumulativePricedAmount && prior.OccupiedDays == source.OccupiedDays)?.Charge.Id;
            var row = new FinalFixedChargePreview(policy.ChargeCode, policy.Name, source.Period, "", calculated.Amount, calculated.Source, existing, calculated.MissingInputs);
            result.Add(row with { Reference = "FIXED-" + Fingerprint(id, new { source.Context.View.Reference, source.HandoverDate, source.RecipientUserIds, row }) });
        }
        return result;
    }
    public async Task<IReadOnlyList<FinalFixedChargePreview>> PreviewFinalFixedAsync(Guid id, CancellationToken token)
    { await AuthorizeAsync(id, true, token); return await FixedPreviewAsync(id, token); }
    public async Task<SettlementReceivable> ApproveFinalFixedAsync(Guid id, FinalFixedChargeApproval input, Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || !input.PolicyAppliesToSignedTermsConfirmed || string.IsNullOrWhiteSpace(input.ChargeCode) || string.IsNullOrWhiteSpace(input.ExpectedReference))
            throw ContractException.Invalid("fixed_charge_policy_confirmation_required");
        return await repository.TransactionAsync(id, async () =>
        {
            var fingerprint = Fingerprint(id, input); var previous = await repository.ChargeOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.ContractId != id || previous.Kind != "FinalFixed" || previous.Fingerprint != fingerprint) throw ContractException.Conflict("settlement_idempotency_conflict");
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                return previous;
            }
            await AuthorizeAsync(id, true, token);
            var row = (await FixedPreviewAsync(id, token)).SingleOrDefault(p => p.ChargeCode == input.ChargeCode) ?? throw ContractException.Conflict("fixed_charge_inputs_required");
            if (row.Reference != input.ExpectedReference) throw ContractException.Conflict("settlement_review_changed");
            if (row.ExistingReceivableId is not null) throw ContractException.Conflict("settlement_source_already_charged");
            if (row.MissingInputs.Count > 0 || row.Amount is null || row.Calculation is null) throw ContractException.Conflict("fixed_charge_inputs_required");
            var context = await repository.FinalFixedAsync(id, token);
            var proofs = await evidence.CaptureAsync(id, context.Context.EvidenceIds.Order().ToArray(), token);
            var charge = new SettlementReceivable(Guid.NewGuid(), id, context.Context.View.RoomId, "FinalFixed",
                $"fixed:{context.Context.View.RoomId:N}:{row.BillingPeriod:yyyyMM}:{row.ChargeCode}:{row.Calculation.CumulativePricedAmount}:{row.Calculation.OccupiedDays}",
                context.Context.InspectionId, context.Context.InspectionVersion, null, row.Amount.Value, row.Name,
                JsonSerializer.Serialize(new { kind = "OwnerConfirmedFixedSettlement/v1", row.Calculation, context.SignedContractHash, context.HandoverDate,
                    scheduleVersion = context.Schedule!.Version, policyAppliesToSignedTermsConfirmed = true }),
                proofs, context.RecipientUserIds, Actor, clock.GetUtcNow(), key, fingerprint, context.Context.IsDevelopmentDemo, FixedCharge: row.Calculation);
            await repository.SaveChargeAsync(charge, token); return charge;
        }, token);
    }
}
