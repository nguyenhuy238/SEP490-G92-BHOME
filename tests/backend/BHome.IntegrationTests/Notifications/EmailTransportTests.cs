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
    [Fact]
    public void ExistingSmtpWithoutAllowlistReportsTheExactMissingKeyAndMigrationCommand()
    {
        using var factory = new ApiFactory();
        using var host = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Email:Enabled"] = "true", ["Email:Username"] = "sender@example.invalid",
            ["Email:FromEmail"] = "sender@example.invalid", ["Email:AppPassword"] = "SYNTHETIC_PRIVATE_PASSWORD",
            ["Email:TestRecipient"] = "existing-test@example.invalid"
        })));
        var error = Assert.Throws<OptionsValidationException>(() => host.CreateClient());
        Assert.Single(error.Failures);
        Assert.Contains("Email:AllowedRecipients:0", error.Message);
        Assert.Contains("Initialize-LocalEmail.ps1", error.Message);
        Assert.DoesNotContain("SYNTHETIC_PRIVATE_PASSWORD", error.Message);
        Assert.DoesNotContain("existing-test@example.invalid", error.Message);
    }
    [Theory]
    [InlineData("http://localhost:5173/accept-invitation", "#")]
    [InlineData("http://localhost:5173/reset-password", "#")]
    [InlineData("http://localhost:5173/confirm-email", "#")]
    [InlineData("https://owner.103.146.23.157.sslip.io/accept-invitation", "#")]
    [InlineData("https://owner.103.146.23.157.sslip.io/reset-password", "#")]
    [InlineData("https://owner.103.146.23.157.sslip.io/confirm-email", "#")]
    [InlineData("bhome://accept-invitation", "?")]
    [InlineData("bhome://reset-password", "?")]
    [InlineData("bhome://confirm-email", "?")]
    public void AuthenticationLinksKeepConfiguredEnvironmentAndEscapeTokens(string callback, string separator)
    {
        var link = BHome.Infrastructure.IdentityAccess.AuthenticationEmailDelivery.CallbackLink(callback, "synthetic+user", "synthetic+/&token");
        Assert.Equal(callback + separator + "userName=synthetic%2Buser&token=synthetic%2B%2F%26token", link);
        if (separator == "#") Assert.Empty(new Uri(link).Query);
    }

    [Theory]
    [InlineData("https://localhost:5176/contract-signing")]
    [InlineData("https://owner.103.146.23.157.sslip.io/contract-signing")]
    [InlineData("https://api-sepay-test.103.146.23.157.sslip.io/contract-signing")]
    public void SigningInvitationStaysOnConfiguredHostAndKeepsTokenInFragment(string url)
    {
        var sender = new MailKitEmailSender(Options.Create(new EmailOptions()), NullLogger<MailKitEmailSender>.Instance, ProductionEnvironment());
        var security = new BHome.Infrastructure.Contracts.AnonymousSigningSecurity(
            Options.Create(new BHome.Infrastructure.Contracts.AnonymousSigningOptions { PublicSigningUrl = url }),
            new SigningChannel(false), Options.Create(new NotificationChannelOptions()), sender);
        Assert.Equal(url + "#token=synthetic%2B%2F%26", security.InvitationUrl("synthetic+/&"));
    }
    private static Microsoft.Extensions.Hosting.IHostEnvironment ProductionEnvironment()
    {
        var environment = new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = "Production" };
        return environment;
    }
    [Fact]
    public void ConfirmationMimeContainsBothOriginalPdfAttachmentsAndRejectsUnsafeFiles()
    {
        var contract = new EmailAttachment("Hop-dong.pdf", "application/pdf", "%PDF-1.7 SYNTHETIC SIGNED"u8.ToArray());
        var receipt = new EmailAttachment("Bien-nhan.pdf", "application/pdf", "%PDF-1.7 SYNTHETIC RECEIPT"u8.ToArray());
        var message = new ChannelMessage("synthetic", "EMAIL", "tenant@example.invalid", "HOLDING_CONFIRMED", "Xác nhận", "Đã thanh toán", Attachments: [contract, receipt]);
        using var mime = new MimeKit.MimeMessage { Body = MailKitEmailSender.BuildBody(message) };
        var parts = mime.Attachments.Cast<MimeKit.MimePart>().ToArray(); Assert.Equal(2, parts.Length);
        using var original = new MemoryStream(); parts[0].Content!.DecodeTo(original);
        Assert.Equal(contract.Content, original.ToArray()); Assert.Equal("Hop-dong.pdf", parts[0].FileName);
        Assert.Contains("Đã thanh toán", mime.TextBody);
        Assert.Throws<ChannelDeliveryException>(() => MailKitEmailSender.BuildBody(message with { Attachments = [contract with { FileName = "bad\r\nBcc: attacker" }] }));
        Assert.Throws<ChannelDeliveryException>(() => MailKitEmailSender.BuildBody(message with { Attachments = [contract with { Content = "not pdf"u8.ToArray() }] }));
    }
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
            Enabled = smtp,
            Username = "sender@example.invalid",
            FromEmail = "sender@example.invalid",
            AppPassword = "synthetic-password"
        }), NullLogger<MailKitEmailSender>.Instance, ProductionEnvironment());
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
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance, ProductionEnvironment());
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

    [Fact]
    public void HoldingConfirmationKeepsRequestedSubjectAndStillSanitizesHeaders()
    {
        Assert.Equal("BHOME – Xác nhận giữ chỗ thành công", EmailTemplate.Subject("BHOME – Xác nhận giữ chỗ thành công", "HOLDING_CONFIRMED"));
        Assert.Equal("Holding  Bcc: injected", EmailTemplate.Subject("Holding\r\nBcc: injected", "HOLDING_CONFIRMED"));
        Assert.Equal("[BHOME] Other", EmailTemplate.Subject("Other", "CONTRACT_SIGNING_INVITATION"));
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
