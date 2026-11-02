using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    private async Task<HttpClient> Client(Guid actor)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var email = await db.Users.Where(u => u.Id == actor).Select(u => u.Email).SingleAsync();
        var client = fixture.Factory.CreateClient(); var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "Synthetic-Payment-Test!123" });
        login.EnsureSuccessStatusCode(); var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken); return client;
    }
    private static async Task<HttpResponseMessage> Post(HttpClient client, string route, object body, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await client.SendAsync(request);
    }
    [Fact]
    public async Task OwnerApiReconcilesPersistedInvoiceAndRejectsUnmatchedTransferWithHistory()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        const string root = "/api/v1/payment-transactions"; var input = Input(w) with { ProposedInvoiceId = null, Amount = 100000.00m };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(root, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, root, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(root)).StatusCode);
        var key = Guid.NewGuid(); var registration = await Post(owner, root, input, key); registration.EnsureSuccessStatusCode();
        var transfer = (await registration.Content.ReadFromJsonAsync<TransferView>())!;
        Assert.Equal("PendingReview", transfer.Status);
        var unpaidBody = await owner.GetStringAsync($"/api/v1/debts?roomId={w.Room}");
        using (var json = System.Text.Json.JsonDocument.Parse(unpaidBody))
            Assert.Equal("100000", json.RootElement.GetProperty("items")[0].GetProperty("outstandingAmount").GetString());
        Assert.Equal(transfer.Id, (await (await Post(owner, root, input, key)).Content.ReadFromJsonAsync<TransferView>())!.Id);
        var allocation = await Post(owner, $"{root}/{transfer.Id}/allocate", new PaymentMatchInput(w.Invoice, w.Tenants[0], true)); allocation.EnsureSuccessStatusCode();
        Assert.Equal("Allocated", (await allocation.Content.ReadFromJsonAsync<PaymentReviewResult>())!.Status);
        var scoped = (await owner.GetFromJsonAsync<PagedResult<TransferView>>($"{root}?locationId={w.Location}&roomId={w.Room}"))!;
        Assert.Contains(scoped.Items, p => p.Id == transfer.Id && p.AllocatedInvoiceId == w.Invoice);
        var unrelated = (await owner.GetFromJsonAsync<PagedResult<TransferView>>($"{root}?roomId={Guid.NewGuid()}"))!;
        Assert.Empty(unrelated.Items);
        var view = (await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{w.Invoice}/payment"))!;
        Assert.Equal("Paid", view.PaymentStatus);
        var unknown = await Post(owner, root, Input(w, memo: "WRONG-REFERENCE") with { ProposedInvoiceId = null }); unknown.EnsureSuccessStatusCode();
        var unmatched = (await unknown.Content.ReadFromJsonAsync<TransferView>())!;
        Assert.Equal("invoice_already_settled", (await (await Post(owner, $"{root}/{unmatched.Id}/allocate", new PaymentMatchInput(w.Invoice, null, true))).Content.ReadFromJsonAsync<PaymentReviewResult>())!.Reason);
        var rejected = await Post(owner, $"{root}/{unmatched.Id}/reject", new PaymentRejectInput("Không đủ bằng chứng để phân bổ; giao dịch được giữ lại.")); rejected.EnsureSuccessStatusCode();
        Assert.Equal("Rejected", (await owner.GetFromJsonAsync<TransferView>($"{root}/{unmatched.Id}"))!.Status);
        var history = (await owner.GetFromJsonAsync<PagedResult<ReconciliationView>>($"{root}/{unmatched.Id}/reconciliation-history"))!;
        Assert.Equal(3, history.TotalCount); Assert.Equal("Rejected", history.Items[0].Decision);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"{root}/{transfer.Id}/reject", new PaymentRejectInput("Cannot undo an allocation"))).StatusCode);
        var listing = (await owner.GetFromJsonAsync<PagedResult<TransferView>>(root))!;
        Assert.Contains(listing.Items, p => p.Id == transfer.Id && p.Status == "Allocated");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync(root + "?page=0")).StatusCode);
    }
    [Fact]
    public async Task SharedTenantStatusAndHistoricalAccessStayScopedWithoutLeakingStatementOrAnotherPayerIdentity()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var a = await Client(w.Tenants[0]); using var b = await Client(w.Tenants[1]); using var c = await Client(w.Tenants[2]);
        var path = $"/api/v1/invoices/{w.Invoice}/payment";
        var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(Input(w), Guid.NewGuid(), default));
        await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        foreach (var client in new[] { a, b, c })
        {
            var payment = (await client.GetFromJsonAsync<InvoicePaymentView>(path))!;
            Assert.Equal("Paid", payment.PaymentStatus); Assert.Equal(0, payment.OutstandingAmount); Assert.Single(payment.History);
            var body = await client.GetStringAsync(path);
            Assert.DoesNotContain("bankReference", body); Assert.DoesNotContain("statementReference", body); Assert.DoesNotContain(w.Owner.ToString(), body);
            Assert.DoesNotContain(w.Tenants[0].ToString(), body);
        }
        Assert.Equal("Bạn", (await a.GetFromJsonAsync<InvoicePaymentView>(path))!.History[0].PaidBy);
        Assert.Equal("Khách thuê khác trong hóa đơn", (await b.GetFromJsonAsync<InvoicePaymentView>(path))!.History[0].PaidBy);
        Assert.Equal(3, (await owner.GetFromJsonAsync<PayerChoice[]>(path + "/eligible-payers"))!.Length);
        Assert.Equal(HttpStatusCode.Forbidden, (await b.GetAsync(path + "/eligible-payers")).StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Contracts\" SET \"Status\" = 4 WHERE \"RoomId\" = {w.Room}");
        }
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync(path)).StatusCode);
        var outside = await Setup(); using var outsider = await Client(outside.Tenants[0]);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync(path)).StatusCode);
    }
}
