using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;

namespace BHome.Application.PropertyManagement;

public sealed partial class UtilityWorkspaceService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access) : SetupWorkspaceService(store, user, access), IUtilityBilling
{
    private static void Period(DateOnly period) { if (period == default || period.Day != 1) throw new PropertyException(400, "billing_period_required"); }
    private static void Range(DateOnly from, DateOnly? to) { if (from == default || to < from) throw new PropertyException(400, "invalid_effective_period"); }
    public async Task<SetupDocument> TariffAsync(UtilityTariffWrite input, CancellationToken t)
    {
        Owner(); Range(input.EffectiveFrom, input.EffectiveTo); Text(input.Supplier, 150); Text(input.Classification, 150); Text(input.SourceReference, 1000);
        if (!Enum.IsDefined(input.UtilityType) || input.Tiers is null) throw new PropertyException(400, "invalid_utility_type");
        _ = UtilityTariffMath.Calculate(0, input.Tiers, input.Rounding);
        return await Store.TransactionAsync(input.LocationId, async () =>
        {
            var tariffs = await Store.ListAsync(input.LocationId, "UtilityTariff", t);
            if (input.ReplacesId is { } source)
            {
                var old = await Document(source, "UtilityTariff", true, t);
                if (old.LocationId != input.LocationId || Read<UtilityTariffWrite>(old).UtilityType != input.UtilityType ||
                    input.EffectiveFrom <= Read<UtilityTariffWrite>(old).EffectiveFrom) throw new PropertyException(400, "invalid_tariff_replacement");
                if (tariffs.Any(d => Read<UtilityTariffWrite>(d).ReplacesId == source)) throw new PropertyException(409, "tariff_already_replaced");
            }
            foreach (var doc in tariffs.Where(d => d.Id != input.ReplacesId))
            {
                var old = Read<UtilityTariffWrite>(doc);
                if (old.UtilityType == input.UtilityType && old.EffectiveFrom <= (input.EffectiveTo ?? DateOnly.MaxValue) &&
                    input.EffectiveFrom <= (old.EffectiveTo ?? DateOnly.MaxValue) && !tariffs.Any(d => Read<UtilityTariffWrite>(d).ReplacesId == doc.Id))
                    throw new PropertyException(409, "tariff_period_overlap");
            }
            return await Store.SaveAsync(Guid.NewGuid(), input.LocationId, "UtilityTariff", input.Verified ? "Verified" : "NeedsReview", input, 0, Actor, t);
        }, t);
    }
    public async Task<SetupDocument> SourceMeterAsync(UtilitySourceMeter input, CancellationToken t)
    {
        Owner(); input = input with { Code = Text(input.Code, 80) };
        if (!Enum.IsDefined(input.UtilityType) || input.Scope is not ("Source" or "Common") || input.Scope == "Source" && input.ParentMeterId is not null ||
            input.Scope == "Common" && input.ParentMeterId is null) throw new PropertyException(400, "invalid_meter_scope");
        return await Store.TransactionAsync(input.LocationId, async () =>
        {
            if (input.ParentMeterId is { } parent) await Parent(parent, input.LocationId, input.UtilityType, t);
            if ((await Store.ListAsync(input.LocationId, "UtilitySourceMeter", t)).Any(d => Read<UtilitySourceMeter>(d).Code.Equals(input.Code.Trim(), StringComparison.OrdinalIgnoreCase)))
                throw new PropertyException(409, "duplicate_meter_code");
            return await Store.SaveAsync(Guid.NewGuid(), input.LocationId, "UtilitySourceMeter", "Active", input, 0, Actor, t);
        }, t);
    }
    private async Task Parent(Guid id, Guid location, UtilityType type, CancellationToken t)
    {
        var doc = await Store.GetAsync(id, "UtilitySourceMeter", t) ?? throw new PropertyException(400, "source_meter_required");
        var source = Read<UtilitySourceMeter>(doc);
        if (doc.LocationId != location || source.UtilityType != type || source.Scope != "Source") throw new PropertyException(400, "meter_parent_scope_invalid");
    }
    public async Task<SetupDocument> LinkAsync(UtilityMeterLink input, CancellationToken t)
    {
        Owner(); Range(input.EffectiveFrom, input.EffectiveTo);
        var meter = await Store.MeterScopeAsync(input.MeterId, t) ?? throw new PropertyException(404, "meter_not_found");
        if (input.Scope != "Room" || input.ParentMeterId is null) throw new PropertyException(400, "room_meter_parent_required");
        return await Store.TransactionAsync(meter.LocationId, async () =>
        {
            await Parent(input.ParentMeterId.Value, meter.LocationId, meter.Type, t);
            if ((await Store.ListAsync(meter.LocationId, "UtilityMeterLink", t)).Any(d => { var old = Read<UtilityMeterLink>(d); return old.MeterId == input.MeterId && old.EffectiveFrom <= (input.EffectiveTo ?? DateOnly.MaxValue) && input.EffectiveFrom <= (old.EffectiveTo ?? DateOnly.MaxValue); }))
                throw new PropertyException(409, "meter_link_overlap");
            return await Store.SaveAsync(Guid.NewGuid(), meter.LocationId, "UtilityMeterLink", "Recorded", input, 0, Actor, t);
        }, t);
    }
    public async Task<SetupDocument> SourceReadingAsync(UtilitySourceReading input, CancellationToken t)
    {
        Period(input.Period); var meter = await Document(input.MeterId, "UtilitySourceMeter", false, t);
        if (!input.HumanConfirmed || input.Opening < 0 || input.Closing < input.Opening || input.Closing > 1_000_000_000m) throw new PropertyException(400, "invalid_confirmed_reading");
        await Evidence(meter.LocationId, input.EvidenceObjectKey, t);
        return await Store.TransactionAsync(meter.LocationId, async () =>
        {
            var id = Key($"source-reading:{input.MeterId}:{input.Period}");
            if (await Store.GetAsync(id, "UtilitySourceReading", t) is { } prior)
            {
                if (Hash(Read<UtilitySourceReading>(prior)) != Hash(input)) throw new PropertyException(409, "confirmed_reading_immutable");
                return prior;
            }
            var previous = await Store.GetAsync(Key($"source-reading:{input.MeterId}:{input.Period.AddMonths(-1)}"), "UtilitySourceReading", t);
            if (previous is not null && Read<UtilitySourceReading>(previous).Closing != input.Opening) throw new PropertyException(409, "previous_source_reading_mismatch");
            return await Store.SaveAsync(id, meter.LocationId, "UtilitySourceReading", "Confirmed", input, 0, Actor, t);
        }, t);
    }
    public async Task<SetupDocument> QuotaAsync(UtilityQuotaWrite input, CancellationToken t)
    {
        Owner(); Period(input.Period); Text(input.SourceReference, 1000);
        if (await RoomScope(input.RoomId, true, t) != input.LocationId || !Enum.IsDefined(input.UtilityType) || input.FreeQuantity < 0) throw new PropertyException(400, "invalid_quota_scope");
        return await Store.TransactionAsync(input.LocationId, () => Store.SaveAsync(Key($"quota:{input.RoomId}:{input.UtilityType}:{input.Period}"), input.LocationId,
            "UtilityQuota", input.Verified ? "Verified" : "NeedsReview", input, input.ExpectedVersion, Actor, t), t);
    }
    public async Task<SetupDocument> ProfileAsync(UtilityProfileWrite input, CancellationToken t)
    {
        Owner(); Range(input.EffectiveFrom, input.EffectiveTo);
        if (await RoomScope(input.RoomId, true, t) != input.LocationId) throw new PropertyException(400, "profile_scope_invalid");
        var tariff = await Document(input.TariffId, "UtilityTariff", true, t);
        if (tariff.LocationId != input.LocationId || Read<UtilityTariffWrite>(tariff).UtilityType != input.UtilityType) throw new PropertyException(400, "tariff_scope_invalid");
        return await Store.TransactionAsync(input.LocationId, async () =>
        {
            var originals = await Store.ListAsync(input.LocationId, "UtilityProfile", t);
            if (input.ReplacesId is { } source)
            {
                var original = originals.SingleOrDefault(d => d.Id == source) ?? throw new PropertyException(404, "profile_not_found");
                var old = Read<UtilityProfileWrite>(original);
                if (old.RoomId != input.RoomId || old.UtilityType != input.UtilityType || input.EffectiveFrom <= old.EffectiveFrom)
                    throw new PropertyException(400, "profile_replacement_invalid");
                if (original.Version != input.ExpectedVersion || originals.Any(d => Read<UtilityProfileWrite>(d).ReplacesId == source))
                    throw new PropertyException(409, "profile_replacement_conflict");
            }
            if (NormalizeProfiles(originals).Where(d => d.Id != input.ReplacesId).Any(d =>
            {
                var p = Read<UtilityProfileWrite>(d); return p.RoomId == input.RoomId && p.UtilityType == input.UtilityType &&
                p.EffectiveFrom <= (input.EffectiveTo ?? DateOnly.MaxValue) && input.EffectiveFrom <= (p.EffectiveTo ?? DateOnly.MaxValue);
            }))
                throw new PropertyException(409, "profile_period_overlap");
            return await Store.SaveAsync(Guid.NewGuid(), input.LocationId, "UtilityProfile", "Recorded", input, 0, Actor, t);
        }, t);
    }
    private static IReadOnlyList<SetupDocument> NormalizeProfiles(IReadOnlyList<SetupDocument> documents) => documents.Select(doc =>
    {
        var profile = Read<UtilityProfileWrite>(doc);
        var next = documents.Where(d => Read<UtilityProfileWrite>(d).ReplacesId == doc.Id)
            .Select(d => (DateOnly?)Read<UtilityProfileWrite>(d).EffectiveFrom).Min();
        return next is { } start && (profile.EffectiveTo is null || profile.EffectiveTo >= start)
            ? doc with { Data = JsonSerializer.SerializeToElement(profile with { EffectiveTo = start.AddDays(-1) }, Json) }
            : doc;
    }).ToArray();
    public async Task<SetupDocument> SourceBillAsync(UtilitySourceBill input, Guid key, CancellationToken t)
    {
        Owner(); Period(input.Period); Text(input.Reference, 150); await Parent(input.MeterId, input.LocationId, input.UtilityType, t);
        if (key == Guid.Empty || input.Amount < 0 || input.Amount >= 1_000_000_000_000_000_000m || input.Consumption < 0 || input.Consumption > 1_000_000_000m || decimal.Truncate(input.Amount) != input.Amount) throw new PropertyException(400, "invalid_source_bill");
        await Evidence(input.LocationId, input.EvidenceObjectKey, t);
        return await Store.TransactionAsync(input.LocationId, async () =>
        {
            if (await Store.GetAsync(key, "UtilitySourceBill", t) is { } prior)
            {
                if (prior.LocationId != input.LocationId || Hash(Read<UtilitySourceBill>(prior)) != Hash(input)) throw new PropertyException(409, "idempotency_conflict");
                return prior;
            }
            if ((await Store.ListAsync(input.LocationId, "UtilitySourceBill", t)).Any(d => { var b = Read<UtilitySourceBill>(d); return b.MeterId == input.MeterId && b.Period == input.Period; }))
                throw new PropertyException(409, "duplicate_source_bill");
            return await Store.SaveAsync(key, input.LocationId, "UtilitySourceBill", "Recorded", input, 0, Actor, t);
        }, t);
    }
    public async Task<UtilityReconciliation> PreviewAsync(UtilityReconcileInput input, CancellationToken t)
    {
        Owner(); await Scope(input.LocationId, true, t); return await PreviewCoreAsync(input, t);
    }
    private async Task<UtilityReconciliation> PreviewCoreAsync(UtilityReconcileInput input, CancellationToken t)
    {
        if (input.Tolerance < 0) throw new PropertyException(400, "invalid_tolerance");
        var billDoc = await Store.GetAsync(input.SourceBillId, "UtilitySourceBill", t) ?? throw new PropertyException(404, "source_bill_not_found"); var bill = Read<UtilitySourceBill>(billDoc);
        if (bill.LocationId != input.LocationId) throw new PropertyException(400, "bill_scope_invalid");
        var periodEnd = bill.Period.AddMonths(1).AddDays(-1);
        var links = (await Store.ListAsync(input.LocationId, "UtilityMeterLink", t)).Select(Read<UtilityMeterLink>)
            .Where(l => l.ParentMeterId == bill.MeterId && l.EffectiveFrom <= bill.Period && (l.EffectiveTo is null || l.EffectiveTo >= periodEnd)).ToArray();
        var usage = (await Store.UtilityUsageAsync(input.LocationId, bill.UtilityType, bill.Period, t)).Where(u => links.Any(l => l.MeterId == u.MeterId)).ToArray();
        var commonMeters = (await Store.ListAsync(input.LocationId, "UtilitySourceMeter", t)).Where(d => Read<UtilitySourceMeter>(d).ParentMeterId == bill.MeterId).ToArray();
        decimal common = 0; var readings = new List<UtilitySourceReading>(); var missing = links.Any(l => !usage.Any(u => u.MeterId == l.MeterId));
        foreach (var meter in commonMeters)
        {
            var reading = await Store.GetAsync(Key($"source-reading:{meter.Id}:{bill.Period}"), "UtilitySourceReading", t);
            if (reading is null) { missing = true; continue; }
            var r = Read<UtilitySourceReading>(reading); readings.Add(r); common += r.Closing - r.Opening;
        }
        var sourceReading = await Store.GetAsync(Key($"source-reading:{bill.MeterId}:{bill.Period}"), "UtilitySourceReading", t);
        if (sourceReading is null) missing = true;
        else { var r = Read<UtilitySourceReading>(sourceReading); readings.Add(r); if (r.Closing - r.Opening != bill.Consumption) missing = true; }
        var room = usage.Sum(u => u.Consumption); var variance = bill.Consumption - room - common;
        return new(billDoc.Id, bill.Consumption, room, common, variance, input.Tolerance,
            missing ? "MissingConfirmedInputs" : Math.Abs(variance) > input.Tolerance ? "NeedsReview" : "Reconciled", input.Reason,
            Hash(new { bill, links, usage, readings }));
    }
    public async Task<SetupDocument> ReconcileAsync(UtilityReconcileInput input, CancellationToken t)
    {
        Owner(); Text(input.Reason, 2000);
        return await Store.TransactionAsync(input.LocationId, async () =>
        {
            var preview = await PreviewAsync(input, t);
            return await Store.SaveAsync(Key($"reconciliation:{input.SourceBillId}"), input.LocationId, "UtilityReconciliation", preview.Status, preview, input.ExpectedVersion, Actor, t);
        }, t);
    }
    public async Task<UtilityCalculation?> CalculateAsync(Guid roomId, UtilityType type, DateOnly period, decimal quantity, CancellationToken t)
    {
        var location = await Store.RoomLocationAsync(roomId, t) ?? throw new PropertyException(404, "resource_not_found"); var end = period.AddMonths(1).AddDays(-1);
        var profiles = NormalizeProfiles(await Store.ListAsync(location, "UtilityProfile", t)).Where(d => { var p = Read<UtilityProfileWrite>(d); return p.RoomId == roomId && p.UtilityType == type && p.EffectiveFrom <= end && (p.EffectiveTo is null || p.EffectiveTo >= period); }).ToArray();
        if (profiles.Length == 0) return null;
        var missing = new List<string>();
        if (profiles.Length != 1) return await CalculateSegments(location, roomId, type, period, quantity, profiles, t);
        var profile = Read<UtilityProfileWrite>(profiles[0]);
        var tariff = await Store.GetAsync(profile.TariffId, "UtilityTariff", t) ?? throw new PropertyException(409, "tariff_missing"); var tariffData = Read<UtilityTariffWrite>(tariff);
        if (profile.EffectiveFrom > period || profile.EffectiveTo < end || tariffData.EffectiveFrom > period || tariffData.EffectiveTo < end ||
            (await Store.ListAsync(location, "UtilityTariff", t)).Any(d => Read<UtilityTariffWrite>(d).ReplacesId == tariff.Id && Read<UtilityTariffWrite>(d).EffectiveFrom <= end))
            return await CalculateSegments(location, roomId, type, period, quantity, profiles, t);
        if (tariff.Status != "Verified") missing.Add("utility_tariff_verification_required");
        var quota = await Store.GetAsync(Key($"quota:{roomId}:{type}:{period}"), "UtilityQuota", t);
        decimal free = 0;
        if (profile.RequireQuota)
        {
            if (quota?.Status != "Verified") missing.Add("utility_quota_verification_required");
            else free = Read<UtilityQuotaWrite>(quota).FreeQuantity;
        }
        SetupDocument? reconciliation = null;
        if (profile.RequireReconciliation)
        {
            var links = (await Store.ListAsync(location, "UtilityMeterLink", t)).Select(Read<UtilityMeterLink>).Where(l => l.EffectiveFrom <= period && (l.EffectiveTo is null || l.EffectiveTo >= end)).ToArray();
            var roomMeters = (await Store.UtilityUsageAsync(location, type, period, t)).Where(u => u.RoomId == roomId).Select(u => u.MeterId).ToArray();
            var parentIds = links.Where(l => roomMeters.Contains(l.MeterId)).Select(l => l.ParentMeterId).Distinct().ToArray();
            var bills = (await Store.ListAsync(location, "UtilitySourceBill", t)).Where(d => { var b = Read<UtilitySourceBill>(d); return b.Period == period && b.UtilityType == type && parentIds.Contains(b.MeterId); }).ToArray();
            if (bills.Length != 1) missing.Add("utility_source_bill_required");
            else
            {
                reconciliation = await Store.GetAsync(Key($"reconciliation:{bills[0].Id}"), "UtilityReconciliation", t);
                if (reconciliation?.Status is not ("Reconciled" or "VarianceReviewed")) missing.Add("utility_reconciliation_required");
                else
                {
                    var saved = Read<UtilityReconciliation>(reconciliation);
                    // Internal revalidation uses persisted Owner choices, without authorizing a user-facing read.
                    var fresh = await PreviewInternal(new(location, bills[0].Id, saved.Tolerance, saved.Reason), t);
                    if (fresh.InputsHash != saved.InputsHash || fresh.Status == "MissingConfirmedInputs" || fresh.Status != "Reconciled" && reconciliation.Status != "VarianceReviewed") missing.Add("utility_reconciliation_stale");
                }
            }
        }
        var amount = UtilityTariffMath.Calculate(Math.Max(0, quantity - free), tariffData.Tiers, tariffData.Rounding);
        return new(amount, JsonSerializer.Serialize(new
        {
            profileId = profiles[0].Id,
            profileVersion = profiles[0].Version,
            tariffId = tariff.Id,
            tariffVersion = tariff.Version,
            tariffData.Tiers,
            tariffData.Rounding,
            quotaId = profile.RequireQuota ? quota?.Id : null,
            quotaVersion = profile.RequireQuota ? quota?.Version : null,
            reconciliationId = reconciliation?.Id,
            reconciliationVersion = reconciliation?.Version,
            quantity,
            free,
            amount
        }, Json), missing);
    }
    private Task<UtilityReconciliation> PreviewInternal(UtilityReconcileInput input, CancellationToken t) => PreviewCoreAsync(input, t);

    public async Task<SetupDocument> ReviewVarianceAsync(Guid id, UtilityVarianceReview input, CancellationToken t)
    {
        var initial = await Document(id, "UtilityReconciliation", true, t); Text(input.Reason, 2000);
        return await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var doc = await Document(id, "UtilityReconciliation", true, t); var saved = Read<UtilityReconciliation>(doc);
            var fresh = await PreviewCoreAsync(new(doc.LocationId, saved.SourceBillId, saved.Tolerance, input.Reason), t);
            if (fresh.Status == "MissingConfirmedInputs") throw new PropertyException(409, "confirmed_source_inputs_required");
            if (fresh.InputsHash != saved.InputsHash) throw new PropertyException(409, "utility_reconciliation_stale");
            var status = input.AcceptVariance ? "VarianceReviewed" : "NeedsReview";
            return await Store.SaveAsync(id, doc.LocationId, doc.Kind, status, fresh with { Status = status }, input.ExpectedVersion, Actor, t);
        }, t);
    }
}
