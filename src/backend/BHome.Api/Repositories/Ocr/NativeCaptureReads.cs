using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Ocr;

internal static class NativeCaptureReads
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record TaskState(OperationalTaskKind Kind, Guid? AssignmentId, string? Result, bool EvidenceRequired, Guid? TargetRoomId,
        Guid? TargetAssetId, string? TargetCommonArea, string? TargetLabel, string? MoveInInventoryJson,
        string? LocationAssetInventoryJson, Guid? BillingRoomId, UtilityType? BillingUtilityType, Guid? AutomationPlanId,
        ReadingPurpose Purpose, DateOnly ReadingDate, decimal? OcrProposedValue, string? OcrImageHash,
        string? OcrEngineVersion, DateTimeOffset? CompletedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record EvidenceState(Guid Id, Guid TaskId, Guid UploadedByUserId, string ObjectKey, string ImageHash,
        string ContentType, long Length, DateTimeOffset CleanupAfter, bool IsUploaded, bool IsLinked,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    internal static OperationalTask Task(OperationalTask row)
    {
        // Old physically imported tasks can contain {} rather than a domain snapshot.
        // Keep physical columns authoritative and apply the old projection's defaults.
        var s = row.TaskData.ValueKind == JsonValueKind.Object && row.TaskData.TryGetProperty("state", out var state) &&
            state.ValueKind == JsonValueKind.Object ? state.Deserialize<TaskState>(Json)! : JsonSerializer.Deserialize<TaskState>("{}", Json)!;
        if (row.StoredLocationId is null)
            throw new InvalidOperationException("Staff and meter tasks require a location.");
        row.Kind = s.Kind is OperationalTaskKind.MoveInInventory or OperationalTaskKind.LocationAssetHandover
            ? s.Kind : row.TaskType == "GENERAL" ? OperationalTaskKind.AdHoc : OperationalTaskKind.MeterReading;
        row.EvidenceRequired = s.EvidenceRequired;
        row.AssignmentId = s.AssignmentId;
        row.Result = s.Result;
        row.TargetRoomId = s.TargetRoomId;
        row.TargetAssetId = s.TargetAssetId;
        row.TargetCommonArea = s.TargetCommonArea;
        row.TargetLabel = s.TargetLabel;
        row.MoveInInventoryJson = s.MoveInInventoryJson ?? "";
        row.LocationAssetInventoryJson = s.LocationAssetInventoryJson ?? "";
        row.BillingRoomId = s.BillingRoomId;
        row.BillingUtilityType = s.BillingUtilityType;
        row.AutomationPlanId = s.AutomationPlanId;
        row.Purpose = s.Purpose;
        row.ReadingDate = s.ReadingDate == default ? new DateOnly(1970, 1, 1) : s.ReadingDate;
        row.OcrProposedValue = s.OcrProposedValue;
        row.OcrImageHash = s.OcrImageHash;
        row.OcrEngineVersion = s.OcrEngineVersion;
        row.CompletedAt = s.CompletedAt;
        row.CreatedAt = s.CreatedAt == default ? DateTimeOffset.UnixEpoch : s.CreatedAt;
        row.UpdatedAt = s.UpdatedAt == default ? DateTimeOffset.UnixEpoch : s.UpdatedAt;
        return row;
    }

    internal static MeterEvidence? Evidence(OperationalTask row, Guid id)
    {
        var entry = row.Evidence.EnumerateArray().SingleOrDefault(e => e.TryGetProperty("recordType", out var kind) && kind.GetString() == "MeterEvidence" &&
            e.TryGetProperty("id", out var key) && key.TryGetGuid(out var guid) && guid == id);
        if (entry.ValueKind == JsonValueKind.Undefined) return null;
        var s = entry.Deserialize<EvidenceState>(Json) ?? throw new InvalidOperationException("Invalid meter evidence state.");
        var result = MeterEvidence.Rehydrate(s.Id);
        result.TaskId = s.TaskId; result.UploadedByUserId = s.UploadedByUserId; result.ObjectKey = s.ObjectKey; result.ImageHash = s.ImageHash;
        result.ContentType = s.ContentType; result.Length = s.Length; result.CleanupAfter = s.CleanupAfter; result.IsUploaded = s.IsUploaded;
        result.IsLinked = s.IsLinked; result.CreatedAt = s.CreatedAt; result.UpdatedAt = s.UpdatedAt;
        return result;
    }

    internal static async Task<MeterEvidence?> LockedEvidenceAsync(Compact24DbContext db, Guid id, CancellationToken t, bool skipLocked = false)
    {
        var query = skipLocked
            ? db.Set<OperationalTask>().FromSqlInterpolated($"SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND EXISTS(SELECT 1 FROM jsonb_array_elements(evidence) e WHERE e->>'recordType'='MeterEvidence' AND e->>'id'={id.ToString()}) FOR UPDATE SKIP LOCKED")
            : db.Set<OperationalTask>().FromSqlInterpolated($"SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND EXISTS(SELECT 1 FROM jsonb_array_elements(evidence) e WHERE e->>'recordType'='MeterEvidence' AND e->>'id'={id.ToString()}) FOR UPDATE");
        var row = await query.AsNoTracking().SingleOrDefaultAsync(t);
        return row is null ? null : Evidence(row, id);
    }
}
