using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using BHome.Infrastructure;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using iText.Signatures;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

public sealed class ContractPdfSigningCompositionTests
{
    private static ServiceProvider Backend()
    {
        var configuration = new ConfigurationBuilder().Build();
        var services = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(configuration);
        services.AddInfrastructure(configuration);
        return services.BuildServiceProvider();
    }

    private static byte[] Document()
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var document = new Document(pdf))
            document.Add(new Paragraph("SYNTHETIC PDF - NOT AN APPROVED CONTRACT TEMPLATE"));
        return output.ToArray();
    }

    [Fact]
    public void MainBackendSignsTwoIncrementalRevisionsWithItsRegisteredPdfImplementation()
    {
        using var backend = Backend();
        var signer = backend.GetRequiredService<IPdfSigner>();
        using var ownerKey = RSA.Create(2048);
        using var tenantKey = RSA.Create(2048);
        using var owner = new CertificateRequest("CN=Synthetic Owner", ownerKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        using var tenant = new CertificateRequest("CN=Synthetic Tenant", tenantKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));

        var first = signer.Prepare(Document(), [owner], DateTimeOffset.UtcNow, null);
        var firstPdf = signer.Complete(first.PreparedPdf, first.FieldName, first.DocumentDigest, [owner],
            ownerKey.SignHash(first.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        var second = signer.Prepare(firstPdf, [tenant], DateTimeOffset.UtcNow, null);
        var signed = signer.Complete(second.PreparedPdf, second.FieldName, second.DocumentDigest, [tenant],
            tenantKey.SignHash(second.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(signed)));
        var signatures = new SignatureUtil(pdf);
        Assert.Equal(2, signatures.GetSignatureNames().Count);
        Assert.True(signatures.ReadSignatureData(first.FieldName).VerifySignatureIntegrityAndAuthenticity());
        Assert.True(signatures.ReadSignatureData(second.FieldName).VerifySignatureIntegrityAndAuthenticity());
        Assert.True(signatures.SignatureCoversWholeDocument(second.FieldName));
    }

    [Fact]
    public void MainBackendRejectsSignatureFromAnUnrelatedPrivateKey()
    {
        using var backend = Backend();
        var signer = backend.GetRequiredService<IPdfSigner>();
        using var key = RSA.Create(2048);
        using var otherKey = RSA.Create(2048);
        using var certificate = new CertificateRequest("CN=Synthetic Signer", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        var prepared = signer.Prepare(Document(), [certificate], DateTimeOffset.UtcNow, null);
        var forged = otherKey.SignHash(prepared.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        Assert.Throws<InvalidSignatureException>(() => signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, [certificate], forged));
    }

    [Fact]
    public async Task MainBackendKeepsSigningBlockedUntilAnApprovedTemplateIsAvailable()
    {
        using var backend = Backend();
        using var scope = backend.CreateScope();
        var renderer = scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>();
        var document = new ContractDocument(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            Guid.NewGuid(), [], new DateOnly(2026, 10, 1), new DateOnly(2027, 10, 1), 3000000, 3000000,
            null, 0, "SYNTHETIC TERMS", "SYNTHETIC HASH");
        var error = await Assert.ThrowsAsync<ContractException>(() => renderer.RenderAsync(document, CancellationToken.None));
        Assert.Equal(503, error.Status);
        Assert.Equal("contract_template_not_configured", error.Code);
    }

    [Fact]
    public async Task SIGN01_ConcreteRendererFeedsExistingSignerAndSyntheticRemoteForBothParties()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var renderer = scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>();
        var signer = backend.GetRequiredService<IPdfSigner>();
        using var remote = new SyntheticRemoteSigningProvider();
        var input = ContractPdfRendererTests.Snapshot();
        var bytes = await renderer.RenderAsync(input, default);
        foreach (var subscriber in new[] { "SYNTHETIC-OWNER", "SYNTHETIC-TENANT" })
        {
            await renderer.ValidateAsync(input, default);
            var credential = Assert.Single(await remote.ListCredentialsAsync(subscriber, null, default));
            var prepared = signer.Prepare(bytes, credential.Chain, DateTimeOffset.UtcNow, null);
            var reference = await remote.RequestSignatureAsync(new(subscriber, credential.CredentialId,
                prepared.DataToSignDigest, Guid.NewGuid().ToString(), "Synthetic renderer integration"), default);
            var signed = Assert.IsType<SignStatus.Signed>(await remote.GetStatusAsync(subscriber, reference, default));
            bytes = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, credential.Chain, signed.RawSignature);
        }
        Assert.Equal(2, remote.RequestCount);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var signatures = new SignatureUtil(pdf);
        var fields = signatures.GetSignatureNames();
        Assert.Equal(2, fields.Count);
        Assert.All(fields, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(fields[^1]));
        Assert.Equal(input.SnapshotHash, pdf.GetDocumentInfo().GetMoreInfo("BHomeSnapshotHash"));
        Assert.Contains("Nguyễn Ánh", ContractPdfRendererTests.Text(pdf));
    }

    [Fact]
    public async Task SIGN04_TamperingWithPreparedDocumentCannotProduceAcceptedSignedEvidence()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var bytes = await scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>()
            .RenderAsync(ContractPdfRendererTests.Snapshot(), default);
        var signer = backend.GetRequiredService<IPdfSigner>();
        using var key = RSA.Create(2048);
        using var certificate = new CertificateRequest("CN=Synthetic Renderer Signer", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        var prepared = signer.Prepare(bytes, [certificate], DateTimeOffset.UtcNow, null);
        var signature = key.SignHash(prepared.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var altered = prepared.PreparedPdf.ToArray();
        // Keep a readable, equal-length PDF header, but change a byte inside the signed byte range.
        Assert.True(altered.AsSpan(0, 5).SequenceEqual("%PDF-"u8));
        altered[7] = altered[7] == (byte)'6' ? (byte)'7' : (byte)'6';
        Assert.Throws<InvalidSignatureException>(() => signer.Complete(altered, prepared.FieldName,
            prepared.DocumentDigest, [certificate], signature));

        var accepted = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, [certificate], signature);
        accepted[7] = accepted[7] == (byte)'6' ? (byte)'7' : (byte)'6';
        using var tampered = new PdfDocument(new PdfReader(new MemoryStream(accepted)));
        Assert.False(new SignatureUtil(tampered).ReadSignatureData(prepared.FieldName).VerifySignatureIntegrityAndAuthenticity());
    }

    [Fact]
    public async Task ReusingAnEarlierPdfDoesNotBypassProductionTemplatePolicy()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var renderer = scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>();
        var input = ContractPdfRendererTests.Snapshot();
        await renderer.RenderAsync(input, default);
        backend.GetRequiredService<Microsoft.Extensions.Hosting.IHostEnvironment>().EnvironmentName = "Production";
        var error = await Assert.ThrowsAsync<ContractException>(() => renderer.ValidateAsync(input, default));
        Assert.Equal(503, error.Status);
        Assert.Equal("contract_template_not_approved", error.Code);
    }

    [Fact]
    public async Task ApiHostUsesExplicitTestingTemplateConfigurationWithoutReplacingTheRenderer()
    {
        await using var root = new ApiFactory();
        await using var host = root.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ContractPdf:TemplateId"] = ContractPdfRendererTests.TemplateId
            })));
        await using var scope = host.Services.CreateAsyncScope();
        var bytes = await scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>()
            .RenderAsync(ContractPdfRendererTests.Snapshot(), default);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        Assert.Equal(ContractPdfRendererTests.TemplateId, pdf.GetDocumentInfo().GetMoreInfo("BHomeTemplateId"));
        Assert.Contains("CHƯA PHÊ DUYỆT", ContractPdfRendererTests.Text(pdf));
    }

    [Theory]
    [InlineData("POST", "", "draft")]
    [InlineData("POST", "/signing", "signing")]
    [InlineData("POST", "/signing/sync", "empty")]
    [InlineData("POST", "/signing/recover", "recover")]
    [InlineData("GET", "/document", "empty")]
    [InlineData("GET", "/activation-readiness", "empty")]
    public async Task ExistingContractEndpointsRejectAnonymousBeforeRenderingOrSigning(string method, string action, string body)
    {
        await using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        var input = ContractPdfRendererTests.Snapshot();
        object payload = body switch
        {
            "draft" => new ContractDraftInput(input.RoomId, input.OwnerSignerId, input.TenantUserId, input.RepresentativeResidentId,
                input.ResidentIds, input.StartDate, input.EndDate, input.MonthlyRent, input.RequiredDeposit, input.Terms),
            "signing" => new SigningInput(Guid.NewGuid()),
            "recover" => new SigningRecoveryInput("SYNTHETIC-PROVIDER-REFERENCE"),
            _ => new { }
        };
        var route = "/api/v1/contracts" + (body == "draft" ? "" : $"/{input.ContractId}{action}");
        using var request = new HttpRequestMessage(new HttpMethod(method), route);
        if (method == "POST") request.Content = System.Net.Http.Json.JsonContent.Create(payload);
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var response = await client.SendAsync(request);
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }
}
