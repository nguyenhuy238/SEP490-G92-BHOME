using System.Security.Cryptography;
using System.Text;
using BHome.Application.Notifications;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;
using MimeKit;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class MailKitEmailSender(IOptions<EmailOptions> options, ILogger<MailKitEmailSender> logger, IHostEnvironment environment)
{
    internal bool IsConfigured => options.Value.Enabled && options.Value.ValidForEnvironment(environment.EnvironmentName);

    internal async Task<string> SendAsync(ChannelMessage message, CancellationToken t)
    {
        var config = options.Value;
        if (!IsConfigured) throw new ChannelDeliveryException("email_configuration_invalid");
        if (!EmailOptions.ValidAddress(message.Destination)) throw new ChannelDeliveryException("email_recipient_invalid");
        if (!config.RecipientAllowed(message.Destination, environment.EnvironmentName)) throw new ChannelDeliveryException("email_recipient_not_allowed");
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(message.IdempotencyKey))).ToLowerInvariant();
        using var mail = new MimeMessage();
        mail.From.Add(new MailboxAddress(Encoding.UTF8, config.FromName, config.FromEmail));
        mail.To.Add(new MailboxAddress("", message.Destination));
        mail.MessageId = $"{key}@bhome.notification";
        mail.Subject = EmailTemplate.Subject(message.Title, message.EventType);
        mail.Body = BuildBody(message);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t);
        timeout.CancelAfter(TimeSpan.FromSeconds(config.TimeoutSeconds));
        using var client = new SmtpClient { Timeout = config.TimeoutSeconds * 1000 };
        var submitting = false;
        try
        {
            // Only the validated loopback capture sink is plaintext and unauthenticated.
            // Real SMTP always requires STARTTLS with normal certificate validation.
            await client.ConnectAsync(config.Host, config.Port,
                config.LocalCapture ? SecureSocketOptions.None : SecureSocketOptions.StartTls, timeout.Token);
            if (!config.LocalCapture)
                await client.AuthenticateAsync(config.Username, config.AppPassword.Replace(" ", ""), timeout.Token);
            submitting = true;
            await client.SendAsync(mail, timeout.Token);
            logger.LogInformation("SMTP accepted notification {DeliveryKey}; inbox delivery is not confirmed", key);
            return "smtp-accepted:" + key;
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            var failure = Classify(e, submitting);
            logger.LogWarning("SMTP notification {DeliveryKey} ended with {ErrorCode}", key, failure.Code);
            // Do not retain the provider exception, destination or credentials.
            throw failure;
        }
        finally
        {
            if (client.IsConnected)
            {
                try
                {
                    using var disconnect = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    await client.DisconnectAsync(true, disconnect.Token);
                }
                catch (Exception e) when (e is IOException or SmtpProtocolException or OperationCanceledException or SmtpCommandException) { }
            }
        }
    }

    internal static MimeEntity BuildBody(ChannelMessage message)
    {
        var body = new BodyBuilder
        {
            TextBody = message.Body + (message.ActionUrl is null ? "" : "\n\n" + message.ActionUrl),
            HtmlBody = EmailTemplate.Html(message.Title, message.Body, message.ActionUrl, EmailTemplate.ActionLabel(message.EventType))
        };
        if (message.Attachments is { } attachments)
        {
            if (attachments.Count > 2) throw new ChannelDeliveryException("email_attachments_invalid");
            foreach (var attachment in attachments)
            {
                if (string.IsNullOrWhiteSpace(attachment.FileName) || attachment.FileName.Length > 150 ||
                    attachment.FileName.IndexOfAny(['\r', '\n', '/', '\\']) >= 0 ||
                    attachment.ContentType != "application/pdf" || attachment.Content.Length is < 5 or > 10_485_760 ||
                    !attachment.Content.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
                    throw new ChannelDeliveryException("email_attachments_invalid");
                body.Attachments.Add(attachment.FileName, attachment.Content, ContentType.Parse(attachment.ContentType));
            }
        }
        return body.ToMessageBody();
    }

    internal static ChannelDeliveryException Classify(Exception error, bool submitting) => error switch
    {
        MailKit.Security.AuthenticationException or ServiceNotAuthenticatedException => new("email_authentication_failed"),
        SslHandshakeException or NotSupportedException => new("email_tls_configuration_invalid"),
        SmtpCommandException command => new("email_smtp_" + (int)command.StatusCode, (int)command.StatusCode is >= 400 and < 500),
        OperationCanceledException or TimeoutException or IOException or SmtpProtocolException =>
            new(submitting ? "email_submission_outcome_unknown" : "email_connection_failed", !submitting, submitting),
        _ => new("email_unexpected_failure", outcomeUnknown: submitting)
    };
}
