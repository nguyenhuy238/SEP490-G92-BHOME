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
    public async Task<HandoverMoveInTask?> MoveInTaskAsync(Guid contractId, Guid roomId,
        Guid? staffUserId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return null;
        var task = await db.Set<OperationalTask>().AsNoTracking().SingleOrDefaultAsync(x =>
            x.Id == Key($"contract-move-in:{contractId:N}") && x.ContractId == contractId &&
            x.TargetRoomId == roomId && x.Kind == OperationalTaskKind.AdHoc, t);
        if (task is null) return null;
        // Expose the native task status, with a separate permission-safe
        // indication of whether this Staff actor may inspect at this moment.
        return new HandoverMoveInTask(task.Id, task.Status.ToString(), task.Version,
            task.Status == MeterTaskStatus.InProgress && staffUserId is not null &&
            task.AssignedStaffUserId == staffUserId);
    }
    public async Task EnsureMoveInTaskAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        await EnsureInventoryTaskAsync(c, actor, now, t);
        var id = Key($"contract-move-in:{c.Id:N}");
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var responsible = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
        // Every tenancy starts with its own photographed electricity/water baseline.
        // A physical meter may have confirmed readings from previous occupants, so
        // these tasks are keyed by Contract + Meter instead of Meter alone.
        var meters = await db.Set<Meter>().AsNoTracking().Where(m => m.RoomId == c.RoomId && m.IsActive)
            .OrderBy(m => m.UtilityType).ThenBy(m => m.Id).ToArrayAsync(t);
        foreach (var meter in meters)
        {
            var meterTaskId = Key($"contract-meter-initial:{c.Id:N}:{meter.Id:N}");
            if (await db.Set<OperationalTask>().AnyAsync(x => x.Id == meterTaskId, t)) continue;
            var meterTask = new OperationalTask
            {
                Kind = OperationalTaskKind.MeterReading,
                LocationId = c.Room.LocationId,
                MeterId = meter.Id,
                ContractId = c.Id,
                Title = $"Chụp chỉ số {(meter.UtilityType == UtilityType.Electricity ? "điện" : "nước")} khi nhận phòng {c.Room.RoomNumber}",
                Requirements = "Chụp ảnh công tơ thực tế và xác nhận chỉ số khởi tạo cho hợp đồng này, kể cả khi công tơ đã được dùng trước đó.",
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
        if (await db.Set<OperationalTask>().AnyAsync(x => x.Id == id, t)) return;
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = c.Room.LocationId,
            ContractId = c.Id,
            TargetRoomId = c.RoomId,
            TargetLabel = c.Room.RoomNumber,
            Title = $"Bàn giao vào phòng {c.Room.RoomNumber}",
            Requirements = "Kiểm tra tài sản và chụp xác nhận chỉ số điện, nước khởi tạo riêng cho hợp đồng; Tenant xác nhận trước khi Staff hoàn tất bàn giao.",
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
        if (snapshot?.Items is null || snapshot.Items.Any(i => i.Condition is null ||
            (i.Condition is "Missing" or "Damaged") && i.IncidentId is null))
            return false;
        var incidentIds = snapshot.Items.Where(i => i.Condition is "Missing" or "Damaged")
            .Select(i => i.IncidentId!.Value).Distinct().ToArray();
        return incidentIds.Length == 0 || await db.Set<IncidentReport>().AsNoTracking()
            .CountAsync(i => incidentIds.Contains(i.Id) && i.Status == IncidentStatus.Resolved, t) == incidentIds.Length;
    }
    public async Task CompleteMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await db.Set<OperationalTask>().SingleOrDefaultAsync(x => x.Id == Key($"contract-move-in:{contractId:N}"), t);
        if (task is null || task.Status == MeterTaskStatus.Completed) return;
        task.Status = MeterTaskStatus.Completed; task.CompletedAt = now; task.VerifiedAt = now; task.VerifiedByUserId = actor; task.Version++;
        task.Result = "Bàn giao đã được Tenant xác nhận và Staff hoàn tất.";
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
