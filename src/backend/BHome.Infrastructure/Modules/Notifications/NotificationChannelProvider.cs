using System.Security.Cryptography;
using System.Text;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class NotificationChannelProvider(IOptions<NotificationChannelOptions> options, IHostEnvironment environment,
    MailKitEmailSender email, ExpoPushSender push, ISmsSender sms) : INotificationChannelProvider
{
    private NotificationChannelOptions Config => options.Value;
    private bool Sandbox => Config.Mode == "Sandbox" && (environment.IsDevelopment() || environment.IsEnvironment("Testing"));
    public bool IsConfigured(string channel) => channel switch
    {
        "SMS" => sms.IsConfigured,
        "EMAIL" => email.IsConfigured || Sandbox,
        "PUSH" => push.IsConfigured || Sandbox,
        _ => false
    };
    public bool SupportsIdempotency(string channel) => channel == "SMS" ||
        (channel is "EMAIL" or "PUSH") && Sandbox && !(channel == "EMAIL" && email.IsConfigured ||
                                                        channel == "PUSH" && push.IsConfigured);
    public async Task<string> SendAsync(ChannelMessage message, CancellationToken t)
    {
        t.ThrowIfCancellationRequested();
        if (!IsConfigured(message.Channel)) throw new IntegrationUnavailableException("Notification channel is not configured.");
        if (message.Channel == "SMS") throw new ChannelDeliveryException("sms_typed_message_required");
        if (message.Channel == "EMAIL" && email.IsConfigured) return await email.SendAsync(message, t);
        if (message.Channel == "PUSH" && push.IsConfigured) return await push.SendAsync(message, t);
        if (Sandbox) return "sandbox:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(message.IdempotencyKey)))[..32];
        throw new IntegrationUnavailableException("Notification channel is not configured.");
    }
}
