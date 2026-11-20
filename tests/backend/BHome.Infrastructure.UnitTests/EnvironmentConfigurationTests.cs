using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.Extensions.Configuration;

namespace BHome.Infrastructure.UnitTests;

public sealed class EnvironmentConfigurationTests
{
    [Theory]
    [InlineData("AuthenticationEmail:WebInvitationUrl", "https://old.ngrok-free.dev/accept-invitation")]
    [InlineData("AuthenticationEmail:WebResetUrl", "https://old.trycloudflare.com/reset-password")]
    [InlineData("AuthenticationEmail:WebVerificationUrl", "https://old.ngrok-free.app/confirm-email")]
    [InlineData("AuthenticationEmail:TrustedOrigins:0", "https://old.ngrok-free.dev")]
    [InlineData("Cors:AllowedOrigins:0", "https://old.ngrok-free.dev")]
    [InlineData("AnonymousSigning:PublicSigningUrl", "https://old.ngrok-free.dev/contract-signing")]
    public void DevelopmentRejectsObsoleteTunnelConfigurationBeforeItCanIssueLinks(string key, string value)
    {
        var c = new ConfigurationManager();
        c["ConnectionStrings:Database"] = "Host=localhost;Database=synthetic";
        c[key] = value;
        Assert.Contains(EnvironmentConfiguration.Errors(c, "Development"), error => error.Contains(key.Split(':')[0]) && error.Contains("Initialize-LocalUrls.ps1"));
        Assert.DoesNotContain(value, string.Join(" ", EnvironmentConfiguration.Errors(c, "Development")));
    }
    [Fact]
    public void PublicWebsiteCannotBecomeACookieAuthenticationOrigin()
    {
        var c = Deployment("Production");
        c["Deployment:PublicOrigin"] = "https://public.example.invalid";
        c["Cors:AllowedOrigins:1"] = "https://public.example.invalid";
        c["AuthWeb:AllowedOrigins:1"] = "https://public.example.invalid";
        Assert.Contains(EnvironmentConfiguration.Errors(c, "Production"), e => e.StartsWith("AuthWeb:AllowedOrigins must use"));
    }
    private static ConfigurationManager Deployment(string environment = "Staging", string owner = "https://stage.example.invalid")
    {
        var c = new ConfigurationManager();
        c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Deployment:Environment"] = environment,
            ["Deployment:OwnerOrigin"] = owner,
            ["AllowedHosts"] = new Uri(owner).Host + ";api-" + environment.ToLowerInvariant() + ".example.invalid",
            ["Deployment:ApiOrigin"] = "https://api-" + environment.ToLowerInvariant() + ".example.invalid",
            ["SePay:Mode"] = environment == "Production" ? "Live" : "Test"
        });
        EnvironmentConfiguration.ApplyDeploymentDefaults(c);
        return c;
    }

    [Theory]
    [InlineData("Staging", "https://api-sepay-test.103.146.23.157.sslip.io")]
    [InlineData("Production", "https://owner.103.146.23.157.sslip.io")]
    [InlineData("Production", "https://owner.bhome.example")]
    public void DeploymentDerivesAllCallbacksFromConfiguredOrigins(string environment, string owner)
    {
        var c = Deployment(environment, owner);
        Assert.Empty(EnvironmentConfiguration.Errors(c, environment));
        var auth = c.GetSection("AuthenticationEmail").Get<AuthenticationEmailOptions>()!;
        Assert.True(auth.Configured(false)); Assert.True(auth.VerificationConfigured(false));
        Assert.Equal(owner + "/accept-invitation", auth.WebInvitationUrl);
        Assert.Equal(owner + "/reset-password", auth.WebResetUrl);
        Assert.Equal(owner + "/confirm-email", auth.WebVerificationUrl);
        Assert.Equal(owner + "/contract-signing", c["AnonymousSigning:PublicSigningUrl"]);
        Assert.Equal("bhome://accept-invitation", auth.MobileInvitationUrl);
        Assert.Equal("bhome://reset-password", auth.MobileResetUrl);
        Assert.Equal("bhome://confirm-email", auth.MobileVerificationUrl);
    }

    [Theory]
    [InlineData("http://owner.example.invalid/contract-signing")]
    [InlineData("https://localhost:5176/contract-signing")]
    [InlineData("https://test.trycloudflare.com/contract-signing")]
    [InlineData("https://test.ngrok-free.dev/contract-signing")]
    [InlineData("https://sensitive:private@owner.example.invalid/contract-signing")]
    [InlineData("owner.example.invalid/contract-signing")]
    [InlineData("https://stage.example.invalid/contract-signing")]
    public void ProductionRejectsInvalidSigningAndCrossEnvironmentUrlsWithoutEchoingValues(string url)
    {
        var c = Deployment("Production", "https://owner.example.invalid");
        c["AnonymousSigning:PublicSigningUrl"] = url;
        var errors = EnvironmentConfiguration.Errors(c, "Production");
        Assert.Contains(errors, e => e.Contains("AnonymousSigning:PublicSigningUrl"));
        Assert.DoesNotContain("sensitive", string.Join(" ", errors));
        Assert.DoesNotContain("private", string.Join(" ", errors));
    }

    [Theory]
    [InlineData("AuthenticationEmail:WebResetUrl", "https://owner.production.example/reset-password")]
    [InlineData("AuthenticationEmail:WebInvitationUrl", "http://localhost:5173/accept-invitation")]
    [InlineData("AuthenticationEmail:WebVerificationUrl", "https://owner.production.example/confirm-email")]
    [InlineData("ContractSigning:InvitationLink:PublicOpenUrl", "https://api.production.example/open/sign-contract")]
    [InlineData("Cors:AllowedOrigins:0", "https://owner.production.example")]
    [InlineData("AuthWeb:AllowedOrigins:0", "https://owner.production.example")]
    public void StagingRejectsUrlsAndOriginsFromAnotherDeployment(string key, string value)
    {
        var c = Deployment(); c[key] = value;
        Assert.NotEmpty(EnvironmentConfiguration.Errors(c, "Staging"));
    }

    [Fact]
    public void ExplicitLegacyCallbacksRemainAuthoritativeAndAreCheckedAgainstAnchors()
    {
        var c = new ConfigurationManager();
        c["AuthenticationEmail:WebResetUrl"] = "https://legacy.example/reset-password";
        c["Deployment:OwnerOrigin"] = "https://new.example"; c["Deployment:ApiOrigin"] = "https://api.example";
        EnvironmentConfiguration.ApplyDeploymentDefaults(c);
        Assert.Equal("https://legacy.example/reset-password", c["AuthenticationEmail:WebResetUrl"]);
        Assert.Contains(EnvironmentConfiguration.Errors(c, "Staging"), e => e.Contains("WebResetUrl"));
    }

    [Fact]
    public void LocalCallbacksStayLocalAndRemoteDatabaseRequiresDeliberateOptIn()
    {
        var c = new ConfigurationManager();
        c["ConnectionStrings:Database"] = "Host=localhost;Database=synthetic_local";
        c["AnonymousSigning:PublicSigningUrl"] = "https://localhost:5176/contract-signing";
        c["AuthenticationEmail:WebResetUrl"] = "http://localhost:5173/reset-password";
        Assert.Empty(EnvironmentConfiguration.Errors(c, "Development"));
        c["ConnectionStrings:Database"] = "Host=production.example.invalid;Database=synthetic;Password=DO_NOT_ECHO";
        var errors = EnvironmentConfiguration.Errors(c, "Development");
        Assert.Contains(errors, e => e.Contains("Development database"));
        Assert.DoesNotContain("DO_NOT_ECHO", string.Join(" ", errors));
    }

    [Fact]
    public void SandboxSePayIsAcceptedOnlyInNonProductionAndCannotUseLiveApi()
    {
        var o = new SePayOptions
        {
            Enabled = true,
            WebhookSecret = new string('x', 40),
            ReceivingAccounts =
            [new() { LocationId = Guid.NewGuid(), BankIdentifier = "970416", Gateway = "ACB", AccountNumber = "0000001234" }]
        };
        Assert.True(o.Valid("Staging")); Assert.True(o.Valid("Development")); Assert.False(o.Valid("Production"));
        o.ApiBaseUrl = "https://userapi.sepay.vn/v2"; Assert.False(o.Valid("Staging"));
        o.Mode = "Live"; Assert.False(o.Valid("Staging")); Assert.True(o.Valid("Production"));
        Assert.False(o.Valid("Stagin"));
        Assert.Contains(EnvironmentConfiguration.Errors(new ConfigurationManager(), "Stagin"), e => e.Contains("supported host environment"));
        var c = Deployment("Production"); c["SePay:Mode"] = "Test";
        Assert.Contains(EnvironmentConfiguration.Errors(c, "Production"), e => e.Contains("SePay:Mode"));
    }

    [Fact]
    public void EmailCaptureCannotEscapeLoopbackOrRunOnDeploymentAndSmtpStagingNeedsAllowlist()
    {
        var o = new EmailOptions { Enabled = true, DeliveryMode = "Capture", Host = "localhost", Port = 1025, FromEmail = "sender@example.invalid" };
        Assert.True(o.ValidForEnvironment("Development")); Assert.True(o.ValidForEnvironment("Testing"));
        Assert.False(o.ValidForEnvironment("Production")); Assert.False(o.ValidForEnvironment("Staging"));
        o.Host = "smtp.gmail.com"; Assert.False(o.ValidForEnvironment("Development"));
        o.DeliveryMode = "Smtp"; o.Username = o.FromEmail; o.AppPassword = "synthetic";
        Assert.False(o.ValidForEnvironment("Staging"));
        o.AllowedRecipients = ["recipient@example.invalid"]; Assert.True(o.ValidForEnvironment("Staging"));
        Assert.True(o.RecipientAllowed("RECIPIENT@example.invalid")); Assert.False(o.RecipientAllowed("other@example.invalid"));
        o.UseStartTls = false; Assert.False(o.ValidForEnvironment("Staging"));
    }

    [Fact]
    public void AnyRecipientOptInWorksOnlyForDevelopmentSmtp()
    {
        var o = new EmailOptions
        {
            Enabled = true,
            DeliveryMode = "Smtp",
            Host = "smtp.gmail.com",
            Username = "sender@example.invalid",
            FromEmail = "sender@example.invalid",
            AppPassword = "synthetic",
            AllowedRecipients = ["test@example.invalid"]
        };
        Assert.False(o.RecipientAllowed("staff@example.invalid", "Development"));
        o.AllowAnyRecipientInDevelopment = true;
        Assert.True(o.ValidForEnvironment("Development"));
        Assert.True(o.RecipientAllowed("staff@example.invalid", "Development"));
        Assert.False(o.RecipientAllowed("staff@example.invalid", "Staging"));
        Assert.False(o.ValidForEnvironment("Staging"));
        Assert.False(o.ValidForEnvironment("Testing"));
        Assert.False(o.ValidForEnvironment("Production"));
        o.AllowedRecipients = [];
        Assert.True(o.ValidForEnvironment("Development"));
        Assert.False(o.ValidForEnvironment("Staging"));
        o.DeliveryMode = "Capture"; o.Host = "localhost"; o.Port = 1025;
        Assert.False(o.ValidForEnvironment("Development"));
    }
}
