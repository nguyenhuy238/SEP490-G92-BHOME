using BHome.Application.Common;
using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Billing;

public sealed class BillingAutomationService(IBillingAutomationSchedules schedules, ICurrentUser user, PermissionAccess permissions, TimeProvider clock)
{
    private async Task<Guid> Owner(Guid location, CancellationToken t)
    {
        if (user.UserId is not { } actor) throw new InvoiceException(401, "authentication_required");
        if (!await permissions.CanAccessAsync(Permissions.Locations.Manage, new(location, null), t)) throw new InvoiceException(403, "billing_automation_owner_required");
        return actor;
    }
    public async Task<BillingAutomationPlan?> GetAsync(Guid location, DateOnly period, CancellationToken t)
    { await Owner(location, t); ValidatePeriod(period); return await schedules.ForPeriodAsync(location, period, t); }
    public async Task<IReadOnlyList<BillingAutomationPlan>> HistoryAsync(Guid location, CancellationToken t)
    { await Owner(location, t); return await schedules.HistoryAsync(location, t); }
    // The recurring location editor owns only the five milestones. Effective dates
    // and fixed calculation defaults are internal, retaining historical plan snapshots.
    public async Task<BillingAutomationPlan> SaveLocationScheduleAsync(Guid location, LocationBillingScheduleWrite x, CancellationToken t)
    {
        await Owner(location, t);
        var today = clock.BusinessToday();
        var period = new DateOnly(today.Year, today.Month, 1);
        // An inherited plan is just as authoritative as one created this month.
        // The existing write-version check protects against competing edits.
        if (await schedules.ForPeriodAsync(location, period, t) is not null)
            period = period.AddMonths(1);
        if (new[] { x.MeterDay, x.MeterDueDay, x.DraftDay, x.FinalDay, x.DueDay }.Any(d => d is < 1 or > 31) ||
            new[] { x.MeterDueMonthOffset, x.DraftMonthOffset, x.FinalMonthOffset, x.DueMonthOffset }.Any(o => o is < 0 or > 1))
            throw new InvoiceException(400, "invalid_billing_automation");
        foreach (var month in new[] { new DateOnly(2027, 2, 1), new DateOnly(2028, 2, 1), new DateOnly(2026, 12, 1) })
        {
            var dates = new[] { InvoiceMath.CalendarDate(month, x.MeterDay, 0),
                InvoiceMath.CalendarDate(month, x.MeterDueDay, x.MeterDueMonthOffset),
                InvoiceMath.CalendarDate(month, x.DraftDay, x.DraftMonthOffset),
                InvoiceMath.CalendarDate(month, x.FinalDay, x.FinalMonthOffset),
                InvoiceMath.CalendarDate(month, x.DueDay, x.DueMonthOffset) };
            if (dates.Zip(dates.Skip(1)).Any(pair => pair.First > pair.Second))
                throw new InvoiceException(400, "invalid_billing_calendar_order");
        }
        return await SaveAsync(new(location, period, true, true, x.MeterDay, x.MeterDueDay, x.MeterDueMonthOffset,
            "Asia/Ho_Chi_Minh", x.ExpectedVersion, x.ExpectedBillingScheduleVersion,
            x.DraftDay, x.DraftMonthOffset, x.FinalDay, x.FinalMonthOffset, x.DueDay, x.DueMonthOffset,
            new(BillingRateDate.PeriodStart, PartialMonthRule.FullMonth, VndRounding.AwayFromZero)), t);
    }
    public async Task<BillingAutomationPlan> SaveAsync(BillingAutomationWrite x, CancellationToken t)
    {
        var actor = await Owner(x.LocationId, t); ValidatePeriod(x.EffectiveFrom);
        if (x.LocationId == Guid.Empty || x.TimeZone != "Asia/Ho_Chi_Minh" || x.MeterDay is < 1 or > 31 || x.MeterDueDay is < 1 or > 31 || x.MeterDueMonthOffset is < 0 or > 2 || x.ExpectedVersion < 0 || x.ExpectedBillingScheduleVersion < 0 || !x.Enabled && x.AuthorizeAutomaticFinalization ||
            x.DraftDay is < 1 or > 31 || x.FinalDay is < 1 or > 31 || x.DueDay is < 1 or > 31 ||
            x.DraftMonthOffset is < 0 or > 2 || x.FinalMonthOffset is < 0 or > 2 || x.DueMonthOffset is < 0 or > 2 ||
            (x.InitialSchedule is { } initial && (!Enum.IsDefined(initial.RateDate) || !Enum.IsDefined(initial.PartialMonth) || !Enum.IsDefined(initial.Rounding))))
            throw new InvoiceException(400, "invalid_billing_automation");
        foreach (var period in new[] { new DateOnly(2027, 2, 1), new DateOnly(2028, 2, 1), new DateOnly(2026, 12, 1) })
            if (InvoiceMath.CalendarDate(period, x.MeterDay, 0) > InvoiceMath.CalendarDate(period, x.MeterDueDay, x.MeterDueMonthOffset)) throw new InvoiceException(400, "invalid_meter_calendar_order");
        return await schedules.SaveAsync(x, actor, clock.GetUtcNow(), t);
    }
    public static void ValidatePeriod(DateOnly period)
    { if (period.Day != 1 || period.Year is < 2000 or > 9997) throw new InvoiceException(400, "invalid_invoice_period"); }
    public static BillingSchedule Calendar(BillingAutomationPlan plan) => JsonSerializer.Deserialize<BillingSchedule>(plan.BillingSnapshot) ?? throw new InvoiceException(409, "billing_automation_snapshot_invalid");
    // Additive JSON on the existing immutable plan. Older readers still deserialize
    // the root as BillingSchedule; no persisted invoice or legacy API shape changes.
    public static string Snapshot(BillingSchedule calendar, BillingSchedule? fallback)
    {
        var json = JsonSerializer.SerializeToNode(calendar)!.AsObject();
        json["FallbackSchedule"] = JsonSerializer.SerializeToNode(fallback);
        return json.ToJsonString();
    }
    public static BillingSchedule? FallbackCalendar(BillingSchedule current, BillingAutomationPlan? latest)
    {
        // A newer explicit legacy PUT is intentionally authoritative for uncovered
        // periods. Automation saves carry the previous fallback forward instead.
        if (latest is null || latest.BillingScheduleVersion != current.Version) return current;
        try
        {
            using var json = JsonDocument.Parse(latest.BillingSnapshot);
            if (json.RootElement.ValueKind != JsonValueKind.Object)
                throw new InvoiceException(409, "billing_automation_snapshot_invalid");
            if (!json.RootElement.TryGetProperty("FallbackSchedule", out var fallback)) return current;
            // An initial automation plan must not invent financial rules for
            // periods before its effective date when no legacy schedule existed.
            if (fallback.ValueKind == JsonValueKind.Null) return null;
            var preserved = fallback.Deserialize<BillingSchedule>();
            if (preserved is null || preserved.LocationId != current.LocationId || preserved.Version < 1 ||
                preserved.Version > current.Version || !Enum.IsDefined(preserved.RateDate) ||
                !Enum.IsDefined(preserved.RentSource) || !Enum.IsDefined(preserved.PartialMonth) ||
                !Enum.IsDefined(preserved.Rounding))
                throw new InvoiceException(409, "billing_automation_snapshot_invalid");
            return preserved;
        }
        catch (JsonException) { throw new InvoiceException(409, "billing_automation_snapshot_invalid"); }
    }
    public static bool SameCalendarTerms(BillingSchedule a, BillingSchedule b) =>
        a.LocationId == b.LocationId && a.RateDate == b.RateDate && a.RentSource == b.RentSource &&
        a.PartialMonth == b.PartialMonth && a.Rounding == b.Rounding &&
        a.DraftDay == b.DraftDay && a.DraftMonthOffset == b.DraftMonthOffset &&
        a.FinalDay == b.FinalDay && a.FinalMonthOffset == b.FinalMonthOffset &&
        a.DueDay == b.DueDay && a.DueMonthOffset == b.DueMonthOffset;
    public static string CalendarKey(BillingSchedule s) => JsonSerializer.Serialize(new { s.LocationId, s.Version, s.RateDate, s.RentSource, s.PartialMonth, s.Rounding, s.DraftDay, s.DraftMonthOffset, s.FinalDay, s.FinalMonthOffset, s.DueDay, s.DueMonthOffset });
}
