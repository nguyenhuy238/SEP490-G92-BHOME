using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class SetupWorkspaceStore(Compact24DbContext db, CompactNotificationWriter sql, IObjectStorage storage) : ISetupWorkspaceStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<T> TransactionAsync<T>(Guid locationId, Func<Task<T>> work, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is not null) return await work();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", t);
        if (!await db.Locations.AnyAsync(l => l.Id == locationId && l.IsActive, t)) throw new PropertyException(409, "location_inactive_or_missing");
        try
        {
            var value = await work(); await db.SaveChangesAsync(t); await tx.CommitAsync(t); return value;
        }
        catch (DbUpdateConcurrencyException) { throw new PropertyException(409, "stale_version"); }
        catch (Npgsql.PostgresException e) when (e.SqlState is "23505" or "23514" or "40001" or "40P01")
        { throw new PropertyException(409, "setup_concurrent_or_invalid_operation"); }
        catch (DbUpdateException e) when (e.InnerException is Npgsql.PostgresException { SqlState: "23505" or "23514" })
        { throw new PropertyException(409, "setup_concurrent_or_invalid_operation"); }
    }
    public async Task<SetupDocument?> GetAsync(Guid id, string kind, CancellationToken t)
    {
        var value = await sql.Scalar<string>("SELECT task_data->'document' FROM operational_tasks WHERE id=@id AND task_type='SYSTEM_JOB' AND task_data->>'recordType'=@kind", t,
            ("id", id), ("kind", "Setup" + kind));
        return value is null ? null : JsonSerializer.Deserialize<SetupDocument>(value, Json);
    }
    public async Task<IReadOnlyList<SetupDocument>> ListAsync(Guid locationId, string kind, CancellationToken t)
    {
        await using var cmd = await sql.Command("SELECT task_data->'document' FROM operational_tasks WHERE location_id=@location AND task_type='SYSTEM_JOB' AND task_data->>'recordType'=@kind ORDER BY id LIMIT 1001", t,
            ("location", locationId), ("kind", "Setup" + kind));
        await using var reader = await cmd.ExecuteReaderAsync(t); var items = new List<SetupDocument>();
        while (await reader.ReadAsync(t)) items.Add(JsonSerializer.Deserialize<SetupDocument>(reader.GetString(0), Json)!);
        if (items.Count > 1000) throw new PropertyException(409, "setup_workspace_page_limit");
        return items;
    }
    public async Task<IReadOnlyList<SetupDocument>> HistoryAsync(Guid id, string kind, CancellationToken t)
    {
        await using var cmd = await sql.Command("""
            SELECT revision->'document',revision->>'actorId'
            FROM operational_tasks task CROSS JOIN LATERAL jsonb_array_elements(task.history) revision
            WHERE task.id=@id AND task.task_type='SYSTEM_JOB' AND task.task_data->>'recordType'=@kind
              AND revision->'document'->>'id'=@documentId
            ORDER BY (revision->'document'->>'version')::integer
            """, t, ("id", id), ("kind", "Setup" + kind), ("documentId", id.ToString()));
        await using var reader = await cmd.ExecuteReaderAsync(t);
        var revisions = new List<SetupDocument>();
        while (await reader.ReadAsync(t))
        {
            var revision = JsonSerializer.Deserialize<SetupDocument>(reader.GetString(0), Json)!;
            revisions.Add(revision with { RecordedBy = Guid.TryParse(reader.IsDBNull(1) ? null : reader.GetString(1), out var actor) ? actor : null });
        }
        return revisions;
    }
    public async Task<SetupDocument> SaveAsync(Guid id, Guid locationId, string kind, string status, object data, int expectedVersion, Guid actor, CancellationToken t)
    {
        var before = await GetAsync(id, kind, t);
        if (before is null ? expectedVersion != 0 : before.Version != expectedVersion || before.LocationId != locationId)
            throw new PropertyException(409, "stale_version");
        var payload = JsonSerializer.SerializeToNode(data, Json) as System.Text.Json.Nodes.JsonObject ?? throw new PropertyException(400, "invalid_setup_document");
        payload.Remove("expectedVersion");
        var doc = new SetupDocument(id, locationId, kind, status, expectedVersion + 1, JsonSerializer.SerializeToElement(payload, Json), sql.Now, actor);
        var json = JsonSerializer.Serialize(new { recordType = "Setup" + kind, document = doc }, Json);
        var history = JsonSerializer.Serialize(new[] { new { actorId = actor, occurredAt = sql.Now, action = status, document = doc } }, Json);
        if (before is null)
            await sql.Execute("""
                INSERT INTO operational_tasks(id,task_type,location_id,source_key,title,status,task_data,history,version)
                VALUES(@id,'SYSTEM_JOB',@location,@key,@kind,@status,@json::jsonb,@history::jsonb,@version)
                """, t, ("id", id), ("location", locationId), ("key", $"setup:{kind}:{id:N}"), ("kind", kind), ("status", status),
                ("json", json), ("history", history), ("version", doc.Version));
        else if (await sql.Execute("""
                UPDATE operational_tasks SET task_data=@json::jsonb,history=history||@history::jsonb,status=@status,version=version+1
                WHERE id=@id AND version=@expected
                """, t, ("id", id), ("json", json), ("history", history), ("status", status), ("expected", expectedVersion)) != 1)
            throw new PropertyException(409, "stale_version");
        return doc;
    }
    public Task<Guid?> RoomLocationAsync(Guid roomId, CancellationToken t) => db.Set<Room>().Where(r => r.Id == roomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t);
    public async Task<(Guid LocationId, BHome.Domain.Billing.UtilityType Type)?> MeterScopeAsync(Guid meterId, CancellationToken t)
    {
        var meter = await db.Set<BHome.Domain.Billing.Meter>().Where(m => m.Id == meterId).Select(m => new { m.RoomId, m.UtilityType }).SingleOrDefaultAsync(t);
        if (meter is null) return null;
        return ((await RoomLocationAsync(meter.RoomId, t))!.Value, meter.UtilityType);
    }
    public async Task<IReadOnlyList<UtilityRoomUsage>> UtilityUsageAsync(Guid locationId, BHome.Domain.Billing.UtilityType type, DateOnly period, CancellationToken t)
    {
        await using var cmd = await sql.Command("""
            SELECT r.id,m.id,mr.id,mr.consumption FROM meter_readings mr JOIN meters m ON m.id=mr.meter_id
            JOIN rooms r ON r.id=m.room_id WHERE r.location_id=@location AND m.utility_type=@type
              AND mr.reading_purpose=1 AND mr.billing_period=@period AND mr.consumption IS NOT NULL AND mr.confirmed_at IS NOT NULL
            ORDER BY r.id,m.id,mr.id
            """, t, ("location", locationId), ("type", (short)type), ("period", period));
        await using var reader = await cmd.ExecuteReaderAsync(t); var list = new List<UtilityRoomUsage>();
        while (await reader.ReadAsync(t)) list.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetDecimal(3)));
        return list;
    }
    public async Task<IReadOnlyList<Guid>> RoomsAsync(Guid locationId, CancellationToken t) => await db.Set<Room>().Where(r => r.LocationId == locationId).OrderBy(r => r.Id).Select(r => r.Id).ToArrayAsync(t);
    public async Task<bool> EligibleRoomAsync(Guid roomId, CancellationToken t)
    {
        if (!await db.Set<Room>().AnyAsync(r => r.Id == roomId && r.Status == RoomStatus.Available && r.Location.IsActive, t)) return false;
        if (await db.Set<Contract>().AnyAsync(c => c.RoomId == roomId && (c.Status == ContractStatus.Active ||
            (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation) &&
            (c.Signatures.Any(s => s.SignedAt != null) || db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Any(a => a.TargetDepositContractId == c.Id))), t)) return false;
        return (await new PropertyLifecycleChecks(db).RoomBlockersAsync(roomId, t)).Count == 0;
    }
    public Task<Asset?> AssetAsync(Guid id, CancellationToken t) => db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == id, t);
    public async Task<IReadOnlyList<AssetHistoryEntry>> AssetHistoryAsync(Guid assetId, CancellationToken t) => await db.Set<PropertyChange>().AsNoTracking()
        .Where(a => a.TargetId == assetId && a.TargetType == nameof(Asset)).OrderByDescending(a => a.OccurredAt).ThenBy(a => a.Id)
        .Select(a => new AssetHistoryEntry(a.Id, a.Action, a.Reason, a.OccurredAt, a.ActorId, a.After)).Take(1000).ToArrayAsync(t);
    public async Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t) => await db.Set<Asset>().AsNoTracking().Where(a => a.RoomId == roomId).OrderBy(a => a.Id).Take(1000).ToArrayAsync(t);
    public Task SaveAssetMetadataAsync(Guid assetId, AssetMetadata metadata, CancellationToken t) => sql.Execute(
        "UPDATE assets SET purchase_info=purchase_info||@data::jsonb WHERE id=@id", t, ("id", assetId), ("data", JsonSerializer.Serialize(metadata, Json)));
    public async Task<IReadOnlyDictionary<Guid, AssetMetadata>> AssetMetadataAsync(Guid[] assetIds, CancellationToken t)
    {
        await using var command = await sql.Command("SELECT id,purchase_info FROM assets WHERE id=ANY(@ids)", t, ("ids", assetIds));
        await using var reader = await command.ExecuteReaderAsync(t); var values = new Dictionary<Guid, AssetMetadata>();
        while (await reader.ReadAsync(t))
        {
            using var data = JsonDocument.Parse(reader.GetString(1));
            values[reader.GetGuid(0)] = data.RootElement.TryGetProperty("trackingMode", out _) ? data.RootElement.Deserialize<AssetMetadata>(Json)! : new("Serialized", 1, null, null, null);
        }
        return values;
    }
    public async Task SaveAssetAsync(Asset asset, Guid actor, string reason, CancellationToken t)
    {
        if (!string.IsNullOrWhiteSpace(asset.Code) && await db.Set<Asset>().AnyAsync(a => a.LocationId == asset.LocationId && a.Id != asset.Id && a.Code != null && a.Code.Trim().ToUpper() == asset.Code.Trim().ToUpper(), t))
            throw new PropertyException(409, "duplicate_asset_code");
        if (asset.Status == AssetStatus.Retired && await db.Set<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>().AnyAsync(w => w.AssetId == asset.Id &&
            w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified && w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Cancelled, t))
            throw new PropertyException(409, "asset_workflow_controlled");
        if (db.Entry(asset).State == EntityState.Detached) db.Add(asset);
        db.Add(new PropertyChange
        {
            ActorId = actor,
            LocationId = asset.LocationId,
            TargetId = asset.Id,
            TargetType = nameof(Asset),
            Action = "InventoryChanged",
            Reason = reason,
            After = JsonSerializer.Serialize(asset, Json),
            OccurredAt = sql.Now
        });
        await db.SaveChangesAsync(t);
    }
    public Task<Contract?> ContractAsync(Guid id, CancellationToken t) => db.Set<Contract>().Include(c => c.Room).ThenInclude(r => r.Location)
        .Include(c => c.Signatures).Include(c => c.Residents).AsSplitQuery().SingleOrDefaultAsync(c => c.Id == id, t);
    public async Task SaveContractAsync(Contract contract, Guid actor, string action, CancellationToken t)
    {
        if (db.Entry(contract).State == EntityState.Detached) db.Add(contract);
        db.SecurityAudit.Add(new BHome.Infrastructure.IdentityAccess.SecurityAuditRecord
        {
            UserId = actor,
            Event = action,
            TargetType = "Contract",
            TargetId = contract.Id,
            Succeeded = true,
            OccurredAt = sql.Now
        });
        await db.SaveChangesAsync(t);
        if (contract.TenantUserId is { } tenant)
            await sql.Emit(tenant, "Tenant", contract.Room.LocationId, $"setup-contract:{contract.Id}:{action}:{tenant}", action, "Contract",
                "Phụ lục nội quy", "Có phụ lục nội quy cần xem xét và ký xác nhận.", "Contract", contract.Id, t);
    }
    public async Task NotifyPolicyPublicationAsync(Guid locationId, Guid policyId, CancellationToken t)
    {
        var recipients = await db.Set<Contract>().AsNoTracking().Where(c => c.Room.LocationId == locationId && c.Status == ContractStatus.Active &&
            c.Kind != ContractKind.Holding && c.TenantUserId != null).Select(c => new { c.Id, c.TenantUserId }).ToArrayAsync(t);
        foreach (var recipient in recipients)
            await sql.Emit(recipient.TenantUserId!.Value, "Tenant", locationId, $"policy-published:{policyId}:{recipient.Id}", "OperatingPolicyPublished", "Contract",
                "Công bố phiên bản nội quy", "Phiên bản nội quy mới đã được công bố. Nội quy của hợp đồng đã ký chỉ thay đổi qua phụ lục được chấp thuận.", "Contract", recipient.Id, t);
    }
    public async Task<string?> EvidenceHashAsync(string objectKey, CancellationToken t)
    {
        var hash = await sql.Scalar<string>("SELECT task_data->'document'->'data'->>'hash' FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupEvidence' AND task_data->'document'->'data'->>'objectKey'=@key", t, ("key", objectKey));
        if (hash is null) return null;
        using var bytes = new MemoryStream(); await storage.CopyToAsync(objectKey, bytes, t);
        return Convert.ToHexString(SHA256.HashData(bytes.ToArray())) == hash ? hash : null;
    }
    public async Task<string> UploadEvidenceAsync(Guid locationId, byte[] bytes, string contentType, Guid actor, CancellationToken t)
    {
        var id = Guid.NewGuid(); var key = $"setup/{locationId:N}/evidence/{id:N}";
        using var stream = new MemoryStream(bytes); await storage.PutAsync(key, stream, bytes.Length, contentType, t);
        try
        {
            await TransactionAsync(locationId, async () => await SaveAsync(id, locationId, "Evidence", "Recorded",
            new { objectKey = key, hash = Convert.ToHexString(SHA256.HashData(bytes)), contentType, length = bytes.Length }, 0, actor, t), t);
        }
        catch { await storage.DeleteAsync(key, CancellationToken.None); throw; }
        return key;
    }
}
