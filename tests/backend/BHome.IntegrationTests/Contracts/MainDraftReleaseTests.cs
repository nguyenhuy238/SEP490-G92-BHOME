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
    private WebApplicationFactory<Program> ReleaseHost()
    {
        var settings = fixture.Factory.Services.GetRequiredService<IConfiguration>().GetSection("IdentityProtection").AsEnumerable().ToDictionary(x => x.Key, x => x.Value);
        settings["MainDraft:LibreOfficeContainerImage"] = "bhome/contract-converter:local"; settings["ContractWorkflow:SimulatedSigningEnabled"] = "true";
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
        await using var host = ReleaseHost(); using var staff = InHost(host, w.Staff); using var owner = InHost(host, w.Owner); using var signer = InHost(host, tenant.Client); using var stranger = InHost(host, outside.Client);
        var draft = await Save(w with { Staff = staff });
        var reviewResponse = await staff.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(reviewResponse);
        var review = (await reviewResponse.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        Assert.True(review.DevelopmentOnly); Assert.Equal("SigningReview", review.Kind);
        var reviewedBytes = await owner.GetByteArrayAsync($"{Root}/{draft.Id}/documents/{review.Id}");
        using (var pdf = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(reviewedBytes))))
        { var text = ContractPdfRendererTests.Text(pdf); Assert.Contains("TÀI LIỆU KIỂM THỬ", text); Assert.DoesNotContain("BẢN NHÁP", text); }
        var input = new MainDraftReleaseInput(tenant.Id, draft.Version, review.Id, true); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await Release(staff, draft.Id, input, key)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Release(owner, draft.Id, input with { HumanReviewed = false }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, input with { ExpectedVersion = 0 }, key)).StatusCode);
        var releases = await Task.WhenAll(Release(owner, draft.Id, input, key), Release(owner, draft.Id, input, key));
        foreach (var response in releases) await Success(response);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, input with { TenantUserId = outside.Id }, key)).StatusCode);
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
        using (var deposit = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/deposit-verifications") { Content = JsonContent.Create(new DepositInput("SYNTHETIC-RELEASE-" + Guid.NewGuid(), 6200000, "Synthetic bank statement confirmed")) })
        { deposit.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); await Success(await owner.SendAsync(deposit)); }
        using (var activate = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{draft.Id}/activate") { Content = JsonContent.Create(new { }) })
        { activate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); await Success(await owner.SendAsync(activate)); }
        var active = (await signer.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{draft.Id}"))!; Assert.Equal("Active", active.Status);
        Assert.All(active.Signatures, s => Assert.Equal("Simulated", s.Status));
        await using var verify = host.Services.CreateAsyncScope(); var db = verify.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var persisted = await db.Set<Contract>().SingleAsync(c => c.Id == draft.Id); Assert.NotEqual("{}", persisted.DraftMetadata);
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(reviewedBytes)), (await db.Set<ContractSignature>().SingleAsync(s => s.ContractId == draft.Id && s.SignerUserId == w.OwnerId)).SourceHash);
        Assert.Equal(1, await db.Set<ContractDocumentFile>().CountAsync(f => f.ContractId == draft.Id && f.Kind == ContractFileKind.Preview));
        Assert.Equal(tenant.Id, (await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident)).TenantUserId);
    }
    [Fact]
    public async Task ReleaseRejectsStaleReviewTamperingAndProductionSampleTemplate()
    {
        var w = await Setup(); var tenant = await User("Tenant");
        await using var host = ReleaseHost(); using var owner = InHost(host, w.Owner); using var staff = InHost(host, w.Staff);
        var draft = await Save(w with { Staff = staff });
        var response = await staff.PostAsync($"{Root}/{draft.Id}/signing-review", null); await Success(response); var review = (await response.Content.ReadFromJsonAsync<ContractDocumentView>())!;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var file = await scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Set<ContractDocumentFile>().SingleAsync(f => f.Id == review.Id);
            using var wrong = new MemoryStream("%PDF-tampered synthetic bytes"u8.ToArray());
            await scope.ServiceProvider.GetRequiredService<IObjectStorage>().PutAsync(file.ObjectKey, wrong, wrong.Length, "application/pdf", default);
        }
        var rejected = await Release(owner, draft.Id, new(tenant.Id, draft.Version, review.Id, true), Guid.NewGuid()); Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode); Assert.Contains("contract_document_integrity_failed", await rejected.Content.ReadAsStringAsync());
        var updated = await Save(w, Input(w) with { Notes = "Changed saved terms", ExpectedVersion = draft.Version }, id: draft.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Release(owner, draft.Id, new(tenant.Id, updated.Version, review.Id, true), Guid.NewGuid())).StatusCode);
        await using var production = fixture.Factory.WithWebHostBuilder(b => b.UseEnvironment("Production")); using var productionOwner = InHost(production, w.Owner);
        var blocked = await productionOwner.PostAsync($"{Root}/{draft.Id}/signing-review", null); Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode); Assert.Contains("main_draft_signing_template_not_approved", await blocked.Content.ReadAsStringAsync());
        await using var verify = fixture.Factory.Services.CreateAsyncScope(); var db = verify.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Null((await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident)).TenantUserId); Assert.Equal(ContractStatus.Draft, (await db.Set<Contract>().SingleAsync(c => c.Id == draft.Id)).Status);
    }
}
