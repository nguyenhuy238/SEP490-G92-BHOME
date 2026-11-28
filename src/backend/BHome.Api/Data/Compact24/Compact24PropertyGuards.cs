using BHome.Application.Common;
using BHome.Domain.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Persistence.Compact24;

public partial class Compact24DbContext
{
    protected async Task ValidatePropertyConfigurationAsync(Guid[] locations, CancellationToken token)
    {
        if (locations.Length == 0) return;
        if (await Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => locations.Contains(r.LocationId))
            .GroupBy(r => new { r.LocationId, Number = r.RoomNumber.Trim().ToUpper() }).AnyAsync(g => g.Count() > 1, token) ||
            await Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking().Where(a => locations.Contains(a.LocationId) && a.Code != null)
            .GroupBy(a => new { a.LocationId, Code = a.Code!.Trim().ToUpper() }).AnyAsync(g => g.Count() > 1, token))
            throw new PostgresException("Duplicate normalized property key.", "ERROR", "ERROR", "23505");
        var policies = Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking().Where(p => locations.Contains(p.LocationId));
        if (await policies.AnyAsync(a => policies.Any(b => b.Id != a.Id && b.LocationId == a.LocationId && b.RoomId == a.RoomId &&
            b.ChargeCode == a.ChargeCode && (b.EffectiveTo == null || a.EffectiveFrom <= b.EffectiveTo) &&
            (a.EffectiveTo == null || b.EffectiveFrom <= a.EffectiveTo)), token))
            throw new PostgresException("Overlapping effective policy versions.", "ERROR", "ERROR", "23P01");
    }

    private void ValidateNativePolicyHistory(EntityEntry entry)
    {
        var policy = (BHome.Domain.PropertyManagement.BillingPolicy)entry.Entity;
        var oldFrom = (DateOnly)entry.Property(nameof(BHome.Domain.PropertyManagement.BillingPolicy.EffectiveFrom)).OriginalValue!;
        var oldUsed = (DateTimeOffset?)entry.Property(nameof(BHome.Domain.PropertyManagement.BillingPolicy.FirstUsedAt)).OriginalValue;
        var oldTo = (DateOnly?)entry.Property(nameof(BHome.Domain.PropertyManagement.BillingPolicy.EffectiveTo)).OriginalValue;
        var today = PersistenceClock.BusinessToday();
        static string? HistoricalField(System.Text.Json.JsonElement history, string field)
        {
            foreach (var item in history.EnumerateArray().Reverse())
                if (item.ValueKind == System.Text.Json.JsonValueKind.Object && item.TryGetProperty("recordType", out var type) &&
                    type.ValueKind == System.Text.Json.JsonValueKind.String && type.GetString() == "BillingPolicy" &&
                    item.TryGetProperty("state", out var state) && state.ValueKind == System.Text.Json.JsonValueKind.Object)
                    return state.TryGetProperty(field, out var value) && value.ValueKind != System.Text.Json.JsonValueKind.Null
                        ? value.GetString() : null;
            return null;
        }
        var oldHistory = (System.Text.Json.JsonElement)entry.Property(nameof(BHome.Domain.PropertyManagement.BillingPolicy.History)).OriginalValue!;
        bool HistoryChanged(string field) => HistoricalField(oldHistory, field) != HistoricalField(policy.History, field);
        bool Changed(string name) => !Equals(entry.Property(name).OriginalValue, entry.Property(name).CurrentValue);
        var invalid = new[] { "LocationId", "RoomId", "ChargeCode", "Category", "Method" }.Any(Changed) ||
            HistoryChanged("roomTypeId") || oldUsed is not null && Changed("FirstUsedAt");
        if (oldUsed is null && policy.FirstUsedAt is not null)
            invalid |= HistoryChanged("name") || entry.Properties.Any(p => p.IsModified && p.Metadata.Name is not ("FirstUsedAt" or "Version" or "History"));
        else if (oldFrom > today && oldUsed is null)
            invalid |= policy.EffectiveFrom <= today;
        else
            invalid |= HistoryChanged("name") || entry.Properties.Any(p => p.IsModified && p.Metadata.Name is not ("EffectiveTo" or "Version" or "History")) ||
                policy.EffectiveTo is null || policy.EffectiveTo < today || oldTo is not null && policy.EffectiveTo > oldTo;
        if (invalid) throw new PostgresException("Historical policy terms cannot be rewritten.", "ERROR", "ERROR", "23514");
    }
}
