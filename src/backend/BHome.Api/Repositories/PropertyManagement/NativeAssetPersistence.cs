using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

// The domain Asset is a detached business value, not a persistence projection.
// Retain the exact existing history shape for other modules and historical imports.
internal static class NativeAssetPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record AssetState(Guid Id, Guid LocationId, Guid? RoomId, string? CommonArea,
        string? Code, string Name, string Category, string Condition, AssetStatus Status, int Version,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string? PurchaseInfo);
    private sealed record AssetHistory(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, AssetState State);

    internal static Asset Read(Native.Asset row)
    {
        var history = row.History.EnumerateArray().Reverse().FirstOrDefault(h =>
            h.ValueKind == JsonValueKind.Object && h.TryGetProperty("recordType", out var type) &&
            type.ValueKind == JsonValueKind.String && type.GetString() == "Asset");
        var state = history.ValueKind == JsonValueKind.Object && history.TryGetProperty("state", out var data)
            ? data : default;
        DateTimeOffset At(string name) => state.ValueKind == JsonValueKind.Object && state.TryGetProperty(name, out var value) &&
            value.ValueKind != JsonValueKind.Null ? value.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        var asset = Asset.Rehydrate(row.Id, At("createdAt"), At("updatedAt"));
        asset.LocationId = row.LocationId;
        asset.RoomId = row.RoomId;
        asset.CommonArea = row.CommonArea;
        asset.Code = row.AssetCode;
        asset.Name = row.Name;
        asset.Category = row.Category;
        asset.Condition = row.Condition;
        asset.Status = (AssetStatus)row.Status;
        asset.Version = row.Version;
        return asset;
    }

    internal static AssetMetadata Metadata(Native.Asset row) =>
        row.PurchaseInfo.TryGetProperty("trackingMode", out _)
            ? row.PurchaseInfo.Deserialize<AssetMetadata>(Json)!
            : new("Serialized", 1, null, null, null);

    internal static async Task StageAsync(Compact24DbContext db, Asset asset, int? expectedVersion,
        AssetMetadata? initialMetadata, DateTimeOffset now, CancellationToken t)
    {
        Native.Asset row;
        string? purchaseInfo;
        if (expectedVersion is null)
        {
            row = new Native.Asset
            {
                Id = asset.Id,
                LocationId = asset.LocationId,
                History = JsonSerializer.SerializeToElement(Array.Empty<JsonElement>(), Json),
                PurchaseInfo = initialMetadata is null ? JsonSerializer.SerializeToElement(new { }, Json)
                    : JsonSerializer.SerializeToElement(initialMetadata, Json)
            };
            purchaseInfo = initialMetadata is null ? null : JsonSerializer.Serialize(initialMetadata, Json);
            db.Add(row);
        }
        else
        {
            row = await db.Set<Native.Asset>().AsTracking().SingleOrDefaultAsync(a => a.Id == asset.Id, t)
                ?? throw new DbUpdateConcurrencyException("Asset no longer exists.");
            if (row.Version != expectedVersion.Value)
            {
                db.Entry(row).State = EntityState.Detached;
                throw new DbUpdateConcurrencyException("Asset version changed.");
            }
            if (row.LocationId == asset.LocationId && row.RoomId == asset.RoomId &&
                row.CommonArea == asset.CommonArea && row.AssetCode == asset.Code &&
                row.Name == asset.Name && row.Category == asset.Category && row.Condition == asset.Condition &&
                row.Status == (short)asset.Status && row.Version == asset.Version)
            {
                db.Entry(row).State = EntityState.Detached;
                return;
            }
            purchaseInfo = row.PurchaseInfo.GetRawText();
        }
        asset.Stamp(now, expectedVersion is null);
        row.LocationId = asset.LocationId;
        row.RoomId = asset.RoomId;
        row.CommonArea = asset.CommonArea;
        row.AssetCode = asset.Code;
        row.Name = asset.Name;
        row.Category = asset.Category;
        row.Condition = asset.Condition;
        row.Status = (short)asset.Status;
        row.Version = asset.Version;
        var snapshot = new AssetState(asset.Id, asset.LocationId, asset.RoomId, asset.CommonArea, asset.Code,
            asset.Name, asset.Category, asset.Condition, asset.Status, asset.Version,
            asset.CreatedAt, asset.UpdatedAt, purchaseInfo);
        var entry = JsonSerializer.SerializeToElement(new AssetHistory(1, "Asset", asset.Id.ToString(), false, snapshot), Json);
        row.History = JsonSerializer.SerializeToElement(row.History.EnumerateArray().Append(entry), Json);
    }

    internal static void StageAudit(Compact24DbContext db, PropertyChange change)
    {
        db.Add(new Native.Notification
        {
            Id = change.Id,
            RecordKind = "AUDIT",
            ActorUserId = change.ActorId,
            LocationId = change.LocationId,
            EventKey = "PropertyChange:" + change.Id,
            NotificationType = change.Action,
            RelatedEntityType = change.TargetType,
            RelatedEntityId = change.TargetId,
            EventAt = change.OccurredAt,
            EventData = JsonSerializer.SerializeToElement(new
            {
                schemaVersion = 1, recordType = "PropertyChange", state = change,
                audienceRole = (string?)null, category = (string?)null, succeeded = (bool?)null,
                sessionId = (Guid?)null, targetUserId = (Guid?)null
            }, Json),
            DeliveryHistory = JsonSerializer.SerializeToElement(Array.Empty<JsonElement>(), Json)
        });
    }

    internal static void StageSecurityAudit(Compact24DbContext db, SecurityAuditRecord audit)
    {
        db.Add(new Native.Notification
        {
            Id = audit.Id,
            RecordKind = "AUDIT",
            ActorUserId = audit.UserId,
            EventKey = "SecurityAuditRecord:" + audit.Id,
            NotificationType = audit.Event,
            RelatedEntityType = audit.TargetType,
            RelatedEntityId = audit.TargetId,
            EventAt = audit.OccurredAt,
            EventData = JsonSerializer.SerializeToElement(new
            {
                schemaVersion = 1, recordType = "SecurityAuditRecord", state = audit,
                audienceRole = (string?)null, category = (string?)null, succeeded = audit.Succeeded,
                sessionId = audit.SessionId, targetUserId = audit.TargetUserId
            }, Json),
            DeliveryHistory = JsonSerializer.SerializeToElement(Array.Empty<JsonElement>(), Json)
        });
    }
}
