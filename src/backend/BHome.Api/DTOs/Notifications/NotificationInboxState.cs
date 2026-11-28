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
    public string DeliveryState { get; set; } = "Unconfigured";
    public int DeliveryAttempts { get; set; }
    public DateTimeOffset? NextDeliveryAt { get; set; }
    public DateTimeOffset? DeliveryLockedUntil { get; set; }
    public Guid? DeliveryLeaseToken { get; set; }
    public DateTimeOffset? DeliveryLastAttemptAt { get; set; }
    public string? DeliveryLastErrorCode { get; set; }
    public string? DeliveryProviderReference { get; set; }
}
