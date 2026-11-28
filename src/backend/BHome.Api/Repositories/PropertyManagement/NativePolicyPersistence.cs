using System.Text.Json;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal static class NativePolicyPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record PolicyState(Guid Id, Guid LocationId, Guid? RoomId, Guid? RoomTypeId,
        ChargeCategory Category, string ChargeCode, string Name, ChargingMethod Method, decimal Rate,
        DateOnly EffectiveFrom, DateOnly? EffectiveTo, DateTimeOffset? FirstUsedAt, int Version,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record PolicyHistory(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, PolicyState State);

    internal static BillingPolicy Read(BHome.Domain.PropertyManagement.BillingPolicy row)
    {
        var entry = row.History.EnumerateArray().Reverse().FirstOrDefault(h =>
            h.ValueKind == JsonValueKind.Object && h.TryGetProperty("recordType", out var kind) &&
            kind.ValueKind == JsonValueKind.String && kind.GetString() == "BillingPolicy");
        var state = entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("state", out var data) ? data : default;
        DateTimeOffset At(string name) => state.ValueKind == JsonValueKind.Object &&
            state.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        row.CreatedAt = At("createdAt");
        row.UpdatedAt = At("updatedAt");
        row.RoomTypeId = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("roomTypeId", out var roomType) &&
            roomType.ValueKind != JsonValueKind.Null ? roomType.GetGuid() : null;
        row.Name = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("name", out var name) &&
            name.ValueKind != JsonValueKind.Null ? name.ValueKind == JsonValueKind.String ? name.GetString()! : name.GetRawText() : "";
        return row;
    }

    internal static async Task StageAsync(Compact24DbContext db, BillingPolicy policy, int? expectedVersion,
        DateTimeOffset now, CancellationToken t)
    {
        BHome.Domain.PropertyManagement.BillingPolicy row;
        if (expectedVersion is null)
        {
            row = policy;
            db.Add(row);
        }
        else
        {
            row = await db.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsTracking().SingleOrDefaultAsync(p => p.Id == policy.Id, t)
                ?? throw new DbUpdateConcurrencyException("Policy no longer exists.");
            if (row.Version != expectedVersion.Value)
            {
                db.Entry(row).State = EntityState.Detached;
                throw new DbUpdateConcurrencyException("Policy version changed.");
            }
        }
        policy.Stamp(now, expectedVersion is null);
        row.LocationId = policy.LocationId;
        row.RoomId = policy.RoomId;
        row.Category = policy.Category;
        row.ChargeCode = policy.ChargeCode;
        if (!Enum.IsDefined(policy.Method)) throw new InvalidOperationException("Unsupported calculation method.");
        row.Method = policy.Method;
        row.Rate = policy.Rate;
        row.EffectiveFrom = policy.EffectiveFrom;
        row.EffectiveTo = policy.EffectiveTo;
        // Assign the persisted value on the tracked row so the existing
        // immutability guard can still reject a stale or altered usage time.
        db.Entry(row).Property(p => p.FirstUsedAt).CurrentValue = policy.FirstUsedAt;
        row.Version = policy.Version;
        var state = new PolicyState(policy.Id, policy.LocationId, policy.RoomId, policy.RoomTypeId, policy.Category,
            policy.ChargeCode, policy.Name, policy.Method, policy.Rate, policy.EffectiveFrom, policy.EffectiveTo,
            policy.FirstUsedAt, policy.Version, policy.CreatedAt, policy.UpdatedAt);
        var entry = JsonSerializer.SerializeToElement(new PolicyHistory(1, "BillingPolicy", policy.Id.ToString(), false, state), Json);
        row.History = JsonSerializer.SerializeToElement(row.History.EnumerateArray().Append(entry), Json);
    }
}
