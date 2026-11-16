using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private static BillingScheduleWrite Calendar(Workspace w) => new(w.Location, BillingRateDate.PeriodStart, BillingRentSource.RoomPolicy, PartialMonthRule.FullMonth, VndRounding.AwayFromZero, 1, 0, 20, 0, 31, 0, 0);
    private static DateOnly CurrentPeriod() { var local = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh"); return new(local.Year, local.Month, 1); }
    private static BillingAutomationWrite Plan(Workspace w) => new(w.Location, CurrentPeriod(), true, false, 5, 10, 0, "Asia/Ho_Chi_Minh", 0, 1);
    [Fact]
    public async Task FirstAutomationSaveCreatesBillingScheduleAtomicallyWithoutPricingPage()
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        var initial = Plan(w) with
        {
            Enabled = false,
            ExpectedBillingScheduleVersion = 0,
            MeterDay = 12,
            MeterDueDay = 13,
            DraftDay = 13,
            DraftMonthOffset = 0,
            FinalDay = 13,
            FinalMonthOffset = 0,
            DueDay = 20,
            DueMonthOffset = 0,
            InitialSchedule = new(BillingRateDate.PeriodEnd, PartialMonthRule.OccupiedCalendarDays, VndRounding.AwayFromZero)
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/v1/billing-automation", initial with { DueDay = 12 })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.GetAsync($"/api/v1/billing-schedules/{w.Location}")).StatusCode);
        var response = await owner.PutAsJsonAsync("/api/v1/billing-automation", initial);
        response.EnsureSuccessStatusCode();
        var plan = (await response.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.False(plan.Enabled); Assert.False(plan.AuthorizeAutomaticFinalization);
        Assert.Equal(1, plan.BillingScheduleVersion);
        var schedule = (await owner.GetFromJsonAsync<BillingSchedule>($"/api/v1/billing-schedules/{w.Location}"))!;
        Assert.Equal(1, schedule.Version); Assert.Equal(20, schedule.DueDay);
        Assert.Equal(BillingRateDate.PeriodEnd, schedule.RateDate);
        Assert.Equal(PartialMonthRule.OccupiedCalendarDays, schedule.PartialMonth);
        Assert.Equal(BillingRentSource.RepresentativeContract, schedule.RentSource);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync("/api/v1/billing-automation", initial)).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var repository = scope.ServiceProvider.GetRequiredService<IInvoiceRepository>();
        Assert.Null(await repository.ScheduleForPeriodAsync(w.Location, initial.EffectiveFrom.AddMonths(-1), default));
        Assert.Equal(PartialMonthRule.OccupiedCalendarDays,
            (await repository.ScheduleForPeriodAsync(w.Location, initial.EffectiveFrom, default))!.PartialMonth);
    }
    [Fact]
    public async Task EditingExistingAutomationUpdatesFinancialRulesAtomicallyWithoutChangingOldSnapshots()
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        var initial = Plan(w) with
        {
            Enabled = false,
            ExpectedBillingScheduleVersion = 0,
            DraftDay = 10,
            DraftMonthOffset = 0,
            FinalDay = 12,
            FinalMonthOffset = 0,
            DueDay = 20,
            DueMonthOffset = 0,
            InitialSchedule = new(BillingRateDate.PeriodStart, PartialMonthRule.FullMonth, VndRounding.AwayFromZero)
        };
        var created = await owner.PutAsJsonAsync("/api/v1/billing-automation", initial);
        created.EnsureSuccessStatusCode();
        var first = (await created.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        var edited = initial with
        {
            EffectiveFrom = CurrentPeriod().AddMonths(1),
            ExpectedVersion = 1,
            ExpectedBillingScheduleVersion = 1,
            MeterDueDay = 13,
            DraftDay = 14,
            FinalDay = 15,
            DueDay = 25,
            InitialSchedule = new(BillingRateDate.PeriodEnd, PartialMonthRule.OccupiedCalendarDays, VndRounding.ToEven)
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/v1/billing-automation", edited with { DueDay = 13 })).StatusCode);
        Assert.Equal(1, (await owner.GetFromJsonAsync<BillingSchedule>($"/api/v1/billing-schedules/{w.Location}"))!.Version);
        var updated = await owner.PutAsJsonAsync("/api/v1/billing-automation", edited);
        updated.EnsureSuccessStatusCode();
        var second = (await updated.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.Equal(2, second.BillingScheduleVersion);
        var schedule = (await owner.GetFromJsonAsync<BillingSchedule>($"/api/v1/billing-schedules/{w.Location}"))!;
        Assert.Equal(2, schedule.Version);
        Assert.Equal(BillingRateDate.PeriodEnd, schedule.RateDate);
        Assert.Equal(PartialMonthRule.OccupiedCalendarDays, schedule.PartialMonth);
        Assert.Equal(VndRounding.ToEven, schedule.Rounding);
        Assert.Equal(BillingRentSource.RepresentativeContract, schedule.RentSource);
        Assert.Equal(20, schedule.DueDay); // Plan overrides do not rewrite the fallback calendar.
        Assert.Equal(BillingRateDate.PeriodStart, BillingAutomationService.Calendar(first).RateDate);
        Assert.Equal(20, BillingAutomationService.Calendar(first).DueDay);
        Assert.Equal(BillingRateDate.PeriodEnd, BillingAutomationService.Calendar(second).RateDate);
        Assert.Equal(25, BillingAutomationService.Calendar(second).DueDay);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync("/api/v1/billing-automation", edited)).StatusCode);
        var unchanged = await owner.PutAsJsonAsync("/api/v1/billing-automation", edited with
        {
            ExpectedVersion = 2,
            ExpectedBillingScheduleVersion = 2,
            EffectiveFrom = CurrentPeriod().AddMonths(2)
        });
        unchanged.EnsureSuccessStatusCode();
        Assert.Equal(2, (await unchanged.Content.ReadFromJsonAsync<BillingAutomationPlan>())!.BillingScheduleVersion);
    }
    [Fact]
    public async Task AutomationPreviewAndHistoryRemainOwnerOnlyAndReflectSelectedPeriod()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var path = $"/api/v1/billing-automation/preview?locationId={w.Location}&period={CurrentPeriod():yyyy-MM-dd}";
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
        var missing = (await owner.GetFromJsonAsync<BillingAutomationPreview>(path))!; Assert.Empty(missing.Phases);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w))).EnsureSuccessStatusCode();
        var preview = (await owner.GetFromJsonAsync<BillingAutomationPreview>(path))!;
        Assert.True(preview.DeveloperActionsEnabled); Assert.Equal("Asia/Ho_Chi_Minh", preview.TimeZone);
        Assert.False(preview.WorkerEnabled);
        Assert.Equal(3, preview.Phases.Count);
        Assert.All(preview.Phases, phase => Assert.False(phase.Eligible));
        Assert.Empty((await owner.GetFromJsonAsync<BillingAutomationAttempt[]>($"/api/v1/billing-automation/attempts?locationId={w.Location}&period={CurrentPeriod():yyyy-MM-dd}"))!);
    }
    [Fact]
    public async Task AutomationCalendarIsOwnerAuthorizedEffectiveDatedAndImmutable()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PutAsJsonAsync("/api/v1/billing-automation", Plan(w))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod():yyyy-MM-dd}")).StatusCode);
        var first = await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w)); first.EnsureSuccessStatusCode(); var p = (await first.Content.ReadFromJsonAsync<BillingAutomationPlan>())!; Assert.False(p.AuthorizeAutomaticFinalization);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w))).StatusCode);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w) with { ExpectedVersion = 1, DueDay = 25 })).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with { EffectiveFrom = CurrentPeriod().AddMonths(1), ExpectedVersion = 1, ExpectedBillingScheduleVersion = 2, AuthorizeAutomaticFinalization = true })).EnsureSuccessStatusCode();
        var current = (await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod():yyyy-MM-dd}"))!;
        var future = (await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod().AddMonths(1):yyyy-MM-dd}"))!;
        Assert.Equal(1, current.Version); Assert.Equal(2, future.Version); Assert.Equal(31, BillingAutomationService.Calendar(current).DueDay); Assert.Equal(25, BillingAutomationService.Calendar(future).DueDay);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BillingAutomationPlans\" SET \"Enabled\"=false WHERE \"Id\"={p.Id}"));
        var invoice = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, CurrentPeriod(), w.Contract)); invoice.EnsureSuccessStatusCode();
        Assert.Equal(InvoiceMath.CalendarDate(CurrentPeriod(), 31, 0), (await invoice.Content.ReadFromJsonAsync<InvoiceView>())!.DueDate);
    }
    [Fact]
    public async Task ManualOnlyEffectiveCalendarOverridesPreserveFallbackAndEarlierPeriods()
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var from = CurrentPeriod().AddMonths(1);
        var configured = Plan(w) with
        {
            EffectiveFrom = from,
            Enabled = false,
            AuthorizeAutomaticFinalization = false,
            DraftDay = 6,
            DraftMonthOffset = 0,
            FinalDay = 8,
            FinalMonthOffset = 1,
            DueDay = 12,
            DueMonthOffset = 1
        };
        var created = await owner.PutAsJsonAsync("/api/v1/billing-automation", configured);
        created.EnsureSuccessStatusCode();
        var plan = (await created.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.False(plan.Enabled); Assert.Equal(from, plan.EffectiveFrom);
        Assert.Equal(HttpStatusCode.NoContent,
            (await owner.GetAsync($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod():yyyy-MM-dd}")).StatusCode);
        var selected = (await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={from:yyyy-MM-dd}"))!;
        var snapshot = BillingAutomationService.Calendar(selected);
        Assert.Equal(6, snapshot.DraftDay); Assert.Equal(0, snapshot.DraftMonthOffset);
        Assert.Equal(8, snapshot.FinalDay); Assert.Equal(1, snapshot.FinalMonthOffset);
        Assert.Equal(12, snapshot.DueDay); Assert.Equal(1, snapshot.DueMonthOffset);
        var preview = (await owner.GetFromJsonAsync<BillingAutomationPreview>($"/api/v1/billing-automation/preview?locationId={w.Location}&period={from:yyyy-MM-dd}"))!;
        Assert.All(preview.Phases, phase => Assert.False(phase.Eligible));
        var fallback = (await owner.GetFromJsonAsync<BillingSchedule>($"/api/v1/billing-schedules/{w.Location}"))!;
        Assert.Equal(1, fallback.DraftDay); Assert.Equal(20, fallback.FinalDay); Assert.Equal(31, fallback.DueDay);
        Assert.Equal(1, fallback.Version);
        var subsequent = await owner.PutAsJsonAsync("/api/v1/billing-automation", configured with
        {
            EffectiveFrom = from.AddMonths(1),
            ExpectedVersion = 1,
            DraftDay = 9,
            FinalDay = 10,
            DueDay = 15
        });
        subsequent.EnsureSuccessStatusCode();
        var historical = (await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={from:yyyy-MM-dd}"))!;
        Assert.Equal(6, BillingAutomationService.Calendar(historical).DraftDay);
        Assert.Equal(9, BillingAutomationService.Calendar((await subsequent.Content.ReadFromJsonAsync<BillingAutomationPlan>())!).DraftDay);
    }

    [Fact]
    public async Task FutureFinancialPlansPreserveUngeneratedPeriodsAndSamePeriodSavesAreNoOps()
    {
        var w = await Setup(); await AddAutomationRates(w);
        using var owner = await Client(w.Owner);
        var period = CurrentPeriod();
        var from = period.AddMonths(2);
        var original = Calendar(w);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", original)).EnsureSuccessStatusCode();
        var input = Plan(w) with
        {
            EffectiveFrom = from, Enabled = false, DraftDay = 3, FinalDay = 15, DueDay = 25,
            InitialSchedule = new(BillingRateDate.PeriodEnd, PartialMonthRule.OccupiedCalendarDays, VndRounding.ToEven)
        };
        var response = await owner.PutAsJsonAsync("/api/v1/billing-automation", input);
        response.EnsureSuccessStatusCode();
        var first = (await response.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.Equal(2, first.BillingScheduleVersion);
        var legacy = (await owner.GetFromJsonAsync<BillingSchedule>($"/api/v1/billing-schedules/{w.Location}"))!;
        Assert.Equal(2, legacy.Version);
        Assert.Equal(PartialMonthRule.OccupiedCalendarDays, legacy.PartialMonth);
        Assert.Equal(original.DueDay, legacy.DueDay);
        // PostgreSQL timestamps have microsecond precision; compare the stored
        // plan with the no-op response rather than the pre-persistence clock.
        var storedFirst = (await owner.GetFromJsonAsync<BillingAutomationPlan>(
            $"/api/v1/billing-automation/{w.Location}?period={from:yyyy-MM-dd}"))!;
        var retry = input with { ExpectedVersion = first.Version, ExpectedBillingScheduleVersion = legacy.Version };
        var noOpResponse = await owner.PutAsJsonAsync("/api/v1/billing-automation", retry);
        noOpResponse.EnsureSuccessStatusCode();
        var noOp = (await noOpResponse.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.Equal(first.Id, noOp.Id);
        Assert.Equal(first.Version, noOp.Version);
        Assert.Equal(storedFirst.RecordedAt, noOp.RecordedAt);
        Assert.Equal(storedFirst.BillingSnapshot, noOp.BillingSnapshot);
        Assert.Single((await owner.GetFromJsonAsync<BillingAutomationPlan[]>($"/api/v1/billing-automation/{w.Location}/history"))!);
        // An unchanged stale request must still fail optimistic concurrency.
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync("/api/v1/billing-automation", input)).StatusCode);
        // Two competing changed requests keep exactly one winner.
        var races = await Task.WhenAll(new[] { 26, 27 }.Select(day => owner.PutAsJsonAsync("/api/v1/billing-automation", retry with { DueDay = day })));
        var winnerResponse = Assert.Single(races, r => r.IsSuccessStatusCode);
        Assert.Single(races, r => r.StatusCode == HttpStatusCode.Conflict);
        var winner = (await winnerResponse.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.Equal(2, winner.Version);
        Assert.Equal(2, winner.BillingScheduleVersion);
        Assert.Equal(2, (await owner.GetFromJsonAsync<BillingAutomationPlan[]>($"/api/v1/billing-automation/{w.Location}/history"))!.Length);

        // No earlier effective plan exists. Generate the old period only AFTER
        // the future configuration was changed, and inspect its persisted snapshot.
        var invoiceResponse = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, period, w.Contract));
        invoiceResponse.EnsureSuccessStatusCode();
        var draft = (await invoiceResponse.Content.ReadFromJsonAsync<InvoiceView>())!;
        Assert.Equal(InvoiceMath.CalendarDate(period, original.DueDay, original.DueMonthOffset), draft.DueDate);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == draft.Id);
            var snapshot = JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!;
            Assert.Equal(BillingRateDate.PeriodStart, snapshot.RateDate);
            Assert.Equal(PartialMonthRule.FullMonth, snapshot.PartialMonth);
            Assert.Equal(VndRounding.AwayFromZero, snapshot.Rounding);
            Assert.Equal(1, snapshot.Version);
            var repository = scope.ServiceProvider.GetRequiredService<IInvoiceRepository>();
            var intermediate = await repository.ScheduleForPeriodAsync(w.Location, period.AddMonths(1), default);
            Assert.Equal(PartialMonthRule.FullMonth, intermediate!.PartialMonth);
            var effective = await repository.ScheduleForPeriodAsync(w.Location, from, default);
            Assert.Equal(PartialMonthRule.OccupiedCalendarDays, effective!.PartialMonth);
            Assert.Equal(VndRounding.ToEven, effective.Rounding);
            Assert.Equal(BillingAutomationService.Calendar(winner).DueDay, effective.DueDay);
        }
        // An out-of-order plan, before the future plan, must inherit the old
        // fallback, not the financial rules of the already-written future plan.
        var earlier = Plan(w) with { EffectiveFrom = period.AddMonths(1), Enabled = false, ExpectedVersion = 2, ExpectedBillingScheduleVersion = 2 };
        var earlierResponse = await owner.PutAsJsonAsync("/api/v1/billing-automation", earlier);
        earlierResponse.EnsureSuccessStatusCode();
        var earlierPlan = (await earlierResponse.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        Assert.Equal(PartialMonthRule.FullMonth, BillingAutomationService.Calendar(earlierPlan).PartialMonth);
        Assert.Equal(VndRounding.AwayFromZero, BillingAutomationService.Calendar(earlierPlan).Rounding);
        Assert.Equal(1, BillingAutomationService.Calendar(earlierPlan).Version);
        var future = (await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={from:yyyy-MM-dd}"))!;
        Assert.Equal(winner.Id, future.Id);
        // Legacy PUT continues to be an explicit fallback update; effective
        // automation plans and existing invoice snapshots are still immutable.
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", original with { ExpectedVersion = 2, DueDay = 30 })).EnsureSuccessStatusCode();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var repository = scope.ServiceProvider.GetRequiredService<IInvoiceRepository>();
            Assert.Equal(30, (await repository.ScheduleForPeriodAsync(w.Location, period, default))!.DueDay);
            Assert.Equal(BillingAutomationService.Calendar(winner).DueDay,
                (await repository.ScheduleForPeriodAsync(w.Location, from, default))!.DueDay);
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var persisted = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == draft.Id);
            Assert.Equal(original.DueDay, JsonSerializer.Deserialize<BillingSchedule>(persisted.ScheduleSnapshot)!.DueDay);
        }
    }
    [Theory]
    [InlineData(0, 20, 31)]
    [InlineData(31, 30, 31)]
    [InlineData(3, 2, 31)]
    [InlineData(1, 20, 19)]
    public async Task EffectiveCalendarRejectsInvalidOrMisorderedDayOverrides(int draft, int final, int due)
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var response = await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with
        {
            Enabled = false,
            DraftDay = draft,
            FinalDay = final,
            DueDay = due
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<BillingAutomationPlan[]>($"/api/v1/billing-automation/{w.Location}/history"))!);
    }
    [Fact]
    public async Task BillingSchedulerAndPreexistingQueuedHandlersAreDisabledWithoutExplicitOptIn()
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w))).EnsureSuccessStatusCode();
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var handlers = scope.ServiceProvider.GetServices<BHome.Application.Jobs.IBackgroundJobHandler>()
            .Where(h => h.Name is "billing-meter" or "billing-draft" or "billing-final").ToArray();
        Assert.Equal(3, handlers.Length); Assert.All(handlers, handler => Assert.False(handler.Enabled));
        var scheduler = scope.ServiceProvider.GetServices<BHome.Application.Jobs.IJobScheduleContributor>()
            .Single(x => x.GetType().Name == "BillingAutomationScheduling");
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        static Task<int> BillingJobCount(BHomePersistenceContext context) => context.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*)::int AS \"Value\" FROM \"BackgroundJobs\" WHERE \"Name\" IN ('billing-meter','billing-draft','billing-final')").SingleAsync();
        var before = await BillingJobCount(db);
        await scheduler.EnqueueDueAsync(default);
        Assert.Equal(before, await BillingJobCount(db));
    }
    [Theory]
    [InlineData("UTC", 5, 10, 0, true, false)]
    [InlineData("Asia/Ho_Chi_Minh", 32, 10, 0, true, false)]
    [InlineData("Asia/Ho_Chi_Minh", 20, 10, 0, true, false)]
    [InlineData("Asia/Ho_Chi_Minh", 5, 10, 0, false, true)]
    public async Task AutomationCalendarRejectsInvalidTimezoneDatesAndUnapprovedFinalization(string zone, int meter, int due, int offset, bool enabled, bool final)
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with { TimeZone = zone, MeterDay = meter, MeterDueDay = due, MeterDueMonthOffset = offset, Enabled = enabled, AuthorizeAutomaticFinalization = final })).StatusCode);
    }
}
