using BHome.Application.Common;
using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed partial class Compact24ArchiveContext
{
    // Preserve the normalized indexes and deferred policy exclusion of the source schema.
    // JSON catalogs cannot use the source's relational FK/index; the same Location lock used
    // by PropertyService now also protects direct repository writes and imported catalogs.
    private async Task<Guid[]> LockPropertyConfigurationAsync(EntityEntry[] entries, CancellationToken token)
    {
        if (Importing) return [];
        var relevant = entries.Where(e => e.Entity is RoomType or Asset or BillingPolicy || e.Entity is Room &&
            (e.State == EntityState.Added || new[] { "RoomNumber", "LocationId", "RoomTypeId" }.Any(p => e.Property(p).IsModified))).ToArray();
        var locations = relevant.Select(e => (Guid)e.Property("LocationId").CurrentValue!).Distinct().Order().ToArray();
        foreach (var location in locations)
            await Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))", token);
        foreach (var entry in relevant.Where(e => e.Entity is BillingPolicy && e.State == EntityState.Modified)) ValidatePolicyHistory(entry);
        return locations;
    }

    private void ValidatePolicyHistory(EntityEntry entry)
    {
        var policy = (BillingPolicy)entry.Entity;
        var oldFrom = entry.Property(nameof(BillingPolicy.EffectiveFrom)).OriginalValue;
        var oldUsed = entry.Property(nameof(BillingPolicy.FirstUsedAt)).OriginalValue;
        var today = PersistenceClock.BusinessToday();
        var immutable = new[] { "LocationId", "RoomId", "RoomTypeId", "ChargeCode", "Category", "Method" };
        bool Changed(string name) => !Equals(entry.Property(name).OriginalValue, entry.Property(name).CurrentValue);
        var invalid = immutable.Any(Changed) || oldUsed is not null && Changed("FirstUsedAt");
        if (oldUsed is null && policy.FirstUsedAt is not null)
            invalid |= entry.Properties.Any(p => p.IsModified && p.Metadata.Name is not ("FirstUsedAt" or "Version" or "UpdatedAt"));
        else if ((DateOnly)oldFrom! > today && oldUsed is null)
            invalid |= policy.EffectiveFrom <= today;
        else
        {
            var oldTo = (DateOnly?)entry.Property(nameof(BillingPolicy.EffectiveTo)).OriginalValue;
            invalid |= entry.Properties.Any(p => p.IsModified && p.Metadata.Name is not ("EffectiveTo" or "Version" or "UpdatedAt")) ||
                policy.EffectiveTo is null || policy.EffectiveTo < today || oldTo is not null && policy.EffectiveTo > oldTo;
        }
        if (invalid) throw new PostgresException("Historical policy terms cannot be rewritten.", "ERROR", "ERROR", "23514");
    }

}
