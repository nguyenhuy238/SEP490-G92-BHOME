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
    public async Task<SetupPage> PageAsync(Guid? locationId, string kind, Guid? assetId, int page, int pageSize, CancellationToken t)
    {
        if (page is < 1 or > 1000000 || pageSize is < 1 or > 100) throw new PropertyException(400, "invalid_pagination");
        const string filter = "(@location IS NULL OR location_id=@location) AND task_type='SYSTEM_JOB' AND task_data->>'recordType'=@kind AND (@asset IS NULL OR task_data->'document'->'data'->>'assetId'=@assetText)";
        var total = await sql.Scalar<long>("SELECT count(*) FROM operational_tasks WHERE " + filter, t,
            ("location", locationId), ("kind", "Setup" + kind), ("asset", assetId), ("assetText", assetId?.ToString() ?? ""));
        await using var command = await sql.Command("SELECT task_data->'document' FROM operational_tasks WHERE " + filter + " ORDER BY id OFFSET @skip LIMIT @take", t,
            ("location", locationId), ("kind", "Setup" + kind), ("asset", assetId), ("assetText", assetId?.ToString() ?? ""),
            ("skip", checked((page - 1) * pageSize)), ("take", pageSize));
        await using var reader = await command.ExecuteReaderAsync(t);
        var items = new List<SetupDocument>();
        while (await reader.ReadAsync(t)) items.Add(JsonSerializer.Deserialize<SetupDocument>(reader.GetString(0), Json)!);
        return new(items, page, pageSize, checked((int)total));
    }

    public async Task AuditAsync(Guid locationId, Guid targetId, Guid actor, string action, CancellationToken t)
    {
        await sql.Execute("""
            INSERT INTO notifications(id,record_kind,actor_user_id,location_id,event_key,notification_type,
                related_entity_type,related_entity_id,event_data,event_at,delivery_history)
            VALUES(@id,'AUDIT',@actor,@location,@key,@action,'SetupDocument',@target,'{"succeeded":true}'::jsonb,@now,'[]')
            """, t, ("id", Guid.NewGuid()), ("actor", actor), ("location", locationId), ("key", "setup-audit:" + Guid.NewGuid()),
            ("action", action), ("target", targetId), ("now", sql.Now));
    }
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
    public async Task<IReadOnlyList<SetupDocument>> SaveBatchAsync(Guid locationId, IReadOnlyList<SetupDocumentWrite> documents, Guid actor, CancellationToken t)
    {
        if (documents.Count == 0) return [];
        if (documents.Count > 5000 || documents.Any(d => d.Id == Guid.Empty || d.ExpectedVersion < 0) ||
            documents.Select(d => d.Id).Distinct().Count() != documents.Count)
            throw new PropertyException(400, "invalid_setup_document_batch");
        var now = sql.Now;
        var savedDocuments = new List<SetupDocument>(documents.Count);
        var prepared = documents.Select(write =>
        {
            var payload = JsonSerializer.SerializeToNode(write.Data, Json) as System.Text.Json.Nodes.JsonObject
                ?? throw new PropertyException(400, "invalid_setup_document");
            payload.Remove("expectedVersion");
            var document = new SetupDocument(write.Id, locationId, write.Kind, write.Status, write.ExpectedVersion + 1,
                JsonSerializer.SerializeToElement(payload, Json), now, actor);
            savedDocuments.Add(document);
            return new
            {
                id = write.Id,
                location_id = locationId,
                source_key = $"setup:{write.Kind}:{write.Id:N}",
                title = write.Kind,
                status = write.Status,
                version = document.Version,
                expected_version = write.ExpectedVersion,
                task_data = JsonSerializer.SerializeToElement(new { recordType = "Setup" + write.Kind, document }, Json),
                history = JsonSerializer.SerializeToElement(new[] { new { actorId = actor, occurredAt = now, action = write.Status, document } }, Json)
            };
        }).ToArray();
        var payloadJson = JsonSerializer.Serialize(prepared, Json);
        var count = await sql.Scalar<int>("""
            WITH input AS (
                SELECT * FROM jsonb_to_recordset(@documents::jsonb) AS d(
                    id uuid, location_id uuid, source_key text, title text, status text,
                    version integer, expected_version integer, task_data jsonb, history jsonb)
            ), written AS (
                INSERT INTO operational_tasks(id,task_type,location_id,source_key,title,status,task_data,history,version)
                SELECT id,'SYSTEM_JOB',location_id,source_key,title,status,task_data,history,version
                FROM input
                WHERE expected_version=0 OR EXISTS (
                    SELECT 1 FROM operational_tasks existing WHERE existing.id=input.id
                )
                ON CONFLICT(id) DO UPDATE SET
                    task_data=EXCLUDED.task_data,
                    history=operational_tasks.history||EXCLUDED.history,
                    status=EXCLUDED.status,
                    version=operational_tasks.version+1
                WHERE (SELECT expected_version FROM input WHERE id=EXCLUDED.id)>0
                  AND operational_tasks.version=(SELECT expected_version FROM input WHERE id=EXCLUDED.id)
                  AND operational_tasks.location_id=EXCLUDED.location_id
                  AND operational_tasks.task_type='SYSTEM_JOB'
                  AND operational_tasks.task_data->>'recordType'=EXCLUDED.task_data->>'recordType'
                RETURNING id
            )
            SELECT count(*)::integer FROM written
            """, t, ("documents", payloadJson));
        if (count != documents.Count) throw new PropertyException(409, "stale_version");
        return savedDocuments;
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
    public async Task<IReadOnlyList<Room>> ReviewRoomsAsync(Guid locationId, CancellationToken t) =>
        await db.Set<Room>().AsNoTracking().Where(r => r.LocationId == locationId).OrderBy(r => r.RoomNumber).ThenBy(r => r.Id).ToArrayAsync(t);
    public async Task<IReadOnlyList<RoomInventoryPhysicalAsset>> ReviewRoomAssetsAsync(Guid locationId, CancellationToken t)
    {
        var rows = await db.Set<Asset>().AsNoTracking()
            .Where(a => a.LocationId == locationId && a.RoomId != null && a.Status != AssetStatus.Retired)
            .OrderBy(a => a.Id)
            .Select(a => new { Asset = a, PurchaseInfo = EF.Property<string>(a, "PurchaseInfo") })
            .ToArrayAsync(t);
        return rows.Select(row =>
        {
            using var data = JsonDocument.Parse(row.PurchaseInfo ?? "{}");
            var metadata = data.RootElement.TryGetProperty("trackingMode", out _)
                ? data.RootElement.Deserialize<AssetMetadata>(Json)!
                : new AssetMetadata("Serialized", 1, null, null, null);
            return new RoomInventoryPhysicalAsset(row.Asset, metadata);
        }).ToArray();
    }
    public async Task<IReadOnlyList<RoomInventoryPhysicalAsset>> ReviewCommonAssetsAsync(Guid locationId, CancellationToken t)
    {
        var rows = await db.Set<Asset>().AsNoTracking()
            .Where(a => a.LocationId == locationId && a.RoomId == null && a.CommonArea != null && a.Status != AssetStatus.Retired)
            .OrderBy(a => a.Id)
            .Select(a => new { Asset = a, PurchaseInfo = EF.Property<string>(a, "PurchaseInfo") })
            .ToArrayAsync(t);
        return rows.Select(row =>
        {
            using var data = JsonDocument.Parse(row.PurchaseInfo ?? "{}");
            var metadata = data.RootElement.TryGetProperty("trackingMode", out _)
                ? data.RootElement.Deserialize<AssetMetadata>(Json)!
                : new AssetMetadata("Serialized", 1, null, null, null);
            return new RoomInventoryPhysicalAsset(row.Asset, metadata);
        }).ToArray();
    }
    public async Task<IReadOnlyList<SetupDocument>> ReviewDocumentsAsync(Guid locationId, Guid[] activeAssetIds, CancellationToken t)
    {
        string[] kinds = ["SetupAssetTemplate", "SetupAssetTemplateAssignment", "SetupRoomProvenance", "SetupDesiredAssets", "SetupRoomInventoryChecklistReview", "SetupAssetMetadata", "SetupRoomNoAssets", "SetupHandoverInventoryDiscrepancy"];
        await using var cmd = await sql.Command("""
            SELECT task_data->'document' FROM operational_tasks WHERE location_id=@location AND task_type='SYSTEM_JOB'
                AND (task_data->>'recordType'=ANY(@kinds) OR
                    (task_data->>'recordType'='SetupAssetVerification' AND
                     (task_data->'document'->'data'->>'assetId')::uuid=ANY(@assets)))
            ORDER BY id
            """, t, ("location", locationId), ("kinds", kinds), ("assets", activeAssetIds));
        await using var reader = await cmd.ExecuteReaderAsync(t);
        var documents = new List<SetupDocument>();
        while (await reader.ReadAsync(t)) documents.Add(JsonSerializer.Deserialize<SetupDocument>(reader.GetString(0), Json)!);
        return documents;
    }
    public async Task<IReadOnlyList<SetupDocument>> EvidenceDocumentsAsync(Guid locationId, Guid[] evidenceIds, CancellationToken t)
    {
        if (evidenceIds.Length == 0) return [];
        await using var cmd = await sql.Command("""
            SELECT task_data->'document' FROM operational_tasks
            WHERE location_id=@location AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='SetupEvidence'
              AND id=ANY(@ids)
            ORDER BY id
            """, t, ("location", locationId), ("ids", evidenceIds));
        await using var reader = await cmd.ExecuteReaderAsync(t);
        var documents = new List<SetupDocument>();
        while (await reader.ReadAsync(t)) documents.Add(JsonSerializer.Deserialize<SetupDocument>(reader.GetString(0), Json)!);
        return documents;
    }
    public async Task SaveInventoryAssetsAsync(Guid locationId, IReadOnlyList<AssetInventoryCreation> assets, Guid actor, CancellationToken t)
    {
        if (assets.Count == 0) return;
        if (assets.Count > 1000 || assets.Any(x => x.Asset.LocationId != locationId ||
            (x.Asset.RoomId is null) == string.IsNullOrWhiteSpace(x.Asset.CommonArea) ||
            x.Asset.Status == AssetStatus.Retired || x.Metadata.Quantity < 1 || string.IsNullOrWhiteSpace(x.Asset.Code)) ||
            assets.Select(x => x.Asset.Id).Distinct().Count() != assets.Count ||
            assets.Select(x => x.Asset.Code!.Trim().ToUpperInvariant()).Distinct().Count() != assets.Count)
            throw new PropertyException(400, "invalid_inventory_asset_batch");
        var codes = assets.Select(x => x.Asset.Code!.Trim().ToUpper()).ToArray();
        if (await db.Set<Asset>().AnyAsync(a => a.LocationId == locationId && a.Code != null && codes.Contains(a.Code.Trim().ToUpper()), t))
            throw new PropertyException(409, "duplicate_asset_code");
        foreach (var entry in assets)
        {
            db.Add(entry.Asset);
            db.Entry(entry.Asset).Property<string>("PurchaseInfo").CurrentValue = JsonSerializer.Serialize(entry.Metadata, Json);
            db.Add(new PropertyChange
            {
                ActorId = actor,
                LocationId = locationId,
                TargetId = entry.Asset.Id,
                TargetType = nameof(Asset),
                Action = "InventoryChanged",
                Reason = entry.Reason,
                After = JsonSerializer.Serialize(entry.Asset, Json),
                OccurredAt = sql.Now
            });
        }
        await db.SaveChangesAsync(t);
    }
    public async Task<string?> RoomConfigurationLockReasonAsync(Guid roomId, CancellationToken t)
    {
        var room = await db.Set<Room>().AsNoTracking().Where(r => r.Id == roomId)
            .Select(r => new { r.Status, Active = r.Location.IsActive }).SingleOrDefaultAsync(t);
        if (room is null) return "resource_not_found";
        if (!room.Active) return "location_inactive";
        if (await db.Set<Contract>().AnyAsync(c => c.RoomId == roomId &&
            (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning ||
             c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Active), t))
            return "room_configuration_locked_by_contract";
        if (room.Status is RoomStatus.Occupied or RoomStatus.OnHold ||
            await PostgresPropertyRepository.UnresolvedResidents(db).AnyAsync(r => r.RoomId == roomId, t))
            return "room_has_obligations";
        return null;
    }
    public async Task<bool> EligibleRoomAsync(Guid roomId, CancellationToken t)
    {
        if (!await db.Set<Room>().AnyAsync(r => r.Id == roomId && r.Status == RoomStatus.Available && r.Location.IsActive, t)) return false;
        if (await RoomConfigurationLockReasonAsync(roomId, t) is not null) return false;
        return (await new PropertyLifecycleChecks(db).RoomBlockersAsync(roomId, t)).Count == 0;
    }
    public async Task<Asset?> AssetAsync(Guid id, CancellationToken t)
    {
        var tracked = db.ChangeTracker.Entries<Asset>().SingleOrDefault(entry => entry.Entity.Id == id);
        if (tracked is not null)
        {
            await tracked.ReloadAsync(t);
            return tracked.State == EntityState.Detached ? null : tracked.Entity;
        }
        return await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == id, t);
    }
    public Task<bool> HasOpenAssetWorkAsync(Guid id, CancellationToken t) =>
        db.Set<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>().AnyAsync(w => w.AssetId == id &&
            w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified &&
            w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Cancelled, t);
    public async Task<IReadOnlyList<AssetHistoryEntry>> AssetHistoryAsync(Guid assetId, CancellationToken t)
    {
        var changes = await db.Set<PropertyChange>().AsNoTracking()
            .Where(a => a.TargetId == assetId && a.TargetType == nameof(Asset))
            .Select(a => new AssetHistoryEntry(a.Id, a.Action, a.Reason, a.OccurredAt, a.ActorId, a.After))
            .ToArrayAsync(t);
        var repairs = new List<AssetHistoryEntry>();
        await using (var command = await sql.Command("""
            SELECT id,title,COALESCE(verified_at,due_at,now()),COALESCE(verified_by_user_id,assigned_user_id),
                jsonb_build_object('workOrderId',id,'incidentId',incident_report_id,'status',status,
                    'state',task_data->'state')::text
            FROM operational_tasks
            WHERE task_type='WORK_ORDER' AND asset_id=@asset AND status='Verified'
            ORDER BY COALESCE(verified_at,due_at) DESC,id
            """, t, ("asset", assetId)))
        await using (var reader = await command.ExecuteReaderAsync(t))
        {
            while (await reader.ReadAsync(t))
                repairs.Add(new AssetHistoryEntry(reader.GetGuid(0), "RepairVerified", reader.GetString(1),
                    reader.GetFieldValue<DateTimeOffset>(2), reader.IsDBNull(3) ? Guid.Empty : reader.GetGuid(3), reader.GetString(4)));
        }
        return changes.Concat(repairs).OrderByDescending(entry => entry.OccurredAt).ThenBy(entry => entry.Id)
            .Take(1000).ToArray();
    }
    public async Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t) => await db.Set<Asset>().AsNoTracking().Where(a => a.RoomId == roomId).OrderBy(a => a.Id).Take(1000).ToArrayAsync(t);
    public async Task SaveAssetMetadataAsync(Guid assetId, AssetMetadata metadata, CancellationToken t)
    {
        var unitCount = await sql.Scalar<long>("""
            SELECT count(*) FROM operational_tasks WHERE task_type='SYSTEM_JOB'
                AND task_data->>'recordType'='SetupAssetEquipmentUnit'
                AND task_data->'document'->'data'->>'assetId'=@asset
                AND status<>'Retired'
            """, t, ("asset", assetId.ToString()));
        if (metadata.Quantity < unitCount) throw new PropertyException(409, "equipment_quantity_exceeded");
        var merged = await sql.Scalar<string>("UPDATE assets SET purchase_info=purchase_info||@data::jsonb WHERE id=@id RETURNING purchase_info::text", t,
            ("id", assetId), ("data", JsonSerializer.Serialize(metadata, Json)));
        if (merged is null) throw new PropertyException(404, "resource_not_found");
        var tracked = db.ChangeTracker.Entries<Asset>().SingleOrDefault(e => e.Entity.Id == assetId);
        if (tracked is not null)
        {
            var property = tracked.Property<string>("PurchaseInfo");
            property.CurrentValue = merged; property.OriginalValue = merged; property.IsModified = false;
        }
    }
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
        if (asset.Status == AssetStatus.Retired && await HasOpenAssetWorkAsync(asset.Id, t))
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
    public Task<Guid?> EvidenceIdAsync(Guid locationId, string objectKey, CancellationToken t) =>
        sql.Scalar<Guid?>("""
            SELECT id FROM operational_tasks
            WHERE location_id=@location AND task_type='SYSTEM_JOB'
              AND task_data->>'recordType'='SetupEvidence'
              AND task_data->'document'->'data'->>'objectKey'=@key
            """, t, ("location", locationId), ("key", objectKey));
    public async Task<SetupEvidenceUpload> UploadEvidenceAsync(Guid locationId, byte[] bytes, string contentType, Guid actor, CancellationToken t)
    {
        var id = Guid.NewGuid(); var key = $"setup/{locationId:N}/evidence/{id:N}";
        using var stream = new MemoryStream(bytes); await storage.PutAsync(key, stream, bytes.Length, contentType, t);
        try
        {
            await TransactionAsync(locationId, async () => await SaveAsync(id, locationId, "Evidence", "Recorded",
            new { objectKey = key, hash = Convert.ToHexString(SHA256.HashData(bytes)), contentType, length = bytes.Length }, 0, actor, t), t);
        }
        catch { await storage.DeleteAsync(key, CancellationToken.None); throw; }
        return new(id, key);
    }
}
