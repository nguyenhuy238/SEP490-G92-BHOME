using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed partial class Compact24DbContext
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
                Native.Notification notification => entry.State == EntityState.Added &&
                    notification.EventData.ValueKind == System.Text.Json.JsonValueKind.Object &&
                    notification.EventData.TryGetProperty("recordType", out var recordType) &&
                    recordType.ValueKind == System.Text.Json.JsonValueKind.String &&
                    (notification.RecordKind == "OUTBOX" && notification.NotificationType == "NotificationPublication" &&
                        notification.RecipientUserId is null && recordType.GetString() == "NotificationPublication" ||
                     notification.RecordKind == "INBOX" && notification.RecipientUserId is not null && recordType.GetString() == "UserNotification"),
                _ => false
            };
            if (!allowed)
                throw new InvalidOperationException("Use the guarded Compact24 writer for unmigrated records or deletions.");
        }
        try { return await base.SaveChangesAsync(true, token); }
        finally
        {
            // Match the previous isolated write model: a failed operation must
            // not leave a pending native insert/update for the next request/retry.
            foreach (var entry in entries) entry.State = EntityState.Detached;
        }
    }
}
