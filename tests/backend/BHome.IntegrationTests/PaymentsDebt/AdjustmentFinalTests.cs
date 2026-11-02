using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    private static async Task<AdjustmentView> AdjustRequest(HttpClient tenant, Guid invoice, int version, decimal target)
    {
        var response = await Post(tenant, $"/api/v1/invoices/{invoice}/adjustment-requests", new AdjustmentSubmit(null, target, "Synthetic correction only", [], version));
        response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<AdjustmentView>())!;
    }
    [Theory]
    [InlineData(false, 90000)]
    [InlineData(false, 110000)]
    [InlineData(true, 90000)]
    [InlineData(true, 110000)]
    public async Task FinalAdjustmentPreservesIssuedInvoiceAndVerifiedPaymentsAcrossAllMoneyBranches(bool paid, decimal target)
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        if (paid)
        {
            var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w), Guid.NewGuid(), default));
            await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        }
        var request = await AdjustRequest(tenant, w.Invoice, 1, target); var input = new AdjustmentDecisionInput(1, 1, 0, target, null, "Owner checked synthetic error", true); var key = Guid.NewGuid();
        var response = await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve", input, key); response.EnsureSuccessStatusCode();
        var result = (await response.Content.ReadFromJsonAsync<AdjustmentView>())!;
        Assert.Equal(target, result.Financials!.EffectivePayableAmount); Assert.Equal(paid ? 100000 : 0, result.Financials.AllocatedPayments);
        Assert.Equal(target - 100000, result.Decision!.Delta);
        Assert.Equal(HttpStatusCode.OK, (await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve", input, key)).StatusCode);
        foreach (var actor in w.Tenants)
        {
            var view = await As(actor, Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default));
            Assert.Equal(100000, view.OriginalIssuedAmount); Assert.Equal(target - 100000, view.ApprovedAdjustmentTotal); Assert.Equal(target, view.PayableAmount);
            Assert.Equal(Math.Max(0, target - (paid ? 100000 : 0)), view.OutstandingAmount); Assert.Equal(paid ? Math.Max(0, 100000 - target) : 0, view.PotentialExcessAmount);
            Assert.Equal(paid && target < 100000 ? "PendingReview" : "None", view.ReviewStatus);
        }
        using var other = await Client(w.Tenants[1]);
        var effects = (await other.GetFromJsonAsync<PagedResult<AdjustmentEffectView>>($"/api/v1/invoices/{w.Invoice}/adjustments"))!; Assert.Single(effects.Items);
        var shared = await other.GetStringAsync($"/api/v1/invoices/{w.Invoice}/adjustments"); Assert.DoesNotContain("Synthetic correction only", shared); Assert.DoesNotContain(w.Tenants[0].ToString(), shared);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/v1/invoice-adjustments/{request.Id}")).StatusCode);
        if (target > 100000 || !paid)
        {
            var due = target - (paid ? 100000 : 0);
            var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, due), Guid.NewGuid(), default));
            Assert.Equal("Allocated", (await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(w.Invoice, w.Tenants[1], true), Guid.NewGuid(), default))).Status);
            Assert.Equal("Paid", (await As(w.Tenants[2], Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default))).PaymentStatus);
        }
        else Assert.Equal(10000, result.Financials.PotentialExcessAmount);
        Assert.Empty((await owner.GetFromJsonAsync<PagedResult<DebtInvoiceView>>($"/api/v1/debts?roomId={w.Room}"))!.Items);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(100000, (await db.Set<Invoice>().SingleAsync(i => i.Id == w.Invoice)).Total);
        Assert.Equal(100000, (await db.Set<InvoiceLine>().SingleAsync(i => i.InvoiceId == w.Invoice)).Amount);
        Assert.Equal(1, await db.Set<InvoiceAdjustmentDecision>().CountAsync(d => d.InvoiceId == w.Invoice));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"InvoiceAdjustmentDecisions\" SET \"Delta\"=0 WHERE \"RequestId\"={request.Id}"));
    }
    [Fact]
    public async Task ConcurrentPaymentAndAdjustmentUseOneFinancialBasisWithoutLosingIncomingMoney()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var request = await AdjustRequest(tenant, w.Invoice, 1, 110000);
        var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w), Guid.NewGuid(), default));
        var allocation = As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        var approval = Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve", new AdjustmentDecisionInput(1, 1, 0, 110000, null, "Synthetic concurrent decision", true));
        await Task.WhenAll(allocation, approval); (await approval).EnsureSuccessStatusCode();
        var view = await As(w.Owner, Roles.Owner, s => s.InvoicePaymentAsync(w.Invoice, default)); Assert.Equal(110000, view.PayableAmount);
        Assert.Equal((await allocation).Status == "Allocated" ? 100000 : 0, view.PaidAmount); Assert.Equal(110000 - view.PaidAmount, view.OutstandingAmount);
        Assert.Equal(transfer.Id, (await As(w.Owner, Roles.Owner, s => s.TransferAsync(transfer.Id, default))).Id);
    }
    [Fact]
    public async Task ConcurrentFinalRequestsRequireRereviewAndRejectedDecisionHasNoFinancialEffect()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var a = await AdjustRequest(tenant, w.Invoice, 1, 90000); var b = await AdjustRequest(tenant, w.Invoice, 1, 80000);
        var input = new AdjustmentDecisionInput(1, 1, 0, 90000, null, "Synthetic Owner review", true);
        var replies = await Task.WhenAll(new[] { a, b }.Select(r => Post(owner, $"/api/v1/invoice-adjustments/{r.Id}/approve", input)));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        var pending = (await owner.GetFromJsonAsync<PagedResult<AdjustmentView>>($"/api/v1/invoice-adjustments?invoiceId={w.Invoice}&status=Pending"))!.Items.Single();
        var rejected = await Post(owner, $"/api/v1/invoice-adjustments/{pending.Id}/reject", input with { CorrectedAmount = null }); rejected.EnsureSuccessStatusCode();
        var view = await As(w.Owner, Roles.Owner, s => s.InvoicePaymentAsync(w.Invoice, default)); Assert.Equal(90000, view.PayableAmount); Assert.Equal(1, view.FinancialVersion);
    }
}
