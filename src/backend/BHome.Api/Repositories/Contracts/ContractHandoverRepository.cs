using BHome.Application.Common;
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
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using BHome.Infrastructure.Ocr;
using Native = BHome.Domain.Entities;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractHandoverRepository(BHomePersistenceContext db, IOperationalTaskRepository tasks,
    CompactNotificationWriter? inbox = null, RoomInventoryReviewService? inventory = null, TimeProvider? clock = null,
    NativeContractSidecars? sidecars = null) : IContractHandoverRepository
{
    private Compact24DbContext NativeDb => (Compact24DbContext)db;
    private Task<OperationalTask?> FindTaskAsync(Guid id, CancellationToken t) => NativeHandoverTaskPersistence.FindAsync(NativeDb, id, t);
    private Task WriteTaskAsync(OperationalTask task, bool added, OperationalTaskHistory? history, CancellationToken t) =>
        NativeHandoverTaskPersistence.WriteAsync(NativeDb, task, added, history, t);
    private static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
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
        if (moveOut.ContractId != contract.Id || moveOut.Status is MoveOutStatus.Requested or MoveOutStatus.AwaitingConsent or MoveOutStatus.Rejected)
            throw ContractException.Conflict("move_out_not_approved");
        var id = ContractHandoverTaskIds.MoveOut(contract.Id);
        if (await FindTaskAsync(id, t) is not null) return;
        // A Location work item begins unclaimed. The first currently assigned Staff
        // member to start it becomes its worker under the Location transaction lock.
        var task = new OperationalTask(id)
        {
            Kind = OperationalTaskKind.AdHoc,
            RequiredLocationId = contract.Room.LocationId,
            ContractId = contract.Id,
            TargetRoomId = contract.RoomId,
            TargetLabel = contract.Room.RoomNumber,
            TaskTitle = $"Kiểm tra trả phòng {contract.Room.RoomNumber}",
            Requirements = "Kiểm tra hiện trạng phòng, tài sản, chìa khóa và quyền ra vào; có thể đính kèm ảnh, xác nhận chỉ số điện nước cuối kỳ và gửi kết quả cho Owner xem xét.",
            TaskPriority = OperationalTaskPriority.Normal,
            MeterStatus = MeterTaskStatus.Assigned,
            ReadingDate = moveOut.ProposedDate,
            EvidenceRequired = false
        };
        await WriteTaskAsync(task, true, new OperationalTaskHistory
        {
            TaskId = id,
            ActorId = actor,
            Action = "MoveOutCreated",
            OccurredAt = now,
            TaskVersion = task.Version,
            Note = "Chờ nhân viên cơ sở bắt đầu kiểm tra."
        }, t);
        foreach (var owner in await tasks.OwnersAsync(t))
            await AddNoticeAsync(Key($"move-out-notice:{id:N}:{owner:N}"), new OperationalTaskNotification
            {
                TaskId = id,
                RecipientUserId = owner,
                EventId = id,
                Event = "MoveOutAssigned"
            }, t);
    }
    private async Task<OperationalTask> MoveOutTaskAsync(Guid contractId, CancellationToken t) =>
        await FindTaskAsync(ContractHandoverTaskIds.MoveOut(contractId), t) is { Kind: OperationalTaskKind.AdHoc } task &&
            task.ContractId == contractId ? task : throw ContractException.Conflict("move_out_task_required");
    public async Task RequireMoveOutTaskStartedAsync(Guid contractId, Guid staffId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await MoveOutTaskAsync(contractId, t);
        if (task.MeterStatus != MeterTaskStatus.InProgress || task.AssignedStaffUserId != staffId)
            throw ContractException.Conflict("move_out_task_not_started");
    }
    public async Task EnsureMoveOutTaskAssigneeAsync(Guid contractId, Guid? staffId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await MoveOutTaskAsync(contractId, t);
        if (task.MeterStatus != MeterTaskStatus.Assigned && staffId is { } assignee &&
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
        await WriteTaskAsync(task, false, new OperationalTaskHistory
        {
            TaskId = task.Id,
            ActorId = staffId,
            Action = "MoveOutSubmitted",
            OccurredAt = now,
            TaskVersion = task.Version
        }, t);
    }
    public async Task ReviewMoveOutTaskAsync(Guid contractId, Guid ownerId, bool confirmed, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await MoveOutTaskAsync(contractId, t);
        if (task.MeterStatus != MeterTaskStatus.PendingVerification)
            throw ContractException.Conflict("move_out_task_not_submitted");
        task.ApplyAction(confirmed ? "verify" : "rework", now, ownerId); task.Version++;
        task.Result = confirmed ? "Owner đã xác nhận kết quả kiểm tra trả phòng." : "Owner yêu cầu Staff kiểm tra lại.";
        await WriteTaskAsync(task, false, new OperationalTaskHistory
        {
            TaskId = task.Id,
            ActorId = ownerId,
            Action = confirmed ? "MoveOutVerified" : "MoveOutReinspection",
            OccurredAt = now,
            TaskVersion = task.Version
        }, t);
    }
    public async Task SubmitForcedMoveOutTaskAsync(Guid contractId, Guid staffId, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        await RequireMoveOutTaskStartedAsync(contractId, staffId, t);
        var task = await MoveOutTaskAsync(contractId, t);
        task.MeterStatus = MeterTaskStatus.Completed;
        task.CompletedAt = now;
        task.Version++;
        task.Result = "Nhân viên đã lưu kết quả kiểm tra trả phòng bắt buộc. Chưa có quyết định tài chính.";
        await WriteTaskAsync(task, false, new OperationalTaskHistory
        {
            TaskId = task.Id,
            ActorId = staffId,
            Action = "ForcedMoveOutRecorded",
            OccurredAt = now,
            TaskVersion = task.Version
        }, t);
    }
    public async Task<HandoverMoveInTask?> MoveInTaskAsync(Guid contractId, Guid roomId,
        Guid? staffUserId, bool includeOwnerInventory, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return null;
        // Physical writes are visible within the enclosing transaction.
        var task = await FindTaskAsync(ContractHandoverTaskIds.MoveIn(contractId), t);
        if (task is null || task.ContractId != contractId || task.TargetRoomId != roomId || task.Kind != OperationalTaskKind.AdHoc) return null;
        // Expose the native task status, with a separate permission-safe
        // indication of whether this Staff actor may inspect at this moment.
        var isResponsibleStaff = staffUserId is not null && task.AssignedStaffUserId == staffUserId;
        // Only the authorized Owner or assigned Staff receives the operational
        // inventory-task reference in the contract draft. Tenant gets no ID.
        var inventoryTask = (isResponsibleStaff || includeOwnerInventory)
            ? await FindTaskAsync(Key($"contract-pre-move-in-inventory:{contractId:N}"), t)
            : null;
        if (inventoryTask is not null && (inventoryTask.Kind != OperationalTaskKind.MoveInInventory || inventoryTask.ContractId != contractId)) inventoryTask = null;
        return new HandoverMoveInTask(task.Id, task.MeterStatus.ToString(), task.Version,
            task.MeterStatus == MeterTaskStatus.InProgress && isResponsibleStaff,
            inventoryTask?.Id, inventoryTask?.MeterStatus.ToString());
    }
    public async Task EnsureMoveInTaskAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        if (c.Kind != ContractKind.Main || c.PreviousContractId is not null ||
            c.Status is ContractStatus.Cancelled or ContractStatus.Terminated or ContractStatus.Expired or ContractStatus.Superseded) return;
        if (!await PrepareRoomMoveInAsync(c, actor, now, t)) return;
        var id = ContractHandoverTaskIds.MoveIn(c.Id);
        var prior = await FindTaskAsync(id, t);
        if (prior?.MeterStatus == MeterTaskStatus.Completed) return;
        // Never replace a legacy confirmed baseline or a saved preparation.
        var json = JsonSerializer.Serialize(HandoverDraftState.Create(c, now), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET handover=jsonb_set(COALESCE(handover,jsonb_build_object()),
                ARRAY['preparation'],{json}::jsonb,true)
            WHERE id={c.Id} AND handover->'preparation' IS NULL AND handover->'current' IS NULL
            """, t);
        await EnsureInventoryTaskAsync(c, actor, now, t);
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var responsible = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
        await EnsureMeterBaselinesAsync(c, now, responsible, t);
        if (prior is not null) return;
        var task = new OperationalTask(id)
        {
            Kind = OperationalTaskKind.AdHoc,
            RequiredLocationId = c.Room.LocationId,
            ContractId = c.Id,
            TargetRoomId = c.RoomId,
            TargetLabel = c.Room.RoomNumber,
            TaskTitle = $"Bàn giao vào phòng {c.Room.RoomNumber}",
            Requirements = "Kiểm tra hiện trạng phòng, tài sản và chụp xác nhận chỉ số điện nước đầu kỳ. Staff gửi biên bản để Owner duyệt và ký; Tenant ký sau cùng.",
            AssignedStaffUserId = responsible?.StaffUserId,
            AssignmentId = responsible?.AssignmentId,
            AssignedAt = responsible is null ? null : now,
            EvidenceRequired = true,
            MeterStatus = MeterTaskStatus.Assigned,
            ReadingDate = c.StartDate
        };
        await WriteTaskAsync(task, true, new OperationalTaskHistory
        {
            TaskId = id,
            ActorId = actor,
            Action = "MoveInCreated",
            OccurredAt = now,
            TaskVersion = 1,
            ResponsibleStaffUserId = responsible?.StaffUserId,
            Note = responsible is null ? "AwaitingAssignment" : ""
        }, t);
        foreach (var recipient in (await tasks.OwnersAsync(t)).Concat(responsible is null ? [] : new[] { responsible.StaffUserId }).Distinct())
            await AddNoticeAsync(Key($"move-in-notice:{id:N}:{recipient:N}"), new OperationalTaskNotification
            {
                TaskId = id,
                RecipientUserId = recipient,
                EventId = id,
                Event = responsible is null ? "MoveInAwaitingAssignment" : "MoveInAssigned"
            }, t);
        if (inbox is not null)
            foreach (var party in new[] { (c.TenantUserId, Roles.Tenant), (responsible?.StaffUserId, Roles.Staff), ((Guid?)c.OwnerSignerId, Roles.Owner) }.Where(p => p.Item1 is not null).Distinct())
                await inbox.Emit(party.Item1!.Value, party.Item2, c.Room.LocationId, $"move-in:{c.Id:N}:{party.Item1:N}", "MOVE_IN_PENDING", "Contract",
                    "Bàn giao nhận phòng chưa hoàn tất",
                    c.Status == ContractStatus.Active
                        ? "Hợp đồng đã kích hoạt. Theo dõi kiểm tra và xác nhận bàn giao trong hợp đồng."
                        : "Biên bản bàn giao nháp đã được tạo. Có thể chuẩn bị kiểm kê và chụp chỉ số điện nước ban đầu; việc vào ở chính thức vẫn phụ thuộc các bước duyệt hợp đồng.",
                    "Contract", c.Id, t);
    }

    private const string DuplicateMoveInResult = "Nhiệm vụ trùng trong cùng chu kỳ thuê của phòng.";

    // Both callers execute under the existing Location advisory and Room row
    // locks. A renewal remains part of its original Main's physical occupancy.
    // Overlapping draft contracts also share a planned move-in. No historical
    // task belonging only to an ended tenancy is considered for a new cycle.
    private async Task<bool> PrepareRoomMoveInAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        var contracts = await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(x => x.RoomId == c.RoomId &&
            (x.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || x.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal))
            .Select(x => new { x.Id, x.PreviousContractId, Status = (ContractStatus)x.Status, x.StartDate, x.EndDate }).ToArrayAsync(t);
        var byId = contracts.ToDictionary(x => x.Id);
        Guid Root(Guid id)
        {
            var visited = new HashSet<Guid>();
            while (byId.TryGetValue(id, out var row) && row.PreviousContractId is { } parent)
            {
                if (!visited.Add(id)) throw ContractException.Conflict("contract_renewal_history_invalid");
                id = parent;
            }
            return id;
        }
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var occupiedRoots = contracts.Where(x => x.Id != c.Id && (x.Status is ContractStatus.Active or ContractStatus.Expired) &&
            (c.Status == ContractStatus.Active || c.StartDate <= today || x.StartDate <= c.EndDate && x.EndDate >= c.StartDate))
            .Select(x => Root(x.Id)).ToHashSet();
        if (c.Status == ContractStatus.Active) occupiedRoots.Add(c.Id);
        var cycleRoots = contracts.Where(x => x.Id != c.Id &&
                (x.Status is ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation) &&
                x.StartDate <= c.EndDate && x.EndDate >= c.StartDate)
            .Select(x => Root(x.Id)).Concat(occupiedRoots).Append(c.Id).Distinct().ToArray();
        var all = (await NativeHandoverTaskPersistence.ForContractsAsync(NativeDb, cycleRoots, t))
            .Where(x => x.Kind == OperationalTaskKind.MoveInInventory || x.Kind == OperationalTaskKind.MeterReading && x.Purpose == ReadingPurpose.Initial ||
                x.Kind == OperationalTaskKind.AdHoc && x.TargetRoomId == c.RoomId && x.TaskTitle.StartsWith("Bàn giao vào phòng")).ToArray();
        var main = all.Where(x => x.Kind == OperationalTaskKind.AdHoc && x.MeterStatus != MeterTaskStatus.Cancelled)
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).ToArray();
        var pristine = new HashSet<Guid>();
        foreach (var task in main)
        {
            var contractId = task.ContractId!.Value;
            if (await IsPristineMoveInAsync(contractId, all.Where(x => x.ContractId == contractId).ToArray(), t))
                pristine.Add(task.Id);
        }
        // Existing inspected/signed history wins; otherwise keep the first
        // task of an occupied contract, then the first planned task. If a
        // different pending draft won the race but has no progress, promote
        // the actual activated contract so its initial readings can be saved.
        var canonical = main.FirstOrDefault(x => !pristine.Contains(x.Id)) ??
            main.FirstOrDefault(x => occupiedRoots.Contains(x.ContractId!.Value)) ??
            (c.Status == ContractStatus.Active ? null : main.FirstOrDefault());
        var canonicalId = canonical?.ContractId ?? c.Id;
        var occupiedIds = occupiedRoots.ToArray();
        var historical = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM contracts WHERE id=ANY({occupiedIds})
                AND (handover->'current'->>'status')::int={(int)ContractHandoverStatus.Confirmed}
            """).ToArrayAsync(t);
        if ((canonical is null || pristine.Contains(canonical.Id)) && historical.Length != 0) canonicalId = historical.Order().First();
        foreach (var duplicate in main.Where(x => x.ContractId != canonicalId && pristine.Contains(x.Id)))
        {
            foreach (var child in all.Where(x => x.ContractId == duplicate.ContractId && x.MeterStatus == MeterTaskStatus.Assigned))
            {
                child.MeterStatus = MeterTaskStatus.Cancelled; child.Version++; child.Result = DuplicateMoveInResult;
                await WriteTaskAsync(child, false, new OperationalTaskHistory
                {
                    TaskId = child.Id,
                    ActorId = actor,
                    Action = "MoveInDuplicateCancelled",
                    TaskVersion = child.Version,
                    OccurredAt = now,
                    Note = DuplicateMoveInResult
                }, t);
            }
            await MarkMoveInSuppressedAsync(duplicate.ContractId!.Value, true, t);
        }
        var own = main.FirstOrDefault(x => x.ContractId == c.Id);
        if (own is null && await NativeHandoverTaskPersistence.HasCurrentAsync(NativeDb, c.Id, t))
            return false;
        // Never suppress existing work that already has observations/evidence,
        // even if it was created by the old per-contract generator.
        if (canonicalId != c.Id && (own is null || pristine.Contains(own.Id)))
        {
            await MarkMoveInSuppressedAsync(c.Id, true, t);
            return false;
        }
        await MarkMoveInSuppressedAsync(c.Id, false, t);
        if (historical.Contains(c.Id) && own is null) return false;
        // A pristine duplicate may later become the first actual occupant
        // after the earlier candidate was cancelled. Resume the same IDs and
        // preserve the cancellation in their history instead of inserting again.
        foreach (var child in all.Where(x => x.ContractId == c.Id && x.MeterStatus == MeterTaskStatus.Cancelled && x.Result == DuplicateMoveInResult))
        {
            child.MeterStatus = MeterTaskStatus.Assigned; child.Version++; child.Result = null;
            if (child.Kind == OperationalTaskKind.MeterReading && child.ReadingDate < today) child.ReadingDate = today;
            await WriteTaskAsync(child, false, new OperationalTaskHistory
            {
                TaskId = child.Id,
                ActorId = actor,
                Action = "MoveInDuplicateResumed",
                TaskVersion = child.Version,
                OccurredAt = now
            }, t);
        }
        return true;
    }

    private async Task<bool> IsPristineMoveInAsync(Guid contractId, OperationalTask[] related, CancellationToken t)
    {
        if (related.Any(x => x.MeterStatus != MeterTaskStatus.Assigned || x.CompletedAt != null || x.Result != null || x.OcrImageHash != null)) return false;
        var ids = related.Select(x => x.Id).ToArray();
        if (await NativeHandoverTaskPersistence.HasProgressAsync(NativeDb, ids, t) ||
            (await ContractDocumentPersistence.ListAsync(db, contractId, t)).Any(x =>
                x.Kind == ContractFileKind.HandoverEvidence || x.Kind == ContractFileKind.MoveInReport) ||
            await NativeHandoverTaskPersistence.HasCurrentAsync(NativeDb, contractId, t)) return false;
        return !await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts WHERE id={contractId}
                AND (COALESCE((handover->'preparation'->>'version')::integer,0)>1
                    OR handover->'preparation'->>'ownerSignature' IS NOT NULL)) AS "Value"
            """).SingleAsync(t);
    }

    private Task<int> MarkMoveInSuppressedAsync(Guid id, bool suppressed, CancellationToken t) => suppressed
        ? db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET handover=jsonb_set(COALESCE(handover,jsonb_build_object()),ARRAY['roomMoveInSuppressed'],'true'::jsonb,true)
            WHERE id={id}
            """, t)
        : db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET handover=COALESCE(handover,jsonb_build_object())-'roomMoveInSuppressed' WHERE id={id}
            """, t);

    // Repair missing capture checkpoints on older manually activated Main contracts
    // without creating a second Staff job, replacing physical meters, or reusing an
    // earlier Tenant's confirmed opening value. Called only by an authorized
    // in-progress MoveIn handover, under the same Location transaction lock.
    public async Task<Guid[]> EnsureMoveInMeterBaselinesAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            throw ContractException.Conflict("move_in_baselines_unavailable");
        var contract = await NativeContractSnapshot.LoadAsync(NativeDb, contractId, t);
        if (contract is null || contract.Kind != ContractKind.Main || contract.PreviousContractId != null ||
            contract.Status is ContractStatus.Cancelled or ContractStatus.Terminated or ContractStatus.Expired or ContractStatus.Superseded)
            throw ContractException.Conflict("main_move_in_handover_required");
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
        var meters = await db.Set<BHome.Domain.Billing.Meter>().AsNoTracking().Where(m => m.RoomId == c.RoomId && m.IsActive)
            .OrderBy(m => m.UtilityType).ThenBy(m => m.Id).ToArrayAsync(t);
        var ids = new List<Guid>(meters.Length);
        foreach (var meter in meters)
        {
            // Manual capture and historical imports may use a different task ID.
            // Reuse the same business key enforced by ux_task_source, including
            // completed checkpoints whose confirmed readings must be retained.
            var existing = (await NativeHandoverTaskPersistence.ForContractsAsync(NativeDb, [c.Id], t)).SingleOrDefault(x =>
                x.Kind == OperationalTaskKind.MeterReading && x.MeterId == meter.Id &&
                x.Purpose == ReadingPurpose.Initial && x.MeterStatus != MeterTaskStatus.Cancelled);
            if (existing is not null)
            {
                ids.Add(existing.Id);
                continue;
            }
            var meterTaskId = Key($"contract-meter-initial:{c.Id:N}:{meter.Id:N}");
            ids.Add(meterTaskId);
            if (await FindTaskAsync(meterTaskId, t) is not null) continue;
            var meterTask = new OperationalTask(meterTaskId)
            {
                Kind = OperationalTaskKind.MeterReading,
                RequiredLocationId = c.Room.LocationId,
                MeterId = meter.Id,
                ContractId = c.Id,
                TaskTitle = $"Chụp chỉ số {(meter.UtilityType == UtilityType.Electricity ? "điện" : "nước")} khi nhận phòng {c.Room.RoomNumber}",
                Requirements = "Chụp ảnh thực tế, đối chiếu và xác nhận chỉ số đầu kỳ cho hợp đồng nhận phòng này. Tiếp tục sử dụng công tơ hiện có, không tạo công tơ mới hay kế thừa chỉ số/ảnh của người thuê trước.",
                Purpose = ReadingPurpose.Initial,
                ReadingDate = new[] { c.StartDate, date, meter.InstalledOn }.Max(),
                AssignedStaffUserId = responsible?.StaffUserId,
                AssignmentId = responsible?.AssignmentId,
                AssignedAt = responsible is null ? null : now,
                EvidenceRequired = true,
                MeterStatus = MeterTaskStatus.Assigned
            };
            await WriteTaskAsync(meterTask, true, null, t);
        }
        return ids.ToArray();
    }

    private async Task EnsureInventoryTaskAsync(Contract c, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        var id = Key($"contract-pre-move-in-inventory:{c.Id:N}");
        if (await FindTaskAsync(id, t) is not null) return;
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
        var task = new OperationalTask(id)
        {
            Kind = OperationalTaskKind.MoveInInventory,
            RequiredLocationId = c.Room.LocationId,
            ContractId = c.Id,
            TargetRoomId = c.RoomId,
            TargetLabel = c.Room.RoomNumber,
            TaskTitle = $"Kiểm kê trước nhận phòng {c.Room.RoomNumber}",
            Requirements = "Kiểm tra từng nhóm tài sản trước khi Tenant nhận phòng. Nếu thiếu hoặc hỏng, gửi báo cáo BF-07 và liên kết sự cố trước khi hoàn thành.",
            AssignedStaffUserId = responsible?.StaffUserId,
            AssignmentId = responsible?.AssignmentId,
            AssignedAt = responsible is null ? null : now,
            DueAt = due,
            EvidenceRequired = false,
            MeterStatus = MeterTaskStatus.Assigned,
            ReadingDate = c.StartDate,
            MoveInInventoryJson = JsonSerializer.Serialize(new MoveInInventorySnapshot(source.StateToken, items))
        };
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
        await WriteTaskAsync(task, true, history, t);
        foreach (var owner in (await tasks.OwnersAsync(t)).Concat(responsible is null ? [] : [responsible.StaffUserId]).Distinct())
            await NativeAssignmentReconciliation.TaskNoticeAsync(NativeDb, new OperationalTaskNotification
            {
                TaskId = id,
                RecipientUserId = owner,
                EventId = history.Id,
                Event = responsible is null ? "MoveInInventoryAwaitingAssignment" : "MoveInInventoryAssigned"
            }, t);
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
        var task = await FindTaskAsync(Key($"contract-pre-move-in-inventory:{contractId:N}"), t);
        if (task is null) return true;
        if (task.Kind != OperationalTaskKind.MoveInInventory || task.MeterStatus != MeterTaskStatus.Completed)
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
            i.ActualQuantity > i.ExpectedQuantity);

    public async Task<HandoverCompletedInventory?> CompletedInventoryAsync(Guid contractId, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return null;
        // The completed task is the source of factual observations and its
        // original configuration token. A stale draft.inventoryToken is not
        // evidence of new configuration changes.
        var task = await FindTaskAsync(Key($"contract-pre-move-in-inventory:{contractId:N}"), t);
        if (task is null || task.ContractId != contractId || task.Kind != OperationalTaskKind.MoveInInventory ||
            task.MeterStatus != MeterTaskStatus.Completed) return null;
        try
        {
            var snapshot = JsonSerializer.Deserialize<MoveInInventorySnapshot>(task.MoveInInventoryJson);
            if (!CompletedInventoryValid(snapshot) || snapshot!.Items.Any(item =>
                item.Condition is not ("Good" or "Missing" or "Damaged")))
                return null;
            if (task.CompletedAt is null) return null;
            var evidenceIds = snapshot.Items.SelectMany(item => item.EvidenceIds ?? [])
                .Distinct().ToArray();
            var evidenceById = (await NativeOperationalTaskPersistence.EvidenceAsync(NativeDb, task.Id, t))
                .Where(file => evidenceIds.Contains(file.Id)).ToDictionary(file => file.Id, file => file.CreatedAt);
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
        var task = await FindTaskAsync(Key($"contract-pre-move-in-inventory:{contractId:N}"), t);
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
        var inventoryTask = await FindTaskAsync(Key($"contract-pre-move-in-inventory:{contractId:N}"), t);
        if (inventoryTask is null || inventoryTask.ContractId != contractId || inventoryTask.Kind != OperationalTaskKind.MoveInInventory)
            throw ContractException.Conflict("move_in_inventory_required");
        MoveInInventorySnapshot? source;
        try { source = JsonSerializer.Deserialize<MoveInInventorySnapshot>(inventoryTask.MoveInInventoryJson); }
        catch (JsonException) { throw ContractException.Conflict("move_in_inventory_required"); }
        if (inventoryTask.MeterStatus != MeterTaskStatus.Completed || !CompletedInventoryValid(source) ||
            selectedAssetIds.Length == 0 ||
            selectedAssetIds.Distinct().Count() != selectedAssetIds.Length ||
            selectedAssetIds.Any(id => source!.Items.All(item => item.Id != id)))
            throw ContractException.Conflict("move_in_inventory_required");
        // Domain ApplyAction disallows generic rework for MoveInInventory.
        // Owner-only handover reinspection supplies that explicit transition,
        // retaining the existing version, evidence and task history.
        inventoryTask.MeterStatus = MeterTaskStatus.InProgress;
        inventoryTask.CompletedAt = null;
        inventoryTask.Result = "Owner yêu cầu Staff kiểm kê lại tài sản đã chọn.";
        inventoryTask.MoveInInventoryJson = JsonSerializer.Serialize(source! with
        {
            ReinspectionItemIds = selectedAssetIds,
            ReinspectionRequestedAt = now
        });
        inventoryTask.Version++;
        await WriteTaskAsync(inventoryTask, false, new OperationalTaskHistory
        {
            TaskId = inventoryTask.Id,
            ActorId = actor,
            Action = "MoveInInventoryReinspection",
            OccurredAt = now,
            TaskVersion = inventoryTask.Version
        }, t);
    }
    private Task<OperationalTask?> FindMoveInTaskForUpdateAsync(Guid contractId, CancellationToken t) =>
        FindTaskAsync(ContractHandoverTaskIds.MoveIn(contractId), t);

    public async Task SubmitMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await FindMoveInTaskForUpdateAsync(contractId, t)
            ?? throw ContractException.Conflict("move_in_task_required");
        if (task.AssignedStaffUserId != actor || task.MeterStatus != MeterTaskStatus.InProgress)
            throw ContractException.Conflict("move_in_task_not_started");
        task.ApplyAction("submit", now, actor);
        task.Version++;
        task.Result = "Staff đã hoàn tất kiểm tra, chuyển biên bản cho Owner duyệt.";
        await WriteTaskAsync(task, false, new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInSubmitted", OccurredAt = now, TaskVersion = task.Version }, t);
    }
    public async Task ReopenMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await FindMoveInTaskForUpdateAsync(contractId, t)
            ?? throw ContractException.Conflict("move_in_task_required");
        if (task.MeterStatus != MeterTaskStatus.PendingVerification)
            throw ContractException.Conflict("move_in_task_not_submitted");
        task.ApplyAction("rework", now, actor);
        task.Version++;
        await WriteTaskAsync(task, false, new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInReinspection", OccurredAt = now, TaskVersion = task.Version }, t);
    }
    public async Task CompleteMoveInTaskAsync(Guid contractId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        var task = await FindMoveInTaskForUpdateAsync(contractId, t);
        if (task is null || task.MeterStatus == MeterTaskStatus.Completed) return;
        if (task.MeterStatus != MeterTaskStatus.PendingVerification) throw ContractException.Conflict("move_in_task_not_submitted");
        task.ApplyAction("verify", now, actor); task.Version++;
        task.Result = "Biên bản đã được Owner và Tenant ký điện tử.";
        await WriteTaskAsync(task, false, new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "MoveInCompleted", OccurredAt = now, TaskVersion = task.Version }, t);
    }
    public async Task NotifyAsync(Contract c, string action, Guid actor, int version, CancellationToken t)
    {
        if (db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext) return;
        // Existing persistent notifications are committed with the workflow; external delivery is independent.
        var taskId = ContractHandoverTaskIds.MoveIn(c.Id);
        var recipients = await tasks.OwnersAsync(t);
        if (inbox is not null)
        {
            var date = (clock ?? TimeProvider.System).BusinessToday();
            var staff = await tasks.ResponsibilityAsync(c.Room.LocationId, date, t);
            foreach (var party in recipients.Select(owner => ((Guid?)owner, Roles.Owner)).Concat(new[] { (c.TenantUserId, Roles.Tenant), (staff?.StaffUserId, Roles.Staff) }).Where(p => p.Item1 is not null && p.Item1 != actor).Distinct())
                await inbox.Emit(party.Item1!.Value, party.Item2, c.Room.LocationId, $"handover:{c.Id:N}:{version}:{action}:{party.Item1:N}", "HANDOVER_UPDATED", "Contract",
                    "Bàn giao có cập nhật", "Mở hợp đồng để xem phiên bản và thao tác đang chờ xử lý.", "Contract", c.Id, t);
        }
        if (await FindTaskAsync(taskId, t) is null) return;
        foreach (var recipient in recipients.Concat(c.TenantUserId is { } tenant ? new[] { tenant } : []).Where(r => r != actor).Distinct())
        {
            var id = Key($"handover-notice:{c.Id:N}:{version}:{action}:{recipient:N}");
            if (!await NativeDb.Set<Native.Notification>().AsNoTracking().AnyAsync(n => n.Id == id, t))
                await AddNoticeAsync(id, new OperationalTaskNotification
                {
                    TaskId = taskId,
                    EventId = Key($"handover-event:{c.Id:N}:{version}:{action}"),
                    RecipientUserId = recipient,
                    Event = action
                }, t);
        }
    }
    private Task AddNoticeAsync(Guid id, OperationalTaskNotification notice, CancellationToken t)
    {
        var value = OperationalTaskNotification.Rehydrate(id);
        value.TaskId = notice.TaskId; value.RecipientUserId = notice.RecipientUserId; value.EventId = notice.EventId; value.Event = notice.Event;
        return NativeAssignmentReconciliation.TaskNoticeAsync(NativeDb, value, t);
    }
    public async Task<IReadOnlyList<AssetChangeParty>> ActivePartiesAsync(Guid roomId, CancellationToken t) =>
        db is Compact24DbContext compact
        ? await compact.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.RoomId == roomId && (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal) && c.Status == ContractStatus.Active)
            .Select(c => new AssetChangeParty(c.Id, c.TenantUserId)).ToArrayAsync(t)
        : await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == roomId && (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) && c.Status == ContractStatus.Active)
            .Select(c => new AssetChangeParty(c.Id, c.TenantUserId)).ToArrayAsync(t);
    public async Task<IReadOnlyList<AssetChangeSource>> ChangeSourcesAsync(Guid roomId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var nativeHistory = await compact.Database.SqlQuery<AssetChangeSource>($"""
                SELECT n.id AS "Id",n.related_entity_id AS "AssetId",COALESCE(n.event_data->'state'->>'reason','') AS "Label",
                    NULL::uuid AS "WorkOrderId"
                FROM notifications n JOIN assets a ON a.id=n.related_entity_id
                WHERE n.record_kind='AUDIT' AND n.event_data->>'recordType'='PropertyChange'
                    AND n.related_entity_type='Asset' AND a.room_id={roomId}
                ORDER BY n.event_at DESC LIMIT 200
                """).ToArrayAsync(t);
            var nativeOrders = (await compact.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking()
                .Where(w => w.RoomId == roomId && w.TaskType == "WORK_ORDER" && w.Status == "Verified" && w.AssetId != null)
                .Take(200).ToArrayAsync(t)).Select(NativeIncidentSession.Read)
                .Select(w => new AssetChangeSource(w.Id, w.AssetId!.Value, w.Description, w.Id));
            return nativeOrders.Concat(nativeHistory).ToArray();
        }
        var assetIds = db.Set<Asset>().Where(a => a.RoomId == roomId).Select(a => a.Id);
        var history = await db.Set<PropertyChange>().AsNoTracking().Where(h => h.TargetType == nameof(Asset) && assetIds.Contains(h.TargetId))
            .OrderByDescending(h => h.OccurredAt).Take(200).Select(h => new AssetChangeSource(h.Id, h.TargetId, h.Reason, null)).ToArrayAsync(t);
        var maintenance = await db.Set<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>().AsNoTracking()
            .Where(w => w.RoomId == roomId && w.Status == BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified && w.AssetId != null)
            .Select(w => new AssetChangeSource(w.Id, w.AssetId!.Value, w.Description, w.Id)).Take(200).ToArrayAsync(t);
        return maintenance.Concat(history).ToArray();
    }
    public Task<ContractHandover?> GetAsync(Guid id, CancellationToken t) =>
        sidecars?.Active == true ? sidecars.HandoverAsync(id, t) :
        db is Compact24DbContext compact ? NativeContractMoveOutPersistence.HandoverAsync(compact, id, t)
        : db.Set<ContractHandover>().SingleOrDefaultAsync(h => h.ContractId == id, t);
    public async Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t)
    {
        var assets = db is Compact24DbContext compact
            ? (await compact.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking().Where(a => a.RoomId == roomId && a.Status != AssetStatus.Retired).OrderBy(a => a.Name).Take(201).ToArrayAsync(t)).Select(NativeAssetPersistence.Read).ToArray()
            : await db.Set<Asset>().AsNoTracking().Where(a => a.RoomId == roomId && a.Status != AssetStatus.Retired).OrderBy(a => a.Name).Take(201).ToArrayAsync(t);
        if (assets.Length > 200) throw new ContractException(503, "handover_inventory_limit");
        return assets;
    }
    public async Task<IReadOnlyList<HandoverReading>> ReadingsAsync(Guid contractId, Guid roomId, DateOnly startDate, CancellationToken t)
    {
        // Compact24 is the production path and must never recycle an older
        // tenant's initial/periodic photo. Legacy source-schema test fixtures
        // still validate their original room-based behavior independently.
        if (db is Compact24DbContext compact) return await NativeHandoverTaskPersistence.ReadingsAsync(compact, contractId, roomId, startDate, t);
        return await (
            from r in db.Set<MeterReading>().AsNoTracking()
            join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
            join meter in db.Set<Meter>() on r.MeterId equals meter.Id
            join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
            where meter.RoomId == roomId && meter.IsActive && task.ReadingDate >= startDate &&
                task.MeterStatus == MeterTaskStatus.Completed && evidence.IsUploaded && evidence.IsLinked &&
                (task.Purpose == ReadingPurpose.Initial || task.Purpose == ReadingPurpose.Periodic)
            orderby task.ReadingDate descending
            select new HandoverReading(r.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, r.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash))
            .Take(100).ToArrayAsync(t);
    }
    public async Task<IReadOnlyList<ContractHandoverHistory>> HistoryAsync(Guid id, CancellationToken t) =>
        db is Compact24DbContext compact ? await NativeHandoverTaskPersistence.HistoryAsync(compact, id, t)
        : await db.Set<ContractHandoverHistory>().AsNoTracking().Where(h => h.ContractId == id).OrderByDescending(h => h.OccurredAt).Take(100).ToArrayAsync(t);
    public Task<HandoverReading?> ReadingAsync(Guid roomId, Guid readingId, CancellationToken t) => db is Compact24DbContext compact
        ? NativeHandoverTaskPersistence.ReadingAsync(compact, roomId, readingId, t)
        : (
        from reading in db.Set<MeterReading>().AsNoTracking()
        join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
        join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
        join evidence in db.Set<MeterEvidence>() on reading.EvidenceId equals evidence.Id
        where reading.Id == readingId && meter.RoomId == roomId && evidence.IsUploaded && evidence.IsLinked
        select new HandoverReading(reading.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, reading.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash)).SingleOrDefaultAsync(t);
    public Task<bool> HistoryContainsEvidenceAsync(Guid id, Guid fileId, CancellationToken t)
    {
        var fragment = JsonSerializer.Serialize(new { EvidenceIds = new[] { fileId } });
        if (db is Compact24DbContext compact)
            return compact.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                    WHERE c.id={id} AND h->>'recordType'='ContractHandoverHistory' AND COALESCE(h->>'deleted','false')<>'true'
                    AND (h->'state'->>'snapshot')::jsonb @> CAST({fragment} AS jsonb)) AS "Value"
                """).SingleAsync(t);
        return db.Set<ContractHandoverHistory>().AnyAsync(h => h.ContractId == id && EF.Functions.JsonContains(h.Snapshot, fragment), t);
    }
    public Task<string?> HistoryForReadingAsync(Guid id, Guid readingId, CancellationToken t) => db is Compact24DbContext compact
        ? compact.Database.SqlQuery<string>($"""
            SELECT h->'state'->>'snapshot' AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE c.id={id} AND h->>'recordType'='ContractHandoverHistory' AND COALESCE(h->>'deleted','false')<>'true'
                AND (h->'state'->>'electricityReadingId'={readingId.ToString()} OR h->'state'->>'waterReadingId'={readingId.ToString()})
            ORDER BY (h->'state'->>'occurredAt')::timestamptz DESC LIMIT 1
            """).FirstOrDefaultAsync(t)
        : db.Set<ContractHandoverHistory>().AsNoTracking()
        .Where(h => h.ContractId == id && (h.ElectricityReadingId == readingId || h.WaterReadingId == readingId)).OrderByDescending(h => h.OccurredAt).Select(h => h.Snapshot).FirstOrDefaultAsync(t);
}
