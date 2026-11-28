using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

// A physical inbox row owns its delivery state and append-only attempt history.
// Never write the original event payload or the read flag from the delivery worker.
internal sealed class CompactNotificationDeliveryStore(Compact24DbContext db, INotificationRepository inbox) : INotificationDeliveryStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string Columns = """
        SELECT n.id AS "Id", n.recipient_user_id AS "RecipientUserId",
          n.event_data->>'audienceRole' AS "AudienceRole", n.location_id AS "LocationId",
          n.event_data->>'category' AS "Category", COALESCE(s.data->>'eventType','') AS "EventType",
          COALESCE(s.data->>'priority','') AS "Priority", COALESCE(s.data->>'source','') AS "Source",
          ARRAY(SELECT jsonb_array_elements_text(s.data->'channels')) AS "Channels",
          n.title AS "Title", n.message AS "Summary", n.related_entity_type AS "RelatedObjectType",
          n.related_entity_id AS "RelatedObjectId", n.event_key AS "EventKey",
          (s.data->>'sourceTaskNotificationId')::uuid AS "SourceTaskNotificationId",
          n.event_at AS "CreatedAt", n.read_at AS "ReadAt", n.delivery_status AS "DeliveryState",
          COALESCE((s.data->>'deliveryAttempts')::integer,0) AS "DeliveryAttempts",
          n.next_delivery_at AS "NextDeliveryAt", n.locked_until AS "DeliveryLockedUntil",
          n.lease_token AS "DeliveryLeaseToken", (s.data->>'deliveryLastAttemptAt')::timestamptz AS "DeliveryLastAttemptAt",
          s.data->>'deliveryLastErrorCode' AS "DeliveryLastErrorCode",
          s.data->>'deliveryProviderReference' AS "DeliveryProviderReference"
        FROM
        """;
    private const string LatestState = """
         n LEFT JOIN LATERAL (
          SELECT h->'state' AS data FROM jsonb_array_elements(n.delivery_history) WITH ORDINALITY a(h,position)
          WHERE h->>'recordType'='UserNotification' ORDER BY position DESC LIMIT 1
        ) h ON TRUE
        CROSS JOIN LATERAL (SELECT COALESCE(h.data,n.event_data->'state') AS data) s
        WHERE n.record_kind='INBOX'
        """;

    private IQueryable<NotificationInboxState> Rows() =>
        db.Database.SqlQueryRaw<NotificationInboxState>(Columns + " notifications" + LatestState);

    private Task<NotificationInboxState?> LockAsync(Guid id, bool skipLocked, CancellationToken token) =>
        db.Database.SqlQueryRaw<NotificationInboxState>(Columns +
            " (SELECT * FROM notifications WHERE id={0} AND record_kind='INBOX' FOR UPDATE" +
            (skipLocked ? " SKIP LOCKED" : "") + ")" + LatestState, id).SingleOrDefaultAsync(token);

    public async Task<IReadOnlyList<DeliveryWork>> DueAsync(DateTimeOffset now, CancellationToken t) =>
        await Rows().Where(n => n.Channels.Length == 0)
            .Where(n => n.DeliveryState == "Unconfigured" && n.DeliveryAttempts == 0 ||
                n.DeliveryState == "Pending" && n.NextDeliveryAt <= now ||
                n.DeliveryState == "Processing" && n.DeliveryLockedUntil <= now)
            .OrderBy(n => n.CreatedAt).Take(50).Select(n => new DeliveryWork(n.Id, n.DeliveryAttempts + 1)).ToArrayAsync(t);

    public async Task<PagedResult<DeliveryView>> ListAsync(DeliveryQuery q, CancellationToken t)
    {
        var rows = Rows().Where(n => (q.State == null || n.DeliveryState == q.State) &&
            (q.LocationId == null || n.LocationId == q.LocationId));
        var count = await rows.CountAsync(t);
        var items = await rows.OrderByDescending(n => n.CreatedAt).ThenBy(n => n.Id)
            .Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)
            .Select(n => new DeliveryView(n.Id, n.Category, n.AudienceRole, n.RelatedObjectType,
                n.RelatedObjectId, n.LocationId, n.DeliveryState, n.DeliveryAttempts,
                n.NextDeliveryAt, n.DeliveryLastAttemptAt, n.DeliveryLastErrorCode)).ToArrayAsync(t);
        return new(items, q.Page, q.PageSize, count);
    }

    public async Task<DeliveryClaim?> ClaimAsync(Guid id, DateTimeOffset now, NotificationDeliveryOptions options, bool idempotency, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var n = await LockAsync(id, true, t);
        if (n is null || n.Channels.Length > 0 ||
            n.DeliveryState is "Delivered" or "Failed" or "PendingReview" or "Suppressed" ||
            n.NextDeliveryAt > now || n.DeliveryLockedUntil > now) return null;
        var active = Roles.All.Contains(n.AudienceRole) && await db.Users.AsNoTracking()
            .AnyAsync(u => u.Id == n.RecipientUserId && u.IsActive &&
                EF.Property<string[]>(u, "roles").Contains(n.AudienceRole), t);
        var scope = new NotificationScope(n.RecipientUserId, n.AudienceRole == Roles.Owner,
            n.AudienceRole == Roles.Staff, n.AudienceRole == Roles.Tenant, BillingAutomationDates.BusinessDate(now));
        if (!active || await inbox.TargetAsync(scope, n.Id, t) is null)
        {
            n.DeliveryState = "Suppressed"; n.DeliveryLastErrorCode = "recipient_scope_unavailable";
            await SaveAsync(n, null, t); await tx.CommitAsync(t); return null;
        }
        DeliveryAttemptState? attempt = null;
        if (n.DeliveryState == "Processing")
        {
            attempt = new(Guid.NewGuid(), n.Id, n.DeliveryAttempts, n.DeliveryLastAttemptAt ?? now,
                now, idempotency ? "LeaseExpired" : "PendingReview", "delivery_lease_expired");
            if (!idempotency)
            {
                n.DeliveryState = "PendingReview"; n.DeliveryLastErrorCode = "ambiguous_delivery_recovery";
                n.DeliveryLockedUntil = null; n.DeliveryLeaseToken = null;
                await SaveAsync(n, attempt, t); await tx.CommitAsync(t); return null;
            }
        }
        if (n.DeliveryAttempts >= options.MaxAttempts)
        {
            n.DeliveryState = "Failed"; n.DeliveryLockedUntil = null; n.DeliveryLeaseToken = null;
            await SaveAsync(n, attempt, t); await tx.CommitAsync(t); return null;
        }
        n.DeliveryState = "Processing"; n.DeliveryAttempts++; n.DeliveryLastAttemptAt = now;
        n.DeliveryLockedUntil = now.AddSeconds(options.LeaseSeconds); n.DeliveryLeaseToken = Guid.NewGuid(); n.NextDeliveryAt = null;
        await SaveAsync(n, attempt, t); await tx.CommitAsync(t);
        return new(n.Id, n.DeliveryLeaseToken.Value, n.DeliveryAttempts, now, n.RecipientUserId, n.Category, n.Title, n.Summary);
    }

    public async Task CompleteAsync(DeliveryClaim claim, DeliveryCompletion result, DateTimeOffset now, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var n = await LockAsync(claim.Id, false, t) ?? throw new InvalidOperationException("Notification is unavailable.");
        if (n.DeliveryLeaseToken != claim.Token) return;
        n.DeliveryState = result.State; n.DeliveryLastErrorCode = result.ErrorCode;
        n.NextDeliveryAt = result.NextAt; n.DeliveryProviderReference = result.ProviderReference;
        n.DeliveryLockedUntil = null; n.DeliveryLeaseToken = null;
        await SaveAsync(n, new(Guid.NewGuid(), n.Id, claim.Sequence, claim.StartedAt, now, result.State, result.ErrorCode), t);
        await tx.CommitAsync(t);
    }

    private async Task SaveAsync(NotificationInboxState state, DeliveryAttemptState? attempt, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Delivery writes require the locked inbox transaction.");
        var history = new List<object> { Envelope("UserNotification", state.Id, state) };
        if (attempt is not null) history.Add(Envelope("NotificationDeliveryAttempt", attempt.Id, attempt));
        var json = JsonSerializer.Serialize(history, Json);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE notifications SET delivery_status={state.DeliveryState},next_delivery_at={state.NextDeliveryAt},
              locked_until={state.DeliveryLockedUntil},lease_token={state.DeliveryLeaseToken},
              delivery_history=delivery_history||CAST({json} AS jsonb)
            WHERE id={state.Id} AND record_kind='INBOX'
            """, t);
        if (changed != 1) throw new DbUpdateConcurrencyException("Inbox row is unavailable.");
    }

    private static object Envelope(string type, Guid key, object state) =>
        new { schemaVersion = 1, recordType = type, recordKey = key.ToString(), deleted = false, state };

    private sealed record DeliveryAttemptState(Guid Id, Guid NotificationId, int Sequence, DateTimeOffset StartedAt,
        DateTimeOffset FinishedAt, string Outcome, string? ErrorCode);
}
