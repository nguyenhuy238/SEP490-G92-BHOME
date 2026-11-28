using BHome.Application.Notifications;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class NativeNotificationDeliveryTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private static readonly NotificationDeliveryOptions Options = new() { MaxAttempts = 2, LeaseSeconds = 5 };

    [CompactPostgresFact]
    public async Task NativeDeliveryRetainsReadStateAndHistoryAcrossConcurrentClaimAndRetry()
    {
        var now = DateTimeOffset.Parse("2026-11-28T07:00:00Z");
        var (recipient, id) = await SeedAsync(now);
        var claims = await Task.WhenAll(ClaimAsync(id, now), ClaimAsync(id, now));
        var claim = Assert.Single(claims.OfType<DeliveryClaim>());
        Assert.Equal(1, claim.Sequence);
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var inbox = scope.ServiceProvider.GetRequiredService<INotificationRepository>();
            await inbox.ReadAsync(new(recipient, false, false, true, new DateOnly(2026, 11, 28)), id, now.AddSeconds(1), default);
            await scope.ServiceProvider.GetRequiredService<INotificationDeliveryStore>()
                .CompleteAsync(claim, new("Pending", "TimeoutException", now.AddSeconds(3)), now.AddSeconds(1), default);
        }
        Assert.Null(await ClaimAsync(id, now.AddSeconds(2)));
        var retry = Assert.IsType<DeliveryClaim>(await ClaimAsync(id, now.AddSeconds(3)));
        Assert.Equal(2, retry.Sequence);
        Assert.NotEqual(claim.Token, retry.Token);
        await using var check = fixture.Factory!.Services.CreateAsyncScope();
        var store = check.ServiceProvider.GetRequiredService<INotificationDeliveryStore>();
        await store.CompleteAsync(claim, new("Failed", "Stale", null), now.AddSeconds(4), default);
        await store.CompleteAsync(retry, new("Delivered", null, null, "receipt"), now.AddSeconds(4), default);
        var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var row = await db.Set<Native.Notification>().AsNoTracking().SingleAsync(n => n.Id == id);
        Assert.Equal("Delivered", row.DeliveryStatus);
        Assert.Equal(now.AddSeconds(1), row.ReadAt);
        Assert.Equal("Unconfigured", row.EventData.GetProperty("state").GetProperty("deliveryState").GetString());
        Assert.Equal(6, row.DeliveryHistory.GetArrayLength());
        var attempts = await db.Set<NotificationDeliveryAttempt>().AsNoTracking().Where(a => a.NotificationId == id).OrderBy(a => a.Sequence).ToArrayAsync();
        Assert.Equal(new[] { "Pending", "Delivered" }, attempts.Select(a => a.Outcome));
        var historical = await db.Set<UserNotification>().AsNoTracking().SingleAsync(n => n.Id == id);
        Assert.Equal("Delivered", historical.DeliveryState);
        Assert.Equal("receipt", historical.DeliveryProviderReference);
        Assert.Equal(2, historical.DeliveryAttempts);
        var list = await store.ListAsync(new() { State = "Delivered", PageSize = 100 }, default);
        Assert.Contains(list.Items, n => n.Id == id && n.Attempts == 2);
        Assert.DoesNotContain(await store.DueAsync(now.AddSeconds(10), default), n => n.Id == id);
    }

    [CompactPostgresFact]
    public async Task NativeDeliverySuppressesRevokedRecipientsAndDoesNotSendV2OrAmbiguousLease()
    {
        var now = DateTimeOffset.Parse("2026-11-28T07:00:00Z");
        var (_, id) = await SeedAsync(now);
        var (_, v2) = await SeedAsync(now, ["EMAIL"]);
        var (recipient, revoked) = await SeedAsync(now);
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Users.Where(u => u.Id == recipient).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
            var due = await scope.ServiceProvider.GetRequiredService<INotificationDeliveryStore>().DueAsync(now, default);
            Assert.Contains(due, n => n.Id == id && n.Sequence == 1);
            Assert.DoesNotContain(due, n => n.Id == v2);
        }
        Assert.Null(await ClaimAsync(v2, now));
        Assert.Null(await ClaimAsync(revoked, now));
        Assert.NotNull(await ClaimAsync(id, now, false));
        Assert.Null(await ClaimAsync(id, now.AddSeconds(6), false));
        await using var check = fixture.Factory!.Services.CreateAsyncScope();
        var checkDb = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var rows = await checkDb.Set<Native.Notification>().AsNoTracking().Where(n => n.Id == id || n.Id == v2 || n.Id == revoked).ToArrayAsync();
        Assert.Equal("Unconfigured", rows.Single(n => n.Id == v2).DeliveryStatus);
        Assert.Empty(rows.Single(n => n.Id == v2).DeliveryHistory.EnumerateArray());
        Assert.Equal("Suppressed", rows.Single(n => n.Id == revoked).DeliveryStatus);
        Assert.Equal("PendingReview", rows.Single(n => n.Id == id).DeliveryStatus);
        Assert.Equal("delivery_lease_expired", (await checkDb.Set<NotificationDeliveryAttempt>().AsNoTracking()
            .SingleAsync(a => a.NotificationId == id)).ErrorCode);
    }

    private async Task<DeliveryClaim?> ClaimAsync(Guid id, DateTimeOffset now, bool idempotency = true)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<INotificationDeliveryStore>()
            .ClaimAsync(id, now, Options, idempotency, default);
    }

    private async Task<(Guid Recipient, Guid Id)> SeedAsync(DateTimeOffset now, string[]? channels = null)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var recipient = Guid.NewGuid(); var id = Guid.NewGuid();
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp,is_active)
            VALUES({recipient},{recipient.ToString("N")},{recipient.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Tenant'],'synthetic','synthetic',true)
            """);
        NotificationInboxWrites.Add(db, new NotificationInboxState
        {
            Id = id, RecipientUserId = recipient, AudienceRole = "Tenant", Category = "Account",
            EventType = "TEST_ACCOUNT", EventKey = "native-delivery:" + id,
            Title = "Synthetic", Summary = "Synthetic", RelatedObjectType = "Account", RelatedObjectId = recipient,
            CreatedAt = now, Channels = channels ?? []
        });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return (recipient, id);
    }
}
