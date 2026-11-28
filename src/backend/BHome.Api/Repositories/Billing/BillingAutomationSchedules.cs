using BHome.Infrastructure.Billing;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;
namespace BHome.Infrastructure.Modules.Billing.Persistence;

internal sealed class BillingAutomationSchedules(BHomePersistenceContext db) : IBillingAutomationSchedules
{
    public async Task<bool> AuthorizedAsync(BillingAutomationPlan plan, Guid actor, DateOnly period, bool finalization, CancellationToken t) =>
        plan.Enabled && plan.AuthorizedByUserId == actor && (!finalization || plan.AuthorizeAutomaticFinalization) && (await ForPeriodAsync(plan.LocationId, period, t))?.Id == plan.Id &&
        await (db is Compact24DbContext compact
            ? NativeBillingAutomationPersistence.ActiveRoleAsync(compact, actor, Roles.Owner, t)
            : (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id == actor && u.IsActive && r.Name == Roles.Owner select u.Id).AnyAsync(t));
    public Task<BillingRepresentativeSelection?> RepresentativeAsync(Guid room, DateOnly period, CancellationToken t) => db is Compact24DbContext compact
        ? NativeBillingAutomationPersistence.RepresentativeAsync(compact, room, period, t)
        : db.Set<BillingRepresentativeSelection>().AsNoTracking().Where(r => r.RoomId == room && r.BillingPeriod == period).OrderByDescending(r => r.Version).FirstOrDefaultAsync(t);
    public async Task<BillingRepresentativeSelection> SelectRepresentativeAsync(BillingRepresentativeInput x, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var native = db as Compact24DbContext;
        var location = (native is not null
            ? await native.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.Id == x.RoomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t)
            : await db.Set<Room>().Where(r => r.Id == x.RoomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t))
            ?? throw new InvoiceException(404, "room_not_found");
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))", t);
        if (native is not null) await native.Set<BHome.Domain.PropertyManagement.Room>().FromSqlInterpolated($"SELECT * FROM rooms WHERE id={x.RoomId} FOR UPDATE").AsNoTracking().SingleAsync(t);
        else await db.Locked<Room>(x.RoomId).SingleAsync(t);
        if (native is not null
            ? await native.Set<BHome.Domain.Billing.Invoice>().AnyAsync(i => i.InvoiceType == "PERIODIC" && i.RoomId == x.RoomId && i.BillingPeriod == x.BillingPeriod, t)
            : await db.PeriodicInvoices().AnyAsync(i => i.RoomId == x.RoomId && i.BillingPeriod == x.BillingPeriod, t)) throw new InvoiceException(409, "invoice_period_already_exists");
        var old = await RepresentativeAsync(x.RoomId, x.BillingPeriod, t); if ((old?.Version ?? 0) != x.ExpectedVersion) throw new InvoiceException(409, "billing_representative_changed");
        var end = x.BillingPeriod.AddMonths(1).AddDays(-1);
        var eligible = native is not null
            ? await native.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(c => c.Id == x.ContractId && c.RoomId == x.RoomId && c.ActivatedAt != null &&
                (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Holding || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Addendum) &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
                c.StartDate <= end && (c.ActualEndDate ?? c.EndDate) >= x.BillingPeriod, t)
            : await db.Set<Contract>().AnyAsync(c => c.Id == x.ContractId && c.RoomId == x.RoomId && c.ActivatedAt != null && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) && c.StartDate <= end && (c.ActualEndDate ?? c.EndDate) >= x.BillingPeriod, t);
        if (!eligible) throw new InvoiceException(400, "representative_contract_not_eligible");
        var row = new BillingRepresentativeSelection { RoomId = x.RoomId, BillingPeriod = x.BillingPeriod, ContractId = x.ContractId, Version = x.ExpectedVersion + 1, SelectedByUserId = actor, SelectedAt = now };
        if (native is not null) await NativeBillingAutomationPersistence.SaveRepresentativeAsync(native, row, t);
        else db.Add(row);
        await AuditAsync(actor, "BillingRepresentativeSelected", "BillingAutomation", row.Id, now, t);
        if (native is null) await db.SaveChangesAsync(t);
        await tx.CommitAsync(t); return row;
    }
    public Task<BillingAutomationPlan?> ForPeriodAsync(Guid locationId, DateOnly period, CancellationToken t) =>
        ForPeriodAsync(db, locationId, period, t);
    private static async Task<BillingAutomationPlan?> ForPeriodAsync(BHomePersistenceContext context, Guid locationId, DateOnly period, CancellationToken t) =>
        context is Compact24DbContext compact
            ? (await NativeBillingAutomationPersistence.PlansAsync(compact, locationId, t)).Where(p => p.EffectiveFrom <= period).OrderByDescending(p => p.EffectiveFrom).ThenByDescending(p => p.Version).FirstOrDefault()
            : await context.Set<BillingAutomationPlan>().AsNoTracking().Where(p => p.LocationId == locationId && p.EffectiveFrom <= period).OrderByDescending(p => p.EffectiveFrom).ThenByDescending(p => p.Version).FirstOrDefaultAsync(t);
    private static async Task<BillingAutomationPlan?> LatestAsync(BHomePersistenceContext context, Guid locationId, CancellationToken t) =>
        context is Compact24DbContext compact
            ? (await NativeBillingAutomationPersistence.PlansAsync(compact, locationId, t)).OrderByDescending(p => p.Version).FirstOrDefault()
            : await context.Set<BillingAutomationPlan>().AsNoTracking().Where(p => p.LocationId == locationId).OrderByDescending(p => p.Version).FirstOrDefaultAsync(t);
    internal static async Task<BillingSchedule?> ResolveCalendarAsync(BHomePersistenceContext context, Guid locationId, DateOnly period, CancellationToken t)
    {
        var plan = await ForPeriodAsync(context, locationId, period, t);
        if (plan is not null) return BillingAutomationService.Calendar(plan);
        var fallback = context is Compact24DbContext compact
            ? await NativeBillingAutomationPersistence.ScheduleAsync(compact, locationId, t)
            : await context.Set<BillingSchedule>().AsNoTracking().SingleOrDefaultAsync(s => s.LocationId == locationId, t);
        return fallback is null ? null : BillingAutomationService.FallbackCalendar(fallback, await LatestAsync(context, locationId, t));
    }
    public async Task<IReadOnlyList<BillingAutomationPlan>> HistoryAsync(Guid locationId, CancellationToken t) => db is Compact24DbContext compact
        ? (await NativeBillingAutomationPersistence.PlansAsync(compact, locationId, t)).OrderByDescending(p => p.Version).Take(100).ToArray()
        : await db.Set<BillingAutomationPlan>().AsNoTracking().Where(p => p.LocationId == locationId).OrderByDescending(p => p.Version).Take(100).ToArrayAsync(t);
    private async Task AuditAsync(Guid actor, string action, string type, Guid id, DateTimeOffset now, CancellationToken t)
    {
        var audit = new SecurityAuditRecord { UserId = actor, Event = action, TargetType = type, TargetId = id, Succeeded = true, OccurredAt = now };
        if (db is Compact24DbContext compact) await NativeAdjustmentPersistence.WriteAuditAsync(compact, audit, t);
        else db.SecurityAudit.Add(audit);
    }
    public async Task<BillingAutomationPlan> SaveAsync(BillingAutomationWrite x, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({x.LocationId.ToString()},0))", t);
        var native = db as Compact24DbContext;
        if (!(native is not null ? await native.Set<BHome.Domain.Locations.Location>().AnyAsync(l => l.Id == x.LocationId && l.IsActive, t) : await db.Locations.AnyAsync(l => l.Id == x.LocationId && l.IsActive, t))) throw new InvoiceException(404, "billing_location_not_found");
        var latest = await LatestAsync(db, x.LocationId, t);
        var version = latest?.Version ?? 0;
        var schedule = native is not null ? await NativeBillingAutomationPersistence.ScheduleAsync(native, x.LocationId, t) : await db.Set<BillingSchedule>().SingleOrDefaultAsync(s => s.LocationId == x.LocationId, t);
        var originalVersion = schedule?.Version;
        var creatingSchedule = schedule is null;
        if (version != x.ExpectedVersion || (schedule?.Version ?? 0) != x.ExpectedBillingScheduleVersion)
            throw new InvoiceException(409, "billing_automation_changed");
        if (schedule is null)
        {
            if (x.InitialSchedule is not { } initial || x.DraftDay is null || x.DraftMonthOffset is null ||
                x.FinalDay is null || x.FinalMonthOffset is null || x.DueDay is null || x.DueMonthOffset is null)
                throw new InvoiceException(409, "billing_initial_schedule_required");
            schedule = new BillingSchedule
            {
                LocationId = x.LocationId,
                RateDate = initial.RateDate,
                RentSource = BillingRentSource.RepresentativeContract,
                PartialMonth = initial.PartialMonth,
                Rounding = initial.Rounding,
                DraftDay = x.DraftDay.Value,
                DraftMonthOffset = x.DraftMonthOffset.Value,
                FinalDay = x.FinalDay.Value,
                FinalMonthOffset = x.FinalMonthOffset.Value,
                DueDay = x.DueDay.Value,
                DueMonthOffset = x.DueMonthOffset.Value
            };
            if (native is null) db.Add(schedule);
            await AuditAsync(actor, "BillingScheduleConfigured", "BillingSchedule", schedule.Id, now, t);
        }
        // Detach the preserved value: the tracked legacy schedule may be mutated
        // below and must never also rewrite the baseline captured in this plan.
        var preserved = creatingSchedule ? null : BillingAutomationService.FallbackCalendar(schedule, latest);
        var baseline = preserved is null ? null : JsonSerializer.Deserialize<BillingSchedule>(JsonSerializer.Serialize(preserved));
        // Inherit from the requested period rather than the most recently written
        // future plan. Explicit legacy PUT remains the default for a new period.
        var selected = await ForPeriodAsync(x.LocationId, x.EffectiveFrom, t);
        var samePeriod = selected?.EffectiveFrom == x.EffectiveFrom;
        var legacyChanged = latest is not null && latest.BillingScheduleVersion != schedule.Version;
        var defaults = selected is not null && !legacyChanged
            ? BillingAutomationService.Calendar(selected) : baseline;
        if (defaults is null)
        {
            if (x.InitialSchedule is null || x.DraftDay is null || x.DraftMonthOffset is null ||
                x.FinalDay is null || x.FinalMonthOffset is null || x.DueDay is null || x.DueMonthOffset is null)
                throw new InvoiceException(409, "billing_initial_schedule_required");
            defaults = schedule;
        }
        // Freeze period-specific invoice dates in this immutable plan. Do not modify the
        // location-wide fallback schedule: periods before EffectiveFrom retain their calendar.
        var effectiveCalendar = new BillingSchedule
        {
            LocationId = schedule.LocationId,
            Version = schedule.Version,
            RateDate = x.InitialSchedule?.RateDate ?? defaults.RateDate,
            RentSource = defaults.RentSource,
            PartialMonth = x.InitialSchedule?.PartialMonth ?? defaults.PartialMonth,
            Rounding = x.InitialSchedule?.Rounding ?? defaults.Rounding,
            DraftDay = x.DraftDay ?? defaults.DraftDay,
            DraftMonthOffset = x.DraftMonthOffset ?? defaults.DraftMonthOffset,
            FinalDay = x.FinalDay ?? defaults.FinalDay,
            FinalMonthOffset = x.FinalMonthOffset ?? defaults.FinalMonthOffset,
            DueDay = x.DueDay ?? defaults.DueDay,
            DueMonthOffset = x.DueMonthOffset ?? defaults.DueMonthOffset
        };
        try
        {
            foreach (var period in new[] { new DateOnly(2027, 2, 1), new DateOnly(2028, 2, 1), new DateOnly(2026, 12, 1) })
                if (InvoiceMath.CalendarDate(period, effectiveCalendar.DraftDay, effectiveCalendar.DraftMonthOffset) > InvoiceMath.CalendarDate(period, effectiveCalendar.FinalDay, effectiveCalendar.FinalMonthOffset) ||
                    InvoiceMath.CalendarDate(period, effectiveCalendar.FinalDay, effectiveCalendar.FinalMonthOffset) > InvoiceMath.CalendarDate(period, effectiveCalendar.DueDay, effectiveCalendar.DueMonthOffset))
                    throw new InvoiceException(400, "invalid_billing_calendar_order");
        }
        catch (ArgumentOutOfRangeException) { throw new InvoiceException(400, "invalid_billing_automation"); }
        if (samePeriod && selected!.AuthorizedByUserId == actor && selected.Enabled == x.Enabled &&
            selected.AuthorizeAutomaticFinalization == x.AuthorizeAutomaticFinalization &&
            selected.MeterDay == x.MeterDay && selected.MeterDueDay == x.MeterDueDay &&
            selected.MeterDueMonthOffset == x.MeterDueMonthOffset && selected.TimeZone == x.TimeZone &&
            BillingAutomationService.SameCalendarTerms(BillingAutomationService.Calendar(selected), effectiveCalendar))
        {
            await tx.CommitAsync(t);
            return selected;
        }
        // Preserve legacy GET/PUT version and values for existing consumers, but
        // carry the pre-change fallback in every immutable plan snapshot.
        if (x.InitialSchedule is { } desired &&
            (schedule.RateDate != desired.RateDate || schedule.PartialMonth != desired.PartialMonth || schedule.Rounding != desired.Rounding))
        {
            schedule.RateDate = desired.RateDate;
            schedule.PartialMonth = desired.PartialMonth;
            schedule.Rounding = desired.Rounding;
            schedule.Version++;
            await AuditAsync(actor, "BillingScheduleConfigured", "BillingSchedule", schedule.Id, now, t);
        }
        // The legacy version is a write concurrency token. A meter-only change
        // must not rewrite the effective calendar version of an earlier plan.
        effectiveCalendar.Version = BillingAutomationService.SameCalendarTerms(defaults, effectiveCalendar)
            ? defaults.Version : schedule.Version;
        var plan = new BillingAutomationPlan
        {
            LocationId = x.LocationId,
            Version = version + 1,
            EffectiveFrom = x.EffectiveFrom,
            Enabled = x.Enabled,
            AuthorizeAutomaticFinalization = x.AuthorizeAutomaticFinalization,
            MeterDay = x.MeterDay,
            MeterDueDay = x.MeterDueDay,
            MeterDueMonthOffset = x.MeterDueMonthOffset,
            TimeZone = x.TimeZone,
            BillingScheduleVersion = schedule.Version,
            BillingSnapshot = BillingAutomationService.Snapshot(effectiveCalendar, baseline),
            AuthorizedByUserId = actor,
            RecordedAt = now
        };
        if (native is not null)
        {
            if (originalVersion != schedule.Version) await NativeBillingAutomationPersistence.SaveScheduleAsync(native, schedule, originalVersion, t);
            await NativeBillingAutomationPersistence.SavePlanAsync(native, plan, t);
        }
        else db.Add(plan);
        await AuditAsync(actor, "BillingAutomationConfigured", "BillingAutomation", plan.Id, now, t);
        if (native is null) await db.SaveChangesAsync(t);
        await tx.CommitAsync(t); return plan;
    }
}
