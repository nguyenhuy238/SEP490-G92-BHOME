using System.Text.Json;
using BHome.Domain.Billing;

namespace BHome.Application.PropertyManagement;

public sealed partial class UtilityWorkspaceService
{
    public async Task<SetupDocument> PeriodBreakdownAsync(UtilityPeriodBreakdown input, CancellationToken t)
    {
        Owner(); Period(input.Period);
        if (!input.HumanConfirmed || await RoomScope(input.RoomId, true, t) != input.LocationId || input.Segments is null || input.Segments.Length is < 1 or > 31 || input.Segments.Any(s => s is null))
            throw new PropertyException(400, "invalid_period_breakdown");
        foreach (var segment in input.Segments) await Evidence(input.LocationId, segment.EvidenceObjectKey, t);
        return await Store.TransactionAsync(input.LocationId, async () =>
        {
            var profiles = NormalizeProfiles(await Store.ListAsync(input.LocationId, "UtilityProfile", t)).Where(d =>
            { var p = Read<UtilityProfileWrite>(d); return p.RoomId == input.RoomId && p.UtilityType == input.UtilityType; }).ToArray();
            await ValidateSegments(input, profiles, t);
            return await Store.SaveAsync(Key($"utility-segments:{input.RoomId}:{input.UtilityType}:{input.Period}"), input.LocationId,
                "UtilityPeriodBreakdown", "Confirmed", input, input.ExpectedVersion, Actor, t);
        }, t);
    }
    private async Task ValidateSegments(UtilityPeriodBreakdown input, IReadOnlyList<SetupDocument> profiles, CancellationToken t)
    {
        var next = input.Period; var end = next.AddMonths(1).AddDays(-1);
        var tariffs = await Store.ListAsync(input.LocationId, "UtilityTariff", t);
        foreach (var segment in input.Segments.OrderBy(s => s.From))
        {
            if (segment.From != next || segment.To < segment.From || segment.To > end || segment.Consumption < 0 || segment.FreeQuantity < 0 || segment.FreeQuantity > segment.Consumption)
                throw new PropertyException(400, "period_segments_must_cover_month_without_gaps");
            var tariff = tariffs.SingleOrDefault(d => d.Id == segment.TariffId) ?? throw new PropertyException(400, "tariff_scope_invalid");
            var data = Read<UtilityTariffWrite>(tariff);
            var replacement = tariffs.Where(d => Read<UtilityTariffWrite>(d).ReplacesId == tariff.Id).Select(d => (DateOnly?)Read<UtilityTariffWrite>(d).EffectiveFrom).Min();
            if (tariff.Status != "Verified" || data.UtilityType != input.UtilityType || data.EffectiveFrom > segment.From || data.EffectiveTo < segment.To || replacement <= segment.To)
                throw new PropertyException(409, "verified_effective_tariff_required");
            if (!profiles.Any(d => { var p = Read<UtilityProfileWrite>(d); return p.TariffId == tariff.Id && p.EffectiveFrom <= segment.From && (p.EffectiveTo is null || p.EffectiveTo >= segment.To); }))
                throw new PropertyException(409, "period_segment_profile_mismatch");
            next = segment.To.AddDays(1);
        }
        if (next != end.AddDays(1)) throw new PropertyException(400, "period_segments_must_cover_month_without_gaps");
    }
    private async Task<UtilityCalculation> CalculateSegments(Guid location, Guid room, UtilityType type, DateOnly period, decimal quantity, IReadOnlyList<SetupDocument> profiles, CancellationToken t)
    {
        var doc = await Store.GetAsync(Key($"utility-segments:{room}:{type}:{period}"), "UtilityPeriodBreakdown", t);
        if (doc is null) return new(0, "", ["utility_period_split_requires_review"]);
        var input = Read<UtilityPeriodBreakdown>(doc); var missing = new List<string>();
        try { await ValidateSegments(input, profiles, t); }
        catch (PropertyException) { return new(0, "", ["utility_period_breakdown_stale"]); }
        if (input.Segments.Sum(s => s.Consumption) != quantity) missing.Add("utility_period_consumption_mismatch");
        var quota = await Store.GetAsync(Key($"quota:{room}:{type}:{period}"), "UtilityQuota", t);
        if (profiles.Any(d => Read<UtilityProfileWrite>(d).RequireQuota))
        {
            if (quota?.Status != "Verified" || input.Segments.Sum(s => s.FreeQuantity) != Math.Min(quantity, Read<UtilityQuotaWrite>(quota).FreeQuantity))
                missing.Add("utility_period_quota_mismatch");
        }
        else if (input.Segments.Any(s => s.FreeQuantity != 0)) missing.Add("utility_quota_not_configured");
        var reconciliationVersions = new List<object>();
        if (profiles.Any(d => Read<UtilityProfileWrite>(d).RequireReconciliation))
        {
            var usage = await Store.UtilityUsageAsync(location, type, period, t);
            var links = (await Store.ListAsync(location, "UtilityMeterLink", t)).Select(Read<UtilityMeterLink>)
                .Where(l => usage.Any(u => u.RoomId == room && u.MeterId == l.MeterId)).ToArray();
            var bills = (await Store.ListAsync(location, "UtilitySourceBill", t)).Where(d =>
            { var b = Read<UtilitySourceBill>(d); return b.Period == period && b.UtilityType == type && links.Any(l => l.ParentMeterId == b.MeterId); }).ToArray();
            if (bills.Length != 1) missing.Add("utility_source_bill_required");
            else
            {
                var r = await Store.GetAsync(Key($"reconciliation:{bills[0].Id}"), "UtilityReconciliation", t);
                if (r?.Status is not ("Reconciled" or "VarianceReviewed")) missing.Add("utility_reconciliation_required");
                else
                {
                    var saved = Read<UtilityReconciliation>(r);
                    var fresh = await PreviewCoreAsync(new(location, saved.SourceBillId, saved.Tolerance, saved.Reason), t);
                    if (fresh.InputsHash != saved.InputsHash || fresh.Status == "MissingConfirmedInputs") missing.Add("utility_reconciliation_stale");
                    reconciliationVersions.Add(new { r.Id, r.Version });
                }
            }
        }
        var amounts = new List<object>(); decimal total = 0;
        foreach (var segment in input.Segments)
        {
            var tariff = (await Store.GetAsync(segment.TariffId, "UtilityTariff", t))!; var data = Read<UtilityTariffWrite>(tariff);
            var amount = UtilityTariffMath.Calculate(segment.Consumption - segment.FreeQuantity, data.Tiers, data.Rounding); total += amount;
            amounts.Add(new { segment.From, segment.To, segment.Consumption, segment.FreeQuantity, tariffId = tariff.Id, tariffVersion = tariff.Version, data.Tiers, data.Rounding, amount });
        }
        return new(total, JsonSerializer.Serialize(new
        {
            breakdownId = doc.Id,
            breakdownVersion = doc.Version,
            segments = amounts,
            reconciliationVersions,
            quotaId = quota?.Id,
            quotaVersion = quota?.Version,
            amount = total
        }, Json), missing);
    }
}
