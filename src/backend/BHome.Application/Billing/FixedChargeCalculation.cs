using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Application.PropertyManagement;

namespace BHome.Application.Billing;

[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record FixedChargeSource(DateOnly BillingPeriod, string ChargeCode, string Category, Guid? PolicyId, int? PolicyVersion,
    decimal Rate, string PolicyReference, PartialMonthRule PartialMonth, VndRounding Rounding,
    int OccupiedDays, int PeriodDays, decimal CumulativePricedAmount, decimal AlreadyPricedAmount,
    decimal? PolicyCalculatedAmount = null, decimal ApprovedReduction = 0, Guid[]? ApprovedAdjustmentIds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? ResidentCount = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? PersonDays = null);
public sealed record FixedChargeCoverage(Guid SourceId, FixedChargeSource Source, decimal ApprovedReduction = 0, Guid[]? AdjustmentIds = null);
public sealed record FixedChargeResult(decimal? Amount, FixedChargeSource Source, IReadOnlyList<string> MissingInputs);
public interface IFixedChargeCoverage
{
    Task<IReadOnlyList<FixedChargeCoverage>> ReadAsync(Guid roomId, DateOnly period, string chargeCode, CancellationToken token);
}

public static class FixedChargeCalculation
{
    public static string PolicyReference(PolicyDto policy, BillingSchedule schedule, string signedContractHash) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            policy.Id,
            policy.Version,
            policy.Category,
            policy.ChargeCode,
            policy.Method,
            policy.Rate,
            schedule.PartialMonth,
            schedule.Rounding,
            SignedContract = policy.Id == Guid.Empty ? signedContractHash : ""
        })));

    public static FixedChargeResult Calculate(DateOnly period, PolicyDto policy, BillingSchedule schedule, string signedContractHash,
        int occupiedDays, IReadOnlyList<FixedChargeCoverage> coverage, PersonMonthOccupancy? people = null)
    {
        var days = DateTime.DaysInMonth(period.Year, period.Month);
        var reference = PolicyReference(policy, schedule, signedContractHash);
        var perPerson = policy.Method == ChargingMethod.FixedPerPersonPerMonth;
        var missing = new List<string>();
        decimal cumulative;
        if (perPerson)
        {
            if (people is not { IsComplete: true, ResidentCount: > 0, PersonDays: > 0 } ||
                people.PersonDays < people.ResidentCount || people.PersonDays > (long)people.ResidentCount * occupiedDays)
            {
                missing.Add("fixed_charge_resident_occupancy_required");
                cumulative = 0;
            }
            else
            {
                // Use exact person-days and round once at the VND amount boundary.
                cumulative = schedule.PartialMonth == PartialMonthRule.FullMonth
                    ? InvoiceMath.Amount(policy.Rate, people.ResidentCount, occupiedDays, days, schedule.PartialMonth, schedule.Rounding, false)
                    : InvoiceMath.Amount(policy.Rate, people.PersonDays, 1, days, schedule.PartialMonth, schedule.Rounding, false);
            }
        }
        else
            cumulative = InvoiceMath.Amount(policy.Rate, 1, occupiedDays, days, schedule.PartialMonth, schedule.Rounding, false);
        var previous = coverage.Count == 0 ? 0 : coverage.Max(c => c.Source.CumulativePricedAmount);
        var reduction = coverage.Sum(c => c.ApprovedReduction);
        foreach (var prior in coverage)
        {
            if (prior.Source.BillingPeriod != period || prior.Source.ChargeCode != policy.ChargeCode || prior.Source.PolicyReference != reference)
                missing.Add("fixed_charge_policy_changed");
            if (perPerson && (prior.Source.ResidentCount is not > 0 || prior.Source.PersonDays is not > 0))
                missing.Add("fixed_charge_coverage_invalid");
            if (prior.Source.CumulativePricedAmount > cumulative && prior.Source.CumulativePricedAmount - cumulative > reduction)
                missing.Add("fixed_charge_occupancy_changed");
            if (prior.ApprovedReduction < 0 || prior.Source.AlreadyPricedAmount < 0 || prior.Source.CumulativePricedAmount < prior.Source.AlreadyPricedAmount)
                missing.Add("fixed_charge_coverage_invalid");
        }
        var source = new FixedChargeSource(period, policy.ChargeCode, policy.Category.ToString(), policy.Id == Guid.Empty ? null : policy.Id,
            policy.Id == Guid.Empty ? null : policy.Version, policy.Rate, reference, schedule.PartialMonth, schedule.Rounding,
            occupiedDays, days, Math.Max(cumulative, previous), previous, cumulative, reduction,
            coverage.SelectMany(c => c.AdjustmentIds ?? []).Distinct().Order().ToArray(),
            perPerson ? people?.ResidentCount : null, perPerson ? people?.PersonDays : null);
        return new(missing.Count == 0 ? Math.Max(0, cumulative - previous) : null, source, missing.Distinct().ToArray());
    }
}
