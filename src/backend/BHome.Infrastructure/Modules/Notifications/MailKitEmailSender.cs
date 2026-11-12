using System.Security.Cryptography;
using System.Text;
using BHome.Application.Notifications;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class MailKitEmailSender(IOptions<EmailOptions> options, ILogger<MailKitEmailSender> logger)
{
    internal bool IsConfigured => options.Value.Enabled && options.Value.Valid();

    internal async Task<string> SendAsync(ChannelMessage message, CancellationToken t)
    {
        var config = options.Value;
        if (!IsConfigured) throw new ChannelDeliveryException("email_configuration_invalid");
        if (!EmailOptions.ValidAddress(message.Destination)) throw new ChannelDeliveryException("email_recipient_invalid");
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(message.IdempotencyKey))).ToLowerInvariant();
        using var mail = new MimeMessage();
        mail.From.Add(new MailboxAddress(Encoding.UTF8, config.FromName, config.FromEmail));
        mail.To.Add(new MailboxAddress("", message.Destination));
        mail.MessageId = $"{key}@bhome.notification";
        mail.Subject = EmailTemplate.Subject(message.Title);
        mail.Body = new BodyBuilder { TextBody = message.Body, HtmlBody = EmailTemplate.Html(message.Title, message.Body) }.ToMessageBody();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t);
        timeout.CancelAfter(TimeSpan.FromSeconds(config.TimeoutSeconds));
        using var client = new SmtpClient { Timeout = config.TimeoutSeconds * 1000 };
        var submitting = false;
        try
        {
            // STARTTLS is mandatory. Never downgrade or disable certificate validation.
            await client.ConnectAsync(config.Host, config.Port, SecureSocketOptions.StartTls, timeout.Token);
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
