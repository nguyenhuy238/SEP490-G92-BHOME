using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.IntegrationTests.Contracts;

public sealed partial class MainDraftApiTests
{
    private WebApplicationFactory<Program> ReleaseHost(Guid location)
    {
        var settings = fixture.Factory.Services.GetRequiredService<IConfiguration>().GetSection("IdentityProtection").AsEnumerable().ToDictionary(x => x.Key, x => x.Value);
        settings["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local"; settings["ContractWorkflow:SimulatedSigningEnabled"] = "true";
        settings["SePay:Enabled"] = "true";
        settings["SePay:Mode"] = "Test";
        settings["SePay:WebhookSecret"] = "synthetic-release-webhook-secret-not-a-real-key";
        settings["SePay:ReceivingAccounts:0:LocationId"] = location.ToString();
        settings["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416";
        settings["SePay:ReceivingAccounts:0:Gateway"] = "ACB";
        settings["SePay:ReceivingAccounts:0:AccountNumber"] = "0000000001";
        return fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings));
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IContractSigningProvider>();
                s.AddScoped(typeof(IContractSigningProvider), typeof(ViettelMySignContractAdapter).Assembly.GetType("BHome.Infrastructure.Contracts.DevelopmentContractSigningAdapter", true)!);
            });
        });
    }
    private static HttpClient InHost(WebApplicationFactory<Program> host, HttpClient original)
    { var client = host.CreateClient(); client.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization; return client; }
    private static async Task<HttpResponseMessage> Release(HttpClient owner, Guid id, MainDraftReleaseInput input, Guid key)
    { using var request = new HttpRequestMessage(HttpMethod.Post, $"{Root}/{id}/release") { Content = JsonContent.Create(input) }; request.Headers.Add("Idempotency-Key", key.ToString()); return await owner.SendAsync(request); }
    [Fact]
    public async Task ReviewedMainDraftReleasesOnceAndBothPartiesUseTheSamePdfThroughSimulatedActivation()
    {
        var w = await Setup(); var tenant = await User("Tenant"); var outside = await User("Tenant");
        await using var host = ReleaseHost(w.Location); using var staff = InHost(host, w.Staff); using var owner = InHost(host, w.Owner); using var signer = InHost(host, tenant.Client); using var stranger = InHost(host, outside.Client);
        await using (var seed = host.Services.CreateAsyncScope())
        {
            var resident = await seed.ServiceProvider.GetFixturePersistence().Set<Resident>().SingleAsync(r => r.Id == w.Resident);
            resident.TenantUserId = tenant.Id;
            await seed.ServiceProvider.GetFixturePersistence().SaveChangesAsync();
        }
        var draft = await Save(w with { Staff = staff });
        var reviewResponse = await staff.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(reviewResponse);
        var review = (await reviewResponse.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        Assert.True(review.DevelopmentOnly); Assert.Equal("SigningReview", review.Kind);
        var reviewedBytes = await owner.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{review.Id}");
        using (var pdf = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(reviewedBytes))))
        { var text = ContractPdfRendererTests.Text(pdf); Assert.DoesNotContain("TÀI LIỆU KIỂM THỬ", text); Assert.DoesNotContain("BẢN NHÁP", text); }
        var input = new MainDraftReleaseInput(tenant.Id, draft.Version, review.Id, true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await Release(stranger, draft.Id, input, key)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Release(owner, draft.Id, input with { HumanReviewed = false }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, input with { ExpectedVersion = 0 }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, input with { TenantUserId = outside.Id }, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, input with { TenantUserId = null }, Guid.NewGuid())).StatusCode);
        var staffInput = input with { TenantUserId = null };
        var releases = await Task.WhenAll(Release(staff, draft.Id, staffInput, key), Release(staff, draft.Id, staffInput, key));
        foreach (var response in releases) await Success(response);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(staff, draft.Id, input with { TenantUserId = outside.Id }, key)).StatusCode);
        var contract = (await owner.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{draft.Id}"))!;
        Assert.False(contract.OnboardingDraft); Assert.Equal("PendingSigning", contract.Status); Assert.Equal(tenant.Id, contract.TenantUserId);
        Assert.NotNull(contract.PriceLockedAt);
        Assert.Contains(contract.AgreedCharges!, c => c.ChargeCode == "RENT" && c.Rate == contract.MonthlyRent);
        Assert.Contains(contract.AgreedCharges!, c => c.ChargeCode == "ELECTRICITY");
        Assert.Contains(contract.AgreedCharges!, c => c.ChargeCode == "WATER");
        var previews = (await signer.GetFromJsonAsync<ContractDocumentView[]>($"/api/v1/contracts/{draft.Id}/previews"))!; var preview = Assert.Single(previews);
        Assert.Equal(reviewedBytes, await signer.GetByteArrayAsync($"/api/v1/contracts/{draft.Id}/previews/{preview.Id}"));
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/contracts/{draft.Id}/previews/{preview.Id}")).StatusCode);
        var previewRequest = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/previews"); previewRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var previewResponse = await owner.SendAsync(previewRequest); await Success(previewResponse);
        Assert.Equal(preview.Id, (await previewResponse.Content.ReadFromJsonAsync<ContractDocumentView>())!.Id);
        foreach (var party in new[] { owner, signer })
        {
            using var message = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/signing") { Content = JsonContent.Create(new SigningInput(Guid.Empty)) }; message.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            await Success(await party.SendAsync(message)); await Success(await party.PostAsJsonAsync($"/api/v1/contracts/{draft.Id}/signing/sync", new { }));
        }
        var depositAmount = draft.Preparation.Charges.Single(p => p.ChargeCode == "RENT").Rate;
        using (var deposit = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/deposit-verifications") { Content = JsonContent.Create(new DepositInput("SYNTHETIC-RELEASE-" + Guid.NewGuid(), depositAmount, "Synthetic bank statement confirmed")) })
        { deposit.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); await Success(await owner.SendAsync(deposit)); }
        // The Compact24 checkout must settle initial rent as well as the security deposit.
        await using (var paymentScope = host.Services.CreateAsyncScope())
        {
            var paymentDb = paymentScope.ServiceProvider.GetFixturePersistence();
            if (paymentDb is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            {
                using var unpaid = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/activate") { Content = JsonContent.Create(new { }) };
                unpaid.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
                Assert.Equal(HttpStatusCode.Conflict, (await owner.SendAsync(unpaid)).StatusCode);
                paymentDb.Add(new BHome.Domain.PaymentsDebt.ReceivingBankAccount
                {
                    LocationId = w.Location,
                    BankIdentifier = "970416",
                    AccountNumber = "0000000001",
                    AccountHolder = "SYNTHETIC TEST",
                    Enabled = true,
                    IsDevelopmentDemo = true,
                    Version = 1,
                    ConfirmedByUserId = w.OwnerId,
                    ConfirmedAt = DateTimeOffset.UtcNow
                });
                await paymentDb.SaveChangesAsync();
                var qrResponse = await owner.PostAsync($"/api/v1/contracts/{draft.Id}/initial-payment/transfer-instructions", null);
                await Success(qrResponse);
                var quote = (await qrResponse.Content.ReadFromJsonAsync<BHome.Application.PaymentsDebt.MainInitialPaymentView>())!;
                Assert.Equal(3100000, quote.OutstandingAmount);
                var body = System.Text.Json.JsonSerializer.Serialize(new
                {
                    id = Guid.NewGuid().ToString(),
                    gateway = "ACB",
                    transactionDate = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(7)).ToString("yyyy-MM-dd HH:mm:ss"),
                    accountNumber = "0000000001",
                    transferType = "in",
                    transferAmount = quote.OutstandingAmount,
                    code = quote.TransferReference,
                    content = "Synthetic transfer " + quote.TransferReference,
                    referenceCode = "SYNTHETIC-INITIAL-" + Guid.NewGuid(),
                    subAccount = "",
                    description = "Synthetic",
                    accumulated = quote.OutstandingAmount
                });
                using var webhook = new HttpRequestMessage(HttpMethod.Post, "/api/v1/integrations/sepay/webhook")
                { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
                var digest = System.Security.Cryptography.HMACSHA256.HashData(System.Text.Encoding.UTF8.GetBytes("synthetic-release-webhook-secret-not-a-real-key"), System.Text.Encoding.UTF8.GetBytes(timestamp + "." + body));
                webhook.Headers.Add("X-SePay-Timestamp", timestamp);
                webhook.Headers.Add("X-SePay-Signature", "sha256=" + Convert.ToHexString(digest));
                using var anonymous = host.CreateClient();
                await Success(await anonymous.SendAsync(webhook));
                Assert.True(await paymentScope.ServiceProvider.GetRequiredService<BHome.Application.PaymentsDebt.IMainInitialPaymentLedger>().SatisfiedAsync(draft.Id, default));
            }
        }
        using (var activate = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/activate") { Content = JsonContent.Create(new { }) })
        { activate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); await Success(await owner.SendAsync(activate)); }
        var active = (await signer.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{draft.Id}"))!; Assert.Equal("Active", active.Status);
        Assert.All(active.Signatures, s => Assert.Equal("Simulated", s.Status));
        await using var verify = host.Services.CreateAsyncScope(); var db = verify.ServiceProvider.GetFixturePersistence();
        var persisted = await db.Set<Contract>().SingleAsync(c => c.Id == draft.Id); Assert.NotEqual("{}", persisted.DraftMetadata);
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(reviewedBytes)), (await db.Set<ContractSignature>().SingleAsync(s => s.ContractId == draft.Id && s.SignerUserId == w.OwnerId)).SourceHash);
        Assert.Equal(1, await db.Set<ContractDocumentFile>().CountAsync(f => f.ContractId == draft.Id && f.Kind == ContractFileKind.Preview));
        Assert.Equal(tenant.Id, (await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident)).TenantUserId);
    }
    [Fact]
    public async Task ReleaseRejectsStaleReviewAndTampering()
    {
        var w = await Setup(); var tenant = await User("Tenant");
        await using var host = ReleaseHost(w.Location); using var owner = InHost(host, w.Owner); using var staff = InHost(host, w.Staff);
        var draft = await Save(w with { Staff = staff });
        var response = await staff.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(response); var review = (await response.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var file = await scope.ServiceProvider.GetFixturePersistence().Set<ContractDocumentFile>().SingleAsync(f => f.Id == review.Id);
            using var wrong = new MemoryStream("%PDF-tampered synthetic bytes"u8.ToArray());
            await scope.ServiceProvider.GetRequiredService<IObjectStorage>().PutAsync(file.ObjectKey, wrong, wrong.Length, "application/pdf", default);
        }
        var rejected = await Release(owner, draft.Id, new(null, draft.Version, review.Id, true), Guid.NewGuid()); Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode); Assert.Contains("contract_document_integrity_failed", await rejected.Content.ReadAsStringAsync());
        var updated = await Save(w, Input(w) with { Notes = "Changed saved terms", ExpectedVersion = draft.Version }, id: draft.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, new(null, updated.Version, review.Id, true), Guid.NewGuid())).StatusCode);
        await using var verify = fixture.Factory.Services.CreateAsyncScope(); var db = verify.ServiceProvider.GetFixturePersistence();
        Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident)).TenantUserId); Assert.Equal(ContractStatus.Draft, (await db.Set<Contract>().SingleAsync(c => c.Id == draft.Id)).Status);
    }
    [Theory]
    [InlineData("Staging", false)]
    [InlineData("Staging", true)]
    [InlineData("Production", true)]
    public async Task DemoTemplateCanBeReviewedReleasedAndReadInEveryEnvironment(string environment, bool live)
    {
        // Exercise both persisted payment modes on the deployed Compact24 schema.
        if (environment == "Staging" && fixture.Factory.Services.GetService<BHome.Infrastructure.Persistence.Compact24.Compact24DbContext>() is null)
        {
            var native = new BHome.IntegrationTests.Compact24.PropertyContractDockerFixture();
            try
            {
                await native.InitializeAsync();
                await new MainDraftApiTests(native.Contracts).DemoTemplateCanBeReviewedReleasedAndReadInEveryEnvironment(environment, live);
            }
            finally { await native.DisposeAsync(); }
            return;
        }
        var w = await Setup();
        Guid? tenantUserId = null;
        await using (var seed = fixture.Factory.Services.CreateAsyncScope())
        {
            var seedDb = seed.ServiceProvider.GetFixturePersistence();
            // The historical offline schema requires a linked Tenant on release.
            // Keep exercising account-free internal release on deployed Compact24.
            if (seedDb is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            {
                var tenant = await User("Tenant");
                using var tenantClient = tenant.Client;
                tenantUserId = tenant.Id;
                (await seedDb.Set<Resident>().SingleAsync(r => r.Id == w.Resident)).TenantUserId = tenantUserId;
                await seedDb.SaveChangesAsync();
            }
        }
        await using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.UseTestEnvironment(environment);
            b.ConfigureAppConfiguration((_, config) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local",
                    ["MainDraft:ApprovedProductionTemplateSha256"] = "",
                    ["MainDraft:AllowStagingSigningReview"] = "false",
                    ["ContractWorkflow:SimulatedSigningEnabled"] = "false",
                    ["SePay:Enabled"] = !live ? "true" : "false",
                    ["SePay:Mode"] = !live ? "Test" : "Live"
                };
                if (environment == "Staging")
                {
                    settings["SePay:WebhookSecret"] = "synthetic-staging-template-review-secret";
                    settings["SePay:ReceivingAccounts:0:LocationId"] = w.Location.ToString();
                    settings["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416";
                    settings["SePay:ReceivingAccounts:0:Gateway"] = "ACB";
                    settings["SePay:ReceivingAccounts:0:AccountNumber"] = "0000000001";
                }
                config.AddInMemoryCollection(settings);
            });
            if (environment == "Staging")
            {
                b.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IHoldingTestScope>();
                    services.AddSingleton<IHoldingTestScope>(new SigningTestScope(live ? Guid.NewGuid() : w.Location));
                });
            }
        });
        using var owner = InHost(host, w.Owner); using var staff = InHost(host, w.Staff); using var outside = InHost(host, w.Outside);
        var draft = await Save(w with { Staff = staff });
        Assert.Equal(HttpStatusCode.NotFound, (await outside.PostAsync($"{Root}/{draft.Id}/signing-review", null)).StatusCode);
        // An unsigned preview from the previous rendering revision must be replaced,
        // while its original bytes remain available as history. Generate it through
        // a version-1 test renderer; the database evidence is append-only.
        ContractDocumentView oldReview;
        await using (var legacy = host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IMainDraftRenderer>();
            s.AddScoped<IMainDraftRenderer, LegacyVersionMainDraftRenderer>();
        })))
        {
            using var legacyStaff = InHost(legacy, w.Staff);
            var legacyResponse = await legacyStaff.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(legacyResponse);
            oldReview = (await legacyResponse.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        }
        Assert.Equal(!live, oldReview.DevelopmentOnly); Assert.Equal(1, oldReview.TemplateVersion);
        var oldBytes = await owner.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{oldReview.Id}");
        var response = await staff.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(response);
        var review = (await response.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        Assert.Equal(!live, review.DevelopmentOnly);
        Assert.NotEqual(oldReview.Id, review.Id); Assert.Equal(4, review.TemplateVersion);
        Assert.Equal(oldBytes, await owner.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{oldReview.Id}"));
        var staleInput = new MainDraftReleaseInput(tenantUserId, draft.Version, oldReview.Id, true, EmailSigning: tenantUserId is not null);
        var staleResponse = await Release(owner, draft.Id, staleInput, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Conflict, staleResponse.StatusCode);
        Assert.Contains("draft_document_outdated", await staleResponse.Content.ReadAsStringAsync());
        if (live)
        {
            // Reproduce an older renderer's label through an appended document;
            // immutable document evidence must never be edited in place.
            await using var historical = host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IMainDraftRenderer>();
                s.AddScoped<IMainDraftRenderer>(p => new LegacyVersionMainDraftRenderer(
                    p.GetRequiredService<IConfiguration>(), p.GetRequiredService<TimeProvider>(), 4, true));
            }));
            using var historicalStaff = InHost(historical, w.Staff);
            var historicalResponse = await historicalStaff.PostAsync($"{Root}/{draft.Id}/signing-review", null);
            await Success(historicalResponse);
            review = (await historicalResponse.Content.ReadFromJsonAsync<ContractDocumentView>())!;
            Assert.True(review.DevelopmentOnly);
        }
        var bytes = await owner.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{review.Id}");
        using (var pdf = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(bytes))))
            Assert.DoesNotContain("TÀI LIỆU KIỂM THỬ", ContractPdfRendererTests.Text(pdf));
        var key = Guid.NewGuid(); var input = staleInput with { ReviewedFileId = review.Id };
        await Success(await Release(owner, draft.Id, input, key));
        await Success(await Release(owner, draft.Id, input, key));
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var contract = await db.Set<Contract>().Include(c => c.Residents).Include(c => c.Signatures).SingleAsync(c => c.Id == draft.Id);
        Assert.Equal(ContractStatus.PendingSigning, contract.Status);
        Assert.Equal(tenantUserId, contract.TenantUserId);
        Assert.Empty(contract.Signatures); Assert.Null(contract.ActivatedAt);
        var document = new ContractDocument(contract.Id, contract.RoomId, contract.OwnerSignerId, Guid.Empty,
            contract.RepresentativeResidentId, contract.Residents.Select(r => r.ResidentId).Order().ToArray(),
            contract.StartDate, contract.EndDate, contract.MonthlyRent, contract.RequiredDeposit,
            contract.HoldingContractId, contract.AppliedHoldingDeposit, contract.Terms, contract.SnapshotHash)
        { IsInternalResidentAcceptance = true, AgreedCharges = ContractChargeSnapshot.Read(contract).Charges };
        Assert.Equal(bytes, await scope.ServiceProvider.GetRequiredService<IContractSigningDocumentSource>().ReadAsync(document, default));
        Assert.Single(await db.Set<ContractDocumentFile>().Where(f => f.ContractId == draft.Id && f.Kind == ContractFileKind.Preview).ToArrayAsync());
    }

    private sealed class LegacyVersionMainDraftRenderer(IConfiguration configuration, TimeProvider clock,
        int version = 1, bool developmentOnly = false) : IMainDraftRenderer
    {
        private readonly MainDraftRenderer renderer = new(configuration, clock);
        public string TemplateHash => renderer.TemplateHash;
        public bool SigningReviewAvailable => renderer.SigningReviewAvailable;
        public bool CanUseSigningReview(Contract contract) => renderer.CanUseSigningReview(contract);
        public bool IsProductionSigningTemplate(Contract contract) => !developmentOnly && renderer.IsProductionSigningTemplate(contract);
        public int DocumentVersion => version;
        public Task<byte[]> DocxAsync(MainDraftRenderData data, CancellationToken t) => renderer.DocxAsync(data, t);
        public Task<byte[]> PdfAsync(byte[] docx, CancellationToken t) => renderer.PdfAsync(docx, t);
    }

    private sealed class SigningTestScope(Guid locationId) : IHoldingTestScope
    {
        public bool AllowsExternalDatabase => false;
        public bool Allows(Guid candidate) => candidate == locationId;
    }

    [Theory]
    [InlineData(false)]
    public async Task ReleaseCannotAssignAnUnrelatedAccountToAnUnlinkedVerifiedResident(bool verifyInternalRelease)
    {
        var w = await Setup(); var unrelated = await User("Tenant");
        await using var host = ReleaseHost(w.Location); using var owner = InHost(host, w.Owner); using var staff = InHost(host, w.Staff);
        var draft = await Save(w with { Staff = staff });
        var response = await owner.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(response);
        var review = (await response.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        var rejected = await Release(owner, draft.Id, new(unrelated.Id, draft.Version, review.Id, true), Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.Contains("resident_account_already_linked", await rejected.Content.ReadAsStringAsync());
        await using (var check = host.Services.CreateAsyncScope())
        {
            var db = check.ServiceProvider.GetFixturePersistence();
            Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident)).TenantUserId);
            Assert.Equal(ContractStatus.Draft, (await db.Set<Contract>().SingleAsync(c => c.Id == draft.Id)).Status);
        }
        // Null-account release is supported by the deployed Compact24 model. The
        // historical offline schema retains its old non-null signer constraint.
        if (verifyInternalRelease)
        {
            await Success(await Release(owner, draft.Id, new(null, draft.Version, review.Id, true), Guid.NewGuid()));
            var released = (await owner.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{draft.Id}"))!;
            Assert.Null(released.TenantUserId); Assert.Equal("INTERNAL_OTP_DRAWN", released.SigningMode);
            Assert.Equal("PendingSigning", released.Status); Assert.Empty(released.Signatures);
        }
    }
}
