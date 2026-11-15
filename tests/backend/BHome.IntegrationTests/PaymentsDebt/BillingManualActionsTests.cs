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
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var input = new DraftInvoiceInput(w.Room, CurrentPeriod());
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PostAsJsonAsync("/api/v1/invoices/drafts", input)).StatusCode);
        var first = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input); first.EnsureSuccessStatusCode();
        var draft = (await first.Content.ReadFromJsonAsync<InvoiceView>())!;
        Assert.Equal("Draft", draft.Status);
        var repeated = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input); repeated.EnsureSuccessStatusCode();
        Assert.Equal(draft.Id, (await repeated.Content.ReadFromJsonAsync<InvoiceView>())!.Id);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var persisted = await db.Set<Invoice>().SingleAsync(i => i.Id == draft.Id);
        Assert.Equal(w.Contract, persisted.RepresentativeContractId);
        Assert.Equal(1, await db.Set<Invoice>().CountAsync(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod()));
    }

    [Fact]
    public async Task ManualDraftRequiresExplicitSavedSelectionForMultipleEligibleContracts()
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var input = new DraftInvoiceInput(w.Room, CurrentPeriod());
        var ambiguous = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input);
        Assert.Equal(HttpStatusCode.Conflict, ambiguous.StatusCode);
        Assert.Contains("representative_selection_required", await ambiguous.Content.ReadAsStringAsync());
        (await owner.PutAsJsonAsync("/api/v1/billing-automation/representative",
            new BillingRepresentativeInput(w.Room, CurrentPeriod(), w.Contract, 0))).EnsureSuccessStatusCode();
        var created = await owner.PostAsJsonAsync("/api/v1/invoices/drafts", input); created.EnsureSuccessStatusCode();
        var invoice = (await created.Content.ReadFromJsonAsync<InvoiceView>())!;
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        Assert.Equal(w.Contract, (await scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>()
            .Set<Invoice>().SingleAsync(i => i.Id == invoice.Id)).RepresentativeContractId);
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, CurrentPeriod(), Guid.NewGuid()))).StatusCode);
    }

    [Fact]
    public async Task DeveloperManualMeterTaskUsesEffectivePlanDayEvenWhenPlanIsDisabled()
    {
        var (w, _, meters) = await MeterWorkspace(water: false);
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        using var tenant = await Client(w.Tenants[0]);
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
}
