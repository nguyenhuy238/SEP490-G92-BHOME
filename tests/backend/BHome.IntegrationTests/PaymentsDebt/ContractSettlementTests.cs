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
        Assert.Equal(100000, before.Calculation!.RoomOutstanding); Assert.Null(before.Calculation.ContractSpecificOutstanding);
        Assert.Contains("invoice_outstanding", before.UnresolvedItems); var invoice = Assert.Single(before.Invoices); Assert.True(invoice.Shared); Assert.Equal(100000, invoice.Financials.OutstandingAmount);
        var request = await AdjustRequest(tenant, w.Invoice, 1, 90000); var response = await Post(owner, $"/api/v1/invoice-adjustments/{request.Id}/approve", new AdjustmentDecisionInput(1, 1, 0, 90000, null, "Synthetic error confirmed", true)); response.EnsureSuccessStatusCode();
        var adjusted = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.Equal(-10000, Assert.Single(adjusted.Invoices).Financials.ApprovedAdjustmentTotal); Assert.NotEqual(before.Reference, adjusted.Reference);
        var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 90000), Guid.NewGuid(), default)); await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        var paid = (await tenant.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.DoesNotContain("invoice_outstanding", paid.UnresolvedItems); Assert.False(paid.Resolved); Assert.Equal(90000, Assert.Single(paid.Invoices).Financials.AllocatedPayments);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).RequiredDeposit = 20000; await db.SaveChangesAsync();
            db.Add(new DepositVerification { ContractId = w.Contract, Amount = 20000, BankTransactionReference = "SYN-BH40-" + Guid.NewGuid(), VerificationReason = "Synthetic deposit", VerifiedByUserId = w.Owner, VerifiedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        }
        var deposit = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path))!; Assert.Equal(20000, deposit.VerifiedSecurityDeposit); Assert.Null(deposit.RefundAmount); Assert.Null(deposit.ApprovedDeductions); Assert.Contains("deposit_deduction_refund_policy_required", deposit.UnresolvedItems);
        Assert.NotEqual(paid.Reference, deposit.Reference);
    }

    // Compact24-specific source positions; raw rows are synthetic preconditions, not bank acceptance.
    internal async Task SettlementSubtractsDepositUsesCompletedAndReservedRefundsWithoutDoubleCounting()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var path = $"/api/v1/contracts/{w.Contract}/move-out/settlement-summary";
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).RequiredDeposit = 400000;
        var otherTarget = await db.Set<Contract>().Where(c => c.RoomId == w.Room && c.Id != w.Contract).FirstAsync(); otherTarget.RequiredDeposit = 50000;
        await db.SaveChangesAsync();
        db.Add(new DepositVerification
        {
            ContractId = w.Contract,
            Amount = 400000,
            BankTransactionReference = "SYN-POS-" + Guid.NewGuid(),
            VerificationReason = "Synthetic verified deposit",
            VerifiedByUserId = w.Owner,
            VerifiedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var before = (await owner.GetFromJsonAsync<ContractSettlementSummary>(path))!;
        Assert.Equal(400000, before.Calculation!.AvailableSecurityDeposit);
        var beneficiary = (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).RepresentativeResidentId;
        var otherContract = await db.Set<Contract>().Where(c => c.RoomId == w.Room && c.Id != w.Contract).Select(c => c.Id).FirstAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_deposit_contract_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
              VALUES({Guid.NewGuid()},{w.Contract},{otherContract},50000,{Guid.NewGuid()},1,{w.Owner},{DateTimeOffset.UtcNow},'Synthetic prior transfer');
            """);
        foreach (var status in new[] { "COMPLETED", "APPROVED", "REJECTED" })
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_deposit_contract_id,beneficiary_resident_id,requested_by_user_id,requested_at,
                  requested_amount,reason,status,decided_by_user_id,decided_at,decision_reason,executed_at,external_refund_reference,execution_evidence_key,operation_key)
                VALUES({Guid.NewGuid()},{w.Contract},{beneficiary},{w.Owner},{DateTimeOffset.UtcNow},100000,'Synthetic prior refund',
                  {status},{w.Owner},{DateTimeOffset.UtcNow},'Synthetic decision',
                  {(status == "COMPLETED" ? DateTimeOffset.UtcNow : (DateTimeOffset?)null)},
                  {(status == "COMPLETED" ? "SYN-POS-" + Guid.NewGuid() : null)},
                  {(status == "COMPLETED" ? "synthetic/private-not-downloaded" : null)},{Guid.NewGuid()});
                """);
        var after = (await tenant.GetFromJsonAsync<ContractSettlementSummary>(path))!;
        Assert.Equal(400000, after.VerifiedSecurityDeposit); Assert.Equal(50000, after.Calculation!.DepositAllocated);
        Assert.Equal(100000, after.Calculation.DepositRefunded); Assert.Equal(100000, after.Calculation.DepositReserved);
        Assert.Equal(150000, after.Calculation.AvailableSecurityDeposit); Assert.Equal(0, after.Calculation.VerifiedInvoicePayments);
        Assert.Equal(100000, after.Calculation.IssuedTotal); Assert.Null(after.RefundAmount);
        Assert.False(after.Resolved); Assert.NotEqual(before.Reference, after.Reference);
        Assert.Equal(after.Reference, (await owner.GetFromJsonAsync<ContractSettlementSummary>(path))!.Reference);
        // Unknown source transfer/refund history stays blocked; summary never authorizes spending these funds.
        Assert.Contains("deposit_deduction_refund_policy_required", after.UnresolvedItems);
        using var stranger = await Client(w.Tenants[1]); Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(path)).StatusCode);
    }
}
