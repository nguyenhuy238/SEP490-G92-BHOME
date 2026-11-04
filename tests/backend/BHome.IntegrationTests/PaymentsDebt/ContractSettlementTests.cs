using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task SettlementReadsActualSharedDebtAdjustmentsAndDepositsWithoutAssigningRoomDebtToTenant()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var other = await Client(w.Tenants[1]); using var staff = await Client(w.Staff);
        var path = $"/api/v1/contracts/{w.Contract}/move-out/settlement-summary";
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(path)).StatusCode); Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(path)).StatusCode);
        var before = (await tenant.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.False(before.Resolved); Assert.Null(before.ContractSpecificOutstanding);
        Assert.Contains("shared_liability_allocation_pending", before.UnresolvedItems); var invoice = Assert.Single(before.Invoices); Assert.True(invoice.Shared); Assert.Equal(100000, invoice.Financials.OutstandingAmount);
        var request = await AdjustRequest(tenant, w.Invoice, 1, 90000); var response = await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve", new AdjustmentDecisionInput(1, 1, 0, 90000, null, "Synthetic error confirmed", true)); response.EnsureSuccessStatusCode();
        var adjusted = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.Equal(-10000, Assert.Single(adjusted.Invoices).Financials.ApprovedAdjustmentTotal); Assert.NotEqual(before.Reference, adjusted.Reference);
        var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 90000), Guid.NewGuid(), default)); await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        var paid = (await tenant.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.DoesNotContain("shared_liability_allocation_pending", paid.UnresolvedItems); Assert.False(paid.Resolved); Assert.Equal(90000, Assert.Single(paid.Invoices).Financials.AllocatedPayments);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); db.Add(new DepositVerification { ContractId = w.Contract, Amount = 20000, BankTransactionReference = "SYN-BH40-" + Guid.NewGuid(), VerificationReason = "Synthetic deposit", VerifiedByUserId = w.Owner, VerifiedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        }
        var deposit = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.Equal(20000, deposit.VerifiedSecurityDeposit); Assert.Null(deposit.RefundAmount); Assert.Null(deposit.ApprovedDeductions); Assert.Contains("deposit_deduction_refund_policy_required", deposit.UnresolvedItems);
        Assert.NotEqual(paid.Reference, deposit.Reference);
    }
}
