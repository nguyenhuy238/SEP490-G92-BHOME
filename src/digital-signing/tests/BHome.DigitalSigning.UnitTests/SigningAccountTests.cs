using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Application.Services;
using BHome.DigitalSigning.Infrastructure.Security;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.DigitalSigning.UnitTests;

public sealed class SigningAccountTests
{
    private const string Key = "a-test-key-that-is-long-enough-0123456789";
    private static readonly ViettelAccount Configured = new("https://remotesigning.viettel.vn", "env-client", "env-secret-123456",
        null, "/login", "/credentials/list", "/signHash", "/status", 15);

    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly ISigningSettingsStore settings = Substitute.For<ISigningSettingsStore>();
    private readonly AesGcmSecretProtector protector = new(Key);
    private ViettelSettingsRow? saved;

    public SigningAccountTests()
    {
        user.UserId.Returns(Guid.NewGuid());
        user.IsInRole(Roles.Owner).Returns(true);
        settings.FindAsync(Arg.Any<CancellationToken>()).Returns(_ => saved);
        settings.SaveAsync(Arg.Do<ViettelSettingsRow>(row => saved = row), Arg.Any<CancellationToken>()).Returns(Task.CompletedTask);
    }

    private SigningAccountService Service() => new(user, settings, protector,
        new DigitalSigningPolicy(TimeSpan.FromMinutes(5), 1024, Configured), new SigningAccountCache(), TimeProvider.System);

    [Fact]
    public async Task ConfigurationAppliesUntilSomethingIsSaved()
    {
        var account = await Service().CurrentAsync(CancellationToken.None);

        Assert.Equal("env-client", account.ClientId);
        Assert.Equal("env-secret-123456", account.ClientSecret);
    }

    [Fact]
    public async Task ASavedSecretIsEncryptedOverridesConfigurationAndIsNeverShown()
    {
        var view = await Service().SaveAsync(
            new SaveViettelSettings(null, "db-client", null, "db-secret-abcdefgh", false), CancellationToken.None);

        Assert.NotEqual("db-secret-abcdefgh", saved!.ClientSecretEncrypted);
        Assert.Equal("DATABASE", view.SecretSource);
        Assert.Equal("efgh", view.SecretHint);
        Assert.Equal("CONFIGURATION", view.BaseUrlSource);
        var account = await Service().CurrentAsync(CancellationToken.None);
        Assert.Equal(("db-client", "db-secret-abcdefgh"), (account.ClientId, account.ClientSecret));
    }

    [Fact]
    public async Task ABlankSecretKeepsTheStoredOne()
    {
        await Service().SaveAsync(new SaveViettelSettings(null, null, null, "first-secret-1234", false), CancellationToken.None);
        await Service().SaveAsync(new SaveViettelSettings(null, "other", null, null, false), CancellationToken.None);

        Assert.Equal("first-secret-1234", (await Service().CurrentAsync(CancellationToken.None)).ClientSecret);
    }

    [Fact]
    public async Task OnlyAnOwnerChangesTheAccount()
    {
        user.IsInRole(Roles.Owner).Returns(false);

        var refused = await Assert.ThrowsAsync<DigitalSigningException>(() => Service().SaveAsync(
            new SaveViettelSettings(null, null, null, null, false), CancellationToken.None));
        Assert.Equal(DigitalSigningError.Forbidden, refused.Error);
    }

    [Fact]
    public void ASecretSavedUnderAnotherKeyIsReportedUnreadable()
    {
        var stored = new AesGcmSecretProtector("another-key-that-is-long-enough-987654321").Protect("secret");

        Assert.Equal("secret", new AesGcmSecretProtector("another-key-that-is-long-enough-987654321").Unprotect(stored));
        Assert.Throws<SecretUnreadableException>(() => protector.Unprotect(stored));
    }
}
