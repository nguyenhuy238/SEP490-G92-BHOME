namespace BHome.Application.Notifications;

public sealed class NotificationChannelOptions
{
    public bool Enabled { get; set; }
    public bool AutomationEnabled { get; set; }
    public string Mode { get; set; } = "Unconfigured";
    public int MaxAttempts { get; set; } = 4;
    public int RetrySeconds { get; set; } = 60;
    public int TimeoutSeconds { get; set; } = 15;
    public string? SmtpHost { get; set; }
    public int SmtpPort { get; set; } = 587;
    public string? SmtpUser { get; set; }
    public string? SmtpPassword { get; set; }
    public string? FromAddress { get; set; }
    public bool SmtpUseTls { get; set; } = true;

    public TimeSpan RetryDelay(int attempt) => TimeSpan.FromSeconds(Math.Min(3600, RetrySeconds * (attempt <= 1 ? 1 : attempt == 2 ? 5 : 15)));
}

public static class NotificationEmailPolicy
{
    public static string[] Channels(string eventType, string role, string[] channels) =>
        (eventType is "INVOICE_FINALIZED" or "INVOICE_DUE_SOON" or "INVOICE_OVERDUE" or
            "INVOICE_FULLY_PAID" or "PAYMENT_PARTIALLY_CONFIRMED" or "CONTRACT_EXPIRY_REMINDER" ||
         eventType == "INCIDENT_EMERGENCY_SUBMITTED" && role is "Owner" or "Staff")
        ? channels.Append("EMAIL").Distinct().ToArray() : channels;
}

public sealed record EmailTestResult(string Status, string ProviderReference, bool InboxDeliveryConfirmed);
public interface IDevelopmentEmailTest
{
    Task<EmailTestResult> SendAsync(CancellationToken t);
}
public sealed record ChannelMessage(string IdempotencyKey, string Channel, string Destination, string EventType, string Title, string Body, string? ActionUrl = null);
public interface INotificationChannelProvider
{
    bool IsConfigured(string channel);
    bool SupportsIdempotency(string channel);
    Task<string> SendAsync(ChannelMessage message, CancellationToken t);
}
