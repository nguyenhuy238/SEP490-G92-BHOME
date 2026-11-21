using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task AdjustmentSubmissionIsPersistedIdempotentAndPrivateToRequesterAndOwner()
    {
        var w = await Setup(); using var a = await Client(w.Tenants[0]); using var b = await Client(w.Tenants[1]); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var route = $"/api/v1/invoices/{w.Invoice}/adjustment-requests";
        var input = new AdjustmentSubmit(null, 90000, "Sai khoản thuê tổng hợp", [], 1); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(owner, route, input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, route, input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(a, route, input with { Reason = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(a, route, input with { ProposedAmount = 0.5m })).StatusCode);
        var result = await Post(a, route, input, key); result.EnsureSuccessStatusCode(); var request = (await result.Content.ReadFromJsonAsync<AdjustmentView>())!;
        Assert.Equal("Pending", request.Status); Assert.Equal(100000, request.CurrentAmount);
        using (var snapshot = System.Text.Json.JsonDocument.Parse(request.InvoiceSnapshot)) Assert.Equal("100000", snapshot.RootElement.GetProperty("Total").GetString());
        Assert.Equal(request.Id, (await (await Post(a, route, input, key)).Content.ReadFromJsonAsync<AdjustmentView>())!.Id);
        Assert.Equal(HttpStatusCode.OK, (await Post(a, route, input with { ProposedAmount = 90000.00m }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(a, route, input with { ProposedAmount = 80000 }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/api/v1/invoice-adjustments/{request.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/v1/invoice-adjustments/{request.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/invoice-adjustments")).StatusCode);
        Assert.Empty((await b.GetFromJsonAsync<PagedResult<AdjustmentView>>($"/api/v1/invoice-adjustments?invoiceId={w.Invoice}"))!.Items);
        var outside = await Setup(); using var stranger = await Client(outside.Tenants[0]);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(stranger, route, input)).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await db.Set<InvoiceAdjustmentRequest>().CountAsync(r => r.InvoiceId == w.Invoice));
        Assert.Equal(1, await db.Set<InvoiceAdjustmentEvent>().CountAsync(r => r.InvoiceId == w.Invoice));
        foreach (var contract in await db.Set<BHome.Domain.TenantContracts.Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync()) contract.Status = BHome.Domain.TenantContracts.ContractStatus.Terminated;
        await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync($"/api/v1/invoice-adjustments/{request.Id}")).StatusCode);
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM invoice_adjustments WHERE id={request.Id}"));
        else await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"InvoiceAdjustmentRequests\" WHERE \"Id\"={request.Id}"));
    }
    [Fact]
    public async Task AdjustmentEvidenceIsValidatedPrivateAndCannotBeReusedOrStolen()
    {
        var w = await Setup(); using var a = await Client(w.Tenants[0]); using var b = await Client(w.Tenants[1]); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var upload = $"/api/v1/invoices/{w.Invoice}/adjustment-evidence";
        using var image = new Mat(16, 16, MatType.CV_8UC3, Scalar.White); var png = image.ToBytes(".png");
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PutAsync(upload, new ByteArrayContent(png))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsync(upload, new ByteArrayContent([1, 2, 3]))).StatusCode);
        var response = await a.PutAsync(upload, new ByteArrayContent(png)); response.EnsureSuccessStatusCode(); var evidence = (await response.Content.ReadFromJsonAsync<AdjustmentEvidenceView>())!;
        var input = new AdjustmentSubmit(null, 90000, "Bằng chứng tổng hợp", [evidence.Id], 1);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(b, $"/api/v1/invoices/{w.Invoice}/adjustment-requests", input)).StatusCode);
        var request = (await (await Post(a, $"/api/v1/invoices/{w.Invoice}/adjustment-requests", input)).Content.ReadFromJsonAsync<AdjustmentView>())!;
        var file = $"/api/v1/invoice-adjustments/{request.Id}/evidence/{evidence.Id}";
        Assert.Equal(png, await owner.GetByteArrayAsync(file)); Assert.Equal(png, await a.GetByteArrayAsync(file));
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync(file)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(a, $"/api/v1/invoices/{w.Invoice}/adjustment-requests", input)).StatusCode);
    }
    private sealed class FailingAdjustmentStorage : BHome.Application.Storage.IObjectStorage
    {
        public int Deletes { get; private set; }
        public Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken t) => throw new IOException("Synthetic upload failure");
        public Task CopyToAsync(string key, Stream destination, CancellationToken t) => throw new NotSupportedException();
        public Task DeleteAsync(string key, CancellationToken t) { Deletes++; return Task.CompletedTask; }
    }
    [Fact]
    public async Task FailedEvidenceUploadLeavesOnlyRecoverableIntentAndCannotBeSubmitted()
    {
        var w = await Setup(); using var tenant = await Client(w.Tenants[0]);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var storage = new FailingAdjustmentStorage();
        var files = new BHome.Infrastructure.Billing.AdjustmentEvidenceFiles(db, storage, TimeProvider.System);
        await Assert.ThrowsAsync<IOException>(() => files.UploadAsync(w.Invoice, w.Tenants[0], [137, 80, 78, 71], "image/png", default));
        var orphan = await db.Set<InvoiceAdjustmentEvidence>().AsNoTracking().SingleAsync(e => e.InvoiceId == w.Invoice); Assert.False(orphan.Uploaded);
        var input = new AdjustmentSubmit(null, 90000, "Synthetic failed upload", [orphan.Id], 1);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(tenant, $"/api/v1/invoices/{w.Invoice}/adjustment-requests", input)).StatusCode);
        await BHome.Infrastructure.Billing.AdjustmentEvidenceCleanup.CleanupAsync(db, storage, DateTimeOffset.UtcNow.AddDays(2), default);
        Assert.Equal(1, storage.Deletes); Assert.False(await db.Set<InvoiceAdjustmentEvidence>().AnyAsync(e => e.Id == orphan.Id));
    }
}
