using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using iText.Kernel.Pdf;

namespace BHome.Infrastructure.StaffOperations;

// Compact24 is intentionally a 24-table database: an immutable report manifest and its
// signature events live in the Location's append-only history; immutable JSON/PDF bytes
// are private object-storage objects. A task is completed only after both acceptances.
public sealed class LocationAssetHandoverService(
    Compact24DbContext db, ICurrentUser currentUser, IObjectStorage storage,
    TimeProvider clock, ISetupWorkspaceStore workspace,
    BHome.Application.StaffOperations.IOperationalTaskRepository taskRepository,
    IHandoverSignatureInkRenderer inkRenderer,
    IContractSigningPages signingPages)
{
    private readonly CompactNotificationWriter inbox = new(db, clock);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private sealed record ReportManifest(
        Guid TaskId, Guid LocationId, Guid AssignmentId, Guid StaffId, Guid OwnerId,
        int TaskVersion, int Revision, string LocationName, string Address,
        int TotalItems, int DirectItems, int InheritedItems,
        string SnapshotSha256, string SnapshotObjectKey, string PdfSha256, string PdfObjectKey,
        DateTimeOffset ApprovedAt, string? ExceptionDecision,
        string? OwnerDisplayName = null, string? StaffDisplayName = null,
        DateOnly? AssignmentStart = null, DateOnly? AssignmentEnd = null);

    private sealed record ReportEvent(string Action, Guid TaskId, int Revision, DateTimeOffset OccurredAt,
        ReportManifest? Report = null, LocationAssetHandoverAcceptance? Signature = null,
        string? FinalPdfObjectKey = null, string? FinalPdfSha256 = null,
        string? InkObjectKey = null, string? InkSha256 = null,
        string? OwnerPdfObjectKey = null, string? OwnerPdfSha256 = null);

    private sealed record TaskState(Guid Id, Guid LocationId, Guid? StaffId, Guid? AssignmentId,
        int Version, string Status, string InventoryJson, string LocationName, string Address,
        string AssignmentHistory, string LocationHistory);

    private sealed record ReportState(ReportManifest Manifest,
        LocationAssetHandoverAcceptance? OwnerSignature,
        LocationAssetHandoverAcceptance? StaffSignature,
        string? FinalPdfObjectKey, string? FinalPdfSha256,
        string? OwnerInkObjectKey = null, string? OwnerInkSha256 = null,
        string? OwnerPdfObjectKey = null, string? OwnerPdfSha256 = null);

    private sealed record LocationHistory(Guid Id, string History);

    private Guid Actor => currentUser.UserId is { } actor && actor != Guid.Empty
        ? actor : throw new OperationalTaskException(401, "authentication_required");

    private DateTimeOffset Now => clock.GetUtcNow();
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
        Now, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static string? ReadString(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        foreach (var field in element.EnumerateObject())
            if (field.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                return field.Value.ValueKind == JsonValueKind.Null ? null : field.Value.ToString();
        return null;
    }
    private static JsonElement Property(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var field in element.EnumerateObject())
                if (field.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) return field.Value;
        return default;
    }

    private static IReadOnlyList<LocationAssetReportItem> ParseItems(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var items = Property(doc.RootElement, "items");
            if (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() > 10000)
                throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
            var result = new List<LocationAssetReportItem>(items.GetArrayLength());
            var ids = new HashSet<Guid>();
            foreach (var item in items.EnumerateArray())
            {
                var id = Guid.TryParse(ReadString(item, "id"), out var parsedId) ? parsedId : Guid.Empty;
                var name = ReadString(item, "name") ?? "";
                var quantity = int.TryParse(ReadString(item, "quantity"), NumberStyles.Integer,
                    CultureInfo.InvariantCulture, out var count) ? count : -1;
                var checkedItem = bool.TryParse(ReadString(item, "checked"), out var confirmed) && confirmed;
                var inherited = bool.TryParse(ReadString(item, "inherited"), out var inheritedValue) && inheritedValue;
                var source = Guid.TryParse(ReadString(item, "sourceHandoverContractId"), out var sourceId)
                    ? sourceId : (Guid?)null;
                var incident = Guid.TryParse(ReadString(item, "incidentId"), out var incidentId)
                    ? incidentId : (Guid?)null;
                var priorTask = Guid.TryParse(ReadString(item, "priorStaffTaskId"), out var priorTaskId)
                    ? priorTaskId : (Guid?)null;
                var priorStaff = Guid.TryParse(ReadString(item, "priorStaffUserId"), out var priorStaffId)
                    ? priorStaffId : (Guid?)null;
                if (id == Guid.Empty || !ids.Add(id) || name.Length is < 1 or > 300 ||
                    quantity is < 0 or > 1000000 || !checkedItem || inherited && source is null)
                    throw OperationalTaskException.Conflict("location_inventory_checklist_incomplete");
                var room = ReadString(item, "roomNumber");
                var common = ReadString(item, "commonArea");
                var scope = !string.IsNullOrWhiteSpace(room) ? "Phòng " + room :
                    !string.IsNullOrWhiteSpace(common) ? common : "Khu vực chung";
                result.Add(new(id, scope, name, quantity, inherited, source, incident,
                    ReadString(item, "note"), priorTask, priorStaff)
                {
                    Condition = ReadString(item, "condition") ?? "Unassessed"
                });
            }
            return result;
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid"); }
    }

    private static ReportEvent[] Events(string history)
    {
        try
        {
            using var doc = JsonDocument.Parse(history);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                throw OperationalTaskException.Conflict("location_handover_history_invalid");
            return doc.RootElement.EnumerateArray()
                .Where(x => (ReadString(x, "action") ?? "").StartsWith("LocationAssetHandover", StringComparison.Ordinal))
                .Select(x => JsonSerializer.Deserialize<ReportEvent>(x.GetRawText(), Json))
                .Where(x => x is not null).Cast<ReportEvent>().ToArray();
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("location_handover_history_invalid"); }
    }

    private static ReportState? Latest(string history, Guid taskId)
    {
        try
        {
            using var doc = JsonDocument.Parse(history);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                throw OperationalTaskException.Conflict("location_handover_history_invalid");
            var events = doc.RootElement.EnumerateArray()
                .Where(x => ReadString(x, "taskId") == taskId.ToString("D") &&
                    (ReadString(x, "action") ?? "").StartsWith("LocationAssetHandover", StringComparison.Ordinal))
                .Select(x => JsonSerializer.Deserialize<ReportEvent>(x.GetRawText(), Json))
                .Where(x => x is not null).Cast<ReportEvent>().ToArray();
            var approval = events.LastOrDefault(x => x.Action == "LocationAssetHandoverApproved" &&
                x.Report is not null);
            if (approval?.Report is not { } manifest) return null;
            var matching = events.Where(x => x.Revision == manifest.Revision).ToArray();
            var owner = matching.LastOrDefault(x => x.Action == "LocationAssetHandoverOwnerSigned");
            var staff = matching.LastOrDefault(x => x.Action == "LocationAssetHandoverStaffSigned");
            return new(manifest, owner?.Signature, staff?.Signature,
                staff?.FinalPdfObjectKey, staff?.FinalPdfSha256,
                owner?.InkObjectKey, owner?.InkSha256,
                owner?.OwnerPdfObjectKey, owner?.OwnerPdfSha256);
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("location_handover_history_invalid"); }
    }

    private static IReadOnlyList<ReportState> Revisions(string history, Guid locationId)
    {
        var events = Events(history);
        var result = new List<ReportState>();
        foreach (var approval in events.Where(x => x.Action == "LocationAssetHandoverApproved" && x.Report is not null))
        {
            var manifest = approval.Report!;
            if (approval.TaskId != manifest.TaskId || approval.Revision != manifest.Revision ||
                manifest.LocationId != locationId || manifest.Revision < 1) continue;
            var matching = events.Where(x => x.TaskId == manifest.TaskId && x.Revision == manifest.Revision).ToArray();
            var owner = matching.LastOrDefault(x => x.Action == "LocationAssetHandoverOwnerSigned");
            var staff = matching.LastOrDefault(x => x.Action == "LocationAssetHandoverStaffSigned");
            result.Add(new(manifest, owner?.Signature, staff?.Signature,
                staff?.FinalPdfObjectKey, staff?.FinalPdfSha256,
                owner?.InkObjectKey, owner?.InkSha256,
                owner?.OwnerPdfObjectKey, owner?.OwnerPdfSha256));
        }
        return result;
    }

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(Uri.IsHexDigit);

    private static bool IsFinalArchiveRevision(ReportState state, Guid actor)
    {
        var manifest = state.Manifest;
        var owner = state.OwnerSignature;
        var staff = state.StaffSignature;
        var expectedSnapshotKey = $"location-asset-handovers/{manifest.TaskId:N}/v{manifest.Revision}/inventory.json";
        var expectedFinalPdfKey = $"location-asset-handovers/{manifest.TaskId:N}/v{manifest.Revision}/signed.pdf";
        return manifest.TaskId != Guid.Empty && manifest.LocationId != Guid.Empty &&
            manifest.StaffId == actor && manifest.OwnerId != Guid.Empty &&
            IsSha256(manifest.SnapshotSha256) && manifest.SnapshotObjectKey == expectedSnapshotKey &&
            owner is not null && owner.ActorId == manifest.OwnerId &&
            owner.Method is "AuthenticatedSessionAcceptance" or "AuthenticatedSessionHandwritten" &&
            string.Equals(owner.SnapshotSha256, manifest.SnapshotSha256, StringComparison.OrdinalIgnoreCase) &&
            staff is not null && staff.ActorId == actor &&
            staff.Method is "AuthenticatedSessionAcceptance" or "AuthenticatedSessionHandwritten" &&
            string.Equals(staff.SnapshotSha256, manifest.SnapshotSha256, StringComparison.OrdinalIgnoreCase) &&
            state.FinalPdfObjectKey == expectedFinalPdfKey && IsSha256(state.FinalPdfSha256);
    }

    private async Task<IReadOnlyList<LocationHistory>> ArchiveHistoriesAsync(
        Guid? taskId, int? revision, CancellationToken token)
    {
        await EnsureConnectionOpenAsync(token);
        var sql = new StringBuilder("""
            SELECT l.id,COALESCE((
                SELECT jsonb_agg(history_entry.value ORDER BY history_entry.ordinality)
                FROM jsonb_array_elements(COALESCE(l.history,'[]'::jsonb))
                    WITH ORDINALITY AS history_entry(value,ordinality)
                WHERE history_entry.value->>'action' LIKE 'LocationAssetHandover%'
            ),'[]'::jsonb)::text
            FROM locations l
            WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(l.history,'[]'::jsonb)) AS entry(value)
                WHERE entry.value->>'action'='LocationAssetHandoverApproved'
                    AND entry.value->'report'->>'staffId'=@staff
            """);
        var args = new List<(string Name, object Value)> { ("staff", Actor.ToString("D")) };
        if (taskId is { } task)
        {
            sql.Append(" AND entry.value->'report'->>'taskId'=@task");
            args.Add(("task", task.ToString("D")));
        }
        if (revision is { } reportRevision)
        {
            sql.Append(" AND entry.value->'report'->>'revision'=@revision");
            args.Add(("revision", reportRevision.ToString(CultureInfo.InvariantCulture)));
        }
        sql.Append(") ORDER BY l.name,l.id");
        await using var command = Command(sql.ToString(), args.ToArray());
        await using var reader = await command.ExecuteReaderAsync(token);
        var result = new List<LocationHistory>();
        while (await reader.ReadAsync(token))
            result.Add(new(reader.GetGuid(0), reader.GetString(1)));
        return result;
    }

    private async Task<ReportState> ArchiveRevisionStateAsync(Guid taskId, int revision, CancellationToken token)
    {
        if (taskId == Guid.Empty || revision < 1) throw OperationalTaskException.Missing();
        var histories = await ArchiveHistoriesAsync(taskId, revision, token);
        foreach (var location in histories)
        {
            var report = Revisions(location.History, location.Id).FirstOrDefault(state =>
                state.Manifest.TaskId == taskId && state.Manifest.Revision == revision &&
                IsFinalArchiveRevision(state, Actor));
            if (report is not null) return report;
        }
        throw OperationalTaskException.Missing();
    }

    private static LocationAssetHandoverArchiveListItem ArchiveListItem(ReportState state)
    {
        var manifest = state.Manifest;
        return new(manifest.TaskId, manifest.LocationId, manifest.AssignmentId,
            manifest.StaffId, manifest.OwnerId, manifest.Revision, manifest.LocationName,
            manifest.Address, manifest.TotalItems, manifest.DirectItems, manifest.InheritedItems,
            manifest.SnapshotSha256, state.FinalPdfSha256!, manifest.ApprovedAt,
            manifest.ExceptionDecision, state.OwnerSignature!, state.StaffSignature!);
    }

    public async Task<IReadOnlyList<LocationAssetHandoverArchiveListItem>> ArchiveAsync(CancellationToken token)
    {
        await RequireRoleAsync(Roles.Staff, token);
        var histories = await ArchiveHistoriesAsync(null, null, token);
        return histories.SelectMany(location => Revisions(location.History, location.Id)
                .Where(report => IsFinalArchiveRevision(report, Actor))
                .Select(ArchiveListItem))
            .OrderByDescending(report => report.ApprovedAt)
            .ThenBy(report => report.LocationName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(report => report.TaskId)
            .ThenBy(report => report.Revision)
            .ToArray();
    }

    public async Task<LocationAssetHandoverArchiveReportView> ArchiveRevisionAsync(
        Guid taskId, int revision, CancellationToken token)
    {
        await RequireRoleAsync(Roles.Staff, token);
        var state = await ArchiveRevisionStateAsync(taskId, revision, token);
        var snapshot = await VerifiedBytesAsync(state.Manifest.SnapshotObjectKey,
            state.Manifest.SnapshotSha256, token);
        var items = ParseItems(Encoding.UTF8.GetString(snapshot)).Select(item =>
            new LocationAssetHandoverArchiveAssetView(item.Id, item.Scope, item.Name, item.Quantity,
                item.Condition, item.Inherited, item.SourceHandoverContractId, item.IncidentId,
                item.Note, item.PriorStaffTaskId, item.PriorStaffUserId)).ToArray();
        return new(ArchiveListItem(state), items);
    }

    public async Task<byte[]> ArchiveDocumentAsync(Guid taskId, int revision, CancellationToken token)
    {
        await RequireRoleAsync(Roles.Staff, token);
        var state = await ArchiveRevisionStateAsync(taskId, revision, token);
        // The archive is a final-signature document endpoint. Never serve the approval preview.
        return await VerifiedBytesAsync(state.FinalPdfObjectKey!, state.FinalPdfSha256!, token);
    }

    private static LocationAssetHandoverReportView View(TaskState task, ReportState state)
    {
        var report = state.Manifest;
        // Legacy pending handovers only have a checkbox acceptance. They must be
        // upgraded by a real Owner drawing before Staff can complete the handover.
        var ownerInkRequired = state.StaffSignature is null &&
            state.OwnerSignature is not null && state.OwnerInkObjectKey is null;
        // A finished report remains a finished historical document even if the next
        // assignment changes the task's current responsibility.
        var superseded = state.StaffSignature is null &&
            (report.TaskVersion != task.Version ||
             report.AssignmentId != task.AssignmentId || report.StaffId != task.StaffId);
        var status = superseded ? "Superseded" :
            state.StaffSignature is not null ? "Completed" :
            state.OwnerSignature is not null && !ownerInkRequired ? "PendingStaffSignature" : "PendingOwnerSignature";
        return new(report.TaskId, report.LocationId, report.AssignmentId, report.StaffId,
            report.TaskVersion, report.Revision, status, report.TotalItems, report.DirectItems,
            report.InheritedItems, report.SnapshotSha256,
            state.FinalPdfSha256 ?? state.OwnerPdfSha256 ?? report.PdfSha256, report.ApprovedAt, report.OwnerId,
            report.ExceptionDecision, ownerInkRequired ? null : state.OwnerSignature, state.StaffSignature,
            state.StaffSignature is not null);
    }

    private async Task RequireRoleAsync(string role, CancellationToken token)
    {
        if (!currentUser.IsInRole(role)) throw new OperationalTaskException(403, "location_handover_permission_denied");
        await EnsureConnectionOpenAsync(token);
        await using var command = Command("SELECT EXISTS(SELECT 1 FROM users WHERE id=@actor AND is_active AND @role=ANY(roles))",
            ("actor", Actor), ("role", role));
        if (await command.ExecuteScalarAsync(token) is not true)
            throw new OperationalTaskException(403, "location_handover_permission_denied");
    }

    private async Task EnsureConnectionOpenAsync(CancellationToken token)
    {
        if (db.Database.GetDbConnection().State != ConnectionState.Open)
            await db.Database.OpenConnectionAsync(token);
    }

    private async Task<bool> StaffAssignedAsync(TaskState task, Guid staff, CancellationToken token)
    {
        if (task.StaffId != staff || task.AssignmentId is null) return false;
        using var doc = JsonDocument.Parse(task.AssignmentHistory);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return false;
        var recordedAssignment = doc.RootElement.EnumerateArray().Any(assignment =>
            ReadString(assignment, "id") == task.AssignmentId.Value.ToString("D") &&
            ReadString(assignment, "staffUserId") == staff.ToString("D") &&
            DateOnly.TryParse(ReadString(assignment, "startDate"), out var start) &&
            DateOnly.TryParse(ReadString(assignment, "endDate"), out var end) &&
            start <= Today && Today <= end);
        if (!recordedAssignment) return false;

        // Use the same authoritative current-responsibility query as task detail and
        // checklist access. Assignment history alone does not prove active employment.
        var location = await taskRepository.LocationAsync(task.LocationId, token);
        if (location is null || !location.IsActive) return false;
        var responsible = await taskRepository.ResponsibilityAsync(task.LocationId, Today, token);
        return responsible?.StaffUserId == staff && responsible.AssignmentId == task.AssignmentId;
    }

    // Capture the valid assignment period once at approval. Later assignment
    // changes must never alter an already prepared or signed report revision.
    private static (DateOnly Start, DateOnly End) AssignmentPeriod(TaskState task)
    {
        using var doc = JsonDocument.Parse(task.AssignmentHistory);
        if (doc.RootElement.ValueKind == JsonValueKind.Array && task.AssignmentId is { } assignmentId)
            foreach (var assignment in doc.RootElement.EnumerateArray())
                if (ReadString(assignment, "id") == assignmentId.ToString("D") &&
                    ReadString(assignment, "staffUserId") == task.StaffId?.ToString("D") &&
                    DateOnly.TryParse(ReadString(assignment, "startDate"), out var start) &&
                    DateOnly.TryParse(ReadString(assignment, "endDate"), out var end) && start <= end)
                    return (start, end);
        throw OperationalTaskException.Conflict("location_handover_task_not_ready");
    }

    private async Task PermitReadAsync(TaskState task, ReportState? report, CancellationToken token,
        bool requireCurrentAssignment = false)
    {
        if (currentUser.IsInRole(Roles.Owner)) { await RequireRoleAsync(Roles.Owner, token); return; }
        await RequireRoleAsync(Roles.Staff, token);
        // A former Staff member may still access their own signed handover, not the
        // ongoing checklist or documents of the succeeding staff member.
        var currentlyAssigned = await StaffAssignedAsync(task, Actor, token);
        var ownSignedHistory = report?.Manifest.StaffId == Actor && report.StaffSignature?.ActorId == Actor;
        if (!currentlyAssigned && (requireCurrentAssignment || !ownSignedHistory))
            throw OperationalTaskException.Missing();
    }

    private NpgsqlCommand Command(string sql, params (string Name, object Value)[] args)
    {
        var command = new NpgsqlCommand(sql, (NpgsqlConnection)db.Database.GetDbConnection(),
            (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
        foreach (var (name, value) in args) command.Parameters.AddWithValue(name, value);
        return command;
    }

    private async Task<TaskState> LoadAsync(Guid taskId, bool locked, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        var sql = """
            SELECT t.id,t.location_id,t.assigned_user_id,t.version,t.status::text,
                t.task_data::text,l.name,l.address,l.staff_assignments::text,l.history::text
            FROM operational_tasks t JOIN locations l ON l.id=t.location_id
            WHERE t.id=@task AND t.task_type='GENERAL'
                AND t.task_data->'state'->>'kind'='3'
            """ + (locked ? " FOR UPDATE OF l,t" : "");
        await using var command = Command(sql, ("task", taskId));
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token)) throw OperationalTaskException.Missing();
        var data = reader.GetString(5);
        string? inventory;
        Guid? assignmentId;
        try
        {
            using var doc = JsonDocument.Parse(data);
            var state = Property(doc.RootElement, "state");
            inventory = ReadString(state, "locationAssetInventoryJson");
            assignmentId = Guid.TryParse(ReadString(state, "assignmentId"), out var assignment)
                ? assignment : null;
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid"); }
        if (string.IsNullOrWhiteSpace(inventory)) throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
        return new(reader.GetGuid(0), reader.GetGuid(1), reader.IsDBNull(2) ? null : reader.GetGuid(2),
            assignmentId, reader.GetInt32(3), reader.GetString(4), inventory,
            reader.GetString(6), reader.GetString(7), reader.GetString(8), reader.GetString(9));
    }

    private async Task<Guid> LocationIdAsync(Guid taskId, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var command = Command("SELECT location_id FROM operational_tasks WHERE id=@task", ("task", taskId));
        return await command.ExecuteScalarAsync(token) is Guid location ? location : throw OperationalTaskException.Missing();
    }

    private async Task LockLocationAsync(Guid id, CancellationToken token) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({id.ToString()}, 0))", token);

    private async Task AppendAsync(Guid locationId, ReportEvent item, CancellationToken token)
    {
        var history = JsonSerializer.Serialize(new[] { item }, Json);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET history=COALESCE(history,'[]'::jsonb)||CAST({history} AS jsonb)
            WHERE id={locationId}
            """, token);
        if (affected != 1) throw OperationalTaskException.Missing();
    }

    private async Task RecordTaskHistoryAsync(TaskState task, string action, string note, int version,
        CancellationToken token, bool complete = false, Guid? verifiedBy = null)
    {
        var instant = Now;
        var itemId = Guid.NewGuid();
        var history = JsonSerializer.Serialize(new[]
        {
            new
            {
                recordType = "OperationalTaskHistory", recordKey = itemId.ToString("D"),
                state = new
                {
                    id = itemId, taskId = task.Id, actorId = Actor, action, note,
                    changesJson = JsonSerializer.Serialize(new { handover = action }),
                    responsibleStaffUserId = task.StaffId, occurredAt = instant,
                    wasOverdue = false, taskVersion = version, createdAt = instant, updatedAt = instant
                }
            }
        }, Json);
        int affected;
        if (complete)
        {
            affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks
                SET status='2',verified_by_user_id={verifiedBy},verified_at={instant},
                    version=version+1,history=COALESCE(history,'[]'::jsonb)||CAST({history} AS jsonb),
                    task_data=jsonb_set(task_data,ARRAY['state'],
                        COALESCE(task_data->'state',jsonb_build_object())||
                        jsonb_build_object('status',2,'completedAt',{instant},'verifiedByUserId',{verifiedBy},
                            'verifiedAt',{instant},'version',version+1,'updatedAt',{instant}),true)
                WHERE id={task.Id} AND version={task.Version} AND status='4'
                """, token);
        }
        else
        {
            affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks
                SET history=COALESCE(history,'[]'::jsonb)||CAST({history} AS jsonb)
                WHERE id={task.Id} AND version={task.Version}
                """, token);
        }
        if (affected != 1) throw OperationalTaskException.Conflict("location_handover_task_changed");
    }

    private async Task<byte[]> VerifiedBytesAsync(string key, string hash, CancellationToken token)
    {
        using var stream = new MemoryStream();
        await storage.CopyToAsync(key, stream, token);
        var bytes = stream.ToArray();
        if (!Hash(bytes).Equals(hash, StringComparison.OrdinalIgnoreCase))
            throw OperationalTaskException.Conflict("location_handover_document_integrity_failed");
        return bytes;
    }

    // Staff may only receive responsibility for Owner-attested assets, not for
    // a merely configured template or an unverified physical asset. The Owner
    // can change inventory while Staff is inspecting, so validate the *current*
    // attestation again before approval and each fresh signature.
    private async Task ValidateOwnerSourceAsync(TaskState task, CancellationToken token)
    {
        LocationAssetInventorySnapshot persisted;
        try
        {
            persisted = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.InventoryJson, Json)
                ?? throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
        }
        catch (JsonException)
        {
            throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
        }
        if (task.AssignmentId is null || persisted.AssignmentId != task.AssignmentId)
            throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
        if (persisted.PendingOwnerRooms.Length > 0 || persisted.PendingOwnerCommonAssets ||
            persisted.Items.Length == 0)
            throw OperationalTaskException.Conflict("location_asset_inventory_pending_owner_confirmation");

        var authoritative = await LocationAssetInventoryTaskFactory.BuildConfirmedSnapshotAsync(
            db, workspace, task.LocationId, persisted.AssignmentId, persisted.EffectiveFrom, Now, token);
        // The Location task keeps its physical checklist item IDs when responsibility
        // changes. Rebind the freshly resolved Owner source to those stable IDs before
        // comparing the baseline; assignment-scoped IDs here would reject every
        // successor report even though the same physical assets remain attested.
        authoritative = LocationAssetInventoryTaskFactory.PreserveExistingItemIds(authoritative, task.InventoryJson);
        if (authoritative.PendingOwnerRooms.Length > 0 || authoritative.PendingOwnerCommonAssets)
            throw OperationalTaskException.Conflict("location_asset_inventory_pending_owner_confirmation");

        if (persisted.Items.Length != authoritative.Items.Length ||
            !persisted.Items.OrderBy(x => x.Id).Zip(authoritative.Items.OrderBy(x => x.Id))
                .All(pair => LocationAssetInventorySync.SameOwnerItem(pair.First, pair.Second)))
            throw OperationalTaskException.Conflict("location_asset_inventory_owner_baseline_changed");
    }

    private async Task<(string Owner, string Staff)> SignerNamesAsync(Guid ownerId, Guid staffId,
        CancellationToken token)
    {
        await using var command = Command(
            "SELECT id, COALESCE(NULLIF(trim(full_name),''),NULLIF(trim(email),''),id::text) FROM users WHERE id=ANY(@ids)",
            ("ids", new[] { ownerId, staffId }));
        var found = new Dictionary<Guid, string>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) found[reader.GetGuid(0)] = reader.GetString(1);
        return (found.GetValueOrDefault(ownerId, ownerId.ToString("D")),
            found.GetValueOrDefault(staffId, staffId.ToString("D")));
    }

    // A Tenant handover is only a *source* of evidence while the same active
    // tenancy chain and its confirmed document still exist. Do not sign a stale
    // inherited checklist after move-out, replacement or handover amendment.
    private async Task ValidateInheritedEvidenceAsync(TaskState task, CancellationToken token)
    {
        LocationAssetInventorySnapshot snapshot;
        try
        {
            snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.InventoryJson, Json)
                ?? throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid"); }
        var inherited = snapshot.Items.Where(x => x.Inherited).ToArray();
        if (inherited.Length == 0) return;
        if (inherited.Any(x => x.RoomId is null || x.SourceHandoverContractId is null))
            throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
        var sources = inherited.Select(x => x.SourceHandoverContractId!.Value).Distinct().ToArray();
        var contracts = await db.Set<Contract>().AsNoTracking()
            .Where(c => c.Room.LocationId == task.LocationId)
            .Select(c => new
            {
                c.Id,
                c.RoomId,
                c.Kind,
                c.Status,
                c.StartDate,
                c.EndDate,
                c.PreviousContractId,
                c.TenantUserId
            }).ToArrayAsync(token);
        var index = contracts.ToDictionary(x => x.Id);
        var handovers = await db.Set<ContractHandover>().AsNoTracking()
            .Where(h => sources.Contains(h.ContractId) &&
                h.Status == ContractHandoverStatus.Confirmed &&
                h.TenantConfirmedAt != null && h.StaffConfirmedAt != null &&
                h.TenantConfirmedBy != null && h.StaffConfirmedBy != null &&
                h.TenantConfirmedVersion == h.Version)
            .Select(h => new { h.ContractId, h.TenantConfirmedBy, h.Snapshot })
            .ToDictionaryAsync(h => h.ContractId, token);
        if (handovers.Count != sources.Length)
            throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
        var active = contracts.Where(c => c.Status == ContractStatus.Active &&
            c.StartDate <= Today && c.EndDate >= Today &&
            c.Kind is ContractKind.Main or ContractKind.Renewal &&
            c.TenantUserId.HasValue).GroupBy(c => c.RoomId)
            .ToDictionary(g => g.Key, g => g.ToArray());
        var accounts = active.Values.SelectMany(group => group)
            .Select(c => c.TenantUserId!.Value).Distinct().ToArray();
        var validAccounts = (await db.Users.AsNoTracking()
            .Where(u => accounts.Contains(u.Id) && u.IsActive &&
                EF.Property<string[]>(u, "roles").Contains(Roles.Tenant))
            .Select(u => u.Id).ToArrayAsync(token)).ToHashSet();
        foreach (var item in inherited)
        {
            if (!active.TryGetValue(item.RoomId!.Value, out var roomContracts) ||
                roomContracts.Length != 1 ||
                !validAccounts.Contains(roomContracts[0].TenantUserId!.Value))
                throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
            var tenantId = roomContracts[0].TenantUserId!.Value;
            var cursor = roomContracts[0].Id;
            var seen = new HashSet<Guid>();
            var sourceId = item.SourceHandoverContractId!.Value;
            var linked = false;
            while (seen.Add(cursor) && index.TryGetValue(cursor, out var contract))
            {
                if (cursor == sourceId) { linked = true; break; }
                if (contract.PreviousContractId is not { } previous ||
                    !index.TryGetValue(previous, out var prior) ||
                    prior.RoomId != item.RoomId || prior.TenantUserId != tenantId) break;
                cursor = previous;
            }
            if (!linked || !handovers.TryGetValue(sourceId, out var sourceHandover) ||
                sourceHandover.TenantConfirmedBy != tenantId)
                throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");

            HandoverSnapshot sourceSnapshot;
            try
            {
                sourceSnapshot = JsonSerializer.Deserialize<HandoverSnapshot>(sourceHandover.Snapshot, Json)
                    ?? throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
            }
            catch (JsonException)
            {
                throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
            }

            if (item.AssetId is { } assetId)
            {
                if (!LocationAssetInventoryTaskFactory.TenantHandoverConfirmsPhysicalAsset(
                        sourceSnapshot, assetId, item.Quantity))
                    throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
            }
            else if (item.Quantity != 0 || !sourceSnapshot.NoAssetsConfirmed)
            {
                throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
            }
        }
        // Asset identity still matters after Tenant evidence was inherited.
        var assets = inherited.Where(x => x.AssetId.HasValue).Select(x => x.AssetId!.Value).Distinct().ToArray();
        if (assets.Length == 0) return;
        var live = (await db.Set<Asset>().AsNoTracking()
            .Where(a => assets.Contains(a.Id) && a.LocationId == task.LocationId &&
                a.Status != AssetStatus.Retired)
            .Select(a => new { a.Id, a.RoomId }).ToArrayAsync(token))
            .ToDictionary(x => x.Id);
        if (inherited.Where(x => x.AssetId.HasValue)
            .Any(x => !live.TryGetValue(x.AssetId!.Value, out var asset) || asset.RoomId != x.RoomId))
            throw OperationalTaskException.Conflict("location_handover_inherited_evidence_changed");
    }

    public async Task<LocationAssetHandoverReportView> GetAsync(Guid taskId, CancellationToken token)
    {
        var task = await LoadAsync(taskId, false, token);
        var report = Latest(task.LocationHistory, taskId);
        await PermitReadAsync(task, report, token);
        return report is null ? throw OperationalTaskException.Missing() : View(task, report);
    }

    public async Task<byte[]> DocumentAsync(Guid taskId, CancellationToken token)
    {
        var task = await LoadAsync(taskId, false, token);
        var report = Latest(task.LocationHistory, taskId);
        await PermitReadAsync(task, report, token);
        if (report is null) throw OperationalTaskException.Missing();
        var key = report.FinalPdfObjectKey ?? report.OwnerPdfObjectKey ?? report.Manifest.PdfObjectKey;
        var sha = report.FinalPdfSha256 ?? report.OwnerPdfSha256 ?? report.Manifest.PdfSha256;
        return await VerifiedBytesAsync(key, sha, token);
    }

    public async Task<LocationAssetHandoverDocumentPreview> DocumentPreviewAsync(Guid taskId,
        CancellationToken token)
    {
        var bytes = await DocumentAsync(taskId, token);
        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var count = pdf.GetNumberOfPages();
        if (count is < 1 or > 100)
            throw OperationalTaskException.Conflict("location_handover_document_preview_unavailable");
        return new(count, Hash(bytes));
    }

    public async Task<byte[]> DocumentPageAsync(Guid taskId, int page, CancellationToken token)
    {
        if (page < 1) throw OperationalTaskException.Invalid("location_handover_document_page_invalid");
        var bytes = await DocumentAsync(taskId, token);
        using (var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes))))
            if (page > pdf.GetNumberOfPages())
                throw OperationalTaskException.Invalid("location_handover_document_page_invalid");
        return signingPages.RenderPage(bytes, page, 960);
    }

    public async Task<LocationAssetHandoverReportView> ApproveAsync(
        Guid taskId, LocationAssetHandoverApprove input, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        var locationId = await LocationIdAsync(taskId, token);
        await LockLocationAsync(locationId, token);
        var task = await LoadAsync(taskId, true, token);
        await RequireRoleAsync(Roles.Owner, token);
        if (task.Version != input.TaskVersion || task.Status != "4" ||
            task.AssignmentId is null || task.StaffId is null ||
            !await StaffAssignedAsync(task, task.StaffId.Value, token))
            throw OperationalTaskException.Conflict("location_handover_task_not_ready");
        await ValidateOwnerSourceAsync(task, token);
        var prior = Latest(task.LocationHistory, taskId);
        if (prior?.Manifest.TaskVersion == task.Version)
        {
            if (prior.Manifest.ExceptionDecision != input.ExceptionDecision?.Trim())
                throw OperationalTaskException.Conflict("location_handover_already_approved");
            return View(task, prior);
        }
        var items = ParseItems(task.InventoryJson);
        await ValidateInheritedEvidenceAsync(task, token);
        var exception = string.IsNullOrWhiteSpace(input.ExceptionDecision) ? null : input.ExceptionDecision.Trim();
        if (exception?.Length > 2000) throw OperationalTaskException.Invalid("invalid_location_handover_exception");
        if (items.Count == 0 && exception is null)
            throw OperationalTaskException.Conflict("location_handover_empty_inventory_requires_decision");
        var incidentIds = items.Where(x => x.IncidentId.HasValue).Select(x => x.IncidentId!.Value).Distinct().ToArray();
        if (incidentIds.Length > 0)
        {
            var resolved = await db.Set<BHome.Domain.IncidentMaintenance.IncidentReport>().AsNoTracking()
                .Where(x => incidentIds.Contains(x.Id) && x.LocationId == task.LocationId &&
                    x.Status == BHome.Domain.IncidentMaintenance.IncidentStatus.Resolved)
                .Select(x => x.Id).ToArrayAsync(token);
            if (resolved.Length != incidentIds.Length && (exception?.Length ?? 0) < 10)
                throw OperationalTaskException.Conflict("location_handover_unresolved_incident_requires_owner_decision");
        }
        var revision = (prior?.Manifest.Revision ?? 0) + 1;
        var approvedAt = Now;
        var snapshotBytes = Encoding.UTF8.GetBytes(task.InventoryJson);
        var hash = Hash(snapshotBytes);
        var (ownerName, staffName) = await SignerNamesAsync(Actor, task.StaffId.Value, token);
        var assignmentPeriod = AssignmentPeriod(task);
        var snapshotKey = $"location-asset-handovers/{taskId:N}/v{revision}/inventory.json";
        var pdfKey = $"location-asset-handovers/{taskId:N}/v{revision}/preview.pdf";
        var pdf = LocationAssetHandoverPdfRenderer.Render(new(task.Id, task.AssignmentId.Value,
            revision, task.LocationName, task.Address, Actor, task.StaffId.Value, approvedAt,
            hash, exception, items, OwnerDisplayName: ownerName, StaffDisplayName: staffName,
            AssignmentStart: assignmentPeriod.Start, AssignmentEnd: assignmentPeriod.End), token);
        var manifest = new ReportManifest(task.Id, task.LocationId, task.AssignmentId.Value,
            task.StaffId.Value, Actor, task.Version, revision, task.LocationName, task.Address,
            items.Count, items.Count(x => !x.Inherited), items.Count(x => x.Inherited),
            hash, snapshotKey, Hash(pdf), pdfKey, approvedAt, exception, ownerName, staffName,
            assignmentPeriod.Start, assignmentPeriod.End);
        // Object keys are server generated and scoped to the specific task/revision.
        // Their integrity digests are stored in the append-only manifest.
        await using (var memory = new MemoryStream(snapshotBytes, writable: false))
            await storage.PutAsync(snapshotKey, memory, snapshotBytes.Length, "application/json", token);
        await using (var memory = new MemoryStream(pdf, writable: false))
            await storage.PutAsync(pdfKey, memory, pdf.Length, "application/pdf", token);
        await AppendAsync(locationId, new("LocationAssetHandoverApproved", taskId, revision, approvedAt, manifest), token);
        await RecordTaskHistoryAsync(task, "location_asset_handover_approved",
            exception ?? "Owner đã đối soát kết quả kiểm kê.", task.Version, token);
        await transaction.CommitAsync(token);
        return View(task, new(manifest, null, null, null, null));
    }

    public async Task<LocationAssetInventoryView> ReworkAsync(
        Guid taskId, LocationAssetHandoverRework input, CancellationToken token)
    {
        if (input.ItemIds is null || input.ItemIds.Length is < 1 or > 1000 ||
            input.ItemIds.Any(id => id == Guid.Empty) ||
            input.ItemIds.Distinct().Count() != input.ItemIds.Length ||
            string.IsNullOrWhiteSpace(input.Note) || input.Note.Trim().Length is < 10 or > 2000)
            throw OperationalTaskException.Invalid("invalid_location_handover_rework");
        await db.Database.OpenConnectionAsync(token);
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        var locationId = await LocationIdAsync(taskId, token);
        await LockLocationAsync(locationId, token);
        var task = await LoadAsync(taskId, true, token);
        await RequireRoleAsync(Roles.Owner, token);
        if (task.Status != "4" || task.Version != input.TaskVersion ||
            task.AssignmentId is null || task.StaffId is null ||
            !await StaffAssignedAsync(task, task.StaffId.Value, token))
            throw OperationalTaskException.Conflict("location_handover_task_not_reworkable");
        var report = Latest(task.LocationHistory, taskId);
        if (report?.StaffSignature is not null)
            throw OperationalTaskException.Conflict("location_handover_signed_document_immutable");
        LocationAssetInventorySnapshot snapshot;
        try
        {
            snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.InventoryJson, Json)
                ?? throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid");
        }
        catch (JsonException) { throw OperationalTaskException.Conflict("location_inventory_snapshot_invalid"); }
        if (snapshot.AssignmentId != task.AssignmentId || snapshot.Items is null ||
            input.ItemIds.Any(id => snapshot.Items.All(item => item.Id != id)))
            throw OperationalTaskException.Invalid("location_handover_rework_item_not_found");
        var selection = input.ItemIds.ToHashSet();
        for (var i = 0; i < snapshot.Items.Length; i++)
        {
            var item = snapshot.Items[i];
            if (selection.Contains(item.Id))
            {
                // If a Tenant-backed assertion is disputed, the challenged item is now
                // checked directly by Staff; the original inherited source stays in
                // immutable history and previously frozen PDF revisions.
                snapshot.Items[i] = item with
                {
                    Checked = false,
                    Condition = "Unassessed",
                    Inherited = false,
                    RecheckOfHandoverContractId = item.SourceHandoverContractId ?? item.RecheckOfHandoverContractId,
                    SourceHandoverContractId = null,
                    IncidentId = null,
                    Note = null
                };
            }
        }
        var now = Now;
        var historyId = Guid.NewGuid();
        var history = JsonSerializer.Serialize(new[]
        {
            new
            {
                recordType = "OperationalTaskHistory", recordKey = historyId.ToString("D"),
                state = new
                {
                    id = historyId, taskId, actorId = Actor,
                    action = "location_asset_handover_rework_requested", note = input.Note.Trim(),
                    changesJson = JsonSerializer.Serialize(new { input.ItemIds, priorRevision = report?.Manifest.Revision }),
                    responsibleStaffUserId = task.StaffId, occurredAt = now, wasOverdue = false,
                    taskVersion = task.Version + 1, createdAt = now, updatedAt = now
                }
            }
        }, Json);
        var snapshotJson = JsonSerializer.Serialize(snapshot);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET status='1',version=version+1,
                task_data=jsonb_set(task_data,ARRAY['state'],
                    COALESCE(task_data->'state',jsonb_build_object())||
                    jsonb_build_object('locationAssetInventoryJson',{snapshotJson},'status',1,
                        'version',version+1,'result',NULL,'updatedAt',{now}),true),
                history=COALESCE(history,'[]'::jsonb)||CAST({history} AS jsonb)
            WHERE id={taskId} AND version={task.Version} AND status='4'
            """, token);
        if (affected != 1) throw OperationalTaskException.Conflict("location_handover_task_changed");
        await AppendAsync(task.LocationId, new("LocationAssetHandoverReworkRequested",
            taskId, report?.Manifest.Revision ?? 0, now), token);
        await inbox.Emit(task.StaffId.Value, Roles.Staff, task.LocationId,
            $"location-handover-rework:{taskId:N}:v{task.Version + 1}",
            "LOCATION_ASSET_HANDOVER_REWORK", "Task", "Owner yêu cầu kiểm kê lại tài sản",
            input.Note.Trim(), "OperationalTask", taskId, token, channels: ["IN_APP", "EMAIL"]);
        await transaction.CommitAsync(token);
        return new(task.Id, task.LocationId, snapshot.AssignmentId, "InProgress",
            task.Version + 1, snapshot.Items.Length, snapshot.Items.Count(item => item.Checked),
            snapshot.Items);
    }

    public async Task<LocationAssetHandoverReportView> SignAsync(
        Guid taskId, LocationAssetHandoverSign input, CancellationToken token)
    {
        if (!input.Confirmed || !System.Text.RegularExpressions.Regex.IsMatch(
            input.SnapshotSha256 ?? "", "^[0-9A-Fa-f]{64}$"))
            throw OperationalTaskException.Invalid("location_handover_explicit_acceptance_required");
        await db.Database.OpenConnectionAsync(token);
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        var locationId = await LocationIdAsync(taskId, token);
        await LockLocationAsync(locationId, token);
        var task = await LoadAsync(taskId, true, token);
        var state = Latest(task.LocationHistory, taskId) ?? throw OperationalTaskException.Missing();
        // Check disclosure before comparing a document hash or returning a version error:
        // unrelated Staff must never learn another Location's handover state.
        // Signed historical reports are readable by their former Staff signer, but
        // the signing endpoint remains an action and always requires current responsibility.
        await PermitReadAsync(task, state, token, requireCurrentAssignment: true);
        var report = state.Manifest;
        if (input.Revision != report.Revision ||
            !string.Equals(input.SnapshotSha256, report.SnapshotSha256, StringComparison.OrdinalIgnoreCase))
            throw OperationalTaskException.Conflict("location_handover_version_changed");

        var ownerInkRequired = state.StaffSignature is null &&
            state.OwnerSignature is not null && state.OwnerInkObjectKey is null;
        var ownerSigning = state.OwnerSignature is null ||
            (ownerInkRequired && currentUser.IsInRole(Roles.Owner));
        // A retry for an already recorded acceptance is safe even after completion.
        if (state.OwnerSignature?.ActorId == Actor && currentUser.IsInRole(Roles.Owner) && !ownerInkRequired ||
            state.StaffSignature?.ActorId == Actor && currentUser.IsInRole(Roles.Staff))
        {
            await RequireRoleAsync(currentUser.IsInRole(Roles.Owner) ? Roles.Owner : Roles.Staff, token);
            return View(task, state);
        }
        if (task.Status != "4" || task.Version != report.TaskVersion ||
            task.AssignmentId != report.AssignmentId || task.StaffId != report.StaffId ||
            !await StaffAssignedAsync(task, report.StaffId, token))
            throw OperationalTaskException.Conflict("location_handover_version_changed");
        if (ownerSigning)
        {
            await RequireRoleAsync(Roles.Owner, token);
            if (Actor != report.OwnerId) throw new OperationalTaskException(403, "location_handover_owner_mismatch");
        }
        else
        {
            await RequireRoleAsync(Roles.Staff, token);
            if (Actor != report.StaffId) throw OperationalTaskException.Missing();
        }
        // A fresh signature must contain the hand-drawn strokes for this exact
        // immutable revision. Session consent alone is not a handwritten signature.
        if (input.Ink is null)
            throw OperationalTaskException.Invalid("location_handover_handwritten_signature_required");
        var source = await VerifiedBytesAsync(report.SnapshotObjectKey, report.SnapshotSha256, token);
        _ = await VerifiedBytesAsync(report.PdfObjectKey, report.PdfSha256, token);
        var currentHash = Hash(Encoding.UTF8.GetBytes(task.InventoryJson));
        if (!currentHash.Equals(report.SnapshotSha256, StringComparison.Ordinal))
            throw OperationalTaskException.Conflict("location_handover_inventory_changed");
        await ValidateOwnerSourceAsync(task, token);
        await ValidateInheritedEvidenceAsync(task, token);
        var png = inkRenderer.Render(input.Ink);
        if (png.Length is < 50 or > 1024 * 1024)
            throw OperationalTaskException.Invalid("location_handover_handwritten_signature_invalid");
        var role = ownerSigning ? "owner" : "staff";
        var inkKey = $"location-asset-handovers/{taskId:N}/v{report.Revision}/{role}-ink.png";
        var inkHash = Hash(png);
        var items = ParseItems(Encoding.UTF8.GetString(source));
        var instant = Now;
        var signature = new LocationAssetHandoverAcceptance(Actor, instant,
            "AuthenticatedSessionHandwritten", report.SnapshotSha256);
        if (ownerSigning)
        {
            var ownerPdf = LocationAssetHandoverPdfRenderer.Render(new(task.Id, report.AssignmentId,
                report.Revision, report.LocationName, report.Address, report.OwnerId, report.StaffId,
                report.ApprovedAt, report.SnapshotSha256, report.ExceptionDecision,
                items, signature, null, report.OwnerDisplayName, report.StaffDisplayName,
                OwnerInkPng: png, AssignmentStart: report.AssignmentStart,
                AssignmentEnd: report.AssignmentEnd), token);
            var ownerPdfKey = $"location-asset-handovers/{taskId:N}/v{report.Revision}/owner-signed.pdf";
            var ownerPdfHash = Hash(ownerPdf);
            await using (var memory = new MemoryStream(png, writable: false))
                await storage.PutAsync(inkKey, memory, png.Length, "image/png", token);
            await using (var memory = new MemoryStream(ownerPdf, writable: false))
                await storage.PutAsync(ownerPdfKey, memory, ownerPdf.Length, "application/pdf", token);
            await AppendAsync(task.LocationId, new("LocationAssetHandoverOwnerSigned", taskId,
                report.Revision, instant, Signature: signature,
                InkObjectKey: inkKey, InkSha256: inkHash,
                OwnerPdfObjectKey: ownerPdfKey, OwnerPdfSha256: ownerPdfHash), token);
            await RecordTaskHistoryAsync(task, "location_asset_handover_owner_signed",
                "Owner đã xác nhận điện tử biên bản đã đối soát.", task.Version, token);
            await inbox.Emit(report.StaffId, Roles.Staff, task.LocationId,
                $"location-handover-owner-signed:{taskId:N}:{report.Revision}",
                "LOCATION_ASSET_HANDOVER_OWNER_SIGNED", "Task", "Biên bản bàn giao chờ Staff ký",
                "Owner đã ký xác nhận biên bản kiểm kê tài sản cơ sở. Hãy xem đúng phiên bản trước khi ký.",
                "OperationalTask", taskId, token, channels: ["IN_APP", "EMAIL"]);
            await transaction.CommitAsync(token);
            return View(task, state with
            {
                OwnerSignature = signature,
                OwnerInkObjectKey = inkKey,
                OwnerInkSha256 = inkHash,
                OwnerPdfObjectKey = ownerPdfKey,
                OwnerPdfSha256 = ownerPdfHash
            });
        }
        if (state.OwnerInkObjectKey is null || state.OwnerInkSha256 is null ||
            state.OwnerPdfObjectKey is null || state.OwnerPdfSha256 is null)
            throw OperationalTaskException.Conflict("location_handover_owner_handwritten_signature_required");
        var ownerInk = await VerifiedBytesAsync(state.OwnerInkObjectKey, state.OwnerInkSha256, token);
        _ = await VerifiedBytesAsync(state.OwnerPdfObjectKey, state.OwnerPdfSha256, token);
        var final = LocationAssetHandoverPdfRenderer.Render(new(task.Id, report.AssignmentId,
            report.Revision, report.LocationName, report.Address, report.OwnerId, report.StaffId,
            report.ApprovedAt, report.SnapshotSha256, report.ExceptionDecision,
            items, state.OwnerSignature, signature,
            report.OwnerDisplayName, report.StaffDisplayName, ownerInk, png,
            report.AssignmentStart, report.AssignmentEnd), token);
        var finalKey = $"location-asset-handovers/{taskId:N}/v{report.Revision}/signed.pdf";
        await using (var memory = new MemoryStream(png, writable: false))
            await storage.PutAsync(inkKey, memory, png.Length, "image/png", token);
        await using (var memory = new MemoryStream(final, writable: false))
            await storage.PutAsync(finalKey, memory, final.Length, "application/pdf", token);
        await AppendAsync(task.LocationId, new("LocationAssetHandoverStaffSigned", taskId,
            report.Revision, instant, Signature: signature,
            FinalPdfObjectKey: finalKey, FinalPdfSha256: Hash(final),
            InkObjectKey: inkKey, InkSha256: inkHash), token);
        await RecordTaskHistoryAsync(task, "location_asset_handover_completed",
            "Owner và Staff đã xác nhận cùng phiên bản biên bản.", task.Version + 1,
            token, complete: true, verifiedBy: report.OwnerId);
        await inbox.Emit(report.OwnerId, Roles.Owner, task.LocationId,
            $"location-handover-completed:{taskId:N}:{report.Revision}",
            "LOCATION_ASSET_HANDOVER_COMPLETED", "Task", "Bàn giao tài sản cơ sở đã hoàn tất",
            "Owner và Staff đã ký xác nhận biên bản bàn giao tài sản cơ sở.",
            "OperationalTask", taskId, token);
        await transaction.CommitAsync(token);
        return View(task with { Version = task.Version + 1, Status = "2" },
            state with { StaffSignature = signature, FinalPdfObjectKey = finalKey, FinalPdfSha256 = Hash(final) });
    }
}
