using System.Net;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    internal async Task MainWholeExcessRemainsRefundableAfterPhysicalRelease(bool external)
    {
        var w = await Setup(); await ReadySettlementFixture(w, false, agreedDeposit: 100000);
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var extra = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 25000, memo: PaymentRules.DepositReference(w.Contract)) with { ProposedInvoiceId = null, ProposedDepositContractId = w.Contract }, Guid.NewGuid(), default));
        var route = $"/api/v1/payment-transactions/{extra.Id}/excess-disposition";
        var contextRoute = route + $"/context?depositContractId={w.Contract}";
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(contextRoute)).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(contextRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync(contextRoute + $"&invoiceId={w.Invoice}")).StatusCode);
        var context = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(contextRoute));
        Assert.Equal(100000, context.Outstanding); Assert.Contains("receipt_target_not_settled", context.Problems);
        var payer = Assert.Single(context.Payers); var target = new ReceiptExcessTarget(DepositContractId: w.Contract);
        var stale = new ReceiptExcessConfirmation(target, context.Reference, payer.ResidentId, "Synthetic whole excess review", true);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, stale)).StatusCode);
        await RefundValue<ContractId>(await Post(owner, $"/api/v1/contracts/{w.Contract}/deposit-verifications", new DepositInput("SYN-MAIN-FUND-" + Guid.NewGuid(), 100000, "Synthetic original deposit receipt checked")));
        Guid? externalId = null;
        if (external)
        {
            var path = $"/api/v1/payment-transactions/{extra.Id}/external-payer";
            var source = await RefundValue<ExternalPaymentPayerContext>(await owner.GetAsync(path));
            externalId = (await RefundValue<ExternalPaymentPayer>(await Post(owner, path, new ExternalPaymentPayerInput(source.TransferFingerprint, "Synthetic outside payer", "Synthetic statement identity verified", true, true)))).Id;
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, stale)).StatusCode);
        context = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(contextRoute)); Assert.Empty(context.Problems); Assert.Equal(0, context.Outstanding);
        var input = new ReceiptExcessConfirmation(target, context.Reference, external ? null : payer.ResidentId, "Synthetic accidental transfer after deposit was fully funded", true, externalId);
        var key = Guid.NewGuid(); var confirmed = await Task.WhenAll(Post(owner, route, input, key), Post(owner, route, input, key));
        var disposition = await RefundValue<ReceiptExcessDisposition>(confirmed[0]); Assert.Equal(disposition.Id, (await RefundValue<ReceiptExcessDisposition>(confirmed[1])).Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { Reason = "Different decision" }, key)).StatusCode);
        var summaryPath = $"/api/v1/contracts/{w.Contract}/move-out/settlement-summary";
        Assert.Contains("receipt_excess_refund_pending", (await RefundValue<ContractSettlementSummary>(await owner.GetAsync(summaryPath))).UnresolvedItems);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await RefundValue<ContractView>(await Post(owner, $"/api/v1/contracts/{w.Contract}/move-out/complete", new CompletionInput(today)));
        Assert.Contains("receipt_excess_refund_pending", (await RefundValue<ContractSettlementSummary>(await owner.GetAsync(summaryPath))).UnresolvedItems);
        var history = await RefundValue<PagedResult<TransferView>>(await owner.GetAsync($"/api/v1/payment-transactions?depositContractId={w.Contract}&paymentStatus=ExcessRefundPending"));
        Assert.Contains(history.Items, p => p.Id == extra.Id && p.AllocatedAmount == 0 && p.UnallocatedAmount == 25000);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/payment-transactions/{extra.Id}/allocate-deposit", new PaymentDepositMatchInput(w.Contract, null, true, external ? null : payer.ResidentId, externalId))).StatusCode);
        var refundPath = $"/api/v1/payment-transactions/{extra.Id}/refunds";
        var sourceAfterRelease = await RefundValue<RefundSource>(await owner.GetAsync(refundPath)); Assert.Equal(25000, sourceAfterRelease.AvailableAmount);
        var refund = await RefundValue<RefundView>(await Post(owner, refundPath, new RefundInput(external ? null : payer.ResidentId, 25000, "Synthetic return after handover", true, externalId)));
        refund = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(refund.Version, true, "Synthetic actual payer verified", true)));
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        Assert.Equal("COMPLETED", (await RefundValue<RefundView>(await DepositExecute(owner, refund, Guid.NewGuid(), DateTimeOffset.UtcNow, image.ImEncode(".png")))).Status);
        Assert.DoesNotContain("receipt_excess_refund_pending", (await RefundValue<ContractSettlementSummary>(await owner.GetAsync(summaryPath))).UnresolvedItems);
        history = await RefundValue<PagedResult<TransferView>>(await owner.GetAsync($"/api/v1/payment-transactions?depositContractId={w.Contract}&paymentStatus=ExcessRefundCompleted"));
        Assert.Contains(history.Items, p => p.Id == extra.Id);
        var own = await RefundValue<PagedResult<TenantRefundView>>(await tenant.GetAsync("/api/v1/tenant/refunds"));
        Assert.Equal(!external, own.Items.Any(r => r.Id == refund.Id));
        Assert.False((await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"))).HasUnclassifiedRefunds);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(0, await db.Set<PaymentAllocation>().CountAsync(a => a.TransferId == extra.Id));
        Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == payer.ResidentId)).RoomId);
        Assert.Equal(100000, await db.Database.SqlQuery<decimal>($"SELECT sum(amount) AS \"Value\" FROM payment_allocations WHERE target_deposit_contract_id={w.Contract}").SingleAsync());
        if (!external)
        {
            // Simulate inconsistent imported legacy money; a copied proof must not clear an over-refunded receipt.
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,requested_amount,reason,status,
                  decided_by_user_id,decided_at,decision_reason,executed_at,external_refund_reference,execution_evidence_key,operation_key,history)
                SELECT {Guid.NewGuid()},source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,1,'Synthetic inconsistent imported extra return',status,
                  decided_by_user_id,decided_at,decision_reason,executed_at,external_refund_reference,execution_evidence_key,{Guid.NewGuid()},history
                FROM refund_requests WHERE id={refund.Id}
                """);
            Assert.Contains("receipt_excess_refund_pending", (await RefundValue<ContractSettlementSummary>(await owner.GetAsync(summaryPath))).UnresolvedItems);
            Assert.True((await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"))).HasUnclassifiedRefunds);
        }
    }
}
