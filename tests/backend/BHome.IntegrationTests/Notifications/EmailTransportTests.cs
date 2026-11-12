using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using MailKit.Net.Smtp;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Notifications;

public sealed class EmailTransportTests
{
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
