using System.Text.Json;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Notifications;

internal static class NotificationInboxWrites
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static Task<bool> ExistsAsync(BHomePersistenceContext db, Guid recipient, string key, CancellationToken token) =>
        db is Compact24DbContext
            ? db.Set<Native.Notification>().AsNoTracking().AnyAsync(n => n.RecordKind == "INBOX" && n.RecipientUserId == recipient && n.EventKey == key, token)
            : db.Set<UserNotification>().AsNoTracking().AnyAsync(n => n.RecipientUserId == recipient && n.EventKey == key, token);

    internal static Task<bool> HasEventAsync(BHomePersistenceContext db, Guid target, string eventType, CancellationToken token) =>
        db is Compact24DbContext
            ? db.Database.SqlQuery<bool>($"""
                SELECT EXISTS (SELECT 1 FROM notifications n
                  LEFT JOIN LATERAL (SELECT h->'state' AS data FROM jsonb_array_elements(n.delivery_history) WITH ORDINALITY a(h,position)
                    WHERE h->>'recordType'='UserNotification' ORDER BY position DESC LIMIT 1) s ON true
                  WHERE n.record_kind='INBOX' AND n.related_entity_id={target}
                    AND COALESCE(COALESCE(s.data,n.event_data->'state')->>'eventType','')={eventType}) AS "Value"
                """).SingleAsync(token)
            : db.Set<UserNotification>().AsNoTracking().AnyAsync(n => n.RelatedObjectId == target && n.EventType == eventType, token);

    internal static void Add(BHomePersistenceContext db, NotificationInboxState state)
    {
        if (db is not Compact24DbContext)
        {
            // Only the archived-schema integration host uses the former table mapping.
            db.Add(new UserNotification
            {
                Id = state.Id, RecipientUserId = state.RecipientUserId, AudienceRole = state.AudienceRole,
                LocationId = state.LocationId, Category = state.Category, EventType = state.EventType,
                Priority = state.Priority, Source = state.Source, Channels = state.Channels,
                Title = state.Title, Summary = state.Summary, RelatedObjectType = state.RelatedObjectType,
                RelatedObjectId = state.RelatedObjectId, EventKey = state.EventKey,
                SourceTaskNotificationId = state.SourceTaskNotificationId, CreatedAt = state.CreatedAt,
                ReadAt = state.ReadAt, DeliveryState = state.DeliveryState,
                DeliveryAttempts = state.DeliveryAttempts, NextDeliveryAt = state.NextDeliveryAt,
                DeliveryLockedUntil = state.DeliveryLockedUntil, DeliveryLeaseToken = state.DeliveryLeaseToken,
                DeliveryLastAttemptAt = state.DeliveryLastAttemptAt, DeliveryLastErrorCode = state.DeliveryLastErrorCode,
                DeliveryProviderReference = state.DeliveryProviderReference
            });
            return;
        }
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Inbox publication requires the existing notification transaction.");
        db.Add(new Native.Notification
        {
            Id = state.Id, RecordKind = "INBOX", RecipientUserId = state.RecipientUserId,
            LocationId = state.LocationId, EventKey = state.EventKey,
            // Historical v1 publishers persisted the category here (eventType is in JSON).
            NotificationType = state.Category, Title = state.Title, Message = state.Summary,
            RelatedEntityType = state.RelatedObjectType, RelatedEntityId = state.RelatedObjectId,
            EventData = JsonSerializer.SerializeToElement(new
            {
                schemaVersion = 1, recordType = "UserNotification", state,
                audienceRole = state.AudienceRole, category = state.Category, succeeded = (bool?)null,
                sessionId = (Guid?)null, targetUserId = (Guid?)null
            }, Json),
            EventAt = state.CreatedAt, ReadAt = state.ReadAt, DeliveryStatus = state.DeliveryState,
            NextDeliveryAt = state.NextDeliveryAt, LockedUntil = state.DeliveryLockedUntil,
            LeaseToken = state.DeliveryLeaseToken, DeliveryHistory = JsonSerializer.SerializeToElement(Array.Empty<object>())
        });
    }
}
