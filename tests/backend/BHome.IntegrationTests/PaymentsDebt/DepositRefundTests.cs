using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    private static async Task<T> RefundValue<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync() + "\n" +
            string.Join('\n', BHome.IntegrationTests.Compact24.Compact24WorkflowFixture.Diagnostics));
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static Task<HttpResponseMessage> DepositExecute(HttpClient client, RefundView row, Guid key, DateTimeOffset at, byte[] photo)
    {
        var body = new MultipartFormDataContent {
            { new StringContent(row.Version.ToString()), "expectedVersion" }, { new StringContent(at.ToString("O")), "executedAt" },
            { new StringContent("SYN-DEPOSIT-" + row.Id), "externalReference" },
            { new StringContent("Synthetic manually reconciled bank transfer"), "reason" }, { new StringContent("true"), "humanConfirmed" },
            { new ByteArrayContent(photo) { Headers = { ContentType = new("image/png") } }, "evidence", "synthetic.png" }
        };
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/refund-requests/{row.Id}/execution") { Content = body };
        request.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(request);
    }

    internal async Task UndisputedDepositIsReservedManuallyReturnedAndRecheckedBeforeContractClosure(bool interruptedUpload = false)
    {
        var w = await Setup(); await ReadySettlementFixture(w, false);
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var contract = $"/api/v1/contracts/{w.Contract}"; var sourceRoute = contract + "/deposit-refunds";
        await RefundValue<ContractId>(await Post(owner, contract + "/deposit-verifications",
            new DepositInput("SYN-DEP-" + Guid.NewGuid(), 400000, "Synthetic original depositor verified")));
        var summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(contract + "/move-out/settlement-summary"));
        Assert.False(summary.Resolved); Assert.Equal(400000, summary.Calculation!.AvailableSecurityDeposit);
        var source = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute));
        Assert.Empty(source.Blockers!); Assert.Null(source.SourcePaymentId); Assert.Equal(w.Contract, source.SourceDepositContractId);
        Assert.Equal(400000, source.VerifiedDepositAmount); Assert.Equal(0, source.ExcessAmount);
        var person = Assert.Single(source.Beneficiaries);
        var input = new DepositRefundInput(new(person.Id, 400000, "Synthetic original depositor and full return checked", true), source.FinancialReference!, true, true);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(sourceRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, sourceRoute, input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, sourceRoute, input with { NoDeductionsConfirmed = false })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, sourceRoute, input with { ExpectedFinancialReference = "stale" })).StatusCode);
        var key = Guid.NewGuid();
        var created = await Task.WhenAll(Post(owner, sourceRoute, input, key), Post(owner, sourceRoute, input, key));
        var row = await RefundValue<RefundView>(created[0]); Assert.Equal(row.Id, (await RefundValue<RefundView>(created[1])).Id);
        Assert.Null(row.SourcePaymentId); Assert.Equal(w.Contract, row.SourceDepositContractId);
        var tenantRefund = Assert.Single((await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await tenant.GetAsync("/api/v1/tenant/refunds"))).Items);
        Assert.Equal("SecurityDeposit", tenantRefund.SourceKind); Assert.Equal(row.Id, tenantRefund.Id); Assert.Equal("REQUESTED", tenantRefund.Status);
        Assert.Equal(0, (await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
        var report = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
        Assert.False(report.HasUnclassifiedRefunds); Assert.Equal("0", report.VerifiedDepositReturns);
        Assert.Equal("0", report.Total.OperatingExpenses); Assert.Equal("200000", report.Total.VerifiedCollections);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, sourceRoute, input)).StatusCode);
        Assert.False((await RefundValue<ContractSettlementSummary>(await owner.GetAsync(contract + "/move-out/settlement-summary"))).Resolved);
        var decisions = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Post(owner, $"/api/v1/refund-requests/{row.Id}/decision",
            new RefundDecision(1, true, "Synthetic statement/beneficiary and zero deduction verified", true))));
        Assert.Single(decisions, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(decisions, r => r.StatusCode == HttpStatusCode.Conflict);
        var approved = await RefundValue<RefundView>(decisions.Single(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal("APPROVED", approved.Status);
        await PumpNotifications();
        var pendingNotices = (await tenant.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<BHome.Application.Notifications.NotificationView>>(
            "/api/v1/notifications?category=Contract&pageSize=100"))!.Items;
        Assert.Single(pendingNotices, n => n.RelatedObjectId == w.Contract && n.Title == "Yêu cầu hoàn cọc đã được duyệt, chờ thực hiện");
        Assert.DoesNotContain(pendingNotices, n => n.RelatedObjectId == w.Contract && n.Title == "Giao dịch hoàn cọc đã được xác minh thủ công");
        var pending = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(contract + "/move-out/settlement-summary"));
        Assert.False(pending.Resolved); Assert.Equal(400000, pending.Calculation!.DepositReserved);
        await RefundValue<MoveOutView>(await Post(owner, contract + "/move-out/settlement", new SettlementInput("Still awaiting bank", pending.Reference)));
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var completionKey = Guid.NewGuid();
        (await Post(owner, contract + "/move-out/complete", new CompletionInput(today), completionKey)).EnsureSuccessStatusCode();
        using var mat = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); var bytes = mat.ImEncode(".png");
        var at = DateTimeOffset.UtcNow; var executionKey = Guid.NewGuid();
        if (interruptedUpload)
        {
            Assert.Equal(HttpStatusCode.InternalServerError, (await DepositExecute(owner, approved, executionKey, at, bytes)).StatusCode);
            var interrupted = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute));
            var intent = Assert.Single(interrupted.Requests); Assert.Equal("APPROVED", intent.Status);
            Assert.Equal(executionKey, intent.ExecutionIntent!.Key); Assert.Equal(400000, interrupted.ReservedAmount);
            Assert.False((await RefundValue<ContractSettlementSummary>(await owner.GetAsync(contract + "/move-out/settlement-summary"))).Resolved);
            using var different = new Mat(40, 100, MatType.CV_8UC3, Scalar.Black);
            Assert.Equal(HttpStatusCode.Conflict, (await DepositExecute(owner, approved, executionKey, at, different.ImEncode(".png"))).StatusCode);
        }
        var results = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => DepositExecute(owner, approved, executionKey, at, bytes)));
        foreach (var response in results) Assert.Equal("COMPLETED", (await RefundValue<RefundView>(response)).Status);
        Assert.Equal(bytes, await owner.GetByteArrayAsync($"/api/v1/refund-requests/{row.Id}/evidence"));
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"/api/v1/refund-requests/{row.Id}/evidence")).StatusCode);
        var final = await RefundValue<ContractSettlementSummary>(await tenant.GetAsync(contract + "/move-out/settlement-summary"));
        Assert.Equal(summary.FinancialReference, final.FinancialReference);
        Assert.True(final.Resolved, string.Join(',', final.UnresolvedItems)); Assert.Equal(400000, final.RefundAmount);
        Assert.Equal(0, final.ApprovedDeductions); Assert.Equal("VerifiedManual", final.TransferVerificationStatus);
        Assert.Equal(summary.FinancialReference, final.FinancialReference); Assert.NotEqual(summary.Reference, final.Reference);
        await RefundValue<MoveOutView>(await Post(owner, contract + "/move-out/settlement", new SettlementInput("Synthetic final bank statement checked", final.Reference)));
        await RefundValue<ContractView>(await Post(owner, contract + "/move-out/complete", new CompletionInput(today), completionKey));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM refund_requests WHERE source_deposit_contract_id={w.Contract} AND status='COMPLETED'").SingleAsync());
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == row.Id && a.Event == "DepositRefundCompleted"));
        var afterReturn = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
        Assert.False(afterReturn.HasUnclassifiedRefunds); Assert.Equal("400000", afterReturn.VerifiedDepositReturns);
        tenantRefund = Assert.Single((await RefundValue<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>>(await tenant.GetAsync("/api/v1/tenant/refunds"))).Items);
        Assert.Equal("COMPLETED", tenantRefund.Status); Assert.NotNull(tenantRefund.ExecutedAt);
        Assert.Equal(report.Total.OperatingExpenses, afterReturn.Total.OperatingExpenses);
        Assert.Equal(report.Total.VerifiedCollections, afterReturn.Total.VerifiedCollections);
        Assert.Equal(report.Capital.NetRecovery, afterReturn.Capital.NetRecovery);
        // A correctly classified demo return stays separate from actual financial totals.
        var history = await db.Database.SqlQuery<string>($"SELECT history::text AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync();
        var marker = System.Text.Json.Nodes.JsonNode.Parse(history)!.AsArray().Last()!.DeepClone();
        marker["state"]!["isDevelopmentDemo"] = true;
        var json = marker.ToJsonString();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({json}::jsonb) WHERE id={row.Id}");
        var demo = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
        Assert.False(demo.HasUnclassifiedRefunds); Assert.Equal("0", demo.VerifiedDepositReturns);
        Assert.Equal(afterReturn.Total, demo.Total);
        await VerifySettlementNotifications(w, false, true);
        Assert.Equal(ContractStatus.Terminated, (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).Status);
        Assert.Equal(0, (await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
    }
    internal async Task ChangedObligationsInvalidateDepositRefundApprovalAndRejectedReservationIsReleased()
    {
        var w = await Setup(); await ReadySettlementFixture(w, true); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        var contract = $"/api/v1/contracts/{w.Contract}"; var route = contract + "/deposit-refunds";
        await RefundValue<ContractId>(await Post(owner, contract + "/deposit-verifications", new DepositInput("SYN-CHANGED-" + Guid.NewGuid(), 20000, "Synthetic")));
        var source = await RefundValue<RefundSource>(await owner.GetAsync(route));
        var row = await RefundValue<RefundView>(await Post(owner, route, new DepositRefundInput(new(source.Beneficiaries[0].Id, 20000, "Synthetic", true), source.FinancialReference!, true, true)));
        await AdjustRequest(tenant, w.Invoice, 1, 90000);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/refund-requests/{row.Id}/decision", new RefundDecision(1, true, "Stale", true))).StatusCode);
        var rejected = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{row.Id}/decision", new RefundDecision(1, false, "Release after obligations changed", true)));
        Assert.Equal("REJECTED", rejected.Status);
        var changed = await RefundValue<RefundSource>(await owner.GetAsync(route)); Assert.Contains("invoice_adjustment_pending", changed.Blockers!);
        Assert.Equal(20000, changed.AvailableAmount); Assert.DoesNotContain(changed.Requests, r => r.Status != "REJECTED");
    }
    internal async Task UnclassifiedFullDepositRefundCannotAuthorizeClosureOrDuplicateReturn()
    {
        var w = await Setup(); await ReadySettlementFixture(w, true); using var owner = await Client(w.Owner);
        var contract = $"/api/v1/contracts/{w.Contract}";
        await RefundValue<ContractId>(await Post(owner, contract + "/deposit-verifications", new DepositInput("SYN-IMPORT-" + Guid.NewGuid(), 20000, "Synthetic")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var person = (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).RepresentativeResidentId;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO refund_requests(id,source_deposit_contract_id,beneficiary_resident_id,requested_by_user_id,requested_at,requested_amount,
              reason,status,decided_by_user_id,decided_at,decision_reason,executed_at,external_refund_reference,execution_evidence_key,operation_key)
            VALUES({Guid.NewGuid()},{w.Contract},{person},{w.Owner},{DateTimeOffset.UtcNow},20000,'Synthetic imported refund','COMPLETED',
              {w.Owner},{DateTimeOffset.UtcNow},'Synthetic',{DateTimeOffset.UtcNow},'SYN-UNKNOWN','synthetic/unverified',{Guid.NewGuid()});
            """);
        var summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(contract + "/move-out/settlement-summary"));
        Assert.Equal(20000, summary.Calculation!.DepositRefunded); Assert.Equal(0, summary.Calculation.AvailableSecurityDeposit);
        Assert.False(summary.Resolved); Assert.Contains("deposit_refund_manual_review_required", summary.UnresolvedItems);
        Assert.Null(summary.RefundAmount);
        var source = await RefundValue<RefundSource>(await owner.GetAsync(contract + "/deposit-refunds"));
        Assert.Contains("refund_source_requires_manual_review", source.Blockers!);
        var report = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
        Assert.True(report.HasUnclassifiedRefunds); Assert.Null(report.Total.NetOperatingCashFlow);
        Assert.Equal("0", report.VerifiedDepositReturns);
        Assert.Equal(0, source.AvailableAmount); // Unknown completed money cannot be offered for refund again.
        var input = new DepositRefundInput(new(person, 20000, "Must not pay again", true), source.FinancialReference!, true, true);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, contract + "/deposit-refunds", input)).StatusCode);
    }
}
