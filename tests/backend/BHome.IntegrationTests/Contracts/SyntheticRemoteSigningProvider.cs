using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;

namespace BHome.IntegrationTests.Contracts;

// Test-only provider boundary. Its self-signed certificates establish no real identity or CA trust.
internal sealed class SyntheticRemoteSigningProvider : ISigningProvider, IDisposable
{
    private readonly Dictionary<string, (RSA Key, X509Certificate2 Certificate)> signers = new();
    private readonly ConcurrentDictionary<string, (string Subscriber, byte[] Signature)> transactions = new();
    public string Code => SigningProviders.ViettelMySign;
    public int RequestCount => transactions.Count;

    public SyntheticRemoteSigningProvider()
    {
        foreach (var subscriber in new[] { "SYNTHETIC-OWNER", "SYNTHETIC-TENANT" })
        {
            var key = RSA.Create(2048);
            var certificate = new CertificateRequest("CN=" + subscriber, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
                .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
            signers.Add(subscriber, (key, certificate));
        }
    }

    public Task<IReadOnlyList<RemoteCredential>> ListCredentialsAsync(string subscriber, string? serial, CancellationToken t)
    {
        var (_, certificate) = signers[subscriber];
        IReadOnlyList<RemoteCredential> found = serial is null || serial == certificate.SerialNumber
            ? [new(certificate.SerialNumber, certificate, [certificate], certificate.SerialNumber)] : [];
        return Task.FromResult(found);
    }

    public Task<string> RequestSignatureAsync(SignHashRequest input, CancellationToken t)
    {
        var (key, certificate) = signers[input.ProviderUserId];
        if (input.CredentialId != certificate.SerialNumber) throw new InvalidOperationException("Unexpected synthetic credential.");
        var reference = Guid.NewGuid().ToString("N");
        transactions[reference] = (input.ProviderUserId, key.SignHash(input.Digest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        return Task.FromResult(reference);
    }

    public Task<SignStatus> GetStatusAsync(string subscriber, string reference, CancellationToken t)
    {
        var entry = transactions[reference];
        if (entry.Subscriber != subscriber) throw new InvalidOperationException("Unexpected synthetic subscriber.");
        return Task.FromResult<SignStatus>(new SignStatus.Signed(entry.Signature));
    }

    public Task<string?> CheckAccountAsync(string subscriber, CancellationToken t) => Task.FromResult<string?>(null);

    public void Dispose()
    {
        foreach (var (key, certificate) in signers.Values) { certificate.Dispose(); key.Dispose(); }
    }
}

// This renderer is injected only in the test host. It cannot become a production contract template.
internal sealed class SyntheticContractRenderer : IContractDocumentRenderer
{
    public Task<byte[]> RenderAsync(ContractDocument snapshot, CancellationToken t)
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var document = new Document(pdf))
        {
            document.Add(new Paragraph("SYNTHETIC TEST TEMPLATE - NOT A LEGAL CONTRACT"));
            document.Add(new Paragraph(snapshot.SnapshotHash));
            document.Add(new Paragraph(snapshot.Terms));
        }
        return Task.FromResult(output.ToArray());
    }
}
