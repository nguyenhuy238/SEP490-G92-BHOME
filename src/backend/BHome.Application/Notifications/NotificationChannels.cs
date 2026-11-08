namespace BHome.Application.Notifications;

public sealed class NotificationChannelOptions
{
    public bool Enabled { get; set; }
    public bool AutomationEnabled { get; set; }
    public string Mode { get; set; } = "Unconfigured";
    public int MaxAttempts { get; set; } = 4;
    public int RetrySeconds { get; set; } = 30;
    public int TimeoutSeconds { get; set; } = 15;
    public string? SmtpHost { get; set; }
    public int SmtpPort { get; set; } = 587;
    public string? SmtpUser { get; set; }
    public string? SmtpPassword { get; set; }
    public string? FromAddress { get; set; }
    public bool SmtpUseTls { get; set; } = true;
}
public sealed record ChannelMessage(string IdempotencyKey, string Channel, string Destination, string EventType, string Title, string Body);
public interface INotificationChannelProvider
{
    bool IsConfigured(string channel);
    bool SupportsIdempotency(string channel);
    Task<string> SendAsync(ChannelMessage message, CancellationToken t);
}
