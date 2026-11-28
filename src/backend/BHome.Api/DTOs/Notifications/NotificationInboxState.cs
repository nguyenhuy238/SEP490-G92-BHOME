namespace BHome.Infrastructure.Modules.Notifications;

// Stable JSON payload stored in notifications.event_data.state and delivery history.
// Keep its property names/defaults compatible with existing schema-version 1/2 events.
internal sealed class NotificationInboxState
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid RecipientUserId { get; init; }
    public string AudienceRole { get; init; } = "";
    public Guid? LocationId { get; init; }
    public string Category { get; init; } = "";
    public string EventType { get; init; } = "";
    public string Priority { get; init; } = "P1";
    public string Source { get; init; } = "System";
    public string[] Channels { get; set; } = [];
    public string Title { get; init; } = "";
    public string Summary { get; init; } = "";
    public string RelatedObjectType { get; init; } = "";
    public Guid RelatedObjectId { get; init; }
    public string EventKey { get; init; } = "";
    public Guid? SourceTaskNotificationId { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? ReadAt { get; init; }
    public string DeliveryState { get; init; } = "Unconfigured";
    public int DeliveryAttempts { get; init; }
    public DateTimeOffset? NextDeliveryAt { get; init; }
    public DateTimeOffset? DeliveryLockedUntil { get; init; }
    public Guid? DeliveryLeaseToken { get; init; }
    public DateTimeOffset? DeliveryLastAttemptAt { get; init; }
    public string? DeliveryLastErrorCode { get; init; }
    public string? DeliveryProviderReference { get; init; }
}
