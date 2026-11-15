using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Compact24;

public sealed class MainDraftReleaseBeforeAccountsTests
{
    private sealed class FixtureLifetime : IAsyncDisposable
    {
        public Compact24Fixture Fixture { get; } = new();
        public async ValueTask DisposeAsync() => await Fixture.DisposeAsync();
    }
    private sealed class SandboxScope(bool enabled) : IHoldingTestScope
    {
        public bool AllowsExternalDatabase => false;
        public bool Allows(Guid locationId) => enabled;
    }
    private sealed class Renderer : IMainDraftRenderer
    {
        public string TemplateHash => "synthetic-main-template";
        public bool SigningReviewAvailable => true;
        public Task<byte[]> DocxAsync(MainDraftRenderData data, CancellationToken t) => Task.FromResult("SYNTHETIC DOCX"u8.ToArray());
        public Task<byte[]> PdfAsync(byte[] source, CancellationToken t)
        {
            using var output = new MemoryStream();
            using (var pdf = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfWriter(output))) pdf.AddNewPage();
            return Task.FromResult(output.ToArray());
        }
    }
    [CompactPostgresTheory]
    [InlineData(false, true)]
    [InlineData(true, true)]
    [InlineData(true, false)]
    public async Task ReviewedMainReleasesBeforeAccountCreationWithCanonicalOtpDocument(bool sandbox, bool staffSimulation)
    {
        await using var lifetime = new FixtureLifetime();
        var fixture = lifetime.Fixture;
        await fixture.InitializeAsync();
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Only the explicitly synthetic scenario may exercise legacy simulation commands.
                ["ContractWorkflow:SimulatedSigningEnabled"] = sandbox ? "true" : "false",
                ["ContractPdf:TemplateId"] = "main-contract-development-v1",
                ["IdentityProtection:ActiveEncryptionVersion"] = "test",
                ["IdentityProtection:ActiveHmacVersion"] = "test",
                ["IdentityProtection:EncryptionKeys:test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
                ["IdentityProtection:HmacKeys:test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            }));
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IObjectStorage>(new Compact24WorkflowFixture.TestObjectStorage()); s.RemoveAll<IMainDraftRenderer>(); s.AddSingleton<IMainDraftRenderer, Renderer>();
                s.RemoveAll<IHoldingTestScope>(); s.AddSingleton<IHoldingTestScope>(new SandboxScope(sandbox));
            });
        });
        await Compact24SampleSeed.RunAsync(host.Services, "Development", WorkflowTestUsers.Password);
        using var owner = host.CreateClient(); using var staff = host.CreateClient();
        async Task Login(HttpClient c, string email)
        {
            var response = await c.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password }); response.EnsureSuccessStatusCode();
            c.DefaultRequestHeaders.Authorization = new("Bearer", (await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        }
        await Login(owner, "owner.sample@example.invalid"); await Login(staff, "staff.sample@example.invalid");
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7)); var room = Compact24SampleSeed.Id(41); var ownerId = Compact24SampleSeed.Id(1);
        Guid resident; Guid location; int beforeUsers;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); beforeUsers = await db.Users.CountAsync();
            location = await db.Set<BHome.Domain.PropertyManagement.Room>().Where(r => r.Id == room).Select(r => r.LocationId).SingleAsync();
            var person = new Resident { RoomId = room, OwnerUserId = ownerId, DisplayLabel = "SYNTHETIC", ContactEmail = $"{Guid.NewGuid():N}@example.invalid", VerificationStatus = IdentityVerificationStatus.Verified };
            var identity = new IdentityConfirmation(true, "000000000123", "SYNTHETIC", new(2000, 1, 1), "Synthetic address", "VN", null, null, new(2020, 1, 1), new(2030, 1, 1));
            var bytes = JsonSerializer.SerializeToUtf8Bytes(identity);
            try { person.IdentityData = JsonSerializer.Serialize(scope.ServiceProvider.GetRequiredService<IIdentityProtection>().Encrypt(bytes, new(ownerId, person.Id))); } finally { CryptographicOperations.ZeroMemory(bytes); }
            db.Add(person); await db.SaveChangesAsync(); resident = person.Id;
        }
        var root = "/api/v1/contracts/main-drafts";
        var settings = new MainContractSettingsInput(ownerId, today, null, 3000000, "Synthetic monthly payment terms", "Synthetic terms", new("SYNTHETIC OWNER", new(1980, 1, 1), "000000000456", new(2020, 1, 1), "Synthetic issuer", "Synthetic address", "0900000000"), 0);
        (await owner.PutAsJsonAsync(root + "/settings/" + location, settings)).EnsureSuccessStatusCode();
        async Task<HttpResponseMessage> Post(HttpClient c, string path, object body, Guid key)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key.ToString()); return await c.SendAsync(request);
        }
        var created = await Post(staff, root, new MainDraftInput(room, resident, [resident], today, today.AddMonths(6), "Synthetic notes", "0900000001", "Synthetic issuer"), Guid.NewGuid());
        Assert.True(created.IsSuccessStatusCode, await created.Content.ReadAsStringAsync()); var draft = (await created.Content.ReadFromJsonAsync<MainDraftView>())!;
        var response = await staff.PostAsync($"{root}/{draft.Id}/signing-review", null); response.EnsureSuccessStatusCode(); var review = (await response.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        var input = new MainDraftReleaseInput(null, draft.Version, review.Id, true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, $"{root}/{draft.Id}/release", input, key)).StatusCode);
        (await Post(owner, $"{root}/{draft.Id}/release", input, key)).EnsureSuccessStatusCode();
        (await Post(owner, $"{root}/{draft.Id}/release", input, key)).EnsureSuccessStatusCode();
        await using var check = host.Services.CreateAsyncScope(); var savedDb = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var c = await savedDb.Set<Contract>().Include(c => c.Residents).SingleAsync(c => c.Id == draft.Id);
        Assert.Equal(ContractStatus.PendingSigning, c.Status); Assert.Null(c.TenantUserId); Assert.Equal(ContractSigningModes.Internal, c.SigningMode);
        var document = new ContractDocument(c.Id, c.RoomId, c.OwnerSignerId, Guid.Empty, c.RepresentativeResidentId, c.Residents.Select(r => r.ResidentId).Order().ToArray(), c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit, c.HoldingContractId, c.AppliedHoldingDeposit, c.Terms, "") { IsInternalResidentAcceptance = true, AgreedCharges = ContractChargeSnapshot.Read(c).Charges };
        Assert.Equal(ContractDocumentSnapshot.Hash(document), c.SnapshotHash);
        var pdf = await check.ServiceProvider.GetRequiredService<IContractSigningDocumentSource>().ReadAsync(document with { SnapshotHash = c.SnapshotHash }, default);
        Assert.NotNull(pdf); Assert.True(pdf!.AsSpan(0, 5).SequenceEqual("%PDF-"u8)); Assert.Equal(beforeUsers, await savedDb.Users.CountAsync());
        Assert.Null((await savedDb.Set<Resident>().SingleAsync(r => r.Id == resident)).TenantUserId);
        var signingRoot = $"/api/v1/contracts/{draft.Id}/internal-signing";
        var status = (await owner.GetFromJsonAsync<InternalSigningStatus>(signingRoot))!;
        Assert.Equal(sandbox, status.SandboxAvailable);
        var confirmation = new InternalOwnerAcceptance(c.SnapshotHash, ContractSigningModes.InternalConsent, true);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(signingRoot + "/owner-confirmation", confirmation)).StatusCode);
        if (!sandbox)
        {
            Assert.Equal(HttpStatusCode.NotFound, (await staff.PostAsJsonAsync(signingRoot + "/owner-simulation", confirmation)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(signingRoot + "/owner-confirmation", confirmation)).StatusCode);
            return;
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(signingRoot + "/owner-confirmation", confirmation with { Consent = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(signingRoot + "/owner-confirmation", confirmation with { DocumentHash = "stale" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync(signingRoot + "/owner-simulation", confirmation)).StatusCode);
        var pendingInvite = new ContractSigningInvitation { ContractId = c.Id, ResidentId = resident, ApprovedByUserId = ownerId, TokenHash = new string('A', 64), SnapshotHash = c.SnapshotHash, DocumentObjectKey = "synthetic-review.pdf", DocumentHash = "synthetic-hash", RecipientEmail = "synthetic@example.invalid", ExpiresAt = DateTimeOffset.UtcNow.AddDays(1), OtpHash = "synthetic-otp", SessionHash = "synthetic-session" };
        savedDb.Add(pendingInvite); await savedDb.SaveChangesAsync();
        var canonical = await savedDb.Set<ContractDocumentFile>().SingleAsync(f => f.ContractId == c.Id && f.Kind == ContractFileKind.Preview && f.TemplateId == "main-tenancy-docx-v1");
        var objectStorage = check.ServiceProvider.GetRequiredService<IObjectStorage>();
        await objectStorage.DeleteAsync(canonical.ObjectKey, default);
        var missing = await Assert.ThrowsAsync<ContractException>(() => check.ServiceProvider.GetRequiredService<IContractSigningDocumentSource>().ReadAsync(document with { SnapshotHash = c.SnapshotHash }, default));
        Assert.Equal("signing_source_document_required", missing.Code);
        pendingInvite.DocumentHash = canonical.FileHash;
        await savedDb.SaveChangesAsync();
        using (var copy = new MemoryStream(pdf)) await objectStorage.PutAsync(pendingInvite.DocumentObjectKey, copy, pdf.Length, "application/pdf", default);
        Assert.Equal(pdf, await check.ServiceProvider.GetRequiredService<IContractSigningDocumentSource>().ReadAsync(document with { SnapshotHash = c.SnapshotHash }, default));
        await objectStorage.DeleteAsync(pendingInvite.DocumentObjectKey, default);
        Assert.True((await staff.GetFromJsonAsync<InternalSigningStatus>(signingRoot))!.SandboxAvailable);
        if (!staffSimulation) (await owner.PostAsJsonAsync(signingRoot + "/owner-confirmation", confirmation)).EnsureSuccessStatusCode();
        else (await staff.PostAsJsonAsync(signingRoot + "/owner-simulation", confirmation)).EnsureSuccessStatusCode();
        (await staff.PostAsJsonAsync(signingRoot + "/owner-simulation", confirmation)).EnsureSuccessStatusCode();
        (await owner.PostAsJsonAsync(signingRoot + "/owner-confirmation", confirmation)).EnsureSuccessStatusCode();
        status = (await owner.GetFromJsonAsync<InternalSigningStatus>(signingRoot))!;
        Assert.False(status.CanContinue); Assert.False(status.TenantSimulated); Assert.Null(status.TenantAcceptedAt);
        Assert.NotNull(status.OwnerAcceptedAt);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync($"/api/v1/contracts/{draft.Id}/initial-payment")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync(signingRoot + "/tenant-simulation", new { })).StatusCode);
        (await staff.PostAsJsonAsync(signingRoot + "/tenant-simulation", new { })).EnsureSuccessStatusCode();
        (await staff.PostAsJsonAsync(signingRoot + "/tenant-simulation", new { })).EnsureSuccessStatusCode();
        status = (await owner.GetFromJsonAsync<InternalSigningStatus>(signingRoot))!;
        Assert.True(status.CanContinue); Assert.True(status.TenantSimulated);
        Assert.Null(status.TenantAcceptedAt);
        var payment = await owner.GetAsync($"/api/v1/contracts/{draft.Id}/initial-payment");
        Assert.True(payment.IsSuccessStatusCode, await payment.Content.ReadAsStringAsync());
        var quote = (await payment.Content.ReadFromJsonAsync<BHome.Application.PaymentsDebt.MainInitialPaymentView>())!;
        Assert.True(quote.SigningComplete); Assert.False(quote.Paid);
        savedDb.ChangeTracker.Clear();
        var simulated = await savedDb.Set<Contract>().SingleAsync(x => x.Id == c.Id);
        Assert.Equal(ContractStatus.PendingActivation, simulated.Status);
        Assert.NotNull(MainSandboxAcceptance.Read(simulated));
        Assert.Equal(staffSimulation, MainSandboxAcceptance.Read(simulated)!.OwnerSimulatedBy is not null);
        Assert.True(MainSandboxAcceptance.Read(simulated)!.RebuiltTestArtifact);
        var revoked = await savedDb.Set<ContractSigningInvitation>().SingleAsync(i => i.Id == pendingInvite.Id);
        Assert.NotNull(revoked.RevokedAt); Assert.Null(revoked.OtpHash); Assert.Null(revoked.SessionHash);
        Assert.True(AnonymousContractSigningService.Complete(simulated));
        Assert.Null(AnonymousContractSigningService.AcceptedEvidence(simulated));
        Assert.Equal(beforeUsers, await savedDb.Users.CountAsync());
        Assert.Empty(await savedDb.Set<ContractSignature>().Where(x => x.ContractId == c.Id).ToArrayAsync());
        using var disabledHost = host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IHoldingTestScope>(); s.AddSingleton<IHoldingTestScope>(new SandboxScope(false));
        }));
        using var disabledOwner = disabledHost.CreateClient();
        disabledOwner.DefaultRequestHeaders.Authorization = owner.DefaultRequestHeaders.Authorization;
        var disabledStatus = (await disabledOwner.GetFromJsonAsync<InternalSigningStatus>(signingRoot))!;
        Assert.False(disabledStatus.SandboxAvailable); Assert.False(disabledStatus.CanContinue);
        Assert.Equal(HttpStatusCode.Forbidden, (await disabledOwner.GetAsync($"/api/v1/contracts/{draft.Id}/initial-payment")).StatusCode);

        // A background scope has no HTTP actor. Payment alone must not bypass readiness.
        await using var automaticScope = host.Services.CreateAsyncScope();
        var automatic = automaticScope.ServiceProvider.GetRequiredService<ContractService>();
        await Assert.ThrowsAsync<ContractException>(() => automatic.AutoActivatePaidMainAsync(c.Id, default));
        var paymentDb = automaticScope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var at = DateTimeOffset.UtcNow;
        var verifiedReceipt = new BHome.Domain.PaymentsDebt.PaymentTransfer { Amount = quote.OutstandingAmount, IsDevelopmentDemo = true, VerifiedAt = at, ProviderIdentity = "SEPAY:TEST", BankReference = "SYNTHETIC-AUTO", NormalizedReference = "SYNTHETIC-AUTO", TransferDescription = "BH12345678", OccurredAt = at };
        var eventId = Guid.NewGuid();
        var receiptId = verifiedReceipt.Id;
        var providerEvent = JsonSerializer.Serialize(new { recordType = "SePayEventV1", mode = "Test", transaction = new { referenceCode = "SYNTHETIC-AUTO", transferType = "in", transferAmount = quote.OutstandingAmount, gateway = "MBBank", accountNumber = "0000000001" } });
        var receiptData = JsonSerializer.Serialize(new { schemaVersion = 1, compactState = verifiedReceipt, sepay = new { eventId, mode = "Test", bankReference = "SYNTHETIC-AUTO" } }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var paymentCode = JsonSerializer.Serialize(new { code = "BH12345678", mode = "Test", kind = "MainInitial", obligationId = c.Id, locationId = location });
        await using (var tx = await paymentDb.Database.BeginTransactionAsync())
        {
            await paymentDb.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO operational_tasks(id,task_type,source_key,status,task_data) VALUES({eventId},'COMMAND',{"synthetic-event:" + eventId},'Pending',CAST({providerEvent} AS jsonb));
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_at,remittance_info,verification_data)
                VALUES({receiptId},'SEPAY:TEST','Test:MBBANK:0000000001',{receiptId.ToString()},{receiptId.ToString()},{at},{quote.OutstandingAmount},'VND','VERIFIED','AUTO',{at},'BH12345678',CAST({receiptData} AS jsonb));
                INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data) VALUES({Guid.NewGuid()},'COMMAND',{location},'payment-code:BH12345678','Issued',jsonb_build_object('recordType','PaymentCodeV1','state',CAST({paymentCode} AS jsonb)))
                """);
            await automaticScope.ServiceProvider.GetRequiredService<BHome.Application.PaymentsDebt.IMainInitialPaymentLedger>()
                .AllocateAsync(c.Id, verifiedReceipt, default);
            await paymentDb.SaveChangesAsync(); await tx.CommitAsync();
        }
        // Disabled Sandbox must still reject activation even after money is verified.
        await using (var disabledScope = disabledHost.Services.CreateAsyncScope())
            await Assert.ThrowsAsync<ContractException>(() => disabledScope.ServiceProvider.GetRequiredService<ContractService>().AutoActivatePaidMainAsync(c.Id, default));
        await using (var scheduling = host.Services.CreateAsyncScope())
            await scheduling.ServiceProvider.GetRequiredService<BHome.Infrastructure.PaymentsDebt.MainContractActivationScheduling>().EnqueueDueAsync(default);
        Assert.True(await host.Services.GetRequiredService<BHome.Infrastructure.Jobs.PostgresJobWorker>()
            .ProcessAllowedAsync(default, ["activate-paid-main-contract"]));
        await automatic.AutoActivatePaidMainAsync(c.Id, default);
        paymentDb.ChangeTracker.Clear();
        var activated = await paymentDb.Set<Contract>().SingleAsync(x => x.Id == c.Id);
        Assert.Equal(ContractStatus.Active, activated.Status); Assert.NotNull(activated.TenantUserId);
        Assert.Equal(ownerId, activated.ActivatedByUserId); Assert.NotNull(activated.ActivatedAt);
        Assert.Equal(beforeUsers + 1, await paymentDb.Users.CountAsync());
        Assert.False((await paymentDb.Users.SingleAsync(x => x.Id == activated.TenantUserId)).EmailConfirmed);
        Assert.Equal(1, await paymentDb.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM operational_tasks WHERE task_data->>'name'='post-activation-account-invitation' AND task_data->>'idempotencyKey'={"contract:" + c.Id.ToString("N") + ":resident:" + resident.ToString("N")}").SingleAsync());

    }
}
