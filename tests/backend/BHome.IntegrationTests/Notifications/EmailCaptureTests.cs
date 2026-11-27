using System.Net;
using System.Net.Sockets;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.Extensions.Hosting.Internal;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Notifications;

public sealed class EmailCaptureTests
{
    [Theory]
    [InlineData("Testing", "TEST", false)]
    [InlineData("Development", "HOLDING_CONFIRMED", true)]
    [InlineData("Development", "ACCOUNT_INVITATION", false)]
    [InlineData("Development", "PASSWORD_RESET_REQUESTED", false)]
    [InlineData("Development", "EMAIL_CONFIRMATION_REQUESTED", false)]
    [InlineData("Development", "InternalContractSigning", false)]
    [InlineData("Development", "ANNOUNCEMENT", false)]
    [InlineData("Development", "TENANT_SETUP_AFTER_ACTIVATION", true)]
    public async Task LocalSmtpCaptureReceivesGeneratedEmailWithoutExternalNetworkOrCredentials(string environment, string eventType, bool allowSigningRecipient)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var captured = new List<string>();
        var server = Task.Run(async () =>
        {
            using var connection = await listener.AcceptTcpClientAsync(timeout.Token);
            await using var stream = connection.GetStream();
            using var reader = new StreamReader(stream);
            await using var writer = new StreamWriter(stream) { AutoFlush = true, NewLine = "\r\n" };
            await writer.WriteLineAsync("220 localhost synthetic capture");
            var data = false;
            while (await reader.ReadLineAsync(timeout.Token) is { } line)
            {
                if (data)
                {
                    if (line == ".") { data = false; await writer.WriteLineAsync("250 captured"); }
                    else captured.Add(line);
                }
                else if (line.StartsWith("EHLO", StringComparison.Ordinal)) await writer.WriteLineAsync("250 localhost");
                else if (line == "DATA") { data = true; await writer.WriteLineAsync("354 send data"); }
                else if (line == "QUIT") { await writer.WriteLineAsync("221 bye"); break; }
                else await writer.WriteLineAsync("250 ok");
            }
        }, timeout.Token);
        var options = new EmailOptions
        {
            Enabled = true,
            DeliveryMode = "Capture",
            Host = "127.0.0.1",
            Port = ((IPEndPoint)listener.LocalEndpoint).Port,
            FromEmail = "sender@example.invalid",
            AllowedRecipients = environment == "Development" ? ["allowed@example.invalid"] : [],
            AllowAnyRecipientInDevelopment = environment == "Development",
            AllowAnyDevelopmentSigningRecipient = allowSigningRecipient
        };
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance,
            new HostingEnvironment { EnvironmentName = environment });
        var result = await sender.SendAsync(new("synthetic-capture", "EMAIL", "recipient@example.invalid", eventType,
            "Synthetic invitation", "Open the local page", "https://localhost:5176/contract-signing#token=SYNTHETIC"), timeout.Token);
        await server;
        Assert.StartsWith("smtp-accepted:", result);
        // Decode MIME rather than relying on the transport's transfer encoding.
        using var mime = MimeKit.MimeMessage.Load(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(string.Join("\r\n", captured))));
        Assert.Contains("https://localhost:5176/contract-signing#token=SYNTHETIC", mime.TextBody);
        Assert.Contains("recipient@example.invalid", mime.To.ToString());
    }

    [Theory]
    [InlineData("Staging")]
    [InlineData("Production")]
    [InlineData("Testing")]
    public async Task InvalidRecipientIsRejectedBeforeNetworkRegardlessOfLegacyAllowlist(string environment)
    {
        var options = new EmailOptions
        {
            Enabled = true,
            Host = "smtp.example.invalid",
            Username = "sender@example.invalid",
            FromEmail = "sender@example.invalid",
            AppPassword = "synthetic",
            AllowedRecipients = ["allowed@example.invalid"],
            AllowAnyDevelopmentSigningRecipient = true
        };
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance,
            new HostingEnvironment { EnvironmentName = environment });
        var error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(
            new("synthetic", "EMAIL", "invalid\r\nBcc: attacker@example.invalid", "HOLDING_CONFIRMED", "Test", "Test"), default));
        Assert.Equal("email_recipient_invalid", error.Code);
    }
    [Theory]
    [InlineData("Development", "outside@example.invalid", "email_connection_failed")]
    [InlineData("Development", "invalid", "email_recipient_invalid")]
    [InlineData("Testing", "outside@example.invalid", "email_connection_failed")]
    [InlineData("Testing", "invalid", "email_recipient_invalid")]
    [InlineData("Staging", "outside@example.invalid", "email_connection_failed")]
    [InlineData("Staging", "invalid", "email_recipient_invalid")]
    [InlineData("Staging", "allowed@example.invalid", "email_connection_failed")]
    [InlineData("Production", "outside@example.invalid", "email_connection_failed")]
    [InlineData("Production", "invalid", "email_recipient_invalid")]
    [InlineData("Production", "allowed@example.invalid", "email_connection_failed")]
    public async Task DirectSmtpUsesSharedPolicyBeforeOpeningConnection(string environment, string destination, string expected)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        var options = new EmailOptions
        {
            Enabled = true,
            Host = "127.0.0.1",
            Port = port,
            Username = "sender@example.invalid",
            FromEmail = "sender@example.invalid",
            AppPassword = "synthetic",
            AllowedRecipients = ["allowed@example.invalid"],
            TestEnabled = true,
            TestRecipient = "diagnostic@example.invalid"
        };
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance,
            new HostingEnvironment { EnvironmentName = environment });
        var error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(
            new("synthetic", "EMAIL", destination, "TEST", "Test", "Test"), default));
        Assert.Equal(expected, error.Code);
        // This proves recipient acceptance, not successful SMTP authentication/delivery.
        if (expected == "email_connection_failed") Assert.True(error.Retryable);
        if (environment == "Development")
        {
            options.AppPassword = "";
            error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(
                new("synthetic", "EMAIL", destination, "TEST", "Test", "Test"), default));
            Assert.Equal("email_configuration_invalid", error.Code);
        }
    }

}
