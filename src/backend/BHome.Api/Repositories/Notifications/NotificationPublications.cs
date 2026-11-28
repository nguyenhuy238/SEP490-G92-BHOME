using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Notifications;

// Publication is an immutable outbox marker, not a separate physical table.
internal static class NotificationPublications
{
    internal static IQueryable<string> Keys(BHomePersistenceContext db) => db is Compact24DbContext
        ? db.Set<Native.Notification>().AsNoTracking()
            .Where(n => n.RecordKind == "OUTBOX" && n.EventData.GetProperty("recordType").GetString() == "NotificationPublication")
            .Select(n => n.EventData.GetProperty("state").GetProperty("eventKey").GetString() ?? "")
        : db.Set<NotificationPublication>().AsNoTracking().Select(n => n.EventKey);

    internal static async Task SaveAsync(BHomePersistenceContext db, string key, DateTimeOffset at, int recipientCount, CancellationToken token)
    {
        if (db is not Compact24DbContext)
        {
            db.Add(new NotificationPublication { EventKey = key, PublishedAt = at, RecipientCount = recipientCount });
            await db.SaveChangesAsync(token);
            return;
        }

        // Preserve any pending source transition (e.g. suppressed incident delivery)
        // before the marker; both writes remain in the caller's publication transaction.
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Publication requires the existing notification transaction.");
        await db.SaveChangesAsync(token);
        var state = new { eventKey = key, publishedAt = at, recipientCount };
        db.Add(new Native.Notification
        {
            Id = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("NotificationPublication/" + key)).AsSpan(0, 16)),
            RecordKind = "OUTBOX", EventKey = "NotificationPublication:" + key,
            NotificationType = "NotificationPublication", EventAt = at,
            EventData = JsonSerializer.SerializeToElement(new
            {
                schemaVersion = 1, recordType = "NotificationPublication", state,
                audienceRole = (string?)null, category = (string?)null, succeeded = (bool?)null,
                sessionId = (Guid?)null, targetUserId = (Guid?)null
            }),
            DeliveryHistory = JsonSerializer.SerializeToElement(Array.Empty<object>())
        });
        await db.SaveChangesAsync(token);
    }
}
