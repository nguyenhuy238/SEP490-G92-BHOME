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
