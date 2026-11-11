using System.Net;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    // Explicit pre-existing legacy history fixture. Never use the retired production command to manufacture historical data.
    private async Task<DepositDeductionPlan> SeedHistoricalDeduction(Workspace w, DepositDeductionInput input, ContractSettlementSummary summary, Guid key)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var inspection = await db.Set<ContractFinalInspection>().SingleAsync(i => i.ContractId == w.Contract);
        var items = DepositDeductionPolicy.Normalize(input, 999999999999999999m, input.Items.Where(i => i.AssetId != null).Select(i => i.AssetId!.Value).ToArray(), input.Items.SelectMany(i => i.EvidenceIds).ToArray());
        var normalized = input with { Reason = input.Reason.Trim(), Items = items };
        var fingerprint = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { contractId = w.Contract, input = normalized })));
        var evidence = await scope.ServiceProvider.GetRequiredService<IDepositDeductionEvidence>().CaptureAsync(w.Contract, items.SelectMany(i => i.EvidenceIds).Distinct().Order().ToArray(), default);
        var plan = new DepositDeductionPlan(Guid.NewGuid(), w.Contract, summary.DepositContractId, inspection.Id, inspection.Version,
            input.ExpectedVersion + 1, w.Owner, DateTimeOffset.UtcNow, normalized.Reason, summary.ObligationReference, items.Sum(i => i.Amount), items, evidence, key, fingerprint);
        var json = JsonSerializer.Serialize(new { recordType = "DepositDeductionV1", recordKey = plan.Id, state = plan }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history=history||jsonb_build_array({json}::jsonb) WHERE id={w.Contract}");
        db.SecurityAudit.Add(new() { UserId = w.Owner, TargetId = plan.Id, TargetType = "DepositDeduction", Event = "DepositDeductionApproved", Succeeded = true, OccurredAt = plan.ApprovedAt });
        await db.SaveChangesAsync(); return plan;
    }
    private async Task<(Workspace Workspace, Guid Proof, byte[] Photo)> DamageFixture(bool otherResidents = false)
    {
        var w = await Setup(); await ReadySettlementFixture(w, otherResidents);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); var photo = image.ImEncode(".png");
        var proof = new ContractInspectionEvidence
        {
            ContractId = w.Contract,
            UploadedByUserId = w.Staff,
            ObjectKey = "synthetic/deduction/" + Guid.NewGuid(),
            ContentType = "image/png",
            IsLinked = true
        };
        db.Add(proof);
        var inspection = await db.Set<ContractFinalInspection>().SingleAsync(i => i.ContractId == w.Contract);
        var snapshot = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot)!;
        inspection.ObservedSnapshot = JsonSerializer.Serialize(snapshot with { RoomCondition = "Synthetic damaged surface", EvidenceIds = [proof.Id] });
        inspection.NoAdditionalCharges = false;
        await db.SaveChangesAsync();
        using var content = new MemoryStream(photo);
        await scope.ServiceProvider.GetRequiredService<IObjectStorage>().PutAsync(proof.ObjectKey, content, photo.Length, "image/png", default);
        using var owner = await Client(w.Owner);
        await RefundValue<ContractId>(await Post(owner, $"/api/v1/contracts/{w.Contract}/deposit-verifications",
            new DepositInput("SYN-DAMAGE-" + Guid.NewGuid(), 400000, "Synthetic original depositor checked")));
        return (w, proof.Id, photo);
    }
    internal async Task HistoricalDamageDeductionPreservesRemainderRefundAndOriginalInvoice(decimal deduction)
    {
        var (w, proof, photo) = await DamageFixture(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var root = $"/api/v1/contracts/{w.Contract}"; var route = root + "/deposit-deductions";
        var originalInvoice = await owner.GetStringAsync($"/api/v1/invoices/{w.Invoice}");
        var before = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(root + "/move-out/settlement-summary"));
        Assert.Contains("final_charges_and_damage_policy_pending", before.UnresolvedItems);
        var input = new DepositDeductionInput(0, before.Reference, "Synthetic Owner damage decision, not billed on invoices", true,
            [new(null, "TenantDamage", deduction, "Synthetic surface repair supported by the inspection", [proof])]);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, route, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, route, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { Items = [input.Items[0] with { Amount = 400001 }] })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { Items = [input.Items[0] with { EvidenceIds = [Guid.NewGuid()] }] })).StatusCode);
        var key = Guid.NewGuid(); var historical = await SeedHistoricalDeduction(w, input, before, key);
        var replies = await Task.WhenAll(Post(owner, route, input, key), Post(owner, route, input, key));
        var plan = await RefundValue<DepositDeductionPlan>(replies[0]); Assert.Equal(plan.Id, (await RefundValue<DepositDeductionPlan>(replies[1])).Id);
        Assert.Equal(historical.Id, plan.Id);
        Assert.Equal(deduction, plan.Total); Assert.Single(plan.Evidence); Assert.Equal(64, plan.Evidence[0].Sha256.Length);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { Reason = "Changed key payload" }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input)).StatusCode);
        var summary = await RefundValue<ContractSettlementSummary>(await tenant.GetAsync(root + "/move-out/settlement-summary"));
        Assert.Equal(deduction, summary.ApprovedDeductions); Assert.Equal(deduction, summary.ApprovedFinalCharges);
        Assert.Equal(400000 - deduction, summary.Calculation!.AvailableSecurityDeposit);
        Assert.Equal(before.ObligationReference, summary.ObligationReference); Assert.NotEqual(before.FinancialReference, summary.FinancialReference);
        if (deduction < 400000)
        {
            Assert.False(summary.Resolved);
            var source = await RefundValue<RefundSource>(await owner.GetAsync(root + "/deposit-refunds"));
            Assert.Empty(source.Blockers!); Assert.Equal(400000, source.VerifiedDepositAmount); Assert.Equal(400000 - deduction, source.AvailableAmount);
            Assert.Equal(plan.Id, source.DepositDeductions!.Id);
            var request = new DepositRefundInput(new(source.Beneficiaries[0].Id, 400000 - deduction, "Synthetic return after approved damage", true), source.FinancialReference!, true, false, plan.Id, true);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/deposit-refunds", request with { ExpectedDeductionPlanId = Guid.NewGuid() })).StatusCode);
            var row = await RefundValue<RefundView>(await Post(owner, root + "/deposit-refunds", request));
            var reserved = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(root + "/move-out/settlement-summary"));
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { ExpectedVersion = 1, ExpectedReference = reserved.Reference })).StatusCode);
            var approved = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{row.Id}/decision", new RefundDecision(1, true, "Synthetic verified deduction and payee", true)));
            await RefundValue<RefundView>(await DepositExecute(owner, approved, Guid.NewGuid(), DateTimeOffset.UtcNow, photo));
            summary = await RefundValue<ContractSettlementSummary>(await tenant.GetAsync(root + "/move-out/settlement-summary"));
        }
        Assert.True(summary.Resolved, string.Join(',', summary.UnresolvedItems)); Assert.Equal(400000 - deduction, summary.RefundAmount);
        Assert.Equal(deduction == 400000 ? "NotRequired" : "VerifiedManual", summary.TransferVerificationStatus);
        Assert.Equal(0, summary.Calculation!.AvailableSecurityDeposit);
        await RefundValue<MoveOutView>(await Post(owner, root + "/move-out/settlement", new SettlementInput("Synthetic final checks", summary.Reference)));
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await RefundValue<ContractView>(await Post(owner, root + "/move-out/complete", new CompletionInput(today)));
        Assert.Equal(originalInvoice, await owner.GetStringAsync($"/api/v1/invoices/{w.Invoice}"));
        var report = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
        Assert.False(report.HasUnclassifiedRefunds);
        Assert.Equal((400000 - deduction).ToString(System.Globalization.CultureInfo.InvariantCulture), report.VerifiedDepositReturns);
        Assert.Equal("200000", report.Total.VerifiedCollections); Assert.Equal("0", report.Total.OperatingExpenses);
        Assert.Equal("200000", report.Total.OperatingProfit); Assert.Equal("200000", report.Total.NetOperatingCashFlow);
        var future = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2100-01-01&to=2100-12-31"));
        Assert.Equal("0", future.VerifiedDepositReturns);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == plan.Id && a.Event == "DepositDeductionApproved"));
        var room = await db.Set<BHome.Domain.PropertyManagement.Room>().SingleAsync(r => r.Id == w.Room);
        var emptyRoom = new BHome.Domain.PropertyManagement.Room
        {
            LocationId = w.Location,
            RoomTypeId = room.RoomTypeId,
            RoomNumber = "SYN-OTHER",
            Capacity = 1,
            Status = BHome.Domain.PropertyManagement.RoomStatus.Available
        };
        db.Add(emptyRoom); await db.SaveChangesAsync();
        var otherRoom = await RefundValue<FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&roomId={emptyRoom.Id}"));
        Assert.Equal("0", otherRoom.VerifiedDepositReturns);
        var scoped = await RefundValue<FinancialReport>(await owner.GetAsync($"/api/v1/financial-reports?from=2000-01-01&to=2100-12-31&locationId={w.Location}&roomId={w.Room}"));
        Assert.Equal(report.VerifiedDepositReturns, scoped.VerifiedDepositReturns);
        await VerifySettlementNotifications(w, true, deduction < 400000);
    }
    internal async Task HistoricalDamageDeductionVersionsRemainReadableAndTamperedEvidenceCannotSettle()
    {
        var (w, proof, _) = await DamageFixture(); using var owner = await Client(w.Owner);
        var root = $"/api/v1/contracts/{w.Contract}"; var route = root + "/deposit-deductions";
        var summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(root + "/move-out/settlement-summary"));
        var input = new DepositDeductionInput(0, summary.Reference, "Synthetic decision", true, [new(null, "TenantDamage", 400000, "Synthetic damage", [proof])]);
        var competing = await Task.WhenAll(Post(owner, route, input), Post(owner, route, input));
        Assert.All(competing, r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        var first = await SeedHistoricalDeduction(w, input, summary, Guid.NewGuid());
        summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(root + "/move-out/settlement-summary"));
        var revision = input with { ExpectedVersion = 1, ExpectedReference = summary.Reference, Reason = "Synthetic historical re-evaluation" };
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, revision)).StatusCode);
        var revised = await SeedHistoricalDeduction(w, revision, summary, Guid.NewGuid());
        Assert.Equal(2, revised.Version); Assert.NotEqual(first.Id, revised.Id);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(2, await db.Database.SqlQuery<int>($"SELECT jsonb_array_length(jsonb_path_query_array(history,'$[*] ? (@.recordType == \"DepositDeductionV1\")')) AS \"Value\" FROM contracts WHERE id={w.Contract}").SingleAsync());
        var file = await db.Set<ContractInspectionEvidence>().SingleAsync(e => e.Id == proof);
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.Black); var changed = image.ImEncode(".png");
        using var bytes = new MemoryStream(changed);
        await scope.ServiceProvider.GetRequiredService<IObjectStorage>().PutAsync(file.ObjectKey, bytes, changed.Length, "image/png", default);
        summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync(root + "/move-out/settlement-summary"));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/move-out/settlement", new SettlementInput("Must reject corrupted proof", summary.Reference))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync(root + "/deposit-refunds")).StatusCode);
        Assert.Equal("Active", (await RefundValue<ContractView>(await owner.GetAsync(root))).Status);
    }
}
