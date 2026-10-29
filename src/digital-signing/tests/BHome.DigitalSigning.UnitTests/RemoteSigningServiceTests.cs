using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.DigitalSigning.Domain;
using BHome.DigitalSigning.Infrastructure.Pdf;
using BHome.Domain.IdentityAccess;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace BHome.DigitalSigning.UnitTests;

public sealed class RemoteSigningServiceTests : IDisposable
{
    private static readonly Guid Signer = Guid.NewGuid();
    private static readonly Guid SomebodyElse = Guid.NewGuid();

    private readonly FakeCa ca = new();
    private readonly InMemoryStore store = new();
    private readonly ISigningProvider provider = Substitute.For<ISigningProvider>();
    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly MutableClock clock = new(new DateTimeOffset(2026, 10, 29, 3, 0, 0, TimeSpan.Zero));
    private readonly Guid certificateId = Guid.NewGuid();
    private byte[]? sentDigest;

    public RemoteSigningServiceTests()
    {
        ActAs(Signer, Roles.Tenant);
        provider.Code.Returns(SigningProviders.ViettelMySign);
        provider.ListCredentialsAsync("079000000001", "01AB", Arg.Any<CancellationToken>())
            .Returns([new RemoteCredential("01AB", ca.Certificate, ca.Chain, "cred-1")]);
        provider.RequestSignatureAsync(Arg.Do<SignHashRequest>(request => sentDigest = request.Digest), Arg.Any<CancellationToken>())
            .Returns("vt-42");
        store.Certificates.Add(certificateId, new SigningCertificate
        {
            Id = certificateId, OwnerUserId = Signer, Provider = SigningProviders.ViettelMySign,
            ProviderUserId = "079000000001", CredentialId = "cred-1", SerialNumber = "01AB", Subject = "CN=A",
            Issuer = "CN=A", ValidFrom = clock.Now.AddDays(-1), ValidTo = clock.Now.AddYears(1), CreatedAt = clock.Now
        });
    }

    private readonly ISignatureImageStore images = Substitute.For<ISignatureImageStore>();

    private RemoteSigningService Service() => new(user, store, provider, new ITextPdfSigner(new PdfAppearanceOptions()),
        new DigitalSigningPolicy(TimeSpan.FromMinutes(5), 10 * 1024 * 1024,
            new ViettelAccount(null, null, null, null, "", "", "", "", 15)), images, clock);

    private StartSigning Request(SignaturePlacement? placement = null) =>
        new(certificateId, "hop-dong-101.pdf", Pdfs.Simple(), null, placement);

    [Fact]
    public async Task SignsOnceTheSignerConfirmsOnThePhone()
    {
        var service = Service();
        var started = await service.StartAsync(Request(new SignaturePlacement(1, 0.5, 0.75, 0.4)), CancellationToken.None);
        Assert.Equal("pending", started.Status);
        Assert.Equal("vt-42", store.Transactions[started.Id].ProviderTransactionId);

        provider.GetStatusAsync("079000000001", "vt-42", Arg.Any<CancellationToken>())
            .Returns(new SignStatus.Signed(ca.Sign(sentDigest!)));
        var finished = await service.StatusAsync(started.Id, CancellationToken.None);

        Assert.Equal("signed", finished.Status);
        Assert.True(finished.CanDownload);
        var document = await service.DownloadAsync(started.Id, CancellationToken.None);
        Assert.Equal("hop-dong-101-da-ky.pdf", document.FileName);
        Assert.Equal(1, Pdfs.SignatureCount(document.Content));
    }

    [Fact]
    public async Task ThePlacedBoxShowsTheSignersPictureWhenTheyKeepOne()
    {
        images.FindAsync(Signer, Arg.Any<CancellationToken>())
            .Returns(new SignatureImage(Pngs.Create(400, 100), 400, 100, new string('a', 64), clock.Now));
        var service = Service();
        var started = await service.StartAsync(Request(new SignaturePlacement(1, 0.55, 0.8, 0.25)), CancellationToken.None);
        provider.GetStatusAsync("079000000001", "vt-42", Arg.Any<CancellationToken>())
            .Returns(new SignStatus.Signed(ca.Sign(sentDigest!)));

        Assert.Equal("signed", (await service.StatusAsync(started.Id, CancellationToken.None)).Status);
        var signed = (await service.DownloadAsync(started.Id, CancellationToken.None)).Content;
        using var document = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(signed)));
        var box = Assert.Single(document.GetPage(1).GetAnnotations()).GetRectangle().ToRectangle();
        Assert.Equal(box.GetWidth() / 4, box.GetHeight(), 1);
    }

    [Fact]
    public async Task WaitsWhileTheSignerHasNotAnswered()
    {
        var service = Service();
        var started = await service.StartAsync(Request(), CancellationToken.None);
        provider.GetStatusAsync("079000000001", "vt-42", Arg.Any<CancellationToken>()).Returns(new SignStatus.Pending());

        Assert.Equal("pending", (await service.StatusAsync(started.Id, CancellationToken.None)).Status);
    }

    [Fact]
    public async Task EndsWhenTheSignerRefuses()
    {
        var service = Service();
        var started = await service.StartAsync(Request(), CancellationToken.None);
        provider.GetStatusAsync("079000000001", "vt-42", Arg.Any<CancellationToken>())
            .Returns(new SignStatus.Rejected("Người ký từ chối trên ứng dụng MySign"));

        var view = await service.StatusAsync(started.Id, CancellationToken.None);

        Assert.Equal("rejected", view.Status);
        Assert.False(view.CanDownload);
    }

    [Fact]
    public async Task ExpiresWithoutAskingViettelOnceTheWindowHasPassed()
    {
        var service = Service();
        var started = await service.StartAsync(Request(), CancellationToken.None);
        clock.Now += TimeSpan.FromMinutes(6);

        Assert.Equal("expired", (await service.StatusAsync(started.Id, CancellationToken.None)).Status);
        await provider.DidNotReceiveWithAnyArgs().GetStatusAsync(default!, default!, default);
    }

    [Fact]
    public async Task AWrongSignatureFailsTheAttemptInsteadOfKeepingTheFile()
    {
        using var impostor = new FakeCa("Kẻ mạo danh");
        var service = Service();
        var started = await service.StartAsync(Request(), CancellationToken.None);
        provider.GetStatusAsync("079000000001", "vt-42", Arg.Any<CancellationToken>())
            .Returns(new SignStatus.Signed(impostor.Sign(sentDigest!)));

        var view = await service.StatusAsync(started.Id, CancellationToken.None);

        Assert.Equal("failed", view.Status);
        Assert.Equal("SIGNATURE_INVALID", view.ErrorCode);
        Assert.Null(store.Transactions[started.Id].SignedPdf);
    }

    [Fact]
    public async Task ARefusalByViettelFailsTheAttempt()
    {
        provider.RequestSignatureAsync(Arg.Any<SignHashRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new SigningProviderException("signHash failed: invalid_credential"));

        var refused = await Assert.ThrowsAsync<DigitalSigningException>(
            () => Service().StartAsync(Request(), CancellationToken.None));

        Assert.Equal(DigitalSigningError.ProviderUnavailable, refused.Error);
        Assert.Equal(SigningTransactionStatus.Failed, Assert.Single(store.Transactions.Values).Status);
    }

    [Fact]
    public async Task OnlyTheRequesterFollowsTheAttempt()
    {
        var started = await Service().StartAsync(Request(), CancellationToken.None);
        ActAs(SomebodyElse, Roles.Owner);

        var hidden = await Assert.ThrowsAsync<DigitalSigningException>(
            () => Service().StatusAsync(started.Id, CancellationToken.None));
        Assert.Equal(DigitalSigningError.NotFound, hidden.Error);
    }

    [Fact]
    public async Task SomebodyElsesCertificateCannotSign()
    {
        ActAs(SomebodyElse, Roles.Owner);

        var refused = await Assert.ThrowsAsync<DigitalSigningException>(
            () => Service().StartAsync(Request(), CancellationToken.None));
        Assert.Equal(DigitalSigningError.NotFound, refused.Error);
    }

    [Fact]
    public async Task ALockedCertificateCannotSign()
    {
        store.Certificates[certificateId].Locked = true;

        var refused = await Assert.ThrowsAsync<DigitalSigningException>(
            () => Service().StartAsync(Request(), CancellationToken.None));
        Assert.Equal(DigitalSigningError.Conflict, refused.Error);
    }

    [Fact]
    public async Task OnlyPdfFilesAreSigned()
    {
        var refused = await Assert.ThrowsAsync<DigitalSigningException>(() => Service().StartAsync(
            Request() with { Pdf = "hello"u8.ToArray() }, CancellationToken.None));
        Assert.Equal(DigitalSigningError.Invalid, refused.Error);
    }

    [Fact]
    public void TheBoxNamesTheSignerAndTheVietnamTime()
    {
        var text = RemoteSigningService.AppearanceText(ca.Certificate, new DateTimeOffset(2026, 10, 29, 3, 0, 5, TimeSpan.Zero));

        Assert.Equal("Ký bởi: Nguyễn Văn A\nNgày ký: 29/10/2026 10:00:05", text);
    }

    private void ActAs(Guid id, string role)
    {
        user.UserId.Returns(id);
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
    }

    public void Dispose() => ca.Dispose();
}
