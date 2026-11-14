using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using MailKit.Net.Smtp;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using BHome.Api.Configuration;
using System.Net;
using System.Text.RegularExpressions;

namespace BHome.IntegrationTests.Notifications;

public sealed class EmailTransportTests
{
    private sealed class SigningChannel(bool configured) : INotificationChannelProvider
    {
        public bool IsConfigured(string channel) => configured && channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => false;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken t) => throw new InvalidOperationException("No email should be sent by configuration tests.");
    }

    [Theory]
    [InlineData("Sandbox", true, true, true)]
    [InlineData("Sandbox", false, true, false)]
    [InlineData("Sandbox", true, false, false)]
    [InlineData("Unconfigured", false, true, true)]
    [InlineData("Unconfigured", false, false, false)]
    public void SigningUsesConfiguredSmtpEvenInDevelopmentSandboxButRejectsSandboxOnlyDelivery(string mode, bool smtp, bool channel, bool expected)
    {
        var email = new MailKitEmailSender(Options.Create(new EmailOptions
        {
            Enabled = smtp, Username = "sender@example.invalid", FromEmail = "sender@example.invalid", AppPassword = "synthetic-password"
        }), NullLogger<MailKitEmailSender>.Instance);
        var security = new BHome.Infrastructure.Contracts.AnonymousSigningSecurity(
            Options.Create(new BHome.Infrastructure.Contracts.AnonymousSigningOptions()), new SigningChannel(channel),
            Options.Create(new NotificationChannelOptions { Mode = mode }), email);
        Assert.Equal(expected, security.EmailConfigured);
    }

    [Fact]
    public void EnabledEmailWithoutPasswordFailsHostValidationWithSafeConfigurationMessage()
    {
        using var factory = new ApiFactory();
        using var host = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["Email:Enabled"] = "true", ["Email:AppPassword"] = "" })));
        var error = Assert.Throws<OptionsValidationException>(() => host.CreateClient());
        Assert.Contains("Email:AppPassword", error.Message); Assert.DoesNotContain("bhome.notification@gmail.com", error.Message);
    }

    [Fact]
    public void EmailDotEnvFallbackLoadsWithoutOverridingHigherPriorityConfiguration()
    {
        var file = Path.Combine(Path.GetTempPath(), "bhome-email-config-" + Guid.NewGuid().ToString("N"));
        try
        {
            File.WriteAllText(file, "Email__Enabled=true\nEmail__AppPassword=SYNTHETIC_FILE_SECRET\nEmail__TestRecipient=mailbox@example.invalid");
            var config = new ConfigurationManager();
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["Email:AppPassword"] = "SYNTHETIC_EXPLICIT_SECRET" });
            DevelopmentEnvironmentFile.AddFile(config, file);
            Assert.True(config.GetValue<bool>("Email:Enabled"));
            Assert.Equal("SYNTHETIC_EXPLICIT_SECRET", config["Email:AppPassword"]);
            Assert.Equal("mailbox@example.invalid", config["Email:TestRecipient"]);
        }
        finally { File.Delete(file); }
    }

    [Theory]
    [InlineData("tenant@example.invalid", true)]
    [InlineData("", false)]
    [InlineData("not-an-email", false)]
    [InlineData("Tenant <tenant@example.invalid>", false)]
    [InlineData("tenant@example.invalid\r\nBcc: other@example.invalid", false)]
    [InlineData("one@example.invalid,two@example.invalid", false)]
    public void RecipientMustBeOneBareMailbox(string address, bool valid) => Assert.Equal(valid, EmailOptions.ValidAddress(address));

    [Fact]
    public async Task MissingConfigurationAndInvalidRecipientFailBeforeNetworkAndExposeOnlySafeCodes()
    {
        var options = new EmailOptions { Enabled = true, Username = "sender@example.invalid", FromEmail = "sender@example.invalid" };
        Assert.False(options.Valid());
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance);
        var message = new ChannelMessage("synthetic-key", "EMAIL", "invalid", "TEST", "Tiếng Việt", "Nội dung");
        Assert.Equal("email_configuration_invalid", (await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(message, default))).Code);
        options.AppPassword = "SYNTHETIC_TEST_SECRET";
        Assert.True(options.Valid());
        Assert.Equal("email_recipient_invalid", (await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(message, default))).Code);
        options.UseStartTls = false; Assert.False(options.Valid());
    }

    [Fact]
    public void TemplateEncodesUntrustedTextAndPreservesVietnamese()
    {
        var html = EmailTemplate.Html("Hóa đơn <script>alert(1)</script>", "Phòng 101\n<img src=x onerror=alert(1)>");
        Assert.Contains("lang=\"vi\"", html); Assert.Contains("charset=\"utf-8\"", html);
        Assert.Contains("&lt;script&gt;", html); Assert.Contains("&lt;img", html);
        Assert.DoesNotContain("<script>", html); Assert.DoesNotContain("<img", html);
        Assert.Contains("<br>", html);
        Assert.Equal("[BHOME] Hóa đơn  Bcc: injected", EmailTemplate.Subject("Hóa đơn\r\nBcc: injected"));
    }

    [Theory]
    [InlineData("http://localhost:5173/confirm-email#userName=owner%40example.invalid&token=synthetic-token", "EMAIL_CONFIRMATION_REQUESTED", "Xác nhận email")]
    [InlineData("https://owner.example.invalid/reset-password#userName=owner&token=synthetic-token", "PASSWORD_RESET_REQUESTED", "Đặt lại mật khẩu")]
    [InlineData("bhome://accept-invitation?userName=staff&token=synthetic-token", "ACCOUNT_INVITATION", "Thiết lập tài khoản")]
    public void AuthenticationHtmlKeepsTheFullCopyableUrlBeforeRepeatedContentEvenWhenTheClientRemovesAnchors(string url, string eventType, string label)
    {
        var html = EmailTemplate.Html("BHOME", "Repeated authentication body", url, EmailTemplate.ActionLabel(eventType));
        Assert.Contains(">" + WebUtility.HtmlEncode(label) + "</a>", html);
        Assert.Contains("href=\"" + WebUtility.HtmlEncode(url) + "\"", html);
        // Strip tags just as a client that does not preserve the href might do.
        var visible = WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]*>", ""));
        Assert.Contains(url, visible);
        Assert.True(visible.IndexOf(url, StringComparison.Ordinal) < visible.IndexOf("Repeated authentication body", StringComparison.Ordinal));
        Assert.Contains("sao chép toàn bộ liên kết", visible);
    }

    [Fact]
    public void ActionLabelAndCopyableUrlAreEncodedAndOrdinaryEmailsDoNotShowAnEmptyAction()
    {
        var html = EmailTemplate.Html("BHOME", "Nội dung", "https://example.invalid/#token=synthetic&value=\"<tag>", "<img src=x>");
        Assert.DoesNotContain("<img", html); Assert.Contains("&lt;img", html); Assert.Contains("&quot;&lt;tag&gt;", html);
        var ordinary = EmailTemplate.Html("BHOME", "Nội dung");
        Assert.DoesNotContain("href=", ordinary); Assert.DoesNotContain("sao chép toàn bộ liên kết", ordinary);
    }

    [Fact]
    public void SmtpFailuresSeparateSafeRetriesPermanentRejectionAndUnknownSubmission()
    {
        var connection = MailKitEmailSender.Classify(new IOException("PRIVATE_PROVIDER_DATA"), false);
        Assert.True(connection.Retryable); Assert.False(connection.OutcomeUnknown);
        var submission = MailKitEmailSender.Classify(new TimeoutException("PRIVATE_PROVIDER_DATA"), true);
        Assert.True(submission.OutcomeUnknown); Assert.False(submission.Retryable);
        var authentication = MailKitEmailSender.Classify(new MailKit.Security.AuthenticationException("PRIVATE_PROVIDER_DATA"), false);
        Assert.False(authentication.Retryable); Assert.Equal("email_authentication_failed", authentication.Code);
        var transient = MailKitEmailSender.Classify(new SmtpCommandException(SmtpErrorCode.RecipientNotAccepted, SmtpStatusCode.MailboxBusy, "PRIVATE_PROVIDER_DATA"), true);
        Assert.True(transient.Retryable); Assert.False(transient.OutcomeUnknown);
        var permanent = MailKitEmailSender.Classify(new SmtpCommandException(SmtpErrorCode.RecipientNotAccepted, SmtpStatusCode.MailboxUnavailable, "PRIVATE_PROVIDER_DATA"), true);
        Assert.False(permanent.Retryable); Assert.False(permanent.OutcomeUnknown);
        Assert.DoesNotContain("PRIVATE_PROVIDER_DATA", submission.ToString()); Assert.Null(submission.InnerException);
    }
}
