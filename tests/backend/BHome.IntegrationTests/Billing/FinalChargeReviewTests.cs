using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.Billing;
public sealed partial class InvoiceApiTests
{
    private async Task ReviewChargesOffsetAndRefundRemainder(Workspace w, SettlementReceivable electricity, DateOnly date, decimal deposit)
    {
        var root = $"/api/v1/contracts/{w.Contract}"; var route = root + "/move-out/receivables";
        var review = await Success<SettlementChargeReviewPreview>(await w.Owner.Client.GetAsync(route + "/charge-review"));
        Assert.False(review.IsCurrent); Assert.NotEmpty(review.MissingInputs);
        Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route + "/charge-review", new SettlementChargeReviewInput(review.Reference, "Synthetic source review", true), Guid.NewGuid())).StatusCode);
        var water = (await Success<FinalUtilityPreview[]>(await w.Owner.Client.GetAsync(route + "/final-utilities"))).Single(p => p.UtilityType == "Water");
        await Success<SettlementReceivable>(await UtilityPost(w.Owner.Client, route + "/final-utilities", new FinalUtilityApprovalInput(UtilityType.Water, water.Reference, true), Guid.NewGuid()));
        var rent = Assert.Single(await Success<FinalFixedChargePreview[]>(await w.Owner.Client.GetAsync(route + "/final-fixed-charges")));
        Assert.Empty(rent.MissingInputs); Assert.Equal(0, rent.Amount);
        await Success<SettlementReceivable>(await UtilityPost(w.Owner.Client, route + "/final-fixed-charges", new FinalFixedChargeApproval(rent.ChargeCode, rent.Reference, true), Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, route + "/charge-review", new SettlementChargeReviewInput(review.Reference, "Stale source review", true), Guid.NewGuid())).StatusCode);
        review = await Success<SettlementChargeReviewPreview>(await w.Owner.Client.GetAsync(route + "/charge-review")); Assert.Empty(review.MissingInputs);
        var input = new SettlementChargeReviewInput(review.Reference, "Synthetic confirmed all rent, utilities, fees and no additional damage", true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await UtilityPost(w.Tenant.Client, route + "/charge-review", input, key)).StatusCode);
        var approved = await Success<SettlementChargeReview>(await UtilityPost(w.Owner.Client, route + "/charge-review", input, key));
        Assert.Contains(electricity.Id, approved.ChargeIds);
        Assert.Equal(approved.Id, (await Success<SettlementChargeReview>(await UtilityPost(w.Owner.Client, route + "/charge-review", input, key))).Id);
        // The physical handover can finish while debt and refund are both unresolved.
        await Success<ContractView>(await UtilityPost(w.Owner.Client, root + "/move-out/complete", new CompletionInput(date), Guid.NewGuid()));
        var summary = await Success<ContractSettlementSummary>(await w.Owner.Client.GetAsync(root + "/move-out/settlement-summary"));
        Assert.NotNull(summary.ChargeReview); Assert.Contains("settlement_receivable_outstanding", summary.UnresolvedItems);
        Assert.DoesNotContain("final_charge_review_required", summary.UnresolvedItems);
        var view = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(route));
        var targets = view.Receivables.Where(r => r.Outstanding > 0).Select(r => (Receivable: (Guid?)r.Charge.Id, Invoice: (Guid?)null, r.Outstanding))
            .Concat(view.Invoices!.Where(i => i.Outstanding > 0).Select(i => (Receivable: (Guid?)null, Invoice: (Guid?)i.Id, i.Outstanding))).ToArray();
        var total = targets.Sum(t => t.Outstanding); Assert.True(total <= deposit);
        foreach (var target in targets)
        {
            view = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(route));
            await Success<DepositOffsetApproval>(await UtilityPost(w.Owner.Client, route + "/deposit-offsets", new DepositOffsetInput(view.Reference, target.Receivable, target.Invoice, target.Outstanding, "Synthetic source-specific debt offset", true), Guid.NewGuid()));
        }
        var refundSource = await Success<RefundSource>(await w.Owner.Client.GetAsync(root + "/deposit-refunds"));
        Assert.Empty(refundSource.Blockers!); Assert.Equal(total, refundSource.ApprovedDepositOffsets); Assert.Equal(deposit - total, refundSource.AvailableAmount);
        Assert.True((await Success<SettlementChargeReviewPreview>(await w.Owner.Client.GetAsync(route + "/charge-review"))).IsCurrent);
        if (deposit == total)
        {
            Assert.Empty(refundSource.Requests);
            summary = await Success<ContractSettlementSummary>(await w.Owner.Client.GetAsync(root + "/move-out/settlement-summary"));
            Assert.True(summary.Resolved, string.Join(',', summary.UnresolvedItems)); Assert.Equal(0, summary.RefundAmount);
            Assert.Equal("NotRequired", summary.TransferVerificationStatus); Assert.Equal(deposit, summary.ApprovedDepositOffsets);
            var settle = await Success<MoveOutView>(await UtilityPost(w.Owner.Client, root + "/move-out/settlement", new SettlementInput("Synthetic all deposit applied with approval", summary.Reference), Guid.NewGuid()));
            Assert.Equal("Completed", settle.Status); return;
        }
        var refundInput = new DepositRefundInput(new(Assert.Single(refundSource.Beneficiaries).Id, refundSource.AvailableAmount!.Value,
            "Synthetic verified original depositor; refund remaining deposit", true), refundSource.FinancialReference!, true, false, DeductionsConfirmed: true);
        Assert.Equal(HttpStatusCode.Conflict, (await UtilityPost(w.Owner.Client, root + "/deposit-refunds", refundInput with { NoDeductionsConfirmed = true, DeductionsConfirmed = false }, Guid.NewGuid())).StatusCode);
        var refund = await Success<RefundView>(await UtilityPost(w.Owner.Client, root + "/deposit-refunds", refundInput, Guid.NewGuid())); Assert.Equal("REQUESTED", refund.Status);
        var decision = await Success<RefundView>(await UtilityPost(w.Owner.Client, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(refund.Version, true, "Synthetic confirmed remaining amount", true), Guid.NewGuid())); Assert.Equal("APPROVED", decision.Status);
        Assert.False((await Success<ContractSettlementSummary>(await w.Owner.Client.GetAsync(root + "/move-out/settlement-summary"))).Resolved);
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); var bytes = image.ImEncode(".png"); var executedAt = DateTimeOffset.UtcNow; var executeKey = Guid.NewGuid();
        async Task<HttpResponseMessage> Execute()
        {
            var form = new MultipartFormDataContent { { new StringContent(decision.Version.ToString()), "expectedVersion" }, { new StringContent(executedAt.ToString("O")), "executedAt" },
                { new StringContent("SYN-FINAL-REFUND-" + executeKey), "externalReference" }, { new StringContent("Synthetic verified external execution"), "reason" }, { new StringContent("true"), "humanConfirmed" } };
            var file = new ByteArrayContent(bytes); file.Headers.ContentType = new("image/png"); form.Add(file, "evidence", "synthetic.png");
            var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/refund-requests/{refund.Id}/execution") { Content = form }; request.Headers.Add("Idempotency-Key", executeKey.ToString()); return await w.Owner.Client.SendAsync(request);
        }
        foreach (var response in await Task.WhenAll(Execute(), Execute())) Assert.Equal("COMPLETED", (await Success<RefundView>(response)).Status);
        summary = await Success<ContractSettlementSummary>(await w.Tenant.Client.GetAsync(root + "/move-out/settlement-summary"));
        Assert.True(summary.Resolved, string.Join(',', summary.UnresolvedItems)); Assert.Equal(total, summary.ApprovedDepositOffsets);
        Assert.Equal(deposit - total, summary.RefundAmount); Assert.Equal(0, summary.Calculation!.AvailableSecurityDeposit);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(BHome.Domain.PropertyManagement.RoomStatus.Available, (await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.Equal(1, await db.Set<Invoice>().CountAsync(i => i.RoomId == w.Room));
        var finance = await scope.ServiceProvider.GetRequiredService<IFinancialReportRepository>().ReadAsync(new(Today.AddDays(-1), Today, RoomId: w.Room), default);
        Assert.False(finance.HasUnclassifiedRefunds); Assert.Equal(deposit - total, finance.VerifiedDepositReturns);
    }
}
