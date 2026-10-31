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
}
