using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("notifications", Schema = "public")]
public sealed class Notification
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("record_kind", TypeName = "varchar(10)")]
    public string RecordKind { get; set; } = null!;

    [Column("recipient_user_id", TypeName = "uuid")]
    public Guid? RecipientUserId { get; set; }

    [Column("actor_user_id", TypeName = "uuid")]
    public Guid? ActorUserId { get; set; }

    [Column("location_id", TypeName = "uuid")]
    public Guid? LocationId { get; set; }

    [Column("event_key", TypeName = "varchar(250)")]
    public string EventKey { get; set; } = null!;

    [Column("notification_type", TypeName = "varchar(80)")]
    public string NotificationType { get; set; } = null!;

    [Column("related_entity_type", TypeName = "varchar(50)")]
    public string? RelatedEntityType { get; set; }

    [Column("related_entity_id", TypeName = "uuid")]
    public Guid? RelatedEntityId { get; set; }

    [Column("title", TypeName = "varchar(200)")]
    public string? Title { get; set; }

    [Column("message", TypeName = "text")]
    public string? Message { get; set; }

    [Column("event_data", TypeName = "jsonb")]
    public JsonElement EventData { get; set; }

    [Column("event_at", TypeName = "timestamptz")]
    public DateTimeOffset EventAt { get; set; }

    [Column("read_at", TypeName = "timestamptz")]
    public DateTimeOffset? ReadAt { get; set; }

    [Column("delivery_status", TypeName = "varchar(25)")]
    public string? DeliveryStatus { get; set; }

    [Column("next_delivery_at", TypeName = "timestamptz")]
    public DateTimeOffset? NextDeliveryAt { get; set; }

    [Column("locked_until", TypeName = "timestamptz")]
    public DateTimeOffset? LockedUntil { get; set; }

    [Column("lease_token", TypeName = "uuid")]
    public Guid? LeaseToken { get; set; }

    [Column("delivery_history", TypeName = "jsonb")]
    public JsonElement DeliveryHistory { get; set; }
}
