namespace BHome.Domain.Notifications;
public sealed class UserNotification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipientUserId { get; set; }
    public string AudienceRole { get; set; } = "";
    public Guid? LocationId { get; set; }
    public string Category { get; set; } = "";
    public string EventType { get; set; } = "";
    public string Priority { get; set; } = "P1";
    public string Source { get; set; } = "System";
    public string[] Channels { get; set; } = [];
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string RelatedObjectType { get; set; } = "";
    public Guid RelatedObjectId { get; set; }
    public string EventKey { get; set; } = "";
    public Guid? SourceTaskNotificationId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public string DeliveryState { get; set; } = "Unconfigured";
    public int DeliveryAttempts { get; set; }
    public DateTimeOffset? NextDeliveryAt { get; set; }
    public DateTimeOffset? DeliveryLockedUntil { get; set; }
    public Guid? DeliveryLeaseToken { get; set; }
    public DateTimeOffset? DeliveryLastAttemptAt { get; set; }
    public string? DeliveryLastErrorCode { get; set; }
    public string? DeliveryProviderReference { get; set; }
}
public sealed class NotificationDeliveryAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid NotificationId { get; set; }
    public int Sequence { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset FinishedAt { get; set; }
    public string Outcome { get; set; } = "";
    public string? ErrorCode { get; set; }
}
public sealed class NotificationPublication
{
    public string EventKey { get; set; } = "";
    public DateTimeOffset PublishedAt { get; set; }
    public int RecipientCount { get; set; }
}
