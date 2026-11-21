using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Application.Services;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.DigitalSigning.UnitTests;

public sealed class SignatureImageTests
{
    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly ISignatureImageStore store = Substitute.For<ISignatureImageStore>();

    public SignatureImageTests()
    {
        user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(Roles.Tenant).Returns(true);
    }

    private SignatureImageService Service() => new(user, store, TimeProvider.System);

    [Fact]
    public async Task KeepsATransparentPng()
    {
        var view = await Service().SaveAsync(Pngs.Create(300, 120), CancellationToken.None);

        Assert.True(view.Present);
        Assert.Equal((300, 120), (view.Width, view.Height));
        await store.Received(1).SaveAsync(user.UserId!.Value, Arg.Any<SignatureImage>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("opaque", "Ảnh phải có nền trong suốt.")]
    [InlineData("tiny", "Mỗi cạnh của ảnh phải từ 40 đến 4000 điểm ảnh (ảnh này 20 × 20).")]
    [InlineData("jpeg", "Ảnh phải là tệp PNG.")]
    public async Task RefusesAPictureThatCannotSitOverAPage(string kind, string message)
    {
        var content = kind switch
        {
            "opaque" => Pngs.Create(300, 120, transparent: false),
            "tiny" => Pngs.Create(20, 20),
            _ => new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }
        };

        var refused = await Assert.ThrowsAsync<DigitalSigningException>(() => Service().SaveAsync(content, CancellationToken.None));

        Assert.Equal(message, refused.Message);
    }
}
