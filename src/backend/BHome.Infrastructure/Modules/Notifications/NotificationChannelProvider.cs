using System.Security.Cryptography;
using System.Text;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class NotificationChannelProvider(IOptions<NotificationChannelOptions> options, IHostEnvironment environment, MailKitEmailSender email) : INotificationChannelProvider
{
    private NotificationChannelOptions Config => options.Value;
    private bool Sandbox => Config.Mode == "Sandbox" && (environment.IsDevelopment() || environment.IsEnvironment("Testing"));
    public bool IsConfigured(string channel) => channel == "EMAIL" && email.IsConfigured || Sandbox;
    public bool SupportsIdempotency(string channel) => !(channel == "EMAIL" && email.IsConfigured) && Sandbox;
    public async Task<string> SendAsync(ChannelMessage message, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        if (!IsConfigured(message.Channel)) throw new IntegrationUnavailableException("Notification channel is not configured.");
        if (message.Channel == "EMAIL" && email.IsConfigured) return await email.SendAsync(message, t);
        if (Sandbox) return "sandbox:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(message.IdempotencyKey)))[..32];
        throw new IntegrationUnavailableException("Notification channel is not configured.");
    }
}

// Sandbox validates the delivery boundary without exposing reset tokens through an API or log.
internal sealed class PasswordEmailDelivery(INotificationChannelProvider provider) : IPasswordResetDelivery
{
    public bool IsAvailable => provider.IsConfigured("EMAIL");
    public async Task SendAsync(Guid userId, string destination, string token, CancellationToken cancellationToken) =>
        _ = await provider.SendAsync(new("auth:" + userId + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))), "EMAIL", destination,
            "ACCOUNT_PASSWORD_TOKEN", "BHOME: xác nhận tài khoản hoặc đặt lại mật khẩu", "Mã xác nhận dùng một lần: " + token + "\nNếu bạn không yêu cầu, hãy bỏ qua email này."), cancellationToken);
}
