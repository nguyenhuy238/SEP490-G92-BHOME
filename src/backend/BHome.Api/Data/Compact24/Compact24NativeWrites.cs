using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

public partial class Compact24DbContext
{
    // The normal SaveChanges path selects this branch only for native entity changes.
    // Repositories save only after their existing lock, authorization, history and
    // idempotency checks. Reject all unconverted tables and every physical deletion.
    private async Task<int> SaveNativeChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken token)
    {
        if (!acceptAllChangesOnSuccess)
            throw new InvalidOperationException("Native repository writes require accepting the saved state.");
        if (Database.CurrentTransaction is null)
            throw new InvalidOperationException("Native writes require the existing repository transaction.");
        ChangeTracker.DetectChanges();
        var entries = ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted).ToArray();
        foreach (var entry in entries)
        {
            var allowed = entry.Entity switch
            {
                Native.FinancialScenario => entry.State == EntityState.Added,
                Native.StaffEmployment => entry.State is EntityState.Added or EntityState.Modified,
                Native.Expense => entry.State is EntityState.Added or EntityState.Modified,
                BHome.Domain.PropertyManagement.Asset => entry.State is EntityState.Added or EntityState.Modified,
                BHome.Domain.Locations.Location => entry.State is EntityState.Added or EntityState.Modified,
                BHome.Domain.PropertyManagement.Room => entry.State is EntityState.Added or EntityState.Modified,
                BHome.Domain.PropertyManagement.BillingPolicy => entry.State is EntityState.Added or EntityState.Modified,
                Native.RefundRequest => entry.State is EntityState.Added or EntityState.Modified,
                Native.Notification notification => entry.State == EntityState.Added &&
                    notification.EventData.ValueKind == System.Text.Json.JsonValueKind.Object &&
                    notification.EventData.TryGetProperty("recordType", out var recordType) &&
                    recordType.ValueKind == System.Text.Json.JsonValueKind.String &&
                    (notification.RecordKind == "OUTBOX" && notification.NotificationType == "NotificationPublication" &&
                        notification.RecipientUserId is null && recordType.GetString() == "NotificationPublication" ||
                     notification.RecordKind == "INBOX" && notification.RecipientUserId is not null && recordType.GetString() == "UserNotification" ||
                     notification.RecordKind == "AUDIT" && notification.RecipientUserId is null &&
                        recordType.GetString() is "PropertyChange" or "SecurityAuditRecord" &&
                        notification.EventKey == recordType.GetString() + ":" + notification.Id.ToString()),
                _ => false
            };
            if (!allowed)
                throw new InvalidOperationException("Use the explicit repository for this record; physical deletions are not allowed.");
        }
        var propertyLocations = entries.Select(e => e.Entity).OfType<BHome.Domain.PropertyManagement.Asset>()
            .Select(a => a.LocationId).Concat(entries.Where(e => e.Entity is BHome.Domain.PropertyManagement.Room &&
                (e.State == EntityState.Added || e.Property(nameof(BHome.Domain.PropertyManagement.Room.RoomNumber)).IsModified ||
                 e.Property(nameof(BHome.Domain.PropertyManagement.Room.LocationId)).IsModified || NativeRoomTypeChanged(e)))
                .Select(e => ((BHome.Domain.PropertyManagement.Room)e.Entity).LocationId))
            .Concat(entries.Select(e => e.Entity).OfType<BHome.Domain.PropertyManagement.BillingPolicy>().Select(p => p.LocationId)).Distinct().Order().ToArray();
        try
        {
            foreach (var location in propertyLocations)
                await Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))", token);
            foreach (var entry in entries.Where(e => e.Entity is BHome.Domain.PropertyManagement.BillingPolicy && e.State == EntityState.Modified))
                ValidateNativePolicyHistory(entry);
            var count = await base.SaveChangesAsync(true, token);
            await ValidatePropertyConfigurationAsync(propertyLocations, token);
            return count;
        }
        catch (PostgresException error)
        {
            throw new DbUpdateException("Compact24 persistence rejected a write.", error);
        }
        finally
        {
            // Match the previous isolated write model: a failed operation must
            // not leave a pending native insert/update for the next request/retry.
            foreach (var entry in entries) entry.State = EntityState.Detached;
        }
    }

    private static bool NativeRoomTypeChanged(Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry entry)
    {
        static string? TypeId(System.Text.Json.JsonElement history)
        {
            if (history.ValueKind != System.Text.Json.JsonValueKind.Array) return null;
            foreach (var item in history.EnumerateArray().Reverse())
                if (item.ValueKind == System.Text.Json.JsonValueKind.Object && item.TryGetProperty("recordType", out var type) &&
                    type.ValueKind == System.Text.Json.JsonValueKind.String && type.GetString() == "Room" &&
                    item.TryGetProperty("state", out var state) && state.ValueKind == System.Text.Json.JsonValueKind.Object)
                    return state.TryGetProperty("roomTypeId", out var id) &&
                        id.ValueKind == System.Text.Json.JsonValueKind.String ? id.GetString() : null;
            return null;
        }
        var history = entry.Property(nameof(BHome.Domain.PropertyManagement.Room.History));
        return history.IsModified && TypeId((System.Text.Json.JsonElement)history.OriginalValue!) !=
            TypeId((System.Text.Json.JsonElement)history.CurrentValue!);
    }
}
