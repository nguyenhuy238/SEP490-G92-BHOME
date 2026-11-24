using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using BHome.Application.StaffOperations;
using BHome.Domain.StaffOperations;
using System.Security.Cryptography;
using System.Text;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Application.PropertyManagement;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractHandoverRepository(BHomePersistenceContext db, IOperationalTaskRepository tasks,
    CompactNotificationWriter? inbox = null, RoomInventoryReviewService? inventory = null) : IContractHandoverRepository
{
    private static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
    internal static Guid MoveOutTaskId(Guid contractId) => Key($"contract-move-out:{contractId:N}");
    private static readonly JsonSerializerOptions MoveOutDraftJson = new(JsonSerializerDefaults.Web);
    public async Task<MoveOutInspectionDraftState?> MoveOutInspectionDraftAsync(Guid contractId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            throw new ContractException(503, "move_out_draft_storage_unavailable");
        var json = await db.Database.SqlQuery<string>($"""
            SELECT COALESCE((move_out->'inspectionDraft')::text, 'null') AS "Value"
            FROM contracts WHERE id={contractId}
            """).SingleOrDefaultAsync(t);
        return json is null or "null" ? null :
            JsonSerializer.Deserialize<MoveOutInspectionDraftState>(json, MoveOutDraftJson)
            ?? throw ContractException.Conflict("move_out_draft_integrity_failed");
    }
    public async Task<bool> ReplaceMoveOutInspectionDraftAsync(Guid contractId, int version,
        MoveOutInspectionDraftState next, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            throw new ContractException(503, "move_out_draft_storage_unavailable");
        var json = JsonSerializer.Serialize(next, MoveOutDraftJson);
        var rows = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts
            SET move_out=jsonb_set(COALESCE(move_out,jsonb_build_object()),
                ARRAY['inspectionDraft'],{json}::jsonb,true)
            WHERE id={contractId}
              AND move_out->'current' IS NOT NULL
              AND COALESCE((move_out->'inspectionDraft'->>'version')::integer,0)={version}
            """, t);
        return rows == 1;
    }
    public async Task ResetMoveOutInspectionDraftAsync(Guid contractId, Guid staffId,
        string snapshotHash, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var prior = await MoveOutInspectionDraftAsync(contractId, t);
        if (prior is null) return;
        var reset = MoveOutInspectionDraftState.Empty(contractId, staffId, snapshotHash, now, prior.Version + 1);
        if (!await ReplaceMoveOutInspectionDraftAsync(contractId, prior.Version, reset, t))
            throw ContractException.Conflict("move_out_draft_version_changed");
    }
    public async Task EnsureMoveOutTaskAsync(Contract contract, ContractMoveOut moveOut, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        if (moveOut.ContractId != contract.Id || moveOut.Status == MoveOutStatus.Requested)
            throw ContractException.Conflict("move_out_not_approved");
        var id = MoveOutTaskId(contract.Id);
        if (await db.Set<OperationalTask>().AnyAsync(task => task.Id == id, t)) return;
        // A Location work item begins unclaimed. The first currently assigned Staff
        // member to start it becomes its worker under the Location transaction lock.
        var task = new OperationalTask(id)
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = contract.Room.LocationId,
            ContractId = contract.Id,
            TargetRoomId = contract.RoomId,
            TargetLabel = contract.Room.RoomNumber,
            Title = $"Kiểm tra trả phòng {contract.Room.RoomNumber}",
            Requirements = "Kiểm tra hiện trạng phòng, tài sản, chìa khóa và quyền ra vào; có thể đính kèm ảnh, xác nhận chỉ số điện nước cuối kỳ và gửi kết quả cho Owner xem xét.",
            Priority = OperationalTaskPriority.Normal,
            Status = MeterTaskStatus.Assigned,
            ReadingDate = moveOut.ProposedDate,
            EvidenceRequired = false
        };
        db.Add(task);
        db.Add(new OperationalTaskHistory
        {
            TaskId = id,
            ActorId = actor,
            Action = "MoveOutCreated",
            OccurredAt = now,
            TaskVersion = task.Version,
            Note = "Chờ nhân viên cơ sở bắt đầu kiểm tra."
        });
        foreach (var owner in await tasks.OwnersAsync(t))
            AddNotice(Key($"move-out-notice:{id:N}:{owner:N}"), new OperationalTaskNotification
            {
                TaskId = id,
                RecipientUserId = owner,
                EventId = id,
                Event = "MoveOutAssigned"
            });
    }
    private async Task<OperationalTask> MoveOutTaskAsync(Guid contractId, CancellationToken t) =>
        await db.Set<OperationalTask>().SingleOrDefaultAsync(task =>
            task.Id == MoveOutTaskId(contractId) && task.ContractId == contractId &&
            task.Kind == OperationalTaskKind.AdHoc, t)
        ?? throw ContractException.Conflict("move_out_task_required");
    public async Task RequireMoveOutTaskStartedAsync(Guid contractId, Guid staffId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await MoveOutTaskAsync(contractId, t);
        if (task.Status != MeterTaskStatus.InProgress || task.AssignedStaffUserId != staffId)
            throw ContractException.Conflict("move_out_task_not_started");
    }
    public async Task EnsureMoveOutTaskAssigneeAsync(Guid contractId, Guid? staffId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await MoveOutTaskAsync(contractId, t);
        if (task.Status != MeterTaskStatus.Assigned && staffId is { } assignee &&
            assignee != task.AssignedStaffUserId)
            throw ContractException.Conflict("move_out_task_already_claimed");
    }
    public async Task SubmitMoveOutTaskAsync(Guid contractId, Guid staffId, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        await RequireMoveOutTaskStartedAsync(contractId, staffId, t);
        var task = await MoveOutTaskAsync(contractId, t);
        task.ApplyAction("submit", now, staffId); task.Version++;
        task.Result = "Staff đã gửi kết quả kiểm tra trả phòng cho Owner xem xét.";
        db.Add(new OperationalTaskHistory
        {
            TaskId = task.Id,
            ActorId = staffId,
            Action = "MoveOutSubmitted",
            OccurredAt = now,
            TaskVersion = task.Version
        });
    }
    public async Task ReviewMoveOutTaskAsync(Guid contractId, Guid ownerId, bool confirmed, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await MoveOutTaskAsync(contractId, t);
        if (task.Status != MeterTaskStatus.PendingVerification)
            throw ContractException.Conflict("move_out_task_not_submitted");
        task.ApplyAction(confirmed ? "verify" : "rework", now, ownerId); task.Version++;
        task.Result = confirmed ? "Owner đã xác nhận kết quả kiểm tra trả phòng." : "Owner yêu cầu Staff kiểm tra lại.";
        db.Add(new OperationalTaskHistory
        {
            TaskId = task.Id,
            ActorId = ownerId,
            Action = confirmed ? "MoveOutVerified" : "MoveOutReinspection",
            OccurredAt = now,
            TaskVersion = task.Version
        });
    }
    public async Task<HandoverMoveInTask?> MoveInTaskAsync(Guid contractId, Guid roomId,
        Guid? staffUserId, bool includeOwnerInventory, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return null;
        // Use the transaction's tracked entity, if present: Submit/Reopen/Verify
        // updates the task in this same transaction and the response must show
        // the resulting state before the outer transaction commits.
        var task = await db.Set<OperationalTask>().SingleOrDefaultAsync(x =>
            x.Id == Key($"contract-move-in:{contractId:N}") && x.ContractId == contractId &&
            x.TargetRoomId == roomId && x.Kind == OperationalTaskKind.AdHoc, t);
        if (task is null) return null;
        // Expose the native task status, with a separate permission-safe
        // indication of whether this Staff actor may inspect at this moment.
        var isResponsibleStaff = staffUserId is not null && task.AssignedStaffUserId == staffUserId;
        // Only the authorized Owner or assigned Staff receives the operational
        // inventory-task reference in the contract draft. Tenant gets no ID.
        var inventoryTask = (isResponsibleStaff || includeOwnerInventory)
            ? await db.Set<OperationalTask>().SingleOrDefaultAsync(x =>
                x.Id == Key($"contract-pre-move-in-inventory:{contractId:N}") &&
                x.Kind == OperationalTaskKind.MoveInInventory && x.ContractId == contractId, t)
            : null;
        return new HandoverMoveInTask(task.Id, task.Status.ToString(), task.Version,
            task.Status == MeterTaskStatus.InProgress && isResponsibleStaff,
            inventoryTask?.Id, inventoryTask?.Status.ToString());
    }
    public async Task EnsureMoveInTaskAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        await EnsureInventoryTaskAsync(c, actor, now, t);
        var id = Key($"contract-move-in:{c.Id:N}");
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var responsible = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
        await EnsureMeterBaselinesAsync(c, now, responsible, t);
        if (await db.Set<OperationalTask>().AnyAsync(x => x.Id == id, t)) return;
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = c.Room.LocationId,
            ContractId = c.Id,
            TargetRoomId = c.RoomId,
            TargetLabel = c.Room.RoomNumber,
            Title = $"Bàn giao vào phòng {c.Room.RoomNumber}",
            Requirements = "Kiểm tra hiện trạng phòng, tài sản và chụp xác nhận chỉ số điện nước đầu kỳ. Staff gửi biên bản để Owner duyệt và ký; Tenant ký sau cùng.",
            AssignedStaffUserId = responsible?.StaffUserId,
            AssignmentId = responsible?.AssignmentId,
            AssignedAt = responsible is null ? null : now,
            EvidenceRequired = true,
            Status = MeterTaskStatus.Assigned,
            ReadingDate = c.StartDate
        };
        db.Entry(task).Property(x => x.Id).CurrentValue = id; db.Add(task);
        db.Add(new OperationalTaskHistory
        {
            TaskId = id,
            ActorId = actor,
            Action = "MoveInCreated",
            OccurredAt = now,
            TaskVersion = 1,
            ResponsibleStaffUserId = responsible?.StaffUserId,
            Note = responsible is null ? "AwaitingAssignment" : ""
        });
        foreach (var recipient in (await tasks.OwnersAsync(t)).Concat(responsible is null ? [] : new[] { responsible.StaffUserId }).Distinct())
            AddNotice(Key($"move-in-notice:{id:N}:{recipient:N}"), new OperationalTaskNotification
            {
                TaskId = id,
                RecipientUserId = recipient,
                EventId = id,
                Event = responsible is null ? "MoveInAwaitingAssignment" : "MoveInAssigned"
            });
        if (inbox is not null)
            foreach (var party in new[] { (c.TenantUserId, Roles.Tenant), (responsible?.StaffUserId, Roles.Staff), ((Guid?)c.OwnerSignerId, Roles.Owner) }.Where(p => p.Item1 is not null).Distinct())
                await inbox.Emit(party.Item1!.Value, party.Item2, c.Room.LocationId, $"move-in:{c.Id:N}:{party.Item1:N}", "MOVE_IN_PENDING", "Contract",
                    "Bàn giao nhận phòng chưa hoàn tất",
                    c.Status == ContractStatus.Active
                        ? "Hợp đồng đã kích hoạt. Theo dõi kiểm tra và xác nhận bàn giao trong hợp đồng."
                        : "Biên bản bàn giao nháp đã được tạo. Có thể chuẩn bị kiểm kê và chụp chỉ số điện nước ban đầu; việc vào ở chính thức vẫn phụ thuộc các bước duyệt hợp đồng.",
                    "Contract", c.Id, t);
    }

    // Repair missing capture checkpoints on older manually activated Main contracts
    // without creating a second Staff job, replacing physical meters, or reusing an
    // earlier Tenant's confirmed opening value. Called only by an authorized
    // in-progress MoveIn handover, under the same Location transaction lock.
    public async Task<Guid[]> EnsureMoveInMeterBaselinesAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            throw ContractException.Conflict("move_in_baselines_unavailable");
        var contract = await db.Set<Contract>().Include(c => c.Room).ThenInclude(r => r.Location)
            .SingleOrDefaultAsync(c => c.Id == contractId && c.Kind == ContractKind.Main &&
                c.PreviousContractId == null && c.Status != ContractStatus.Cancelled &&
                c.Status != ContractStatus.Terminated && c.Status != ContractStatus.Expired &&
                c.Status != ContractStatus.Superseded, t)
            ?? throw ContractException.Conflict("main_move_in_handover_required");
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var responsible = await tasks.ResponsibilityAsync(contract.Room.LocationId, date, t);
        return await EnsureMeterBaselinesAsync(contract, now, responsible, t);
    }

    private async Task<Guid[]> EnsureMeterBaselinesAsync(Contract c, DateTimeOffset now,
        TaskResponsibility? responsible, CancellationToken t)
    {
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        // Every tenancy starts with its own photographed electricity/water baseline.
        // A physical meter may have confirmed readings from previous occupants, so
        // these tasks are keyed by Contract + Meter instead of Meter alone.
        var meters = await db.Set<Meter>().AsNoTracking().Where(m => m.RoomId == c.RoomId && m.IsActive)
            .OrderBy(m => m.UtilityType).ThenBy(m => m.Id).ToArrayAsync(t);
        var ids = new List<Guid>(meters.Length);
        foreach (var meter in meters)
        {
            var meterTaskId = Key($"contract-meter-initial:{c.Id:N}:{meter.Id:N}");
            ids.Add(meterTaskId);
            if (db.Set<OperationalTask>().Local.Any(x => x.Id == meterTaskId) ||
                await db.Set<OperationalTask>().AnyAsync(x => x.Id == meterTaskId, t)) continue;
            var meterTask = new OperationalTask
            {
                Kind = OperationalTaskKind.MeterReading,
                LocationId = c.Room.LocationId,
                MeterId = meter.Id,
                ContractId = c.Id,
                Title = $"Chụp chỉ số {(meter.UtilityType == UtilityType.Electricity ? "điện" : "nước")} khi nhận phòng {c.Room.RoomNumber}",
                Requirements = "Chụp ảnh thực tế, đối chiếu và xác nhận chỉ số đầu kỳ cho hợp đồng nhận phòng này. Tiếp tục sử dụng công tơ hiện có, không tạo công tơ mới hay kế thừa chỉ số/ảnh của người thuê trước.",
                Purpose = ReadingPurpose.Initial,
                ReadingDate = new[] { c.StartDate, date, meter.InstalledOn }.Max(),
                AssignedStaffUserId = responsible?.StaffUserId,
                AssignmentId = responsible?.AssignmentId,
                AssignedAt = responsible is null ? null : now,
                EvidenceRequired = true,
                Status = MeterTaskStatus.Assigned
            };
            db.Entry(meterTask).Property(x => x.Id).CurrentValue = meterTaskId;
            db.Add(meterTask);
        }
        return ids.ToArray();
    }

    private async Task EnsureInventoryTaskAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        var id = Key($"contract-pre-move-in-inventory:{c.Id:N}");
        if (await db.Set<OperationalTask>().AnyAsync(x => x.Id == id, t)) return;
        var source = inventory is null ? throw ContractException.Conflict("move_in_inventory_unavailable") :
            await inventory.PrepareForMoveInTaskAsync(c.RoomId, t);
        var items = source.Groups.Select(group =>
        {
            var physical = group.PhysicalAssets ?? [];
            var assetId = physical.Length == 1 ? physical[0].Id : group.ConfiguredQuantity is null ? group.Id : (Guid?)null;
            var expected = group.ConfiguredQuantity ?? physical.Sum(p => p.Quantity);
            return new MoveInInventoryItem(group.Id, assetId, group.Name, expected);
        }).ToArray();
        if (items.Select(i => i.Id).Distinct().Count() != items.Length)
            throw ContractException.Conflict("move_in_inventory_ambiguous_assets");
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var responsible = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
        // Due just before the scheduled first day. A late activation remains visibly overdue,
        // while the actual handover stays guarded until inventory is completed.
        var localBoundary = c.StartDate.ToDateTime(TimeOnly.MinValue);
        var tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
        var due = new DateTimeOffset(localBoundary, tz.GetUtcOffset(localBoundary)).AddTicks(-1).ToUniversalTime();
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.MoveInInventory,
            LocationId = c.Room.LocationId,
            ContractId = c.Id,
            TargetRoomId = c.RoomId,
            TargetLabel = c.Room.RoomNumber,
            Title = $"Kiểm kê trước nhận phòng {c.Room.RoomNumber}",
            Requirements = "Kiểm tra từng nhóm tài sản trước khi Tenant nhận phòng. Nếu thiếu hoặc hỏng, gửi báo cáo BF-07 và liên kết sự cố trước khi hoàn thành.",
            AssignedStaffUserId = responsible?.StaffUserId,
            AssignmentId = responsible?.AssignmentId,
            AssignedAt = responsible is null ? null : now,
            DueAt = due,
            EvidenceRequired = false,
            Status = MeterTaskStatus.Assigned,
            ReadingDate = c.StartDate,
            MoveInInventoryJson = JsonSerializer.Serialize(new MoveInInventorySnapshot(source.StateToken, items))
        };
        db.Entry(task).Property(x => x.Id).CurrentValue = id;
        db.Add(task);
        var history = new OperationalTaskHistory
        {
            TaskId = id,
            ActorId = actor,
            Action = "MoveInInventoryCreated",
            OccurredAt = now,
            TaskVersion = 1,
            ResponsibleStaffUserId = responsible?.StaffUserId,
            Note = responsible is null ? "AwaitingAssignment" : ""
        };
        db.Add(history);
        foreach (var owner in (await tasks.OwnersAsync(t)).Concat(responsible is null ? [] : [responsible.StaffUserId]).Distinct())
            db.Add(new OperationalTaskNotification
            {
                TaskId = id,
                RecipientUserId = owner,
                EventId = history.Id,
                Event = responsible is null ? "MoveInInventoryAwaitingAssignment" : "MoveInInventoryAssigned"
            });
        if (inbox is not null)
            foreach (var party in new[] { (Id: (Guid?)c.OwnerSignerId, Role: Roles.Owner), (Id: responsible?.StaffUserId, Role: Roles.Staff) }.Where(x => x.Id.HasValue))
                await inbox.Emit(party.Id!.Value, party.Role, c.Room.LocationId,
                    $"move-in-inventory:{c.Id:N}:{party.Id:N}", "MOVE_IN_INVENTORY_PENDING", "OperationalTask",
                    "Cần kiểm kê trước khi nhận phòng", $"Phòng {c.Room.RoomNumber} đang chờ kiểm kê tài sản trước bàn giao.",
                    "OperationalTask", id, t, channels: party.Role == Roles.Staff
                        ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"]);
    }

    public async Task<bool> InventoryReadyAsync(Guid contractId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return true;
        // Existing activated contracts with no generated inventory keep their historic handover.
        // New Main activations are always provisioned together with this task.
        var task = await db.Set<OperationalTask>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == Key($"contract-pre-move-in-inventory:{contractId:N}"), t);
        if (task is null) return true;
        if (task.Kind != OperationalTaskKind.MoveInInventory || task.Status != MeterTaskStatus.Completed)
            return false;
        MoveInInventorySnapshot? snapshot;
        try { snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(task.MoveInInventoryJson); }
        catch (JsonException) { return false; }
        return CompletedInventoryValid(snapshot);
    }

    private static bool CompletedInventoryValid(MoveInInventorySnapshot? snapshot) =>
        snapshot?.Items is not null && !snapshot.Items.Any(i => i.Condition is null ||
            i.ActualQuantity is null || i.EvidenceIds is null ||
            i.Condition == "Good" && i.ActualQuantity != i.ExpectedQuantity ||
            i.Condition == "Missing" && i.ActualQuantity >= i.ExpectedQuantity ||
            i.ActualQuantity > i.ExpectedQuantity ||
            (i.Condition is "Missing" or "Damaged") &&
                (i.EvidenceIds.Length == 0 || string.IsNullOrWhiteSpace(i.Notes)));

    public async Task<HandoverCompletedInventory?> CompletedInventoryAsync(Guid contractId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return null;
        // The completed task is the source of factual observations and its
        // original configuration token. A stale draft.inventoryToken is not
        // evidence of new configuration changes.
        var task = await db.Set<OperationalTask>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == Key($"contract-pre-move-in-inventory:{contractId:N}") &&
                x.ContractId == contractId && x.Kind == OperationalTaskKind.MoveInInventory &&
                x.Status == MeterTaskStatus.Completed, t);
        if (task is null) return null; // Legacy contract without an inventory task.
        try
        {
            var snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(task.MoveInInventoryJson);
            if (!CompletedInventoryValid(snapshot) || snapshot!.Items.Any(item =>
                item.Condition is not ("Good" or "Missing" or "Damaged")))
                return null;
            if (task.CompletedAt is null) return null;
            var evidenceIds = snapshot.Items.SelectMany(item => item.EvidenceIds ?? [])
                .Distinct().ToArray();
            var evidenceById = await db.Set<OperationalTaskEvidence>().AsNoTracking()
                .Where(file => file.TaskId == task.Id && evidenceIds.Contains(file.Id))
                .Select(file => new { file.Id, file.CreatedAt })
                .ToDictionaryAsync(file => file.Id, file => file.CreatedAt, t);
            var latestEvidence = snapshot.Items.ToDictionary(item => item.Id, item =>
                (item.EvidenceIds ?? [])
                    .Where(id => evidenceById.ContainsKey(id))
                    .Select(id => (DateTimeOffset?)evidenceById[id])
                    .Max());
            return new HandoverCompletedInventory(snapshot.SourceToken, task.CompletedAt.Value,
                snapshot.Items.Select(item => new HandoverInspectedAsset(item.Id, item.Name,
                    item.ExpectedQuantity, item.ActualQuantity!.Value, item.Condition!, item.Notes)).ToArray(),
                latestEvidence);
        }
        catch (JsonException) { return null; }
    }
    public async Task<bool> InventoryHasIssuesAsync(Guid contractId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return false;
        var task = await db.Set<OperationalTask>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == Key($"contract-pre-move-in-inventory:{contractId:N}"), t);
        if (task?.Kind != OperationalTaskKind.MoveInInventory ||
            string.IsNullOrWhiteSpace(task.MoveInInventoryJson)) return false;
        try
        {
            var snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(task.MoveInInventoryJson);
            return snapshot?.Items.Any(i => i.Condition is "Missing" or "Damaged") == true;
        }
        catch (JsonException) { return false; }
    }

    public async Task ReopenMoveInInventoryAsync(Guid contractId, Guid actor,
        DateTimeOffset now, Guid[] selectedAssetIds, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var inventoryTask = await db.Set<OperationalTask>().SingleOrDefaultAsync(x =>
            x.Id == Key($"contract-pre-move-in-inventory:{contractId:N}") &&
            x.ContractId == contractId && x.Kind == OperationalTaskKind.MoveInInventory, t)
            ?? throw ContractException.Conflict("move_in_inventory_required");
        MoveInInventorySnapshot? source;
        try { source = JsonSerializer.Deserialize<MoveInInventorySnapshot>(inventoryTask.MoveInInventoryJson); }
        catch (JsonException) { throw ContractException.Conflict("move_in_inventory_required"); }
        if (inventoryTask.Status != MeterTaskStatus.Completed || !CompletedInventoryValid(source) ||
            selectedAssetIds.Length == 0 ||
            selectedAssetIds.Distinct().Count() != selectedAssetIds.Length ||
            selectedAssetIds.Any(id => source!.Items.All(item => item.Id != id)))
            throw ContractException.Conflict("move_in_inventory_required");
        // Domain ApplyAction disallows generic rework for MoveInInventory.
        // Owner-only handover reinspection supplies that explicit transition,
        // retaining the existing version, evidence and task history.
        inventoryTask.Status = MeterTaskStatus.InProgress;
        inventoryTask.CompletedAt = null;
        inventoryTask.Result = "Owner yêu cầu Staff kiểm kê lại tài sản đã chọn.";
        inventoryTask.MoveInInventoryJson = JsonSerializer.Serialize(source! with
        {
            ReinspectionItemIds = selectedAssetIds,
            ReinspectionRequestedAt = now
        });
        inventoryTask.Version++;
        db.Add(new OperationalTaskHistory
        {
            TaskId = inventoryTask.Id,
            ActorId = actor,
            Action = "MoveInInventoryReinspection",
            OccurredAt = now,
            TaskVersion = inventoryTask.Version
        });
    }
    public async Task SubmitMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await db.Set<OperationalTask>().SingleOrDefaultAsync(x => x.Id == Key($"contract-move-in:{contractId:N}"), t)
            ?? throw ContractException.Conflict("move_in_task_required");
        if (task.AssignedStaffUserId != actor || task.Status != MeterTaskStatus.InProgress)
            throw ContractException.Conflict("move_in_task_not_started");
        task.ApplyAction("submit", now, actor);
        task.Version++;
        task.Result = "Staff đã hoàn tất kiểm tra, chuyển biên bản cho Owner duyệt.";
        db.Add(new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInSubmitted", OccurredAt = now, TaskVersion = task.Version });
    }
    public async Task ReopenMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await db.Set<OperationalTask>().SingleOrDefaultAsync(x => x.Id == Key($"contract-move-in:{contractId:N}"), t)
            ?? throw ContractException.Conflict("move_in_task_required");
        if (task.Status != MeterTaskStatus.PendingVerification)
            throw ContractException.Conflict("move_in_task_not_submitted");
        task.ApplyAction("rework", now, actor);
        task.Version++;
        db.Add(new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInReinspection", OccurredAt = now, TaskVersion = task.Version });
    }
    public async Task CompleteMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await db.Set<OperationalTask>().SingleOrDefaultAsync(x => x.Id == Key($"contract-move-in:{contractId:N}"), t);
        if (task is null || task.Status == MeterTaskStatus.Completed) return;
        if (task.Status != MeterTaskStatus.PendingVerification) throw ContractException.Conflict("move_in_task_not_submitted");
        task.ApplyAction("verify", now, actor); task.Version++;
        task.Result = "Biên bản đã được Owner và Tenant ký điện tử.";
        db.Add(new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInCompleted", OccurredAt = now, TaskVersion = task.Version });
    }
    public async Task NotifyAsync(Contract c, string action, Guid actor, int version, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        // Existing persistent notifications are committed with the workflow; external delivery is independent.
        var taskId = Key($"contract-move-in:{c.Id:N}");
        var recipients = await tasks.OwnersAsync(t);
        if (inbox is not null)
        {
            var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
            var staff = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
            foreach (var party in recipients.Select(owner => ((Guid?)owner, Roles.Owner)).Concat(new[] { (c.TenantUserId, Roles.Tenant), (staff?.StaffUserId, Roles.Staff) }).Where(p => p.Item1 is not null && p.Item1 != actor).Distinct())
                await inbox.Emit(party.Item1!.Value, party.Item2, c.Room.LocationId, $"handover:{c.Id:N}:{version}:{action}:{party.Item1:N}", "HANDOVER_UPDATED", "Contract",
                    "Bàn giao có cập nhật", "Mở hợp đồng để xem phiên bản và thao tác đang chờ xử lý.", "Contract", c.Id, t);
        }
        if (!await db.Set<OperationalTask>().AnyAsync(x => x.Id == taskId, t)) return;
        foreach (var recipient in recipients.Concat(c.TenantUserId is { } tenant ? new[] { tenant } : []).Where(r => r != actor).Distinct())
        {
            var id = Key($"handover-notice:{c.Id:N}:{version}:{action}:{recipient:N}");
            if (!await db.Set<OperationalTaskNotification>().AnyAsync(n => n.Id == id, t))
                AddNotice(id, new OperationalTaskNotification
                {
                    TaskId = taskId,
                    EventId = Key($"handover-event:{c.Id:N}:{version}:{action}"),
                    RecipientUserId = recipient,
                    Event = action
                });
        }
    }
    private void AddNotice(Guid id, OperationalTaskNotification notice)
    { db.Entry(notice).Property(n => n.Id).CurrentValue = id; db.Add(notice); }
    public async Task<IReadOnlyList<AssetChangeParty>> ActivePartiesAsync(Guid roomId, CancellationToken t) =>
        await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == roomId && (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) && c.Status == ContractStatus.Active)
            .Select(c => new AssetChangeParty(c.Id, c.TenantUserId)).ToArrayAsync(t);
    public async Task<IReadOnlyList<AssetChangeSource>> ChangeSourcesAsync(Guid roomId, CancellationToken t)
    {
        var assetIds = db.Set<Asset>().Where(a => a.RoomId == roomId).Select(a => a.Id);
        var history = await db.Set<PropertyChange>().AsNoTracking().Where(h => h.TargetType == nameof(Asset) && assetIds.Contains(h.TargetId))
            .OrderByDescending(h => h.OccurredAt).Take(200).Select(h => new AssetChangeSource(h.Id, h.TargetId, h.Reason, null)).ToArrayAsync(t);
        var maintenance = await db.Set<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>().AsNoTracking()
            .Where(w => w.RoomId == roomId && w.Status == BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified && w.AssetId != null)
            .Select(w => new AssetChangeSource(w.Id, w.AssetId!.Value, w.Description, w.Id)).Take(200).ToArrayAsync(t);
        return maintenance.Concat(history).ToArray();
    }
    public Task<ContractHandover?> GetAsync(Guid id, CancellationToken t) => db.Set<ContractHandover>().SingleOrDefaultAsync(h => h.ContractId == id, t);
    public async Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t)
    {
        var assets = await db.Set<Asset>().AsNoTracking().Where(a => a.RoomId == roomId && a.Status != AssetStatus.Retired).OrderBy(a => a.Name).Take(201).ToArrayAsync(t);
        if (assets.Length > 200) throw new ContractException(503, "handover_inventory_limit");
        return assets;
    }
    public async Task<IReadOnlyList<HandoverReading>> ReadingsAsync(Guid contractId, Guid roomId, DateOnly startDate, CancellationToken t)
    {
        // Compact24 is the production path and must never recycle an older
        // tenant's initial/periodic photo. Legacy source-schema test fixtures
        // still validate their original room-based behavior independently.
        var contractScoped = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext;
        return await (
            from r in db.Set<MeterReading>().AsNoTracking()
            join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
            join meter in db.Set<Meter>() on r.MeterId equals meter.Id
            join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
            where meter.RoomId == roomId && meter.IsActive && task.ReadingDate >= startDate &&
                task.Status == MeterTaskStatus.Completed && evidence.IsUploaded && evidence.IsLinked &&
                (contractScoped
                    ? task.ContractId == contractId && task.Purpose == ReadingPurpose.Initial
                    : task.Purpose == ReadingPurpose.Initial || task.Purpose == ReadingPurpose.Periodic)
            orderby task.ReadingDate descending
            select new HandoverReading(r.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, r.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash))
            .Take(100).ToArrayAsync(t);
    }
    public async Task<IReadOnlyList<ContractHandoverHistory>> HistoryAsync(Guid id, CancellationToken t) => await db.Set<ContractHandoverHistory>().AsNoTracking().Where(h => h.ContractId == id).OrderByDescending(h => h.OccurredAt).Take(100).ToArrayAsync(t);
    public Task<HandoverReading?> ReadingAsync(Guid roomId, Guid readingId, CancellationToken t) => (
        from reading in db.Set<MeterReading>().AsNoTracking()
        join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
        join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
        join evidence in db.Set<MeterEvidence>() on reading.EvidenceId equals evidence.Id
        where reading.Id == readingId && meter.RoomId == roomId && evidence.IsUploaded && evidence.IsLinked
        select new HandoverReading(reading.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, reading.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash)).SingleOrDefaultAsync(t);
    public Task<bool> HistoryContainsEvidenceAsync(Guid id, Guid fileId, CancellationToken t)
    {
        var fragment = JsonSerializer.Serialize(new { EvidenceIds = new[] { fileId } });
        return db.Set<ContractHandoverHistory>().AnyAsync(h => h.ContractId == id && EF.Functions.JsonContains(h.Snapshot, fragment), t);
    }
    public Task<string?> HistoryForReadingAsync(Guid id, Guid readingId, CancellationToken t) => db.Set<ContractHandoverHistory>().AsNoTracking()
        .Where(h => h.ContractId == id && (h.ElectricityReadingId == readingId || h.WaterReadingId == readingId)).OrderByDescending(h => h.OccurredAt).Select(h => h.Snapshot).FirstOrDefaultAsync(t);
}
