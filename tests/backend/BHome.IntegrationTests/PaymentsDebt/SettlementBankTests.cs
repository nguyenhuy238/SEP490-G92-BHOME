using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    internal async Task SettlementBankPaymentsPreservePartialDebtAndRefundExcessToActualPayer()
    {
        var (w, proof, photo) = await DamageFixture(true); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[2]);
        var route = $"/api/v1/contracts/{w.Contract}/move-out/receivables";
        var view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var inspection = await db.Set<ContractFinalInspection>().SingleAsync(i => i.ContractId == w.Contract);
        var charge = await RefundValue<SettlementReceivable>(await Post(owner, route + "/damage",
            new DamageChargeInput(view.Reference, inspection.Id, inspection.Version, null, 600000, "Synthetic repair", [proof], true)));
        var instructionsRoute = route + $"/{charge.Id}/transfer-instructions";
        var instructions = await RefundValue<SettlementTransferInstructions>(await tenant.GetAsync(instructionsRoute));
        Assert.Equal("ReceivingAccountUnavailable", instructions.Availability); Assert.Null(instructions.AccountNumber);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts", new ReceivingAccountInput(w.Location, "970436", "000000000000", "SYNTHETIC TEST ACCOUNT", true, false, true, 0))).EnsureSuccessStatusCode();
        instructions = await RefundValue<SettlementTransferInstructions>(await tenant.GetAsync(instructionsRoute));
        Assert.Contains(instructions.Availability, new[] { "Available", "InstructionsOnly" });
        Assert.Equal(600000, instructions.OutstandingAmount); Assert.Equal(PaymentRules.InvoiceReference(charge.Id), instructions.TransferReference);
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        await RefundValue<DepositOffsetApproval>(await Post(owner, route + "/deposit-offsets", new DepositOffsetInput(view.Reference, charge.Id, null, 400000, "Synthetic Owner offset", true)));
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await RefundValue<ContractView>(await Post(owner, $"/api/v1/contracts/{w.Contract}/move-out/complete", new CompletionInput(today)));
        var bankRoute = route + $"/{charge.Id}/bank-allocations";
        async Task<TransferView> Incoming(decimal amount, string? description = null, string? bankReference = null, string provider = "SYNTHETIC-SETTLEMENT") =>
            await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w, amount) with
            {
                ProviderIdentity = provider,
                ProposedInvoiceId = null,
                TransferDescription = description ?? PaymentRules.InvoiceReference(charge.Id),
                BankReference = bankReference ?? "SYN-CHARGE-" + Guid.NewGuid()
            }, Guid.NewGuid(), default));
        var wrong = await Incoming(1, "UNMATCHED"); view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        var wrongInput = new SettlementBankAllocationInput(view.Reference, wrong.Id, w.Tenants[2], true);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, bankRoute, wrongInput)).StatusCode);
        var pending = await RefundValue<SettlementBankAllocationResult>(await Post(owner, bankRoute, wrongInput));
        Assert.Equal("PendingReview", pending.Status); Assert.Equal(0, pending.AllocatedAmount);
        var incoming = await Incoming(50000); view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        var input = new SettlementBankAllocationInput(view.Reference, incoming.Id, w.Tenants[2], true); var key = Guid.NewGuid();
        var responses = await Task.WhenAll(Post(owner, bankRoute, input, key), Post(owner, bankRoute, input, key));
        var partial = await RefundValue<SettlementBankAllocationResult>(responses[0]);
        Assert.Equal(partial.Id, (await RefundValue<SettlementBankAllocationResult>(responses[1])).Id);
        Assert.Equal(50000, partial.AllocatedAmount); Assert.Equal(0, partial.UnallocatedAmount);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, bankRoute, input with { PaidByUserId = w.Tenants[0] }, key)).StatusCode);
        view = await RefundValue<SettlementReceivablesView>(await tenant.GetAsync(route)); Assert.Equal(150000, Assert.Single(view.Receivables).Outstanding);
        var duplicate = await Incoming(50000, bankReference: incoming.BankReference, provider: "SYNTHETIC-OTHER");
        view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        Assert.Equal("PendingReview", (await RefundValue<SettlementBankAllocationResult>(await Post(owner, bankRoute,
            new SettlementBankAllocationInput(view.Reference, duplicate.Id, w.Tenants[2], true)))).Status);
        var excess = await Incoming(200000); view = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        var paid = await RefundValue<SettlementBankAllocationResult>(await Post(owner, bankRoute, new SettlementBankAllocationInput(view.Reference, excess.Id, w.Tenants[2], true)));
        Assert.Equal(150000, paid.AllocatedAmount); Assert.Equal(50000, paid.UnallocatedAmount);
        view = await RefundValue<SettlementReceivablesView>(await tenant.GetAsync(route));
        Assert.Equal("Paid", view.Receivables[0].Status); Assert.Equal(0, view.Receivables[0].Outstanding);
        Assert.Equal("Settled", (await RefundValue<SettlementTransferInstructions>(await tenant.GetAsync(instructionsRoute))).Availability);
        var receipt = await RefundValue<TransferView>(await owner.GetAsync($"/api/v1/payment-transactions/{excess.Id}"));
        Assert.Equal(w.Contract, receipt.AllocatedSettlementContractId); Assert.Equal(charge.Id, receipt.AllocatedSettlementReceivableId);
        var history = await RefundValue<BHome.Application.PropertyManagement.PagedResult<TransferView>>(await owner.GetAsync($"/api/v1/payment-transactions?settlementContractId={w.Contract}&paymentStatus=Allocated&pageSize=20"));
        Assert.Equal(2, history.TotalCount); Assert.All(history.Items, t => Assert.Equal(w.Contract, t.AllocatedSettlementContractId));
        var sourceRoute = $"/api/v1/payment-transactions/{excess.Id}/refunds";
        var source = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute)); Assert.Equal(50000, source.AvailableAmount);
        var actualPayer = await db.Set<Resident>().AsNoTracking().SingleAsync(r => r.TenantUserId == w.Tenants[2]);
        Assert.Equal(actualPayer.Id, Assert.Single(source.Beneficiaries).Id);
        var refund = await RefundValue<RefundView>(await Post(owner, sourceRoute, new RefundInput(actualPayer.Id, 50000, "Synthetic actual payer excess return", true)));
        refund = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{refund.Id}/decision", new RefundDecision(refund.Version, true, "Synthetic bank payer checked", true)));
        await RefundValue<RefundView>(await DepositExecute(owner, refund, Guid.NewGuid(), DateTimeOffset.UtcNow, photo));
        Assert.Equal(0, (await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
        Assert.False((await RefundValue<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"))).HasUnclassifiedRefunds);
        Assert.Equal(2, await db.Set<PaymentAllocation>().CountAsync(a => a.SettlementReceivableId == charge.Id && a.TransferId != null));
        var notices = await db.Set<BHome.Domain.Notifications.UserNotification>().Where(n => n.RelatedObjectType == "SettlementReceivable" && n.RelatedObjectId == charge.Id).ToArrayAsync();
        Assert.Equal(charge.RecipientUserIds.Length * 4, notices.Length); // charge, offset and two payments; replay/mismatch produce none.
        Assert.All(notices, n => { Assert.Contains("IN_APP", n.Channels); Assert.Contains("EMAIL", n.Channels); Assert.DoesNotContain(incoming.BankReference, n.Summary); });
        var target = await RefundValue<BHome.Application.Notifications.NotificationTarget>(await tenant.GetAsync($"/api/v1/notifications/{notices.First(n => n.RecipientUserId == w.Tenants[2]).Id}/target"));
        Assert.Equal("SettlementReceivable", target.ObjectType); Assert.Equal(charge.Id, target.ObjectId);
    }
}
