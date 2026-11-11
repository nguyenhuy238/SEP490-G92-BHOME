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
    int OccupiedDays, int PeriodDays, decimal CumulativePricedAmount, decimal AlreadyPricedAmount);
public sealed record FixedChargeCoverage(Guid SourceId, FixedChargeSource Source);
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
            policy.Id, policy.Version, policy.Category, policy.ChargeCode, policy.Method, policy.Rate,
            schedule.PartialMonth, schedule.Rounding,
            SignedContract = policy.Id == Guid.Empty ? signedContractHash : ""
        })));

    public static FixedChargeResult Calculate(DateOnly period, PolicyDto policy, BillingSchedule schedule, string signedContractHash,
        int occupiedDays, IReadOnlyList<FixedChargeCoverage> coverage)
    {
        var days = DateTime.DaysInMonth(period.Year, period.Month);
        var reference = PolicyReference(policy, schedule, signedContractHash);
        var cumulative = InvoiceMath.Amount(policy.Rate, 1, occupiedDays, days, schedule.PartialMonth, schedule.Rounding, false);
        var missing = new List<string>();
        foreach (var prior in coverage)
        {
            if (prior.Source.BillingPeriod != period || prior.Source.ChargeCode != policy.ChargeCode || prior.Source.PolicyReference != reference)
                missing.Add("fixed_charge_policy_changed");
            if (schedule.PartialMonth == PartialMonthRule.OccupiedCalendarDays && prior.Source.OccupiedDays > occupiedDays || prior.Source.CumulativePricedAmount > cumulative)
                missing.Add("fixed_charge_occupancy_changed");
            if (prior.Source.AlreadyPricedAmount < 0 || prior.Source.CumulativePricedAmount < prior.Source.AlreadyPricedAmount)
                missing.Add("fixed_charge_coverage_invalid");
        }
        var previous = coverage.Count == 0 ? 0 : coverage.Max(c => c.Source.CumulativePricedAmount);
        var source = new FixedChargeSource(period, policy.ChargeCode, policy.Category.ToString(), policy.Id == Guid.Empty ? null : policy.Id,
            policy.Id == Guid.Empty ? null : policy.Version, policy.Rate, reference, schedule.PartialMonth, schedule.Rounding,
            occupiedDays, days, cumulative, previous);
        return new(missing.Count == 0 ? cumulative - previous : null, source, missing.Distinct().ToArray());
    }
}
