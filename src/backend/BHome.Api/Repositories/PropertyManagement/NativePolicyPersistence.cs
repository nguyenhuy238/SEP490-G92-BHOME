using System.Text.Json;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal static class NativePolicyPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record PolicyState(Guid Id, Guid LocationId, Guid? RoomId, Guid? RoomTypeId,
        ChargeCategory Category, string ChargeCode, string Name, ChargingMethod Method, decimal Rate,
        DateOnly EffectiveFrom, DateOnly? EffectiveTo, DateTimeOffset? FirstUsedAt, int Version,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record PolicyHistory(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, PolicyState State);

    internal static BillingPolicy Read(Native.BillingPolicy row)
    {
        var entry = row.History.EnumerateArray().Reverse().FirstOrDefault(h =>
            h.ValueKind == JsonValueKind.Object && h.TryGetProperty("recordType", out var kind) &&
            kind.ValueKind == JsonValueKind.String && kind.GetString() == "BillingPolicy");
        var state = entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("state", out var data) ? data : default;
        DateTimeOffset At(string name) => state.ValueKind == JsonValueKind.Object &&
            state.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        var policy = BillingPolicy.Rehydrate(row.Id, At("createdAt"), At("updatedAt"), row.FirstUsedAt);
        policy.LocationId = row.LocationId;
        policy.RoomId = row.RoomId;
        policy.RoomTypeId = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("roomTypeId", out var roomType) &&
            roomType.ValueKind != JsonValueKind.Null ? roomType.GetGuid() : null;
        policy.Category = (ChargeCategory)row.Category;
        policy.ChargeCode = row.ChargeCode;
        policy.Name = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("name", out var name) &&
            name.ValueKind != JsonValueKind.Null ? name.ValueKind == JsonValueKind.String ? name.GetString()! : name.GetRawText() : "";
        policy.Method = row.CalculationMethod switch
        {
            "METERED" => ChargingMethod.Metered,
            "FIXED_PER_PERSON_PER_MONTH" => ChargingMethod.FixedPerPersonPerMonth,
            "FIXED_PER_ROOM_PER_MONTH" => ChargingMethod.FixedPerRoomPerMonth,
            _ => (ChargingMethod)(-1)
        };
        policy.Rate = row.Rate;
        policy.EffectiveFrom = row.EffectiveFrom;
        policy.EffectiveTo = row.EffectiveTo;
        policy.Version = row.Version;
        return policy;
    }

    internal static async Task StageAsync(Compact24DbContext db, BillingPolicy policy, int? expectedVersion,
        DateTimeOffset now, CancellationToken t)
    {
        Native.BillingPolicy row;
        if (expectedVersion is null)
        {
            row = new Native.BillingPolicy
            {
                Id = policy.Id, LocationId = policy.LocationId,
                History = JsonSerializer.SerializeToElement(Array.Empty<JsonElement>(), Json),
                Parameters = JsonSerializer.SerializeToElement(new { }, Json)
            };
            db.Add(row);
        }
        else
        {
            row = await db.Set<Native.BillingPolicy>().AsTracking().SingleOrDefaultAsync(p => p.Id == policy.Id, t)
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
        row.Category = (short)policy.Category;
        row.ChargeCode = policy.ChargeCode;
        row.CalculationMethod = policy.Method switch
        {
            ChargingMethod.Metered => "METERED",
            ChargingMethod.FixedPerPersonPerMonth => "FIXED_PER_PERSON_PER_MONTH",
            ChargingMethod.FixedPerRoomPerMonth => "FIXED_PER_ROOM_PER_MONTH",
            _ => throw new InvalidOperationException("Unsupported calculation method.")
        };
        row.Rate = policy.Rate;
        row.EffectiveFrom = policy.EffectiveFrom;
        row.EffectiveTo = policy.EffectiveTo;
        row.FirstUsedAt = policy.FirstUsedAt;
        row.Version = policy.Version;
        var state = new PolicyState(policy.Id, policy.LocationId, policy.RoomId, policy.RoomTypeId, policy.Category,
            policy.ChargeCode, policy.Name, policy.Method, policy.Rate, policy.EffectiveFrom, policy.EffectiveTo,
            policy.FirstUsedAt, policy.Version, policy.CreatedAt, policy.UpdatedAt);
        var entry = JsonSerializer.SerializeToElement(new PolicyHistory(1, "BillingPolicy", policy.Id.ToString(), false, state), Json);
        row.History = JsonSerializer.SerializeToElement(row.History.EnumerateArray().Append(entry), Json);
    }
}
