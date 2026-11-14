using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private async Task<BillingAutomationExecution?> RunPhase(Workspace w, string phase)
    { using var owner = await Client(w.Owner); var r = await owner.PostAsJsonAsync("/api/v1/billing-automation/run-now", new BillingRunInput(w.Location, CurrentPeriod(), phase)); r.EnsureSuccessStatusCode(); return r.StatusCode == HttpStatusCode.NoContent ? null : await r.Content.ReadFromJsonAsync<BillingAutomationExecution>(); }
    private async Task AddAutomationRates(Workspace w)
    {
        await using var s = fixture.Factory.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var policies = new[] { (ChargeCategory.Rent, "RENT", 100000m), (ChargeCategory.Electricity, "ELECTRICITY", 2m), (ChargeCategory.Water, "WATER", 3m) }
            .Select(p => new BillingPolicy { LocationId = w.Location, Category = p.Item1, ChargeCode = p.Item2, Name = "Synthetic automation " + p.Item2, Rate = p.Item3, Method = p.Item1 == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered, EffectiveFrom = CurrentPeriod().AddMonths(-1) }).ToArray();
        db.AddRange(policies);
        foreach (var c in await db.Set<Contract>().Include(c => c.Residents).Where(c => c.RoomId == w.Room).ToArrayAsync())
        {
            var charges = policies.Select(p => new HoldingPriceCharge(p.Id, p.ChargeCode, (int)p.Category, (int)p.Method, p.Category == ChargeCategory.Rent ? c.MonthlyRent : p.Rate, p.EffectiveFrom, p.EffectiveTo, p.Version) { Name = p.Name }).ToArray();
            c.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(c.MonthlyRent, c.RequiredDeposit, c.StartDate, c.EndDate, default, "SyntheticSigned", DateTimeOffset.UtcNow, charges) { SnapshotVersion = 1 });
            c.SnapshotHash = ContractDocumentSnapshot.Hash(new ContractDocument(c.Id, c.RoomId, c.OwnerSignerId, c.TenantUserId!.Value, c.RepresentativeResidentId, c.Residents.Select(r => r.ResidentId).Order().ToArray(), c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit, c.HoldingContractId, c.AppliedHoldingDeposit, c.Terms, c.SnapshotHash) { AgreedCharges = charges });
        }
        await db.SaveChangesAsync();
    }
    [Fact]
    public async Task DraftJobRequiresSharedRepresentativeAndPreservesApprovedCorrectionOnReplay()
    {
        var (w, p, _) = await MeterWorkspace(); await AddAutomationRates(w); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var missing = (await RunPhase(w, "Draft"))!; Assert.Contains("representative_selection_required", missing.ExceptionsJson);
        (await owner.PutAsJsonAsync("/api/v1/billing-automation/representative", new BillingRepresentativeInput(w.Room, CurrentPeriod(), w.Contract, 0))).EnsureSuccessStatusCode();
        await Task.WhenAll(RunPhase(w, "Draft"), RunPhase(w, "Draft"));
        InvoiceView draft; await using (var s = fixture.Factory.Services.CreateAsyncScope()) { var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); Assert.Equal(1, await db.Set<Invoice>().CountAsync(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod())); var invoice = await db.Set<Invoice>().SingleAsync(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod()); draft = (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{invoice.Id}"))!; Assert.Equal(p.Id, invoice.AutomationPlanId); Assert.Equal(3, await db.Set<InvoiceRecipient>().CountAsync(r => r.InvoiceId == invoice.Id)); }
        Assert.Equal("Draft", draft.Status); Assert.Contains("confirmed_reading_Electricity", draft.MissingInputs); Assert.DoesNotContain(draft.Lines, l => l.MeterReadingId != null);
        var request = await Post(tenant, $"/api/v1/invoices/{draft.Id}/adjustment-requests", new AdjustmentSubmit(draft.Lines.Single(l => l.ChargeCode == "RENT").Id, 90000, "Synthetic draft rent correction", [], draft.Version)); request.EnsureSuccessStatusCode(); var adjustment = (await request.Content.ReadFromJsonAsync<AdjustmentView>())!;
        (await Post(owner, $"/api/v1/invoice-adjustments/{adjustment.Id}/approve", new AdjustmentDecisionInput(1, draft.Version, 0, 90000, "RENT", "Owner checked synthetic correction", true))).EnsureSuccessStatusCode();
        var before = (await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!; await RunPhase(w, "Draft"); var after = (await tenant.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!;
        Assert.Equal(before.Version, after.Version); Assert.Equal(before.Total, after.Total); Assert.Equal(90000, after.Lines.Single(l => l.ChargeCode == "RENT").Amount); Assert.Equal(adjustment.Id, after.Lines.Single(l => l.ChargeCode == "RENT").CorrectionRequestId);
    }
    [Fact]
    public async Task ManualAndAutomaticDraftRaceKeepsOneRoomInvoiceAndNoUnconfirmedOcrCharge()
    {
        var (w, _, _) = await MeterWorkspace(); await AddAutomationRates(w); await RunMeter(w); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-automation/representative", new BillingRepresentativeInput(w.Room, CurrentPeriod(), w.Contract, 0))).EnsureSuccessStatusCode();
        await using (var s = fixture.Factory.Services.CreateAsyncScope()) { var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); await db.Set<OperationalTask>().Where(t => t.BillingRoomId == w.Room).ExecuteUpdateAsync(v => v.SetProperty(t => t.OcrProposedValue, 999)); }
        var manual = owner.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, CurrentPeriod(), w.Contract)); var automated = RunPhase(w, "Draft"); await Task.WhenAll(manual, automated); (await manual).EnsureSuccessStatusCode();
        var invoice = (await (await manual).Content.ReadFromJsonAsync<InvoiceView>())!; Assert.Equal(100000, invoice.Total); Assert.DoesNotContain(invoice.Lines, l => l.Category is "Electricity" or "Water");
        foreach (var tenantId in w.Tenants) { using var tenant = await Client(tenantId); Assert.Equal(HttpStatusCode.OK, (await tenant.GetAsync($"/api/v1/invoices/{invoice.Id}")).StatusCode); }
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Set<Invoice>().CountAsync(i => i.RoomId == w.Room && i.BillingPeriod == CurrentPeriod()));
    }
}
