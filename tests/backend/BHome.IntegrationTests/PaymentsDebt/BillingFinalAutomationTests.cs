using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.Ocr;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private sealed class UnavailableInvoicePaymentCode : IPaymentCodeRegistry
    {
        public Task<string?> GetAsync(string kind, Guid id, CancellationToken token) => Task.FromResult<string?>(null);
        public Task<string?> IssueAsync(string kind, Guid id, Guid locationId, CancellationToken token) => Task.FromResult<string?>(null);
        public Task<bool> MatchesAsync(string kind, Guid id, string description, CancellationToken token) => Task.FromResult(false);
    }

    [Fact]
    public async Task SePayEnabledInvoiceCannotBePublishedWithoutARegisteredPaymentMemo()
    {
        var (w, _, draft) = await FinalWorkspace();
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var service = new InvoiceService(
            scope.ServiceProvider.GetRequiredService<IInvoiceRepository>(),
            new User(w.Owner, Roles.Owner), TimeProvider.System,
            scope.ServiceProvider.GetRequiredService<IBillingAutomationSchedules>(),
            scope.ServiceProvider.GetRequiredService<IFixedChargeCoverage>(),
            new UnavailableInvoicePaymentCode(), new SePayOptions { Enabled = true });
        var error = await Assert.ThrowsAsync<InvoiceException>(() => service.FinalizeAsync(draft.Id, draft.Version, default));
        Assert.Equal("invoice_payment_code_unavailable", error.Code);
        var db = scope.ServiceProvider.GetFixturePersistence();
        db.ChangeTracker.Clear();
        Assert.Equal(InvoiceStatus.Draft, (await db.Set<Invoice>().SingleAsync(i => i.Id == draft.Id)).Status);
        Assert.False(await db.Set<InvoiceIssuedEvent>().AnyAsync(e => e.InvoiceId == draft.Id));
    }

    private async Task<(Workspace W, BillingAutomationPlan Plan, InvoiceView Draft)> FinalWorkspace(bool readings = true, bool authorize = true)
    {
        var (w, _, _) = await MeterWorkspace(); await AddAutomationRates(w); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w) with { ExpectedVersion = 1, FinalDay = 1 })).EnsureSuccessStatusCode();
        var planResponse = await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with { MeterDay = 1, ExpectedVersion = 1, ExpectedBillingScheduleVersion = 2, AuthorizeAutomaticFinalization = authorize }); planResponse.EnsureSuccessStatusCode(); var p = (await planResponse.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        (await owner.PutAsJsonAsync("/api/v1/billing-automation/representative", new BillingRepresentativeInput(w.Room, CurrentPeriod(), w.Contract, 0))).EnsureSuccessStatusCode();
        if (readings)
        {
            await RunMeter(w); using var staff = await Client(w.Staff); var tasks = (await staff.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!.Where(t => t.AutomationPlanId == p.Id).ToArray();
            foreach (var task in tasks) { var initial = await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(task.MeterId, ReadingPurpose.Initial, CurrentPeriod().AddDays(-1), null)); initial.EnsureSuccessStatusCode(); await ConfirmSyntheticTask(w, (await initial.Content.ReadFromJsonAsync<IdResult>())!.Id, 100); await ConfirmSyntheticTask(w, task.Id, 110); }
        }
        await RunPhase(w, "Draft"); await using var s = fixture.Factory.Services.CreateAsyncScope(); var id = await s.ServiceProvider.GetFixturePersistence().Set<Invoice>().Where(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod()).Select(i => i.Id).SingleAsync();
        return (w, p, (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{id}"))!);
    }
    [Fact]
    public async Task AutomaticFinalizationRequiresAuthorizationAndMissingDataRemainsDraftWithoutRepeatedChanges()
    {
        var (w, _, draft) = await FinalWorkspace(false, false); Assert.Null(await RunPhase(w, "Final")); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with { MeterDay = 1, ExpectedVersion = 2, ExpectedBillingScheduleVersion = 2, AuthorizeAutomaticFinalization = true })).EnsureSuccessStatusCode();
        var result = (await RunPhase(w, "Final"))!; Assert.Equal("PendingInputs", result.Status); Assert.Contains("confirmed_billing_inputs_required", result.ExceptionsJson); await RunPhase(w, "Final");
        var unchanged = (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!; Assert.Equal("Draft", unchanged.Status); Assert.Equal(draft.Version, unchanged.Version); Assert.Equal(draft.Lines.Select(l => l.Id), unchanged.Lines.Select(l => l.Id));
        await using var s = fixture.Factory.Services.CreateAsyncScope(); Assert.False(await s.ServiceProvider.GetFixturePersistence().Set<InvoiceIssuedEvent>().AnyAsync(e => e.InvoiceId == draft.Id));
    }
    [Fact]
    public async Task ManualAndScheduledFinalizationCommitOneImmutableInvoiceAndIssuanceEvent()
    {
        var (w, _, draft) = await FinalWorkspace(); using var owner = await Client(w.Owner); Assert.Empty(draft.MissingInputs);
        var manual = owner.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version)); await Task.WhenAll(manual, RunPhase(w, "Final")); (await manual).EnsureSuccessStatusCode(); await RunPhase(w, "Final");
        var final = (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!; Assert.Equal("Final", final.Status); Assert.Equal(100050, final.Total); Assert.Equal(draft.DueDate, final.DueDate);
        await using var s = fixture.Factory.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetFixturePersistence(); Assert.Equal(1, await db.Set<InvoiceIssuedEvent>().CountAsync(e => e.InvoiceId == draft.Id)); Assert.Equal(1, await db.Set<Invoice>().CountAsync(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod()));
    }
    [Fact]
    public async Task PendingAdjustmentBlocksAutomationAndApprovedCorrectionIsRevalidatedBeforeFinal()
    {
        var (w, _, draft) = await FinalWorkspace(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var response = await Post(tenant, $"/api/v1/invoices/{draft.Id}/adjustment-requests", new AdjustmentSubmit(draft.Lines.Single(l => l.ChargeCode == "RENT").Id, 90000, "Synthetic draft dispute", [], draft.Version)); response.EnsureSuccessStatusCode(); var request = (await response.Content.ReadFromJsonAsync<AdjustmentView>())!;
        var blocked = (await RunPhase(w, "Final"))!; Assert.Contains("invoice_adjustment_pending", blocked.ExceptionsJson);
        (await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve", new AdjustmentDecisionInput(1, draft.Version, 0, 90000, "RENT", "Owner approved synthetic correction", true))).EnsureSuccessStatusCode();
        Assert.Equal("Completed", (await RunPhase(w, "Final"))!.Status); var final = (await tenant.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!; Assert.Equal("Final", final.Status); Assert.Equal(90050, final.Total); Assert.Equal(request.Id, final.Lines.Single(l => l.ChargeCode == "RENT").CorrectionRequestId);
    }
    [Fact]
    public async Task PendingAdjustmentBlocksManualAndScheduledFinalAndNotifiesOwnerAndTenantsOnce()
    {
        var (w, _, draft) = await FinalWorkspace();
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var submitted = await Post(tenant, $"/api/v1/invoices/{draft.Id}/adjustment-requests",
            new AdjustmentSubmit(draft.Lines.Single(l => l.ChargeCode == "RENT").Id, 90000,
                "PRIVATE_REVIEW_REASON", [], draft.Version));
        submitted.EnsureSuccessStatusCode();
        var request = (await submitted.Content.ReadFromJsonAsync<AdjustmentView>())!;
        var manual = await owner.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version));
        Assert.Equal(HttpStatusCode.Conflict, manual.StatusCode);
        Assert.Contains("invoice_adjustment_pending", await manual.Content.ReadAsStringAsync());
        var scheduled = (await RunPhase(w, "Final"))!;
        Assert.Equal("PendingInputs", scheduled.Status);
        Assert.Contains("invoice_adjustment_pending", scheduled.ExceptionsJson);
        await PumpNotifications(); await PumpNotifications();
        var ownerNotices = (await owner.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Adjustment"))!.Items;
        var blockedForOwner = Assert.Single(ownerNotices, n => n.EventType == "INVOICE_FINALIZATION_BLOCKED");
        Assert.Equal("Adjustment", blockedForOwner.RelatedObjectType);
        Assert.Equal(request.Id, blockedForOwner.RelatedObjectId);
        Assert.DoesNotContain("PRIVATE_", blockedForOwner.Summary);
        foreach (var id in w.Tenants)
        {
            using var recipient = await Client(id);
            var notices = (await recipient.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Invoice"))!.Items;
            var blocked = Assert.Single(notices, n => n.EventType == "INVOICE_FINALIZATION_BLOCKED");
            Assert.Equal(draft.Id, blocked.RelatedObjectId);
            Assert.DoesNotContain("PRIVATE_", blocked.Summary);
        }
        using var staff = await Client(w.Staff);
        Assert.DoesNotContain((await staff.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications"))!.Items,
            n => n.RelatedObjectId == draft.Id || n.RelatedObjectId == request.Id);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            Assert.Equal(InvoiceStatus.Draft, (await db.Set<Invoice>().SingleAsync(i => i.Id == draft.Id)).Status);
            Assert.False(await db.Set<InvoiceIssuedEvent>().AnyAsync(i => i.InvoiceId == draft.Id));
        }
        (await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/reject",
            new AdjustmentDecisionInput(1, draft.Version, 0, null, null, "Reviewed and rejected", true))).EnsureSuccessStatusCode();
        (await owner.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize",
            new InvoiceFinalizeInput(draft.Version))).EnsureSuccessStatusCode();
        Assert.Equal("Final", (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!.Status);
    }
    [Fact]
    public async Task LateConfirmedReadingsMakePendingDraftEligibleWithoutEstimatedUsage()
    {
        var (w, p, draft) = await FinalWorkspace(false, true); Assert.Equal("PendingInputs", (await RunPhase(w, "Final"))!.Status); await RunMeter(w);
        await PumpNotifications(); await PumpNotifications();
        foreach (var id in w.Tenants)
        {
            using var recipient = await Client(id);
            var notices = (await recipient.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Invoice"))!.Items;
            Assert.Single(notices, n => n.RelatedObjectId == draft.Id && n.EventType == "INVOICE_FINALIZATION_BLOCKED");
        }
        using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        foreach (var task in (await staff.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!.Where(t => t.AutomationPlanId == p.Id))
        { var initial = await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(task.MeterId, ReadingPurpose.Initial, CurrentPeriod().AddDays(-1), null)); initial.EnsureSuccessStatusCode(); await ConfirmSyntheticTask(w, (await initial.Content.ReadFromJsonAsync<IdResult>())!.Id, 100); await ConfirmSyntheticTask(w, task.Id, 110); }
        Assert.Equal("Completed", (await RunPhase(w, "Final"))!.Status); var final = (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!; Assert.Equal("Final", final.Status); Assert.Empty(final.MissingInputs); Assert.Equal(100050, final.Total);
    }
    [Fact]
    public async Task LateReadingsRefreshDraftWithoutDiscardingApprovedCorrection()
    {
        var (w, p, draft) = await FinalWorkspace(false, true);
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var submitted = await Post(tenant, $"/api/v1/invoices/{draft.Id}/adjustment-requests",
            new AdjustmentSubmit(draft.Lines.Single(l => l.ChargeCode == "RENT").Id, 90000, "Synthetic rent correction", [], draft.Version));
        submitted.EnsureSuccessStatusCode();
        var request = (await submitted.Content.ReadFromJsonAsync<AdjustmentView>())!;
        (await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve",
            new AdjustmentDecisionInput(1, draft.Version, 0, 90000, "RENT", "Approved rent correction", true))).EnsureSuccessStatusCode();
        Assert.Equal("PendingInputs", (await RunPhase(w, "Final"))!.Status);
        await RunMeter(w); using var staff = await Client(w.Staff);
        foreach (var task in (await staff.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!.Where(t => t.AutomationPlanId == p.Id))
        {
            var initial = await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(task.MeterId, ReadingPurpose.Initial, CurrentPeriod().AddDays(-1), null));
            initial.EnsureSuccessStatusCode();
            await ConfirmSyntheticTask(w, (await initial.Content.ReadFromJsonAsync<IdResult>())!.Id, 100);
            await ConfirmSyntheticTask(w, task.Id, 110);
        }
        Assert.Equal("Completed", (await RunPhase(w, "Final"))!.Status);
        var final = (await tenant.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!;
        Assert.Equal("Final", final.Status); Assert.Empty(final.MissingInputs); Assert.Equal(90050, final.Total);
        Assert.Equal(request.Id, final.Lines.Single(l => l.ChargeCode == "RENT").CorrectionRequestId);
    }
    [Fact]
    public async Task RevokedOwnerAuthorizationPreventsQueuedFinalization()
    {
        var (w, p, draft) = await FinalWorkspace();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { var db = scope.ServiceProvider.GetFixturePersistence(); await db.Users.Where(u => u.Id == w.Owner).ExecuteUpdateAsync(v => v.SetProperty(u => u.IsActive, false)); }
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { await scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "billing-final").ExecuteAsync(new(Guid.NewGuid(), "synthetic-revoked", System.Text.Json.JsonSerializer.Serialize(new BillingJobInput(p.Id, CurrentPeriod()))), default); var db = scope.ServiceProvider.GetFixturePersistence(); Assert.Equal(InvoiceStatus.Draft, (await db.Set<Invoice>().SingleAsync(i => i.Id == draft.Id)).Status); Assert.False(await db.Set<InvoiceIssuedEvent>().AnyAsync(e => e.InvoiceId == draft.Id)); }
    }
}
