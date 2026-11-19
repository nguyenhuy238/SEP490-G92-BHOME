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
    [Fact]
    public async Task LocalSmtpCaptureReceivesGeneratedEmailWithoutExternalNetworkOrCredentials()
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
        var options = new EmailOptions { Enabled = true, DeliveryMode = "Capture", Host = "127.0.0.1",
            Port = ((IPEndPoint)listener.LocalEndpoint).Port, FromEmail = "sender@example.invalid" };
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance,
            new HostingEnvironment { EnvironmentName = "Testing" });
        var result = await sender.SendAsync(new("synthetic-capture", "EMAIL", "recipient@example.invalid", "TEST",
            "Synthetic invitation", "Open the local page", "https://localhost:5176/contract-signing#token=SYNTHETIC"), timeout.Token);
        await server;
        Assert.StartsWith("smtp-accepted:", result);
        // Decode MIME rather than relying on the transport's transfer encoding.
        using var mime = MimeKit.MimeMessage.Load(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(string.Join("\r\n", captured))));
        Assert.Contains("https://localhost:5176/contract-signing#token=SYNTHETIC", mime.TextBody);
        Assert.Contains("recipient@example.invalid", mime.To.ToString());
    }

    [Fact]
    public async Task StagingRecipientOutsideAllowlistIsRejectedBeforeNetwork()
    {
        var options = new EmailOptions { Enabled = true, Host = "smtp.example.invalid", Username = "sender@example.invalid",
            FromEmail = "sender@example.invalid", AppPassword = "synthetic", AllowedRecipients = ["allowed@example.invalid"] };
        var sender = new MailKitEmailSender(Options.Create(options), NullLogger<MailKitEmailSender>.Instance,
            new HostingEnvironment { EnvironmentName = "Staging" });
        var error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(
            new("synthetic", "EMAIL", "blocked@example.invalid", "TEST", "Test", "Test"), default));
        Assert.Equal("email_recipient_not_allowed", error.Code);
    }
}
