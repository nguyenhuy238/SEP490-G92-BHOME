using System.Net;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    internal async Task CanonicalDepositIsUsedByReadinessHistoryAndSettlement()
    {
        var w = await Setup(); await ReadySettlementFixture(w, false, agreedDeposit: 100000);
        using var owner = await Client(w.Owner);
        var transfer = await As(w.Owner, BHome.Domain.IdentityAccess.Roles.Owner, s => s.RegisterAsync(Input(w, 80000, memo: PaymentRules.DepositReference(w.Contract)) with { ProposedInvoiceId = null, ProposedDepositContractId = w.Contract }, Guid.NewGuid(), default));
        var root = $"/api/v1/payment-transactions/{transfer.Id}";
        var context = await RefundValue<DepositAllocationContext>(await owner.GetAsync(root + "/deposit-context?contractId=" + w.Contract));
        var payer = Assert.Single(context.Payers);
        await RefundValue<PaymentReviewResult>(await Post(owner, root + "/allocate-deposit", new PaymentDepositMatchInput(w.Contract, payer.UserId, true, payer.ResidentId, ExpectedReference: context.Reference)));
        var readiness = await RefundValue<ActivationReadiness>(await owner.GetAsync($"/api/v1/contracts/{w.Contract}/activation-readiness"));
        Assert.Equal(80000, readiness.VerifiedDeposit); Assert.Equal(20000, readiness.RemainingDeposit);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var workflow = scope.ServiceProvider.GetRequiredService<IContractWorkflowRepository>();
        var history = Assert.Single(await workflow.DepositsAsync(w.Contract, default)); Assert.Equal(80000, history.Amount); Assert.Equal(transfer.BankReference, history.BankTransactionReference);
        var summary = await RefundValue<ContractSettlementSummary>(await owner.GetAsync($"/api/v1/contracts/{w.Contract}/move-out/settlement-summary"));
        Assert.Equal(80000, summary.VerifiedSecurityDeposit); Assert.Equal(80000, summary.Calculation!.AvailableSecurityDeposit); Assert.True(summary.Calculation.DepositPositionConsistent);
    }
    internal async Task DepositReceiptPreservesPartialFundsAndReturnsExcessToActualPayer(bool holding, bool external)
    {
        var w = await Setup(); Guid contractId, payerId, representativeId;
        await using (var seed = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var room = new Room { LocationId = w.Location, RoomNumber = "SYN-DEP-" + Guid.NewGuid().ToString("N")[..8], Capacity = 2, Status = RoomStatus.Available };
            var payer = new Resident { RoomId = room.Id, OwnerUserId = w.Owner, DisplayLabel = "SYNTHETIC ACTUAL DEPOSITOR", ContactEmail = Guid.NewGuid() + "@example.invalid", VerificationStatus = IdentityVerificationStatus.Verified };
            var representative = new Resident { RoomId = room.Id, OwnerUserId = w.Owner, DisplayLabel = "SYNTHETIC REPRESENTATIVE", ContactEmail = Guid.NewGuid() + "@example.invalid", VerificationStatus = IdentityVerificationStatus.Verified };
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var contract = new Contract
            {
                RoomId = room.Id,
                OwnerSignerId = w.Owner,
                RepresentativeResidentId = representative.Id,
                Kind = holding ? ContractKind.Holding : ContractKind.Main,
                Status = ContractStatus.PendingSigning,
                RequiredDeposit = 100000,
                MonthlyRent = 100000,
                Terms = "Synthetic agreed deposit",
                StartDate = today,
                EndDate = today.AddMonths(12),
                HoldingExpiryAt = holding ? DateTimeOffset.UtcNow.AddDays(2) : null,
                ApprovedAt = holding ? DateTimeOffset.UtcNow : null,
                ApprovedByUserId = holding ? w.Owner : null,
                Residents = [new() { ResidentId = representative.Id, Role = ResidentType.Representative, ResidenceFrom = today }, new() { ResidentId = payer.Id, Role = ResidentType.CoOccupant, ResidenceFrom = today }]
            };
            db.AddRange(room, payer, representative, contract); await db.SaveChangesAsync(); contractId = contract.Id; payerId = payer.Id; representativeId = representative.Id;
        }
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var check = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var users = await check.Users.CountAsync(); var residents = await check.Set<Resident>().CountAsync();
        async Task<(TransferView Transfer, Guid? ExternalId)> Receipt(decimal amount)
        {
            var transfer = await As(w.Owner, BHome.Domain.IdentityAccess.Roles.Owner, s => s.RegisterAsync(Input(w, amount, memo: PaymentRules.DepositReference(contractId)) with { ProposedInvoiceId = null, ProposedDepositContractId = contractId }, Guid.NewGuid(), default));
            if (!external) return (transfer, null);
            var path = $"/api/v1/payment-transactions/{transfer.Id}/external-payer";
            var source = await RefundValue<ExternalPaymentPayerContext>(await owner.GetAsync(path));
            var attestation = await RefundValue<ExternalPaymentPayer>(await Post(owner, path, new ExternalPaymentPayerInput(source.TransferFingerprint, "SYNTHETIC OUTSIDE DEPOSITOR", "Synthetic bank statement owner check", true, true)));
            return (transfer, attestation.Id);
        }
        async Task Allocate(TransferView receipt, Guid? externalId, decimal expected)
        {
            var root = $"/api/v1/payment-transactions/{receipt.Id}";
            var contextPath = root + "/deposit-context?contractId=" + contractId;
            Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(contextPath)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(contextPath)).StatusCode);
            var context = await RefundValue<DepositAllocationContext>(await owner.GetAsync(contextPath)); Assert.Empty(context.Problems);
            Assert.Equal(expected.ToString("0", System.Globalization.CultureInfo.InvariantCulture), context.ProposedAllocation);
            if (!external) Assert.All(context.Payers, p => Assert.Null(p.UserId));
            var input = new PaymentDepositMatchInput(contractId, null, true, external ? null : payerId, externalId, context.Reference);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, root + "/allocate-deposit", input with { HumanVerified = false })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, root + "/allocate-deposit", input)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/allocate-deposit", input with { ExpectedReference = "STALE" })).StatusCode);
            var key = Guid.NewGuid(); var replies = await Task.WhenAll(Post(owner, root + "/allocate-deposit", input, key), Post(owner, root + "/allocate-deposit", input, key));
            foreach (var reply in replies) Assert.Equal("Allocated", (await RefundValue<PaymentReviewResult>(reply)).Status);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, root + "/allocate-deposit", input with { ExpectedReference = "DIFFERENT" }, key)).StatusCode);
            var saved = await RefundValue<TransferView>(await owner.GetAsync(root)); Assert.Equal(expected, saved.AllocatedAmount); Assert.Equal(receipt.Amount - expected, saved.UnallocatedAmount);
        }
        var first = await Receipt(60000); await Allocate(first.Transfer, first.ExternalId, 60000);
        var positionPath = $"/api/v1/contracts/{contractId}/deposit-payment";
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(positionPath)).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(positionPath)).StatusCode);
        var position = await RefundValue<ContractDepositPosition>(await owner.GetAsync(positionPath));
        Assert.Equal(PaymentRules.DepositReference(contractId), position.TransferReference); Assert.Equal("60000", position.Received); Assert.Equal("40000", position.Remaining);
        var contractRoom = await check.Set<Contract>().Where(c => c.Id == contractId).Select(c => c.RoomId).SingleAsync();
        var obligations = await scope.ServiceProvider.GetRequiredService<BHome.Application.PropertyManagement.IPropertyRepository>()
            .ObligationsAsync(w.Location, contractRoom, DateOnly.FromDateTime(DateTime.UtcNow), default);
        Assert.True(obligations.HasBindingPendingContracts);
        var second = await Receipt(80000); await Allocate(second.Transfer, second.ExternalId, 40000);
        Assert.Equal(100000, await check.Database.SqlQuery<decimal>($"SELECT sum(amount) AS \"Value\" FROM payment_allocations WHERE target_deposit_contract_id={contractId}").SingleAsync());
        var history = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TransferView>>(await owner.GetAsync("/api/v1/payment-transactions?depositContractId=" + contractId)); Assert.Equal(2, history.TotalCount);
        var sourceRoute = $"/api/v1/payment-transactions/{second.Transfer.Id}/refunds";
        var source = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute)); Assert.Equal(40000, source.AvailableAmount);
        if (external) { Assert.Empty(source.Beneficiaries); Assert.Equal(second.ExternalId, source.ExternalBeneficiary!.AttestationId); }
        else { Assert.Equal(payerId, Assert.Single(source.Beneficiaries).Id); Assert.DoesNotContain(source.Beneficiaries, p => p.Id == representativeId); }
        if (!external)
        {
            var payerContext = await RefundValue<ExternalPaymentPayerContext>(await owner.GetAsync($"/api/v1/payment-transactions/{second.Transfer.Id}/external-payer"));
            Assert.Contains("receipt_payer_already_linked", payerContext.Problems);
            var wrongNative = await Assert.ThrowsAsync<PostgresException>(() => check.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,requested_amount,reason,status,operation_key)
                VALUES({Guid.NewGuid()},{second.Transfer.Id},{representativeId},{w.Owner},{DateTimeOffset.UtcNow},40000,'Synthetic wrong depositor','REQUESTED',{Guid.NewGuid()})
                """)); Assert.Equal("23514", wrongNative.SqlState);
        }
        var wrongPayer = await Post(owner, sourceRoute, new RefundInput(representativeId, 40000, "Wrong depositor", true));
        Assert.Equal(HttpStatusCode.Conflict, wrongPayer.StatusCode); Assert.Contains("refund_verified_payer_required", await wrongPayer.Content.ReadAsStringAsync());
        var refundInput = new RefundInput(external ? null : payerId, 40000, "Synthetic refund to actual depositor", true, second.ExternalId);
        var requests = await Task.WhenAll(Post(owner, sourceRoute, refundInput), Post(owner, sourceRoute, refundInput));
        Assert.Single(requests, r => r.IsSuccessStatusCode); Assert.Single(requests, r => r.StatusCode == HttpStatusCode.Conflict);
        var refund = await RefundValue<RefundView>(requests.Single(r => r.IsSuccessStatusCode));
        var approved = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(refund.Version, true, "Synthetic exact payer verified", true)));
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        Assert.Equal("COMPLETED", (await RefundValue<RefundView>(await DepositExecute(owner, approved, Guid.NewGuid(), DateTimeOffset.UtcNow, image.ImEncode(".png")))).Status);
        Assert.Equal(0, (await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
        var report = await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
        Assert.False(report.HasUnclassifiedRefunds); Assert.Equal("0", report.Total.OperatingExpenses); Assert.Equal("0", report.Total.VerifiedCollections);
        Assert.Equal(users, await check.Users.CountAsync()); Assert.Equal(residents, await check.Set<Resident>().CountAsync());
        Assert.Null((await check.Set<Resident>().SingleAsync(r => r.Id == payerId)).TenantUserId);
        var extra = await Receipt(1);
        var contextAfter = await RefundValue<DepositAllocationContext>(await owner.GetAsync($"/api/v1/payment-transactions/{extra.Transfer.Id}/deposit-context?contractId={contractId}")); Assert.Contains("deposit_already_satisfied", contextAfter.Problems);
        var error = await Assert.ThrowsAsync<PostgresException>(() => check.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
            VALUES({Guid.NewGuid()},{extra.Transfer.Id},{contractId},1,{Guid.NewGuid()},1,{w.Owner},{DateTimeOffset.UtcNow},'Synthetic attempted over-credit')
            """)); Assert.Equal("23514", error.SqlState);
        var tamper = await Assert.ThrowsAsync<PostgresException>(() => check.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments SET history=(SELECT jsonb_agg(h) FROM jsonb_array_elements(history) h WHERE h->>'recordType'<>'DepositReceiptAllocationV1') WHERE id={second.Transfer.Id}"));
        Assert.Equal("P0001", tamper.SqlState); Assert.Contains("must only be appended", tamper.MessageText);
        var appendTamper = await Assert.ThrowsAsync<PostgresException>(() => check.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE payments SET history=history||(SELECT jsonb_agg(h) FROM jsonb_array_elements(history) h WHERE h->>'recordType'='DepositReceiptAllocationV1') WHERE id={second.Transfer.Id}
            """)); Assert.Equal("23514", appendTamper.SqlState);
    }
}
