using System.Globalization;
using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Ocr;

internal static class NativeCaptureReads
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record StampState(DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record TaskState(OperationalTaskKind Kind, Guid? AssignmentId, string? Result, bool EvidenceRequired, Guid? TargetRoomId,
        Guid? TargetAssetId, string? TargetCommonArea, string? TargetLabel, string? MoveInInventoryJson,
        string? LocationAssetInventoryJson, Guid? BillingRoomId, UtilityType? BillingUtilityType, Guid? AutomationPlanId,
        ReadingPurpose Purpose, DateOnly ReadingDate, decimal? OcrProposedValue, string? OcrImageHash,
        string? OcrEngineVersion, DateTimeOffset? CompletedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record ReadingState(Guid EvidenceId, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record EvidenceState(Guid Id, Guid TaskId, Guid UploadedByUserId, string ObjectKey, string ImageHash,
        string ContentType, long Length, DateTimeOffset CleanupAfter, bool IsUploaded, bool IsLinked,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    private static T? Latest<T>(JsonElement history, string kind) where T : class
    {
        var entry = history.EnumerateArray().Reverse().FirstOrDefault(h => h.ValueKind == JsonValueKind.Object &&
            h.TryGetProperty("recordType", out var type) && type.GetString() == kind);
        return entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("state", out var state) ? state.Deserialize<T>(Json) : null;
    }

    internal static Meter Meter(Native.Meter row)
    {
        var s = Latest<StampState>(row.History, "Meter");
        var m = BHome.Domain.Billing.Meter.Rehydrate(row.Id);
        m.RoomId = row.RoomId; m.Code = row.MeterCode; m.UtilityType = (UtilityType)row.UtilityType;
        m.Display = (MeterDisplay)row.DisplayType; m.DecimalPlaces = row.DecimalPlaces; m.InstalledOn = row.InstalledOn; m.IsActive = row.IsActive;
        m.CreatedAt = s?.CreatedAt ?? DateTimeOffset.UnixEpoch; m.UpdatedAt = s?.UpdatedAt ?? DateTimeOffset.UnixEpoch;
        return m;
    }

    internal static OperationalTask Task(Native.OperationalTask row)
    {
        // Old physically imported tasks can contain {} rather than a domain snapshot.
        // Keep physical columns authoritative and apply the old projection's defaults.
        var s = row.TaskData.ValueKind == JsonValueKind.Object && row.TaskData.TryGetProperty("state", out var state) &&
            state.ValueKind == JsonValueKind.Object ? state.Deserialize<TaskState>(Json)! : JsonSerializer.Deserialize<TaskState>("{}", Json)!;
        return new OperationalTask(row.Id)
        {
            Kind = s.Kind is OperationalTaskKind.MoveInInventory or OperationalTaskKind.LocationAssetHandover
                ? s.Kind : row.TaskType == "GENERAL" ? OperationalTaskKind.AdHoc : OperationalTaskKind.MeterReading,
            LocationId = row.LocationId!.Value,
            Title = row.Title ?? "",
            Requirements = row.Description ?? "",
            Priority = (OperationalTaskPriority)int.Parse(row.Priority ?? "0", CultureInfo.InvariantCulture),
            DueAt = row.DueAt,
            EvidenceRequired = s.EvidenceRequired,
            AssignedStaffUserId = row.AssignedUserId,
            AssignmentId = s.AssignmentId,
            AssignedAt = row.AssignedAt,
            Result = s.Result,
            VerifiedByUserId = row.VerifiedByUserId,
            VerifiedAt = row.VerifiedAt,
            Version = row.Version,
            TargetRoomId = s.TargetRoomId,
            TargetAssetId = s.TargetAssetId,
            TargetCommonArea = s.TargetCommonArea,
            TargetLabel = s.TargetLabel,
            ContractId = row.ContractId,
            MoveInInventoryJson = s.MoveInInventoryJson ?? "",
            LocationAssetInventoryJson = s.LocationAssetInventoryJson ?? "",
            BillingRoomId = s.BillingRoomId,
            BillingUtilityType = s.BillingUtilityType,
            AutomationPlanId = s.AutomationPlanId,
            MeterId = row.MeterId,
            Purpose = s.Purpose,
            ReadingDate = s.ReadingDate == default ? new DateOnly(1970, 1, 1) : s.ReadingDate,
            BillingPeriod = row.BillingPeriod,
            Status = (MeterTaskStatus)int.Parse(row.Status, CultureInfo.InvariantCulture),
            OcrProposedValue = s.OcrProposedValue,
            OcrImageHash = s.OcrImageHash,
            OcrEngineVersion = s.OcrEngineVersion,
            CompletedAt = s.CompletedAt,
            CreatedAt = s.CreatedAt == default ? DateTimeOffset.UnixEpoch : s.CreatedAt,
            UpdatedAt = s.UpdatedAt == default ? DateTimeOffset.UnixEpoch : s.UpdatedAt
        };
    }

    internal static MeterReading Reading(Native.MeterReading row)
    {
        var s = Latest<ReadingState>(row.History, "MeterReading");
        var reading = MeterReading.Rehydrate(row.Id);
        reading.TaskId = row.OperationalTaskId; reading.MeterId = row.MeterId; reading.EvidenceId = s?.EvidenceId ?? Guid.Empty;
        reading.PreviousValue = row.PreviousValue; reading.OcrProposedValue = row.OcrProposedValue; reading.ConfirmedValue = row.ConfirmedValue;
        reading.Consumption = row.Consumption; reading.Status = (MeterReadingStatus)row.Status; reading.ConfirmedByUserId = row.ConfirmedByUserId;
        reading.ConfirmedAt = row.ConfirmedAt; reading.CreatedAt = s?.CreatedAt ?? DateTimeOffset.UnixEpoch; reading.UpdatedAt = s?.UpdatedAt ?? DateTimeOffset.UnixEpoch;
        return reading;
    }

    internal static MeterEvidence? Evidence(Native.OperationalTask row, Guid id)
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
            ? db.Set<Native.OperationalTask>().FromSqlInterpolated($"SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND EXISTS(SELECT 1 FROM jsonb_array_elements(evidence) e WHERE e->>'recordType'='MeterEvidence' AND e->>'id'={id.ToString()}) FOR UPDATE SKIP LOCKED")
            : db.Set<Native.OperationalTask>().FromSqlInterpolated($"SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND EXISTS(SELECT 1 FROM jsonb_array_elements(evidence) e WHERE e->>'recordType'='MeterEvidence' AND e->>'id'={id.ToString()}) FOR UPDATE");
        var row = await query.AsNoTracking().SingleOrDefaultAsync(t);
        return row is null ? null : Evidence(row, id);
    }
}
