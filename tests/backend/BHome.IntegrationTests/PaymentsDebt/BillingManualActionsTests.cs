using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task ManualDraftResolvesOnlyEligibleContractAndRemainsIdempotentWhenOwnerOmitsRepresentative()
    {
        var w = await Setup(sharedContract: true);
        using var owner = await Client(w.Owner);
        using var tenant = await Client(w.Tenants[0]);
        (await owner.PutAsJsonAsync("/test-probe/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var input = new DraftInvoiceInput(w.Room, CurrentPeriod());
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PostAsJsonAsync("/api/v1/invoices/drafts", input)).StatusCode);
        var first = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input); first.EnsureSuccessStatusCode();
        var draft = (await first.Content.ReadFromJsonAsync<InvoiceView>())!;
        Assert.Equal("Draft", draft.Status);
        var repeated = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input); repeated.EnsureSuccessStatusCode();
        Assert.Equal(draft.Id, (await repeated.Content.ReadFromJsonAsync<InvoiceView>())!.Id);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var persisted = await db.Set<Invoice>().SingleAsync(i => i.Id == draft.Id);
        Assert.Equal(w.Contract, persisted.RepresentativeContractId);
        Assert.Equal(1, await db.Set<Invoice>().CountAsync(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod()));
    }

    [Fact]
    public async Task ManualDraftRequiresExplicitSavedSelectionForMultipleEligibleContracts()
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/test-probe/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var input = new DraftInvoiceInput(w.Room, CurrentPeriod());
        var created = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input); created.EnsureSuccessStatusCode();
        var invoice = (await created.Content.ReadFromJsonAsync<InvoiceView>())!;
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var candidates = await db.Set<BHome.Domain.TenantContracts.Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync();
        var expected = candidates.OrderBy(c => c.CreatedAt).ThenBy(c => c.Id).First().Id;
        Assert.Equal(expected, (await db.Set<Invoice>().SingleAsync(i => i.Id == invoice.Id)).RepresentativeContractId);
        var repeated = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, CurrentPeriod(), Guid.NewGuid()));
        repeated.EnsureSuccessStatusCode();
        Assert.Equal(invoice.Id, (await repeated.Content.ReadFromJsonAsync<InvoiceView>())!.Id);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeveloperManualMeterTaskUsesEffectivePlanDayEvenWhenPlanIsDisabled(bool stagingManual = false)
    {
        var (w, _, meters) = await MeterWorkspace(water: false);
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddSingleton(new BillingAutomationRuntime(!stagingManual)
            { ManualActionsEnabled = stagingManual })));
        using var owner = await Client(w.Owner, host);
        using var staff = await Client(w.Staff, host);
        using var tenant = await Client(w.Tenants[0], host);
        var preview = (await owner.GetFromJsonAsync<BillingAutomationPreview>(
            $"/api/v1/billing-automation/preview?locationId={w.Location}&period={CurrentPeriod():yyyy-MM-dd}"))!;
        Assert.True(preview.DeveloperActionsEnabled);
        Assert.False(preview.WorkerEnabled);
        // The same location has a new immutable manual-only effective plan; existing
        // enabled plans are not allowed to run background jobs by the global switch.
        (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with
        {
            ExpectedVersion = 1,
            Enabled = false,
            AuthorizeAutomaticFinalization = false,
            MeterDay = 1,
            MeterDueDay = 10
        })).EnsureSuccessStatusCode();
        var initial = new BillingManualMeterTaskInput(meters[0], ReadingPurpose.Initial, CurrentPeriod());
        Assert.Equal(HttpStatusCode.Forbidden,
            (await staff.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks", initial)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await tenant.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks", initial)).StatusCode);
        var future = await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks",
            initial with { BillingPeriod = CurrentPeriod().AddMonths(1) });
        Assert.Equal(HttpStatusCode.Conflict, future.StatusCode);
        Assert.Contains("meter_assignment_date_not_reached", await future.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks",
                initial with { Purpose = ReadingPurpose.Final })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks",
                initial with { Purpose = ReadingPurpose.Periodic, ReadingDate = CurrentPeriod().AddDays(1) })).StatusCode);
        var first = await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks", initial); first.EnsureSuccessStatusCode();
        var firstId = (await first.Content.ReadFromJsonAsync<IdResult>())!.Id;
        var periodic = await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks",
            initial with { Purpose = ReadingPurpose.Periodic });
        periodic.EnsureSuccessStatusCode();
        var periodicId = (await periodic.Content.ReadFromJsonAsync<IdResult>())!.Id;
        Assert.NotEqual(firstId, periodicId);
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks", initial)).StatusCode);
        var tasks = (await staff.GetFromJsonAsync<MeterTaskSummary[]>($"/api/v1/capture/meter-tasks?roomId={w.Room}"))!;
        Assert.Contains(tasks, t => t.Id == firstId && t.Purpose == ReadingPurpose.Initial && t.ReadingDate == CurrentPeriod() && t.BillingPeriod == null);
        Assert.Contains(tasks, t => t.Id == periodicId && t.Purpose == ReadingPurpose.Periodic && t.ReadingDate == CurrentPeriod() && t.BillingPeriod == CurrentPeriod());
    }

    [Fact]
    public async Task MeterOptionsExposeInstallationDateAndManualScheduleCannotBackdateReading()
    {
        var (w, _, meters) = await MeterWorkspace(water: false);
        var installed = CurrentPeriod().AddDays(1);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            (await db.Set<Meter>().SingleAsync(m => m.Id == meters[0])).InstalledOn = installed;
            await db.SaveChangesAsync();
        }
        using var owner = await Client(w.Owner);
        var options = (await owner.GetFromJsonAsync<NamedResource[]>($"/api/v1/capture/locations/{w.Location}/meters"))!;
        var meter = Assert.Single(options, item => item.Id == meters[0]);
        Assert.Equal(installed, meter.InstalledOn);
        Assert.True(meter.IsActive);
        var response = await owner.PostAsJsonAsync("/api/v1/billing-automation/manual-meter-tasks",
            new BillingManualMeterTaskInput(meters[0], ReadingPurpose.Periodic, CurrentPeriod()));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("reading_before_installation", await response.Content.ReadAsStringAsync());
        var tasks = (await owner.GetFromJsonAsync<MeterTaskSummary[]>($"/api/v1/capture/meter-tasks?roomId={w.Room}"))!;
        Assert.DoesNotContain(tasks, task => task.MeterId == meters[0] && task.Purpose == ReadingPurpose.Periodic);
    }
}
