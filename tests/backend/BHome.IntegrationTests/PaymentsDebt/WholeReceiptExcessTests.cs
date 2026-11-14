using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    internal async Task WholeReceiptExcessIsReturnedWithoutZeroAllocationOrTenantCredit()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[2]); using var staff = await Client(w.Staff);
        var extra = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 50000), Guid.NewGuid(), default));
        var route = $"/api/v1/payment-transactions/{extra.Id}/excess-disposition";
        var contextPath = route + $"/context?invoiceId={w.Invoice}";
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(contextPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(contextPath)).StatusCode);
        var before = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(contextPath));
        Assert.Contains("receipt_target_not_settled", before.Problems);
        var payer = before.Payers.Single(p => p.UserId == w.Tenants[2]);
        var input = new ReceiptExcessConfirmation(new(InvoiceId: w.Invoice), before.Reference, payer.ResidentId, "Synthetic verified full excess and actual payer", true);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input)).StatusCode);
        var originalPayment = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 100000), Guid.NewGuid(), default));
        await As(w.Owner, Roles.Owner, s => s.AllocateAsync(originalPayment.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input)).StatusCode); // stale balance snapshot
        var context = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(contextPath)); Assert.Empty(context.Problems);
        input = input with { ExpectedReference = context.Reference };
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, route, input with { PayerResidentId = Guid.NewGuid() })).StatusCode);
        var key = Guid.NewGuid(); var results = await Task.WhenAll(Post(owner, route, input, key), Post(owner, route, input, key));
        var disposition = await RefundValue<ReceiptExcessDisposition>(results[0]); Assert.Equal(disposition.Id, (await RefundValue<ReceiptExcessDisposition>(results[1])).Id);
        Assert.Equal(50000, disposition.Amount); Assert.Equal(w.Tenants[2], disposition.PayerUserId);
        Assert.Equal(disposition.Id, (await RefundValue<ReceiptExcessDisposition>(await owner.GetAsync(route))).Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { Reason = "Different source claim" }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/payment-transactions/{extra.Id}/reject", new PaymentRejectInput("Cannot erase refund obligation"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/payment-transactions/{extra.Id}/allocate", new PaymentMatchInput(w.Invoice, w.Tenants[2], true))).StatusCode);
        Assert.Equal("ExcessRefundPending", (await As(w.Owner, Roles.Owner, s => s.TransferAsync(extra.Id, default))).Status);
        var pending = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TransferView>>(await owner.GetAsync("/api/v1/payment-transactions?paymentStatus=ExcessRefundPending&pageSize=20"));
        Assert.Contains(pending.Items, p => p.Id == extra.Id);
        Assert.True((await As(w.Tenants[2], Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default))).PendingReview);
        var sourceRoute = $"/api/v1/payment-transactions/{extra.Id}/refunds";
        var source = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute));
        Assert.Equal(50000, source.ExcessAmount); Assert.Equal(50000, source.AvailableAmount); Assert.Equal(payer.ResidentId, Assert.Single(source.Beneficiaries).Id);
        var wrong = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, sourceRoute, new RefundInput(wrong, 50000, "Synthetic wrong beneficiary", true))).StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            Assert.Equal(0, await db.Set<PaymentAllocation>().CountAsync(a => a.TransferId == extra.Id));
            Assert.Equal(1, await db.Set<PaymentAllocation>().CountAsync(a => a.InvoiceId == w.Invoice));
            var person = await db.Set<BHome.Domain.TenantContracts.Resident>().SingleAsync(r => r.Id == payer.ResidentId); person.RoomId = null; await db.SaveChangesAsync();
            var rejected = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payment_allocations(id,source_payment_id,target_invoice_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
                VALUES({Guid.NewGuid()},{extra.Id},{w.Invoice},1,{Guid.NewGuid()},1,{w.Owner},{DateTimeOffset.UtcNow},'Synthetic forbidden reuse')
                """)); Assert.Equal("23514", rejected.SqlState);
        }
        var refund = await RefundValue<RefundView>(await Post(owner, sourceRoute, new RefundInput(payer.ResidentId, 50000, "Synthetic full excess return to actual payer", true)));
        Assert.Equal("REQUESTED", refund.Status);
        const string ownRefunds = "/api/v1/tenant/refunds?pageSize=1";
        using var coTenant = await Client(w.Tenants[0]); using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(ownRefunds)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.GetAsync(ownRefunds)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(ownRefunds)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await tenant.GetAsync(ownRefunds + "&page=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await tenant.GetAsync("/api/v1/tenant/refunds?page=2147483647&pageSize=100")).StatusCode);
        var own = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await tenant.GetAsync(ownRefunds));
        Assert.Equal(1, own.TotalCount); Assert.Equal(refund.Id, Assert.Single(own.Items).Id); Assert.Equal("ReceiptExcess", own.Items[0].SourceKind); Assert.Equal("REQUESTED", own.Items[0].Status);
        Assert.Empty((await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await tenant.GetAsync(ownRefunds + "&page=2"))).Items);
        Assert.Equal(0, (await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await coTenant.GetAsync(ownRefunds))).TotalCount);
        var tenantJson = System.Text.Json.JsonDocument.Parse(await tenant.GetStringAsync(ownRefunds));
        Assert.Equal(new[] { "amount", "decidedAt", "executedAt", "id", "isDevelopmentDemo", "requestedAt", "sourceKind", "status" }, tenantJson.RootElement.GetProperty("items")[0].EnumerateObject().Select(p => p.Name).Order());
        refund = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(1, true, "Synthetic bank payer proof checked", true)));
        Assert.Equal("APPROVED", refund.Status);
        Assert.True((await As(w.Tenants[2], Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default))).PendingReview);
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); var photo = image.ImEncode(".png"); var executeKey = Guid.NewGuid(); var at = DateTimeOffset.UtcNow;
        foreach (var response in await Task.WhenAll(DepositExecute(owner, refund, executeKey, at, photo), DepositExecute(owner, refund, executeKey, at, photo)))
            Assert.Equal("COMPLETED", (await RefundValue<RefundView>(response)).Status);
        Assert.Equal(0, (await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
        var paid = await As(w.Tenants[2], Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default));
        Assert.False(paid.PendingReview); Assert.Equal(100000, paid.PaidAmount); Assert.Equal(0, paid.OutstandingAmount);
        Assert.Equal("ExcessRefundCompleted", (await As(w.Owner, Roles.Owner, s => s.TransferAsync(extra.Id, default))).Status);
        var completed = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TransferView>>(await owner.GetAsync("/api/v1/payment-transactions?paymentStatus=ExcessRefundCompleted&pageSize=20"));
        Assert.Contains(completed.Items, p => p.Id == extra.Id);
        var ownCompleted = Assert.Single((await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await tenant.GetAsync(ownRefunds))).Items);
        Assert.Equal("COMPLETED", ownCompleted.Status); Assert.Equal(50000, ownCompleted.Amount); Assert.NotNull(ownCompleted.ExecutedAt);
        var report = await RefundValue<FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&roomId={w.Room}"));
        Assert.False(report.HasUnclassifiedRefunds); Assert.Equal("100000", report.Total.VerifiedCollections); Assert.Equal("0", report.Total.OutstandingNow);
    }
    internal async Task ClosedDepositExcessCanReturnToVerifiedResidentWithoutAnAccount(bool main = false)
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        var resident = new BHome.Domain.TenantContracts.Resident { OwnerUserId = w.Owner, DisplayLabel = "SYNTHETIC PREACCOUNT PAYER", VerificationStatus = BHome.Domain.TenantContracts.IdentityVerificationStatus.Verified };
        var holding = new BHome.Domain.TenantContracts.Contract
        {
            RoomId = w.Room,
            OwnerSignerId = w.Owner,
            RepresentativeResidentId = resident.Id,
            Kind = main ? BHome.Domain.TenantContracts.ContractKind.Main : BHome.Domain.TenantContracts.ContractKind.Holding,
            Status = BHome.Domain.TenantContracts.ContractStatus.Cancelled,
            RequiredDeposit = 100000,
            StartDate = DateOnly.FromDateTime(DateTime.UtcNow),
            EndDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30)),
            Terms = "SYNTHETIC CLOSED HOLDING",
            Residents = [new BHome.Domain.TenantContracts.ContractResident { ResidentId = resident.Id, Role = BHome.Domain.TenantContracts.ResidentType.Representative }]
        };
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); db.AddRange(resident, holding); await db.SaveChangesAsync(); }
        var extra = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 35000) with { ProposedInvoiceId = null, TransferDescription = PaymentRules.DepositReference(holding.Id) }, Guid.NewGuid(), default));
        var route = $"/api/v1/payment-transactions/{extra.Id}/excess-disposition";
        var target = main ? new ReceiptExcessTarget(DepositContractId: holding.Id) : new ReceiptExcessTarget(HoldingContractId: holding.Id);
        var query = main ? "depositContractId" : "holdingContractId";
        var context = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(route + $"/context?{query}={holding.Id}"));
        Assert.Empty(context.Problems); Assert.Null(Assert.Single(context.Payers).UserId);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync(route + $"/context?{query}={holding.Id}&invoiceId={w.Invoice}")).StatusCode);
        var confirmed = await RefundValue<ReceiptExcessDisposition>(await Post(owner, route, new ReceiptExcessConfirmation(target, context.Reference, resident.Id, "Synthetic closed deposit received accidental transfer", true)));
        Assert.Null(confirmed.PayerUserId);
        var retentionRoute = $"/api/v1/residents/{resident.Id}/identity-retention";
        Assert.Contains("refund_pending", (await RefundValue<BHome.Application.Operations.IdentityRetentionView>(await owner.GetAsync(retentionRoute))).BlockingReasons);
        var sourceRoute = $"/api/v1/payment-transactions/{extra.Id}/refunds";
        Assert.Equal(resident.Id, Assert.Single((await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute))).Beneficiaries).Id);
        var refund = await RefundValue<RefundView>(await Post(owner, sourceRoute, new RefundInput(resident.Id, 35000, "Synthetic actual preaccount payer", true)));
        refund = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(refund.Version, true, "Synthetic payer proof checked", true)));
        using var picture = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        Assert.Equal("COMPLETED", (await RefundValue<RefundView>(await DepositExecute(owner, refund, Guid.NewGuid(), DateTimeOffset.UtcNow, picture.ImEncode(".png")))).Status);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope(); var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Null((await finalDb.Set<BHome.Domain.TenantContracts.Resident>().SingleAsync(r => r.Id == resident.Id)).TenantUserId);
        Assert.Equal(0, await finalDb.Set<PaymentAllocation>().CountAsync(a => a.TransferId == extra.Id));
        Assert.Equal("ExcessRefundCompleted", (await As(w.Owner, Roles.Owner, s => s.TransferAsync(extra.Id, default))).Status);
        Assert.False((await RefundValue<FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&roomId={w.Room}"))).HasUnclassifiedRefunds);
        Assert.DoesNotContain("refund_pending", (await RefundValue<BHome.Application.Operations.IdentityRetentionView>(await owner.GetAsync(retentionRoute))).BlockingReasons);
    }
    internal async Task SettlementWholeExcessIsDiscoverableAfterPhysicalRelease()
    {
        var (w, proof, photo) = await DamageFixture(true); using var owner = await Client(w.Owner);
        var root = $"/api/v1/contracts/{w.Contract}/move-out/receivables";
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var inspection = await db.Set<BHome.Domain.TenantContracts.ContractFinalInspection>().SingleAsync(i => i.ContractId == w.Contract);
        var view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(root));
        var charge = await RefundValue<SettlementReceivable>(await Post(owner, root + "/damage", new DamageChargeInput(view.Reference, inspection.Id, inspection.Version, null, 400000, "Synthetic covered damage", [proof], true)));
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(root));
        await RefundValue<DepositOffsetApproval>(await Post(owner, root + "/deposit-offsets", new DepositOffsetInput(view.Reference, charge.Id, null, 400000, "Synthetic full offset", true)));
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await RefundValue<ContractView>(await Post(owner, $"/api/v1/contracts/{w.Contract}/move-out/complete", new CompletionInput(today)));
        var extra = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 25000) with { ProposedInvoiceId = null, TransferDescription = PaymentRules.InvoiceReference(charge.Id) }, Guid.NewGuid(), default));
        var route = $"/api/v1/payment-transactions/{extra.Id}/excess-disposition";
        var context = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(route + $"/context?settlementContractId={w.Contract}&receivableId={charge.Id}")); Assert.Empty(context.Problems);
        var payer = context.Payers.Single(p => p.UserId == w.Tenants[2]);
        await RefundValue<ReceiptExcessDisposition>(await Post(owner, route, new ReceiptExcessConfirmation(new(SettlementContractId: w.Contract, ReceivableId: charge.Id), context.Reference, payer.ResidentId, "Synthetic receipt after full offset", true)));
        var history = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TransferView>>(await owner.GetAsync($"/api/v1/payment-transactions?settlementContractId={w.Contract}&pageSize=20")); Assert.Contains(history.Items, p => p.Id == extra.Id && p.Status == "ExcessRefundPending");
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(root));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + $"/{charge.Id}/bank-allocations", new SettlementBankAllocationInput(view.Reference, extra.Id, w.Tenants[2], true))).StatusCode);
        var summaryPath = $"/api/v1/contracts/{w.Contract}/move-out/settlement-summary";
        Assert.Contains("receipt_excess_refund_pending", (await RefundValue<ContractSettlementSummary>(await owner.GetAsync(summaryPath))).UnresolvedItems);
        var refund = await RefundValue<RefundView>(await Post(owner, $"/api/v1/payment-transactions/{extra.Id}/refunds", new RefundInput(payer.ResidentId, 25000, "Synthetic return after physical release", true)));
        refund = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(refund.Version, true, "Synthetic actual payer checked", true)));
        await RefundValue<RefundView>(await DepositExecute(owner, refund, Guid.NewGuid(), DateTimeOffset.UtcNow, photo));
        Assert.DoesNotContain("receipt_excess_refund_pending", (await RefundValue<ContractSettlementSummary>(await owner.GetAsync(summaryPath))).UnresolvedItems);
        Assert.Equal(0, await db.Set<PaymentAllocation>().CountAsync(a => a.TransferId == extra.Id));
    }
}
