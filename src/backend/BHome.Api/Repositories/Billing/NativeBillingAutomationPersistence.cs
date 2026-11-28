using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

// Location settings and room representative history are part of their physical rows.
// Each plan is immutable; updates preserve unrelated settings and append history.
internal static class NativeBillingAutomationPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record ScheduleState(Guid Id, Guid LocationId, BillingRateDate RateDate,
        BillingRentSource RentSource, PartialMonthRule PartialMonth, VndRounding Rounding,
        int DraftDay, int DraftMonthOffset, int FinalDay, int FinalMonthOffset,
        int DueDay, int DueMonthOffset, int Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    private static string Envelope(string kind, Guid id, object state) =>
        JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = id.ToString(), deleted = false, state }, Json);

    private static async Task EnsureAsync(Compact24DbContext db, FormattableString command, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Billing changes require a transaction.");
        if (await db.Database.ExecuteSqlInterpolatedAsync(command, t) != 1)
            throw new DbUpdateConcurrencyException("Billing record changed or no longer exists.");
    }

    internal static async Task<BillingSchedule?> ScheduleAsync(Compact24DbContext db, Guid location, CancellationToken t)
    {
        var settings = await db.Set<Native.Location>().AsNoTracking().Where(l => l.Id == location)
            .Select(l => l.OperatingSettings).SingleOrDefaultAsync(t);
        if (settings.ValueKind != JsonValueKind.Object || !settings.TryGetProperty("billingSchedule", out var node)
            || node.ValueKind != JsonValueKind.Object) return null;
        var s = node.Deserialize<ScheduleState>(Json) ?? throw new InvalidOperationException("Invalid billing schedule.");
        var row = BillingSchedule.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
        row.LocationId = s.LocationId; row.RateDate = s.RateDate; row.RentSource = s.RentSource;
        row.PartialMonth = s.PartialMonth; row.Rounding = s.Rounding; row.DraftDay = s.DraftDay;
        row.DraftMonthOffset = s.DraftMonthOffset; row.FinalDay = s.FinalDay; row.FinalMonthOffset = s.FinalMonthOffset;
        row.DueDay = s.DueDay; row.DueMonthOffset = s.DueMonthOffset; row.Version = s.Version;
        return row;
    }

    internal static async Task<BillingAutomationPlan[]> PlansAsync(Compact24DbContext db, Guid location, CancellationToken t)
    {
        var settings = await db.Set<Native.Location>().AsNoTracking().Where(l => l.Id == location)
            .Select(l => l.OperatingSettings).SingleOrDefaultAsync(t);
        return settings.ValueKind == JsonValueKind.Object && settings.TryGetProperty("automationPlanVersions", out var array)
            ? array.Deserialize<BillingAutomationPlan[]>(Json) ?? [] : [];
    }

    internal static async Task<BillingAutomationPlan?> PlanAsync(Compact24DbContext db, Guid id, CancellationToken t)
    {
        var state = await db.Database.SqlQuery<string>($"""
            SELECT p::text AS "Value" FROM locations l CROSS JOIN LATERAL
              jsonb_array_elements(COALESCE(l.operating_settings->'automationPlanVersions','[]'::jsonb)) p
            WHERE p->>'id'={id.ToString()}
            """).SingleOrDefaultAsync(t);
        return state is null ? null : JsonSerializer.Deserialize<BillingAutomationPlan>(state, Json);
    }

    internal static async Task<BillingRepresentativeSelection?> RepresentativeAsync(Compact24DbContext db, Guid room, DateOnly period, CancellationToken t)
    {
        var json = await db.Set<Native.Room>().AsNoTracking().Where(r => r.Id == room)
            .Select(r => r.BillingRepresentatives).SingleOrDefaultAsync(t);
        if (json.ValueKind != JsonValueKind.Array) return null;
        return json.EnumerateArray().Where(e => e.TryGetProperty("recordType", out var kind) &&
                kind.GetString() == "BillingRepresentativeSelection")
            .GroupBy(e => e.GetProperty("recordKey").GetString()).Select(g => g.Last())
            .Where(e => !e.TryGetProperty("deleted", out var deleted) || deleted.ValueKind != JsonValueKind.True)
            .Select(e => e.GetProperty("state").Deserialize<BillingRepresentativeSelection>(Json)!)
            .Where(s => s.BillingPeriod == period).OrderByDescending(s => s.Version).FirstOrDefault();
    }

    internal static Task SaveRepresentativeAsync(Compact24DbContext db, BillingRepresentativeSelection selection, CancellationToken t)
    {
        var history = Envelope("BillingRepresentativeSelection", selection.Id, selection);
        return EnsureAsync(db, $"""
            UPDATE rooms SET billing_representatives=billing_representatives||jsonb_build_array(CAST({history} AS jsonb)),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={selection.RoomId}
            """, t);
    }

    internal static Task SaveScheduleAsync(Compact24DbContext db, BillingSchedule schedule, int? originalVersion, CancellationToken t)
    {
        schedule.Stamp(DateTimeOffset.UtcNow, originalVersion is null);
        var state = JsonSerializer.Serialize(schedule, Json);
        var history = Envelope("BillingSchedule", schedule.Id, schedule);
        return EnsureAsync(db, $"""
            UPDATE locations SET operating_settings=operating_settings||jsonb_build_object('billingSchedule',CAST({state} AS jsonb)),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={schedule.LocationId} AND COALESCE((operating_settings->'billingSchedule'->>'version')::integer,0)={originalVersion ?? 0}
            """, t);
    }

    internal static Task SavePlanAsync(Compact24DbContext db, BillingAutomationPlan plan, CancellationToken t)
    {
        var state = JsonSerializer.Serialize(plan, Json);
        var history = Envelope("BillingAutomationPlan", plan.Id, plan);
        return EnsureAsync(db, $"""
            UPDATE locations SET operating_settings=operating_settings||jsonb_build_object('automationPlanVersions',
                COALESCE(operating_settings->'automationPlanVersions','[]'::jsonb)||jsonb_build_array(CAST({state} AS jsonb)||jsonb_build_object('recordType','BillingAutomationPlan'))),
                history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={plan.LocationId}
            """, t);
    }

    internal static Task<bool> ActiveRoleAsync(Compact24DbContext db, Guid user, string role, CancellationToken t) =>
        db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM users WHERE id={user} AND is_active AND {role}=ANY(roles)) AS \"Value\"").SingleAsync(t);
}
