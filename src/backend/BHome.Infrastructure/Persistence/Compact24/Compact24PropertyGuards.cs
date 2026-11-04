using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed partial class Compact24DbContext
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

    private async Task ValidatePropertyConfigurationAsync(Guid[] locations, CancellationToken token)
    {
        if (locations.Length == 0) return;
        if (await Set<Room>().AsNoTracking().Where(r => locations.Contains(r.LocationId))
            .GroupBy(r => new { r.LocationId, Number = r.RoomNumber.Trim().ToUpper() }).AnyAsync(g => g.Count() > 1, token) ||
            await Set<RoomType>().AsNoTracking().Where(r => locations.Contains(r.LocationId))
            .GroupBy(r => new { r.LocationId, Name = r.Name.Trim().ToUpper() }).AnyAsync(g => g.Count() > 1, token) ||
            await Set<Asset>().AsNoTracking().Where(a => locations.Contains(a.LocationId) && a.Code != null)
            .GroupBy(a => new { a.LocationId, Code = a.Code!.Trim().ToUpper() }).AnyAsync(g => g.Count() > 1, token))
            throw new PostgresException("Duplicate normalized property key.", "ERROR", "ERROR", "23505");
        if (await Set<Room>().AnyAsync(r => locations.Contains(r.LocationId) && r.RoomTypeId != null &&
            !Set<RoomType>().Any(t => t.Id == r.RoomTypeId && t.LocationId == r.LocationId), token) ||
            await Set<BillingPolicy>().AnyAsync(p => locations.Contains(p.LocationId) && p.RoomTypeId != null &&
            !Set<RoomType>().Any(t => t.Id == p.RoomTypeId && t.LocationId == p.LocationId), token))
            throw new PostgresException("Invalid Location catalog reference.", "ERROR", "ERROR", "23503");
        var policies = Set<BillingPolicy>().AsNoTracking().Where(p => locations.Contains(p.LocationId));
        if (await policies.AnyAsync(a => policies.Any(b => b.Id != a.Id && b.LocationId == a.LocationId && b.RoomId == a.RoomId &&
            b.RoomTypeId == a.RoomTypeId && b.ChargeCode == a.ChargeCode && (b.EffectiveTo == null || a.EffectiveFrom <= b.EffectiveTo) &&
            (a.EffectiveTo == null || b.EffectiveFrom <= a.EffectiveTo)), token))
            throw new PostgresException("Overlapping effective policy versions.", "ERROR", "ERROR", "23P01");
    }

    private static void ValidatePolicyHistory(EntityEntry entry)
    {
        var policy = (BillingPolicy)entry.Entity;
        var oldFrom = entry.Property(nameof(BillingPolicy.EffectiveFrom)).OriginalValue;
        var oldUsed = entry.Property(nameof(BillingPolicy.FirstUsedAt)).OriginalValue;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
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
