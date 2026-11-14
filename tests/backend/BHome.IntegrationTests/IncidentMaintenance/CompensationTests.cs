using System.Net;
using System.Net.Http.Json;
using BHome.Application.IncidentMaintenance;
using BHome.Application.PaymentsDebt;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.IncidentMaintenance;

public sealed partial class IncidentApiTests
{
    [CompactPostgresFact]
    public async Task DepositCompensationWaitsForMoveOutAndDeductsExactlyOnceWithBalanceRecheck()
    {
        var (w, id, evidence) = await VerifiedMaintenance(100000);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            db.Add(new BHome.Domain.TenantContracts.DepositVerification
            {
                ContractId = w.Contract,
                Amount = 100000,
                BankTransactionReference = "SYNTHETIC-BF07-" + Guid.NewGuid().ToString("N"),
                VerificationReason = "Isolated fixture bank deposit",
                VerifiedAt = DateTimeOffset.UtcNow,
                VerifiedByUserId = w.Owner.Id
            });
            await db.SaveChangesAsync();
        }
        var input = new CompensationInput(w.Contract, 50000, "Deposit", null, "Owner approved room damage", [evidence]);
        var row = await Ok<CompensationView>(await Send(w.Owner, $"{Orders}/{id}/compensation", input));
        Assert.Equal("DepositPending", row.Status); Assert.Null(row.InvoiceId);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Orders}/{id}/compensation/deduct", new CompensationDecision(row.Version, "Too early"))).StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            db.Add(new BHome.Domain.TenantContracts.ContractMoveOut
            {
                ContractId = w.Contract,
                ProposedDate = Today,
                ApprovedAt = DateTimeOffset.UtcNow,
                ApprovedByUserId = w.Owner.Id,
                RequestedByUserId = w.Tenant.Id,
                Status = BHome.Domain.TenantContracts.MoveOutStatus.Inspected,
                Reason = "Synthetic move-out"
            });
            db.Add(new BHome.Domain.TenantContracts.ContractFinalInspection
            {
                ContractId = w.Contract,
                BaselineContractId = w.Contract,
                Version = 1,
                BaselineVersion = 1,
                StaffId = w.Staff.Id,
                InspectedAt = DateTimeOffset.UtcNow,
                OwnerDecision = "Confirmed",
                OwnerId = w.Owner.Id,
                ReviewedAt = DateTimeOffset.UtcNow,
                OwnerReason = "Inspected fixture"
            });
            await db.SaveChangesAsync();
        }
        var key = Guid.NewGuid(); var decision = new CompensationDecision(row.Version, "Deduct entire approved obligation at settlement");
        var deducted = await Ok<CompensationView>(await Send(w.Owner, $"{Orders}/{id}/compensation/deduct", decision, key));
        Assert.Equal("Deducted", deducted.Status);
        var history = (await w.Owner.Client.GetFromJsonAsync<CompensationView[]>($"{Orders}/{id}/compensation/history"))!;
        Assert.Equal(2, history.Length); Assert.All(history, item => Assert.Equal(row.Id, item.Id));
        Assert.Contains(history, item => item.Status == "DepositPending" && item.Reason == input.Reason);
        Assert.Equal(deducted, await Ok<CompensationView>(await Send(w.Owner, $"{Orders}/{id}/compensation/deduct", decision, key)));
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Orders}/{id}/compensation/cancel", new CompensationDecision(deducted.Version, "Unsupported reversal"))).StatusCode);
        await using var verify = fixture.Factory.Services.CreateAsyncScope();
        var context = verify.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.False(await context.Set<BHome.Domain.Billing.Invoice>().AnyAsync(i => i.RepresentativeContractId == w.Contract));
        Assert.Equal(50000, (await context.Set<MaintenanceCompensation>().SingleAsync(c => c.WorkOrderId == id)).Amount);
    }

    private async Task<(Workspace Workspace, Guid WorkOrder, Guid Evidence)> VerifiedMaintenance(decimal requiredDeposit = 0)
    {
        var w = await Setup(requiredDeposit: requiredDeposit);
        var created = await Ok<IncidentCommandResult>(await Send(w.Owner, Orders, Proactive(w)));
        var id = created.WorkOrderId!.Value;
        await ProposeAndStart(w, id);
        using var upload = new HttpRequestMessage(HttpMethod.Put, $"{Orders}/{id}/evidence?kind=Completion") { Content = new ByteArrayContent(Image()) };
        upload.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var evidence = (await Ok<IncidentCommandResult>(await w.Staff.Client.SendAsync(upload))).ResourceId!.Value;
        var work = (await Work(w.Staff, id))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{id}/submit", new WorkOrderAction(work.Version, "Synthetic repair completed", [evidence])));
        await Ok<IncidentCommandResult>(await Verify(w, id));
        return (w, id, evidence);
    }

    [CompactPostgresFact]
    public async Task CompensationIssuesExclusiveAdHocInvoiceAndUsesExistingPaymentLedger()
    {
        var (w, id, evidence) = await VerifiedMaintenance();
        var input = new CompensationInput(w.Contract, 50000, "Invoice", Today.AddDays(7), "Owner confirms evidence of tenant damage", [evidence]);
        var key = Guid.NewGuid();
        var row = await Ok<CompensationView>(await Send(w.Owner, $"{Orders}/{id}/compensation", input, key));
        Assert.Equal(row, await Ok<CompensationView>(await Send(w.Owner, $"{Orders}/{id}/compensation", input, key)));
        Assert.NotNull(row.InvoiceId);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Orders}/{id}/compensation", input with { CollectionMethod = "Deposit", DueDate = null })).StatusCode);
        var path = $"/api/v1/invoices/{row.InvoiceId}/payment";
        var payment = (await w.Tenant.Client.GetFromJsonAsync<InvoicePaymentView>(path))!;
        Assert.Equal("Unpaid", payment.PaymentStatus); Assert.Equal(50000, payment.OutstandingAmount); Assert.NotEmpty(payment.TransferReference);
        var bank = new ReceivingAccountInput(w.Location, "970415", "000000000000", "BHOME SYNTHETIC BF07", true, true, true, 0);
        (await w.Owner.Client.PutAsJsonAsync("/api/v1/receiving-bank-accounts", bank)).EnsureSuccessStatusCode();
        var instructions = (await w.Tenant.Client.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{row.InvoiceId}/transfer-instructions"))!;
        Assert.Equal("Available", instructions.Availability);
        Assert.StartsWith("data:image/png;base64,", instructions.QrImageDataUri);
        Assert.Equal(50000, instructions.OutstandingAmount);
        var other = await Setup();
        Assert.Equal(HttpStatusCode.NotFound, (await other.Tenant.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync($"{Orders}/{id}/compensation")).StatusCode);
        var transfer = await Ok<TransferView>(await Send(w.Owner, "/api/v1/payment-transactions", new PaymentTransferInput(
            "SYNTHETIC:BF07", Guid.NewGuid().ToString("N"), 50000, "VND", DateTimeOffset.UtcNow.AddMinutes(-1), payment.TransferReference,
            "Synthetic isolated bank statement", "Owner verified synthetic fixture", row.InvoiceId, true)));
        await Ok<object>(await Send(w.Owner, $"/api/v1/payment-transactions/{transfer.Id}/allocate", new PaymentMatchInput(row.InvoiceId!.Value, w.Tenant.Id, true)));
        payment = (await w.Tenant.Client.GetFromJsonAsync<InvoicePaymentView>(path))!;
        Assert.Equal("Paid", payment.PaymentStatus); Assert.Equal(0, payment.OutstandingAmount); Assert.Single(payment.History);
        Assert.Equal("Settled", (await w.Tenant.Client.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{row.InvoiceId}/transfer-instructions"))!.Availability);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Orders}/{id}/compensation/cancel", new CompensationDecision(row.Version, "Unsupported post-payment reversal"))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var invoice = await db.Set<BHome.Domain.Billing.Invoice>().SingleAsync(i => i.Id == row.InvoiceId);
        Assert.Equal("AD_HOC", invoice.Type);
        Assert.Single(await db.Set<MaintenanceCompensation>().Where(c => c.WorkOrderId == id).ToArrayAsync());
    }

    [CompactPostgresFact]
    public async Task CompensationRejectsExcessAmountWrongContractAndInsufficientDeposit()
    {
        var (w, id, evidence) = await VerifiedMaintenance(); var other = await Setup();
        var input = new CompensationInput(w.Contract, 50000, "Deposit", null, "Synthetic damage decision", [evidence]);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Orders}/{id}/compensation", input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(w.Owner, $"{Orders}/{id}/compensation", input with { ContractId = other.Contract })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Orders}/{id}/compensation", input with { Amount = 100001 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Tenant, $"{Orders}/{id}/compensation", input)).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        Assert.Empty(await scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Set<MaintenanceCompensation>().Where(c => c.WorkOrderId == id).ToArrayAsync());
    }
}
