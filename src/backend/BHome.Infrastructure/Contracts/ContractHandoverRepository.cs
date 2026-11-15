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
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractHandoverRepository(BHomePersistenceContext db, IOperationalTaskRepository tasks) : IContractHandoverRepository
{
    private static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
    public async Task EnsureMoveInTaskAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        var id = Key($"contract-move-in:{c.Id:N}");
        if (await db.Set<OperationalTask>().AnyAsync(x => x.Id == id, t)) return;
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var responsible = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc, LocationId = c.Room.LocationId, ContractId = c.Id,
            TargetRoomId = c.RoomId, TargetLabel = c.Room.RoomNumber,
            Title = $"Bàn giao vào phòng {c.Room.RoomNumber}", Requirements = "Kiểm tra tài sản, bằng chứng và chỉ số đã xác nhận; Tenant xác nhận trước khi Staff hoàn tất bàn giao.",
            AssignedStaffUserId = responsible?.StaffUserId, AssignmentId = responsible?.AssignmentId,
            AssignedAt = responsible is null ? null : now, EvidenceRequired = true,
            Status = MeterTaskStatus.Assigned, ReadingDate = c.StartDate
        };
        db.Entry(task).Property(x => x.Id).CurrentValue = id; db.Add(task);
        db.Add(new OperationalTaskHistory { TaskId = id, ActorId = actor, Action = "MoveInCreated", OccurredAt = now, TaskVersion = 1,
            ResponsibleStaffUserId = responsible?.StaffUserId, Note = responsible is null ? "AwaitingAssignment" : "" });
        foreach (var recipient in (await tasks.OwnersAsync(t)).Concat(responsible is null ? [] : new[] { responsible.StaffUserId }).Distinct())
            AddNotice(Key($"move-in-notice:{id:N}:{recipient:N}"), new OperationalTaskNotification { TaskId = id, RecipientUserId = recipient,
                EventId = id, Event = responsible is null ? "MoveInAwaitingAssignment" : "MoveInAssigned" });
    }
    public async Task CompleteMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        var task = await db.Set<OperationalTask>().SingleOrDefaultAsync(x => x.Id == Key($"contract-move-in:{contractId:N}"), t);
        if (task is null || task.Status == MeterTaskStatus.Completed) return;
        task.Status = MeterTaskStatus.Completed; task.CompletedAt = now; task.VerifiedAt = now; task.VerifiedByUserId = actor; task.Version++;
        task.Result = "Bàn giao đã được Tenant xác nhận và Staff hoàn tất.";
        db.Add(new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInCompleted", OccurredAt = now, TaskVersion = task.Version });
    }
    public async Task NotifyAsync(Contract c, string action, Guid actor, int version, CancellationToken t)
    {
        // Existing persistent notifications are committed with the workflow; external delivery is independent.
        var taskId = Key($"contract-move-in:{c.Id:N}");
        if (!await db.Set<OperationalTask>().AnyAsync(x => x.Id == taskId, t)) return;
        var recipients = await tasks.OwnersAsync(t);
        foreach (var recipient in recipients.Concat(c.TenantUserId is { } tenant ? new[] { tenant } : []).Where(r => r != actor).Distinct())
        {
            var id = Key($"handover-notice:{c.Id:N}:{version}:{action}:{recipient:N}");
            if (!await db.Set<OperationalTaskNotification>().AnyAsync(n => n.Id == id, t))
                AddNotice(id, new OperationalTaskNotification { TaskId = taskId, EventId = Key($"handover-event:{c.Id:N}:{version}:{action}"),
                    RecipientUserId = recipient, Event = action });
        }
    }
    private void AddNotice(Guid id, OperationalTaskNotification notice)
    { db.Entry(notice).Property(n => n.Id).CurrentValue = id; db.Add(notice); }
    public Task<ContractHandover?> GetAsync(Guid id, CancellationToken t) => db.Set<ContractHandover>().SingleOrDefaultAsync(h => h.ContractId == id, t);
    public async Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t)
    {
        var assets = await db.Set<Asset>().AsNoTracking().Where(a => a.RoomId == roomId && a.Status != AssetStatus.Retired).OrderBy(a => a.Name).Take(201).ToArrayAsync(t);
        if (assets.Length > 200) throw new ContractException(503, "handover_inventory_limit");
        return assets;
    }
    public async Task<IReadOnlyList<HandoverReading>> ReadingsAsync(Guid roomId, DateOnly startDate, CancellationToken t) => await (
        from r in db.Set<MeterReading>().AsNoTracking()
        join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
        join meter in db.Set<Meter>() on r.MeterId equals meter.Id
        join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
        where meter.RoomId == roomId && meter.IsActive && task.ReadingDate >= startDate && task.Status == MeterTaskStatus.Completed &&
            (task.Purpose == ReadingPurpose.Initial || task.Purpose == ReadingPurpose.Periodic) && evidence.IsUploaded && evidence.IsLinked
        orderby task.ReadingDate descending
        select new HandoverReading(r.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, r.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash))
        .Take(100).ToArrayAsync(t);
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
