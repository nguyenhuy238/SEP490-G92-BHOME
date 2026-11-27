using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt;
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
    internal async Task ExternalPayerRefundsPartialAndWholeExcessWithoutInventingAResident()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var incoming = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 150000), Guid.NewGuid(), default));
        await As(w.Owner, Roles.Owner, s => s.AllocateAsync(incoming.Id, new(w.Invoice, null, true), Guid.NewGuid(), default));
        var payerRoute = $"/api/v1/payment-transactions/{incoming.Id}/external-payer";
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(payerRoute)).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(payerRoute)).StatusCode);
        var context = await RefundValue<ExternalPaymentPayerContext>(await owner.GetAsync(payerRoute)); Assert.Empty(context.Problems);
        var input = new ExternalPaymentPayerInput(context.TransferFingerprint, "SYNTHETIC OUTSIDE PAYER", "Synthetic bank statement checked, payer has no Resident profile", true, true);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, payerRoute, input with { PayerHasNoResidentProfile = false })).StatusCode);
        var key = Guid.NewGuid(); var replies = await Task.WhenAll(Post(owner, payerRoute, input, key), Post(owner, payerRoute, input, key));
        var payer = await RefundValue<ExternalPaymentPayer>(replies[0]); Assert.Equal(payer.Id, (await RefundValue<ExternalPaymentPayer>(replies[1])).Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, payerRoute, input with { PayerLabel = "Different payer" }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/payment-transactions/{incoming.Id}/allocate", new PaymentMatchInput(w.Invoice, w.Tenants[0], true))).StatusCode);
        var sourceRoute = $"/api/v1/payment-transactions/{incoming.Id}/refunds";
        var source = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute)); Assert.Empty(source.Beneficiaries); Assert.Equal(payer.Id, source.ExternalBeneficiary!.AttestationId); Assert.Equal(50000, source.AvailableAmount);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, sourceRoute, new RefundInput(null, 10000, "Synthetic wrong source payer", true, Guid.NewGuid()))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var people = await db.Set<Resident>().CountAsync(); var users = await db.Users.CountAsync();
        var attempts = await Task.WhenAll(Post(owner, sourceRoute, new RefundInput(null, 30000, "Synthetic actual external payer", true, payer.Id)), Post(owner, sourceRoute, new RefundInput(null, 30000, "Synthetic competing reservation", true, payer.Id)));
        Assert.Single(attempts, r => r.IsSuccessStatusCode); Assert.Single(attempts, r => r.StatusCode == HttpStatusCode.Conflict);
        var refund = await RefundValue<RefundView>(attempts.Single(r => r.IsSuccessStatusCode)); Assert.Null(refund.BeneficiaryResidentId); Assert.Equal("EXTERNAL", refund.BeneficiaryKind);
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); var photo = image.ImEncode(".png");
        async Task Execute(RefundView row)
        {
            var approved = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{row.Id}/decision", new RefundDecision(row.Version, true, "Synthetic verified external beneficiary", true)));
            var operation = Guid.NewGuid(); var at = DateTimeOffset.UtcNow;
            foreach (var response in await Task.WhenAll(DepositExecute(owner, approved, operation, at, photo), DepositExecute(owner, approved, operation, at, photo)))
                Assert.Equal("COMPLETED", (await RefundValue<RefundView>(response)).Status);
        }
        await Execute(refund); Assert.True((await As(w.Tenants[0], Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default))).PendingReview);
        await Execute(await RefundValue<RefundView>(await Post(owner, sourceRoute, new RefundInput(null, 20000, "Synthetic remaining excess", true, payer.Id))));
        Assert.False((await As(w.Tenants[0], Roles.Tenant, s => s.InvoicePaymentAsync(w.Invoice, default))).PendingReview);
        var extra = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, 25000), Guid.NewGuid(), default));
        var externalRoute = $"/api/v1/payment-transactions/{extra.Id}/external-payer";
        var extraContext = await RefundValue<ExternalPaymentPayerContext>(await owner.GetAsync(externalRoute));
        var extraPayer = await RefundValue<ExternalPaymentPayer>(await Post(owner, externalRoute, input with { ExpectedTransferFingerprint = extraContext.TransferFingerprint }));
        var rejected = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_payment_id,target_invoice_id,amount,operation_key,line_number,paid_by_user_id,created_by_user_id,allocated_at,reason)
            VALUES({Guid.NewGuid()},{extra.Id},{w.Invoice},1,{Guid.NewGuid()},1,{w.Tenants[0]},{w.Owner},{DateTimeOffset.UtcNow},'Synthetic forbidden Tenant relabel')
            """)); Assert.Equal("23514", rejected.SqlState);
        var wholeRoute = $"/api/v1/payment-transactions/{extra.Id}/excess-disposition";
        var whole = await RefundValue<ReceiptExcessContext>(await owner.GetAsync(wholeRoute + $"/context?invoiceId={w.Invoice}")); Assert.Empty(whole.Payers); Assert.Equal(extraPayer.Id, whole.ExternalPayer!.Id); Assert.Empty(whole.Problems);
        await RefundValue<ReceiptExcessDisposition>(await Post(owner, wholeRoute, new ReceiptExcessConfirmation(new(InvoiceId: w.Invoice), whole.Reference, null, "Synthetic entire receipt must return to external payer", true, extraPayer.Id)));
        await Execute(await RefundValue<RefundView>(await Post(owner, $"/api/v1/payment-transactions/{extra.Id}/refunds", new RefundInput(null, 25000, "Synthetic whole external excess", true, extraPayer.Id))));
        Assert.Equal("ExcessRefundCompleted", (await As(w.Owner, Roles.Owner, s => s.TransferAsync(extra.Id, default))).Status);
        Assert.Equal(people, await db.Set<Resident>().CountAsync()); Assert.Equal(users, await db.Users.CountAsync());
        Assert.Equal(0, await db.Set<PaymentAllocation>().CountAsync(a => a.TransferId == extra.Id));
        var mine = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await tenant.GetAsync("/api/v1/tenant/refunds")); Assert.Equal(0, mine.TotalCount);
        var report = await RefundValue<FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&roomId={w.Room}"));
        Assert.False(report.HasUnclassifiedRefunds); Assert.Equal("100000", report.Total.VerifiedCollections); Assert.Equal("0", report.Total.OperatingExpenses);
        Assert.DoesNotContain(input.PayerLabel, await tenant.GetStringAsync($"/api/v1/invoices/{w.Invoice}/payment"));
        var invoicePayment = await RefundValue<InvoicePaymentView>(await tenant.GetAsync($"/api/v1/invoices/{w.Invoice}/payment"));
        Assert.Equal("Người trả bên ngoài (đã xác minh)", Assert.Single(invoicePayment.History).PaidBy);
        var history = await RefundValue<BHome.Application.PropertyManagement.PagedResult<PaymentHistoryEntry>>(await tenant.GetAsync("/api/v1/payment-history"));
        Assert.Equal("Người trả bên ngoài (đã xác minh)", Assert.Single(history.Items).PaidBy);
    }
}
