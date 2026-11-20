using BHome.Application.Notifications;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

public sealed class AnonymousSigningUrlTests
{
    private static AnonymousSigningSecurity Security(string configuredUrl) => new(
        Options.Create(new AnonymousSigningOptions { PublicSigningUrl = configuredUrl }),
        Substitute.For<INotificationChannelProvider>(),
        Options.Create(new NotificationChannelOptions()),
        new MailKitEmailSender(Options.Create(new EmailOptions()), NullLogger<MailKitEmailSender>.Instance));

    [Fact]
    public void LocalHttpsSigningUrlWorksWithoutACloudflareDomain()
    {
        Assert.Equal("https://localhost:5176/contract-signing#token=a%2Bb%2Fc",
            Security("https://localhost:5176/contract-signing").InvitationUrl("a+b/c"));
    }

    [Theory]
    [InlineData("http://localhost:5173/contract-signing")]
    [InlineData("https://localhost:5176/contract-signing#stale")]
    [InlineData("https://localhost:5176/contract-signing?token=stale")]
    [InlineData("https://name:secret@localhost:5176/contract-signing")]
    [InlineData("javascript:alert(1)")]
    public void InsecureOrAmbiguousSigningPageConfigurationCannotCreateASecretLink(string url)
    {
        Assert.Null(Security(url).InvitationUrl("synthetic-token"));
    }
}
