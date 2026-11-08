using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using iText.Signatures;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

// Expected behaviour comes from BHOME_OTP_Signing_Plan.md §4/§7 (SRS v1.3 UC-15/UC-16 "electronically sign",
// DBR-03 traceable evidence; proposed D6: 6 digits, 5 minutes, 5 wrong attempts, resend after 60 s, single use).
public sealed class OtpSigningTests
{
    private static readonly Guid SignatureId = Guid.Parse("4e1c2f0a-1111-4a2b-9c3d-000000000001");

    private sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static (SigningOtpChallenges Challenges, Clock Clock, IDistributedCache Cache) NewChallenges()
    {
        var clock = new Clock(new DateTimeOffset(2026, 11, 9, 3, 0, 0, TimeSpan.Zero));
        var cache = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns("Testing");
        var options = Options.Create(new ContractSigningOptions());
        return (new SigningOtpChallenges(cache, options, new ConfigurationBuilder().Build(), environment, clock), clock, cache);
    }

    [Fact]
    public async Task ACodeHasSixDigitsIsAcceptedOnceAndOnlyItsHashIsStored()
    {
        var (challenges, _, cache) = NewChallenges();
        var (code, _) = await challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None);

        Assert.Matches("^[0-9]{6}$", code);
        var stored = await cache.GetStringAsync("bhome:contract-otp:" + SignatureId.ToString("N"));
        Assert.NotNull(stored);
        Assert.DoesNotContain(code, stored);
        Assert.Equal(SigningOtpChallenges.Check.Valid, await challenges.VerifyAsync(SignatureId, code, CancellationToken.None));
        // Single use: the same code cannot sign a second time.
        Assert.Equal(SigningOtpChallenges.Check.Missing, await challenges.VerifyAsync(SignatureId, code, CancellationToken.None));
    }

    [Fact]
    public async Task FiveWrongCodesLockTheSignatureEvenForTheRightCode()
    {
        var (challenges, _, _) = NewChallenges();
        var (code, _) = await challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None);
        var wrong = code == "000000" ? "111111" : "000000";

        for (var attempt = 1; attempt <= 4; attempt++)
            Assert.Equal(SigningOtpChallenges.Check.Wrong, await challenges.VerifyAsync(SignatureId, wrong, CancellationToken.None));
        Assert.Equal(SigningOtpChallenges.Check.Locked, await challenges.VerifyAsync(SignatureId, wrong, CancellationToken.None));
        Assert.Equal(SigningOtpChallenges.Check.Locked, await challenges.VerifyAsync(SignatureId, code, CancellationToken.None));
        var locked = await Assert.ThrowsAsync<ContractException>(() => challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None));
        Assert.Equal("otp_locked", locked.Code);
    }

    [Fact]
    public async Task ACodeExpiresAfterFiveMinutes()
    {
        var (challenges, clock, _) = NewChallenges();
        var (code, _) = await challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None);

        clock.Now = clock.Now.AddSeconds(301);

        Assert.Equal(SigningOtpChallenges.Check.Expired, await challenges.VerifyAsync(SignatureId, code, CancellationToken.None));
    }

    [Fact]
    public async Task ANewCodeIsOnlySentAfterSixtySecondsAndReplacesTheOldOne()
    {
        var (challenges, clock, _) = NewChallenges();
        var (first, _) = await challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None);

        var tooSoon = await Assert.ThrowsAsync<ContractException>(() => challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None));
        Assert.Equal("otp_resend_too_soon", tooSoon.Code);

        clock.Now = clock.Now.AddSeconds(61);
        var (second, challenge) = await challenges.IssueAsync(SignatureId, "tenant.synthetic@example.com", CancellationToken.None);
        Assert.Equal(2, challenge.Issues);
        if (second != first) Assert.Equal(SigningOtpChallenges.Check.Wrong, await challenges.VerifyAsync(SignatureId, first, CancellationToken.None));
        Assert.Equal(SigningOtpChallenges.Check.Valid, await challenges.VerifyAsync(SignatureId, second, CancellationToken.None));
    }

    [Theory]
    [InlineData("tenant.synthetic@example.com", "t******c@example.com")]
    [InlineData("ab@example.com", "a@example.com")]
    [InlineData("not-an-email", "***")]
    public void TheConfirmationScreenOnlyShowsAMaskedEmail(string email, string expected)
        => Assert.Equal(expected, SigningOtpChallenges.Mask(email));

    // Plan §7 TC10: Owner signs first (here with a certificate, like MySign), then the Tenant's OTP signature is sealed by
    // BHOME as an incremental revision. Both signatures stay valid and the BHOME seal covers the whole document.
    [Fact]
    public void TheBhomeSealKeepsTheOwnersEarlierSignatureValid()
    {
        var services = new ServiceCollection();
        BHome.DigitalSigning.Infrastructure.DependencyInjection.AddContractPdfSigning(services);
        using var provider = services.BuildServiceProvider();
        var pdf = provider.GetRequiredService<IPdfSigner>();
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns("Testing");
        using var seal = new SigningSeal(Options.Create(new ContractSigningOptions()), environment);
        using var ownerKey = RSA.Create(2048);
        using var owner = new CertificateRequest("CN=Synthetic Owner", ownerKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        X509Certificate2[] ownerChain = [owner];

        var first = pdf.Prepare(SimplePdf(), ownerChain, DateTimeOffset.UtcNow, null);
        var ownerSigned = pdf.Complete(first.PreparedPdf, first.FieldName, first.DocumentDigest, ownerChain,
            ownerKey.SignHash(first.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        var second = pdf.Prepare(ownerSigned, seal.Chain, DateTimeOffset.UtcNow,
            new VisibleSignature(1, 0.55, 0.7, 0.35, "Ký điện tử bởi: Người thuê tổng hợp\nXác thực: mã OTP qua email"));
        var result = pdf.Complete(second.PreparedPdf, second.FieldName, second.DocumentDigest, seal.Chain, seal.Sign(second.DataToSignDigest));

        using var document = new PdfDocument(new PdfReader(new MemoryStream(result)));
        var signatures = new SignatureUtil(document);
        Assert.Equal(2, signatures.GetSignatureNames().Count);
        Assert.True(signatures.ReadSignatureData(first.FieldName).VerifySignatureIntegrityAndAuthenticity());
        Assert.True(signatures.ReadSignatureData(second.FieldName).VerifySignatureIntegrityAndAuthenticity());
        Assert.True(signatures.SignatureCoversWholeDocument(second.FieldName));
    }

    [Fact]
    public void OnlyTheConfiguredMethodsAreOffered()
    {
        var mode = Substitute.For<IContractWorkflowMode>();
        var both = new ContractSigningMethods(Options.Create(new ContractSigningOptions { Methods = { Otp = true, ViettelMySign = true } }), mode);
        var otpOnly = new ContractSigningMethods(Options.Create(new ContractSigningOptions { Methods = { Otp = true, ViettelMySign = false } }), mode);

        Assert.Equal([SigningMethods.Otp, SigningMethods.ViettelMySign], both.Enabled);
        Assert.Equal([SigningMethods.Otp], otpOnly.Enabled);
        Assert.False(otpOnly.IsEnabled(SigningMethods.ViettelMySign));

        mode.SimulatedSigningEnabled.Returns(true);
        Assert.Equal([SigningMethods.Simulated], both.Enabled);
    }

    [Fact]
    public async Task OtpSigningIsRefusedWhileTheMethodIsSwitchedOff()
    {
        var mode = Substitute.For<IContractWorkflowMode>();
        var methods = new ContractSigningMethods(Options.Create(new ContractSigningOptions { Methods = { Otp = false } }), mode);
        var router = new ContractSigningRouter(methods, mode, new ServiceCollection().BuildServiceProvider());
        var document = new ContractDocument(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), [],
            new DateOnly(2026, 12, 1), new DateOnly(2027, 11, 30), 3_000_000m, 3_000_000m, null, 0m, "", "");

        var refused = await Assert.ThrowsAsync<ContractException>(() =>
            router.PrepareAsync(document, Guid.Empty, null, new SigningAppearance(null, true, SigningMethods.Otp), CancellationToken.None));

        Assert.Equal(503, refused.Status);
        Assert.Equal("signing_method_disabled", refused.Code);
    }

    private static byte[] SimplePdf()
    {
        using var output = new MemoryStream();
        using (var pdf = new PdfDocument(new PdfWriter(output)))
        using (var layout = new Document(pdf))
            layout.Add(new Paragraph("Synthetic tenancy contract for an automated test."));
        return output.ToArray();
    }
}
