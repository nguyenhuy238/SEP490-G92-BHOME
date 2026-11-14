using System.Security.Cryptography;
using System.Text;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Contracts;

public sealed class AnonymousSigningOptions
{
    public string OtpHmacKey { get; set; } = "";
    public string PublicSigningUrl { get; set; } = "";
}
internal sealed class AnonymousSigningSecurity(IOptions<AnonymousSigningOptions> options, INotificationChannelProvider channel,
    IOptions<NotificationChannelOptions> channelOptions, MailKitEmailSender emailSender) : IAnonymousSigningSecurity
{
    // The channel provider sends through configured SMTP before considering the Development sandbox.
    // A sandbox receipt alone can never deliver an invitation or OTP.
    public bool EmailConfigured => channel.IsConfigured("EMAIL") &&
        (emailSender.IsConfigured || channelOptions.Value.Mode != "Sandbox");
    public string? InvitationUrl(string token) => Uri.TryCreate(options.Value.PublicSigningUrl, UriKind.Absolute, out var url) &&
        url.Scheme == "https" && string.IsNullOrEmpty(url.Query) && string.IsNullOrEmpty(url.Fragment)
        ? url.AbsoluteUri + "#token=" + Uri.EscapeDataString(token) : null;
    public string OtpHash(Guid invitationId, string tokenHash, string otp)
    {
        byte[] key;
        try { key = Convert.FromBase64String(options.Value.OtpHmacKey); }
        catch (FormatException) { throw new ContractException(503, "signing_otp_key_not_configured"); }
        if (key.Length < 32) throw new ContractException(503, "signing_otp_key_not_configured");
        try { return Convert.ToHexString(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"internal-signing-otp-v1:{invitationId:N}:{tokenHash}:{otp}"))); }
        finally { CryptographicOperations.ZeroMemory(key); }
    }
    public async Task SendAsync(string email, string eventKey, string title, string body, CancellationToken t) =>
        _ = await channel.SendAsync(new(eventKey, "EMAIL", email, "InternalContractSigning", title, body), t);
}
