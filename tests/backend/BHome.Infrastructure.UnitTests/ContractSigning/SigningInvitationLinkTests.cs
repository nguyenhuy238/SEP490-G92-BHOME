using BHome.Application.Contracts;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

// The signing invitation email opens the app on the contract's signing page (BHOME_OTP_Signing_Plan.md, invitation link).
public sealed class SigningInvitationLinkTests
{
    private static readonly Guid Contract = Guid.Parse("f12af792-5b8b-4c1b-8bcd-f2ea9a7c8bb7");

    [Fact]
    public void DefaultLinkOpensTheAppSigningRoute()
    {
        var options = new SigningInvitationLinkOptions();
        Assert.Equal("bhome://sign-contract?contractId=f12af792-5b8b-4c1b-8bcd-f2ea9a7c8bb7", options.EmailLink(Contract));
    }

    [Fact]
    public void PublicPageIsPreferredForTheEmailAndForwardsToTheApp()
    {
        var options = new SigningInvitationLinkOptions
        {
            PublicOpenUrl = "https://api.bhome.example/open/sign-contract/",
            MobileAppUrl = "exp://192.168.1.10:8081/--/sign-contract",
        };
        Assert.Equal("https://api.bhome.example/open/sign-contract?contractId=f12af792-5b8b-4c1b-8bcd-f2ea9a7c8bb7", options.EmailLink(Contract));
        Assert.Equal("exp://192.168.1.10:8081/--/sign-contract?contractId=f12af792-5b8b-4c1b-8bcd-f2ea9a7c8bb7", options.AppLink(Contract));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://evil.example/sign")]
    [InlineData("bhome://sign-contract?next=x")]
    [InlineData("not a url")]
    [InlineData("")]
    public void UnsafeOrMissingAppLinkGivesNoLink(string app)
    {
        var options = new SigningInvitationLinkOptions { MobileAppUrl = app };
        Assert.Null(options.AppLink(Contract));
        Assert.Null(options.EmailLink(Contract));
    }

    [Theory]
    [InlineData("bhome://open/sign-contract")]
    [InlineData("https://user:pw@api.bhome.example/open/sign-contract")]
    [InlineData("https://api.bhome.example/open/sign-contract#x")]
    public void UnsafePublicPageFallsBackToTheAppLink(string open)
    {
        var options = new SigningInvitationLinkOptions { PublicOpenUrl = open };
        Assert.Equal("bhome://sign-contract?contractId=f12af792-5b8b-4c1b-8bcd-f2ea9a7c8bb7", options.EmailLink(Contract));
    }
}
