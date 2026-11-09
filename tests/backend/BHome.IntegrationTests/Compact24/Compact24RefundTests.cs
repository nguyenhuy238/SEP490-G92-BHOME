using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.PaymentsDebt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection.Extensions;
using BHome.Application.Storage;
using System.Collections.Concurrent;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24RefundTests
{
    private const string Root = "/api/v1/refund-requests";
    private static async Task<(HttpClient Client, Guid Source)> Setup(Compact24WorkflowFixture fixture)
    {
        await new PaymentLedgerTests(fixture.Capture).OwnerConfirmedAmountPolicyPreservesPartialDebtAndUnallocatedExcess(120000,
            "verified_excess_payment_pending_review", verifiedPayer: true);
        await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var owner = await db.Users.SingleAsync(u => EF.Property<string[]>(u, "roles").Contains("Owner"));
        var source = await db.Set<PaymentTransfer>().Select(p => p.Id).SingleAsync();
        var client = fixture.Capture.Factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = owner.Email, password = WorkflowTestUsers.Password });
        login.EnsureSuccessStatusCode(); client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return (client, source);
    }
    private static async Task<T> Value<T>(HttpResponseMessage response)
    { Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync() + "\n" + string.Join('\n', Compact24WorkflowFixture.Diagnostics)); return (await response.Content.ReadFromJsonAsync<T>())!; }
    private static Task<HttpResponseMessage> Post(HttpClient client, string route, object body, Guid key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(request);
    }
    private static Task<HttpResponseMessage> Execute(HttpClient client, RefundView row, Guid key, DateTimeOffset at, string reference, byte[] bytes)
    {
        var body = new MultipartFormDataContent {
            { new StringContent(row.Version.ToString()), "expectedVersion" },
            { new StringContent(at.ToString("O")), "executedAt" },
            { new StringContent(reference), "externalReference" },
            { new StringContent("Synthetic bank statement confirmation"), "reason" },
            { new StringContent("true"), "humanConfirmed" },
            { new ByteArrayContent(bytes) { Headers = { ContentType = new("image/png") } }, "evidence", "synthetic.png" }
        };
        var request = new HttpRequestMessage(HttpMethod.Post, $"{Root}/{row.Id}/execution") { Content = body };
        request.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(request);
    }
    private static byte[] Photo() { using var mat = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); return mat.ImEncode(".png"); }

    [CompactPostgresFact]
    public async Task UnknownOrInconsistentCompletedRefundCannotClearTheInvoicePendingReview()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, sourceId) = await Setup(fixture); using var client = owner;
            var sourceRoute = $"/api/v1/payment-transactions/{sourceId}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(sourceRoute));
            var row = await Value<RefundView>(await Post(owner, sourceRoute,
                new RefundInput(source.Beneficiaries[0].Id, 20000, "Synthetic reconciled excess", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision",
                new RefundDecision(row.Version, true, "Synthetic verified payee", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Execute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-GUARD", Photo()));
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var invoice = await db.Set<Invoice>().Select(i => i.Id).SingleAsync();
            async Task<bool> Pending() => (await Value<InvoicePaymentView>(await owner.GetAsync($"/api/v1/invoices/{invoice}/payment"))).PendingReview;
            Assert.False(await Pending());
            var original = await db.Database.SqlQuery<string>($"SELECT history::text AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync();
            var record = System.Text.Json.JsonDocument.Parse(original).RootElement.EnumerateArray().Last().GetRawText();
            var malformed = System.Text.Json.Nodes.JsonNode.Parse(record)!;
            malformed["state"]!["events"] = "invalid imported events";
            // Later imported/corrupted proof metadata has identical amounts/status to a valid return.
            // Neither may release settlement simply because COMPLETED sums match the excess.
            foreach (var history in new[] { record.Replace("sha256", "missingHash", StringComparison.Ordinal),
                record.Replace("SYN-GUARD", "SYN-MISMATCH", StringComparison.Ordinal), malformed.ToJsonString() })
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({history}::jsonb) WHERE id={row.Id}");
                Assert.True(await Pending());
                var report = await Value<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
                Assert.True(report.HasUnclassifiedRefunds); Assert.Null(report.Total.NetOperatingCashFlow);
                Assert.Equal(100000, (await Value<InvoicePaymentView>(await owner.GetAsync($"/api/v1/invoices/{invoice}/payment"))).PaidAmount);
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({record}::jsonb) WHERE id={row.Id}");
                Assert.False(await Pending());
            }
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task UnclassifiedCompletedRefundEqualToExcessKeepsPendingReview()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, sourceId) = await Setup(fixture); using var client = owner;
            var source = await Value<RefundSource>(await owner.GetAsync($"/api/v1/payment-transactions/{sourceId}/refunds"));
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var actor = await db.Users.Where(u => EF.Property<string[]>(u, "roles").Contains("Owner")).Select(u => u.Id).SingleAsync();
            var beneficiary = source.Beneficiaries[0].Id; var at = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,
                  requested_amount,reason,status,decided_by_user_id,decided_at,executed_at,external_refund_reference,execution_evidence_key,operation_key)
                VALUES({Guid.NewGuid()},{sourceId},{beneficiary},{actor},{at},20000,'Synthetic unclassified import','COMPLETED',
                  {actor},{at},{at},'SYN-UNKNOWN-EXACT','synthetic-unverified',{Guid.NewGuid()})
                """);
            var invoice = await db.Set<Invoice>().Select(i => i.Id).SingleAsync();
            var payment = await Value<InvoicePaymentView>(await owner.GetAsync($"/api/v1/invoices/{invoice}/payment"));
            Assert.True(payment.PendingReview); Assert.Equal(100000, payment.PaidAmount);
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task ExcessRefundReservesRejectsApprovesExecutesAndReplaysWithoutChangingInvoiceAllocations()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, sourceId) = await Setup(fixture); using var client = owner;
            var sourceRoute = $"/api/v1/payment-transactions/{sourceId}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(sourceRoute));
            Assert.Equal(20000, source.AvailableAmount); var person = Assert.Single(source.Beneficiaries);
            var input = new RefundInput(person.Id, 20000, "Synthetic excess refund", true); var key = Guid.NewGuid();
            var row = await Value<RefundView>(await Post(owner, sourceRoute, input, key));
            Assert.Equal(row.Id, (await Value<RefundView>(await Post(owner, sourceRoute, input, key))).Id);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, sourceRoute, input with { Amount = 1 }, key)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, sourceRoute, input, Guid.NewGuid())).StatusCode);
            Assert.Equal(0, (await Value<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
            var rejected = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", new RefundDecision(1, false, "Synthetic reject", true), Guid.NewGuid()));
            Assert.Equal("REJECTED", rejected.Status);
            Assert.Equal(20000, (await Value<RefundSource>(await owner.GetAsync(sourceRoute))).AvailableAmount);
            row = await Value<RefundView>(await Post(owner, sourceRoute, input, Guid.NewGuid()));
            Assert.Equal(HttpStatusCode.Conflict, (await Execute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-REFUND", Photo())).StatusCode);
            var decisionKey = Guid.NewGuid(); var decision = new RefundDecision(1, true, "Synthetic approval", true);
            var approved = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", decision, decisionKey));
            Assert.Equal("APPROVED", approved.Status);
            Assert.Equal(approved.Id, (await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", decision, decisionKey))).Id);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"{Root}/{row.Id}/decision", decision with { Approve = false }, Guid.NewGuid())).StatusCode);
            var at = DateTimeOffset.UtcNow; var bytes = Photo(); var executionKey = Guid.NewGuid();
            var completed = await Value<RefundView>(await Execute(owner, approved, executionKey, at, "SYN-REFUND", bytes));
            Assert.Equal("COMPLETED", completed.Status); Assert.Equal(3, completed.Version); Assert.Equal(3, completed.History.Count);
            var replayed = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Execute(owner, approved, executionKey, at, "SYN-REFUND", bytes)));
            foreach (var replay in replayed) Assert.Equal(3, (await Value<RefundView>(replay)).Version);
            Assert.Equal(bytes, await owner.GetByteArrayAsync($"{Root}/{row.Id}/evidence"));
            var after = await Value<RefundSource>(await owner.GetAsync(sourceRoute));
            Assert.Equal(20000, after.RefundedAmount); Assert.Equal(0, after.ReservedAmount); Assert.Equal(0, after.AvailableAmount);
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(100000, (await db.Set<Invoice>().SingleAsync()).Total);
            Assert.Equal(100000, (await db.Set<PaymentAllocation>().SingleAsync()).Amount);
            var invoiceId = await db.Set<Invoice>().Select(i => i.Id).SingleAsync();
            var payment = await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{invoiceId}/payment");
            Assert.False(payment!.PendingReview); Assert.Equal(100000, payment.PaidAmount);
            var report = await Value<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
            Assert.False(report.HasUnclassifiedRefunds); Assert.Equal("100000", report.Total.VerifiedCollections);
            Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == row.Id && a.Event == "ExcessRefundCompleted"));
            Assert.True(await db.IsSchemaReadyAsync());
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task ExcessRefundRejectsOtherRolesInvalidPayersAndConcurrentOverReservation()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, sourceId) = await Setup(fixture); using var client = owner;
            var route = $"/api/v1/payment-transactions/{sourceId}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(route));
            var input = new RefundInput(source.Beneficiaries[0].Id, 20000, "Synthetic request", true);
            foreach (var invalid in new[] { input with { Amount = -1 }, input with { Amount = 1.1m }, input with { HumanConfirmed = false }, input with { Reason = "" } })
                Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, route, invalid, Guid.NewGuid())).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, input with { BeneficiaryResidentId = Guid.NewGuid() }, Guid.NewGuid())).StatusCode);
            var replies = await Task.WhenAll(Post(owner, route, input, Guid.NewGuid()), Post(owner, route, input, Guid.NewGuid()));
            Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
            using var anonymous = fixture.Capture.Factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(route)).StatusCode);
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            foreach (var role in new[] { "Staff", "Tenant" })
            {
                var account = await db.Users.FirstAsync(u => EF.Property<string[]>(u, "roles").Contains(role));
                using var other = fixture.Capture.Factory.CreateClient();
                var login = await other.PostAsJsonAsync("/api/v1/auth/login", new { email = account.Email, password = WorkflowTestUsers.Password });
                login.EnsureSuccessStatusCode(); other.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
                Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(route)).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await Post(other, route, input, Guid.NewGuid())).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await Post(other, $"{Root}/{Guid.NewGuid()}/decision", new RefundDecision(1, true, "Synthetic", true), Guid.NewGuid())).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await Execute(other, new RefundView(Guid.NewGuid(), sourceId, input.BeneficiaryResidentId,
                    "Synthetic", 100, "Synthetic", "APPROVED", 2, DateTimeOffset.UtcNow, null, null, null, null, false, [], null),
                    Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN", Photo())).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"{Root}/{Guid.NewGuid()}/evidence")).StatusCode);
            }
        }
        finally { await fixture.DisposeAsync(); }
    }

    private sealed class InterruptedStorage : IObjectStorage
    {
        internal readonly ConcurrentDictionary<string, byte[]> Files = new();
        internal bool Fail = true;
        public async Task PutAsync(string key, Stream data, long length, string contentType, CancellationToken t)
        { using var buffer = new MemoryStream(); await data.CopyToAsync(buffer, t); Files[key] = buffer.ToArray(); if (Fail) { Fail = false; throw new IOException("Synthetic interrupted upload"); } }
        public Task CopyToAsync(string key, Stream output, CancellationToken t) => output.WriteAsync(Files[key], t).AsTask();
        public Task DeleteAsync(string key, CancellationToken t) { Files.TryRemove(key, out _); return Task.CompletedTask; }
    }
    [CompactPostgresFact]
    public async Task RefundUploadRecoversAndRejectsTamperingReferencesUnknownPayerAndUnclassifiedLegacyRows()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (original, sourceId) = await Setup(fixture); using var originalClient = original;
            var store = new InterruptedStorage(); var signingKey = fixture.Capture.Factory.Services.GetRequiredService<IConfiguration>()["Jwt:SigningKey"];
            await using var host = fixture.Capture.Factory.WithWebHostBuilder(b =>
            {
                b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:SigningKey"] = signingKey }));
                b.ConfigureTestServices(s => { s.RemoveAll<IObjectStorage>(); s.AddSingleton<IObjectStorage>(store); });
            });
            using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization;
            var route = $"/api/v1/payment-transactions/{sourceId}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(route));
            async Task<RefundView> Approved(decimal amount)
            {
                var row = await Value<RefundView>(await Post(owner, route, new RefundInput(source.Beneficiaries[0].Id, amount, "Synthetic refund", true), Guid.NewGuid()));
                return await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", new RefundDecision(row.Version, true, "Synthetic approval", true), Guid.NewGuid()));
            }
            var approved = await Approved(10000); var at = DateTimeOffset.UtcNow; var key = Guid.NewGuid(); var bytes = Photo();
            Assert.Equal(HttpStatusCode.InternalServerError, (await Execute(owner, approved, key, at, "SYN-OUTGOING", bytes)).StatusCode);
            var pending = Assert.Single((await Value<RefundSource>(await owner.GetAsync(route))).Requests);
            Assert.Equal("APPROVED", pending.Status); Assert.Equal(key, pending.ExecutionIntent!.Key);
            Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"{Root}/{pending.Id}/evidence")).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await Execute(owner, approved, Guid.NewGuid(), at, "SYN-OTHER", bytes)).StatusCode);
            await Value<RefundView>(await Execute(owner, approved, key, at, "SYN-OUTGOING", bytes));
            Assert.Single(store.Files); Assert.Equal(bytes, await owner.GetByteArrayAsync($"{Root}/{pending.Id}/evidence"));
            store.Files[store.Files.Keys.Single()] = "tampered"u8.ToArray();
            Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync($"{Root}/{pending.Id}/evidence")).StatusCode);
            var next = await Approved(10000);
            Assert.Equal(HttpStatusCode.Conflict, (await Execute(owner, next, Guid.NewGuid(), DateTimeOffset.UtcNow, "syn-outgoing", bytes)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Execute(owner, next, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-NEW", "not-image"u8.ToArray())).StatusCode);
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await Execute(owner, next, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-NEW", new byte[5 * 1024 * 1024 + 1])).StatusCode);
            await Value<RefundView>(await Execute(owner, next, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-NEW", bytes));
            Assert.Equal(20000, (await Value<RefundSource>(await owner.GetAsync(route))).RefundedAmount);
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var actor = await db.Users.Where(u => EF.Property<string[]>(u, "roles").Contains("Owner")).Select(u => u.Id).SingleAsync();
            var now = DateTimeOffset.UtcNow; var legacy = Guid.NewGuid(); var operation = Guid.NewGuid(); var beneficiary = source.Beneficiaries[0].Id;
            // Explicit unknown imported refund boundary: reporting must retain its uncertainty guard.
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO refund_requests(id,source_payment_id,beneficiary_resident_id,requested_by_user_id,requested_at,
                  requested_amount,reason,status,decided_by_user_id,decided_at,executed_at,external_refund_reference,execution_evidence_key,operation_key)
                VALUES({legacy},{sourceId},{beneficiary},{actor},{now},1,'Synthetic unclassified import','COMPLETED',
                  {actor},{now},{now},'SYN-LEGACY','synthetic-legacy',{operation})
                """);
            var report = await Value<FinancialReport>(await owner.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"));
            Assert.True(report.HasUnclassifiedRefunds); Assert.Null(report.Capital.NetRecovery);
            Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync(route)).StatusCode);
        }
        finally { await fixture.DisposeAsync(); }
        // Unknown payer is deliberately retained instead of substituting a representative.
        var unknown = new Compact24WorkflowFixture(); await unknown.InitializeAsync();
        try
        {
            await new PaymentLedgerTests(unknown.Capture).OwnerConfirmedAmountPolicyPreservesPartialDebtAndUnallocatedExcess(120000, "verified_excess_payment_pending_review");
            await using var scope = unknown.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var sourceId = await db.Set<PaymentTransfer>().Select(p => p.Id).SingleAsync();
            var user = new TestOwner(await db.Users.Where(u => EF.Property<string[]>(u, "roles").Contains("Owner")).Select(u => u.Id).SingleAsync());
            var service = new RefundService(scope.ServiceProvider.GetRequiredService<IRefundRepository>(), scope.ServiceProvider.GetRequiredService<IObjectStorage>(),
                scope.ServiceProvider.GetRequiredService<BHome.Application.Contracts.IContractImageValidator>(), user, TimeProvider.System);
            Assert.Empty((await service.SourceAsync(sourceId, default)).Beneficiaries);
            var error = await Assert.ThrowsAsync<FinanceException>(() => service.CreateAsync(sourceId, new(Guid.NewGuid(), 100, "Synthetic", true), Guid.NewGuid(), default));
            Assert.Equal("refund_verified_payer_required", error.Code);
        }
        finally { await unknown.DisposeAsync(); }
    }
    private sealed class TestOwner(Guid id) : ICurrentUser
    { public Guid? UserId => id; public bool IsInRole(string role) => role == "Owner"; }
}
