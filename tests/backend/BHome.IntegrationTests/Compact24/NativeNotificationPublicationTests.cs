using System.Text.Json;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class NativeNotificationPublicationTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task InboxPublicationPreservesExistingPayloadAndCommitsWithMarker()
    {
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql(fixture.Connection).Options);
        var recipient = Guid.NewGuid(); var target = Guid.NewGuid();
        var oldKey = "synthetic:old:" + Guid.NewGuid(); var newKey = "synthetic:new:" + Guid.NewGuid();
        var oldId = Guid.NewGuid(); var newId = Guid.NewGuid();
        var at = DateTimeOffset.Parse("2026-11-28T07:00:00Z");
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp)
            VALUES({recipient},{recipient.ToString("N")},{recipient.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Tenant'],'synthetic','synthetic')
            """);
        db.Add(new UserNotification
        {
            Id = oldId,
            RecipientUserId = recipient,
            AudienceRole = "Tenant",
            Category = "Payment",
            EventType = "INVOICE_FULLY_PAID",
            EventKey = oldKey,
            Title = "Synthetic",
            Summary = "Synthetic payment",
            RelatedObjectType = "Invoice",
            RelatedObjectId = target,
            CreatedAt = at,
            ReadAt = at,
            Channels = ["IN_APP", "EMAIL"]
        });
        await db.SaveChangesAsync();
        NotificationInboxWrites.Add(db, new NotificationInboxState
        {
            Id = newId,
            RecipientUserId = recipient,
            AudienceRole = "Tenant",
            Category = "Payment",
            EventType = "INVOICE_FULLY_PAID",
            EventKey = newKey,
            Title = "Synthetic",
            Summary = "Synthetic payment",
            RelatedObjectType = "Invoice",
            RelatedObjectId = target,
            CreatedAt = at,
            ReadAt = at,
            Channels = ["IN_APP", "EMAIL"]
        });
        await NotificationPublications.SaveAsync(db, newKey, at, 1, default);
        var rows = await db.Set<Native.Notification>().AsNoTracking().Where(n => n.Id == oldId || n.Id == newId).ToArrayAsync();
        Assert.Equal(2, rows.Length);
        var previous = rows.Single(n => n.Id == oldId); var current = rows.Single(n => n.Id == newId);
        Assert.Equal(previous.EventData.GetRawText().Replace(oldKey, newKey, StringComparison.Ordinal)
            .Replace(oldId.ToString(), newId.ToString(), StringComparison.Ordinal), current.EventData.GetRawText());
        Assert.Equal(previous.NotificationType, current.NotificationType);
        Assert.Equal(previous.ReadAt, current.ReadAt);
        Assert.Equal(previous.DeliveryStatus, current.DeliveryStatus);
        Assert.True(await NotificationInboxWrites.ExistsAsync(db, recipient, newKey, default));
        Assert.True(await NotificationInboxWrites.HasEventAsync(db, target, "INVOICE_FULLY_PAID", default));
        Assert.False(await NotificationInboxWrites.ExistsAsync(db, Guid.NewGuid(), newKey, default));
        Assert.True(await NotificationPublications.Keys(db).ContainsAsync(newKey));
        await transaction.RollbackAsync();
        Assert.False(await NotificationInboxWrites.ExistsAsync(db, recipient, newKey, default));
        Assert.False(await NotificationPublications.Keys(db).ContainsAsync(newKey));
    }

    [CompactPostgresFact]
    public async Task PhysicalPublicationMatchesHistoricalMarkerAndRollsBackWithSource()
    {
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql(fixture.Connection).Options);
        var oldKey = "synthetic:legacy:" + Guid.NewGuid();
        var newKey = "synthetic:native:" + Guid.NewGuid();
        var at = DateTimeOffset.Parse("2026-11-28T07:00:00Z");
        await using var transaction = await db.Database.BeginTransactionAsync();
        db.Add(new NotificationPublication { EventKey = oldKey, PublishedAt = at, RecipientCount = 2 });
        await db.SaveChangesAsync();
        await NotificationPublications.SaveAsync(db, newKey, at, 2, default);

        var keys = NotificationPublications.Keys(db);
        Assert.True(await keys.ContainsAsync(oldKey));
        Assert.True(await keys.ContainsAsync(newKey));
        Assert.False(await keys.ContainsAsync("absent:" + newKey));
        var markers = await db.Set<Native.Notification>().AsNoTracking()
            .Where(n => n.EventKey == "NotificationPublication:" + oldKey || n.EventKey == "NotificationPublication:" + newKey)
            .ToArrayAsync();
        Assert.Equal(2, markers.Length);
        var oldRow = markers.Single(n => n.EventKey.EndsWith(oldKey, StringComparison.Ordinal));
        var newRow = markers.Single(n => n.EventKey.EndsWith(newKey, StringComparison.Ordinal));
        Assert.Equal(Compact24DbContext.DeterministicId("NotificationPublication/" + newKey), newRow.Id);
        Assert.Equal(oldRow.RecordKind, newRow.RecordKind);
        Assert.Equal(oldRow.NotificationType, newRow.NotificationType);
        Assert.Equal(oldRow.EventAt, newRow.EventAt);
        Assert.Equal(oldRow.EventData.GetRawText().Replace(oldKey, newKey, StringComparison.Ordinal), newRow.EventData.GetRawText());
        Assert.Equal(JsonValueKind.Array, newRow.DeliveryHistory.ValueKind);
        Assert.Empty(newRow.DeliveryHistory.EnumerateArray());
        Assert.Equal(2, await db.Set<Native.Notification>().AsNoTracking().CountAsync(n =>
            (n.Id == oldRow.Id || n.Id == newRow.Id) && keys.Contains(n.EventData.GetProperty("state").GetProperty("eventKey").GetString()!)));
        await transaction.RollbackAsync();
        Assert.False(await keys.ContainsAsync(oldKey));
        Assert.False(await keys.ContainsAsync(newKey));
    }
}
