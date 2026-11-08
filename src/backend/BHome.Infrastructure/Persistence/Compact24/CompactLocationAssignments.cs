using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.TenantContracts;
using BHome.Domain.StaffOperations;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactLocationAssignments(Compact24DbContext db, TimeProvider clock) : ILocationAssignments, IStaffLocationAccess
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Assignment(Guid Id, Guid StaffUserId, Guid ActorId, DateTimeOffset RecordedAt, DateOnly StartDate, DateOnly EndDate);

    public async Task<CreateAssignmentResult> CreateAssignmentAsync(Guid actor, Guid locationId, Guid staffId, DateOnly start, DateOnly end, CancellationToken token)
    {
        if (actor == Guid.Empty || locationId == Guid.Empty || staffId == Guid.Empty || start > end) return new(CreateAssignmentStatus.InvalidDateRange);
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", token);
        await db.Database.OpenConnectionAsync(token);
        await using var select = Command("SELECT staff_assignments::text FROM locations WHERE id=@id FOR UPDATE");
        select.Parameters.AddWithValue("id", locationId);
        var stored = (string?)await select.ExecuteScalarAsync(token);
        if (stored is null) return new(CreateAssignmentStatus.LocationNotFound);
        var owner = await db.Users.AnyAsync(u => u.Id == actor && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token);
        if (!owner) throw new UnauthorizedAccessException("Owner authorization is required.");
        await LockStaffAsync(staffId, token);
        if (!await db.Users.AnyAsync(u => u.Id == staffId && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Staff), token))
            return new(CreateAssignmentStatus.StaffUnavailable);
        var assignments = JsonSerializer.Deserialize<Assignment[]>(stored, Json) ?? throw new InvalidOperationException("Invalid assignment data.");
        if (assignments.Any(a => a.Id == Guid.Empty || a.StaffUserId == Guid.Empty || a.StartDate > a.EndDate))
            throw new InvalidOperationException("Invalid assignment data.");
        if (assignments.Any(a => a.StartDate <= end && start <= a.EndDate)) return new(CreateAssignmentStatus.DateRangeOverlaps);
        var entry = new Assignment(Guid.NewGuid(), staffId, actor, clock.GetUtcNow(), start, end);
        var json = JsonSerializer.Serialize(new[] { entry }, Json);
        var history = JsonSerializer.Serialize(new[] { new { action = "StaffAssigned", actorId = actor, occurredAt = entry.RecordedAt, assignmentId = entry.Id } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET staff_assignments=staff_assignments||CAST({json} AS jsonb),version=version+1,history=history||CAST({history} AS jsonb) WHERE id={locationId}
            """, token);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        if (start <= today && end >= today) await ReassignOpenTasks(locationId, Guid.Empty, entry, actor, entry.RecordedAt, "Location responsibility assigned", token);
        await tx.CommitAsync(token);
        return new(CreateAssignmentStatus.Created, new(entry.Id, entry.StaffUserId, entry.StartDate, entry.EndDate));
    }

    public async Task<IReadOnlyList<StaffAssignmentSummary>?> ListAssignmentsAsync(Guid locationId, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("SELECT staff_assignments::text FROM locations WHERE id=@id"); query.Parameters.AddWithValue("id", locationId);
        var value = (string?)await query.ExecuteScalarAsync(token);
        return value is null ? null : (JsonSerializer.Deserialize<Assignment[]>(value, Json) ?? throw new InvalidOperationException("Invalid assignment data."))
            .OrderByDescending(a => a.StartDate).ThenBy(a => a.Id).Select(a => new StaffAssignmentSummary(a.Id, a.StaffUserId, a.StartDate, a.EndDate)).ToArray();
    }

    public Task<ChangeAssignmentResult> ReplaceAssignmentAsync(Guid actorId, Guid locationId, Guid staffUserId,
        DateOnly effectiveFrom, int expectedLocationVersion, string reason, CancellationToken token) =>
        ChangeAsync(actorId, locationId, staffUserId, effectiveFrom, expectedLocationVersion, reason, token);

    public Task<ChangeAssignmentResult> RemoveAssignmentAsync(Guid actorId, Guid locationId, DateOnly effectiveFrom,
        int expectedLocationVersion, string reason, CancellationToken token) =>
        ChangeAsync(actorId, locationId, null, effectiveFrom, expectedLocationVersion, reason, token);

    private async Task<ChangeAssignmentResult> ChangeAsync(Guid actor, Guid locationId, Guid? nextStaff,
        DateOnly effectiveFrom, int expectedVersion, string reason, CancellationToken token)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(),
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
        if (actor == Guid.Empty || locationId == Guid.Empty || expectedVersion < 1 || effectiveFrom != today ||
            string.IsNullOrWhiteSpace(reason) || nextStaff == Guid.Empty) return new(ChangeAssignmentStatus.Invalid);
        await using var tx = await db.Database.BeginTransactionAsync(token); await db.Database.OpenConnectionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", token);
        await using var select = Command("SELECT staff_assignments::text,version FROM locations WHERE id=@id FOR UPDATE");
        select.Parameters.AddWithValue("id", locationId); string stored; int version;
        await using (var reader = await select.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token)) return new(ChangeAssignmentStatus.LocationNotFound);
            stored = reader.GetString(0); version = reader.GetInt32(1);
        }
        if (version != expectedVersion) return new(ChangeAssignmentStatus.StaleVersion, LocationVersion: version);
        if (!await db.Users.AnyAsync(u => u.Id == actor && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token))
            throw new UnauthorizedAccessException("Owner authorization is required.");
        if (nextStaff is { } lockedStaff) await LockStaffAsync(lockedStaff, token);
        if (nextStaff is { } staff && !await db.Users.AnyAsync(u => u.Id == staff && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Staff), token))
            return new(ChangeAssignmentStatus.StaffUnavailable);
        var assignments = (JsonSerializer.Deserialize<Assignment[]>(stored, Json) ?? throw new InvalidOperationException("Invalid assignment data.")).ToList();
        var current = assignments.SingleOrDefault(a => a.StartDate <= today && a.EndDate >= today);
        if (current is null) return new(ChangeAssignmentStatus.NoCurrentAssignment);
        assignments.Remove(current);
        if (current.StartDate < effectiveFrom) assignments.Add(current with { EndDate = effectiveFrom.AddDays(-1) });
        var now = clock.GetUtcNow(); Assignment? added = null;
        if (nextStaff is { } replacement)
        {
            var future = assignments.Where(a => a.StartDate > effectiveFrom).Select(a => (DateOnly?)a.StartDate).Min();
            added = new(Guid.NewGuid(), replacement, actor, now, effectiveFrom, future?.AddDays(-1) ?? DateOnly.MaxValue);
            assignments.Add(added);
        }
        var json = JsonSerializer.Serialize(assignments.OrderBy(x => x.StartDate).ThenBy(x => x.Id), Json);
        var history = JsonSerializer.Serialize(new[] { new
        {
            action = nextStaff.HasValue ? "StaffReplaced" : "StaffUnassigned", actorId = actor, occurredAt = now,
            previousStaffUserId = current.StaffUserId, staffUserId = nextStaff, reason = reason.Trim()
        } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET staff_assignments=CAST({json} AS jsonb),version=version+1,
              history=history||CAST({history} AS jsonb) WHERE id={locationId}
            """, token);
        await ReassignOpenTasks(locationId, current.StaffUserId, added, actor, now, reason.Trim(), token);
        await NotifyAssignmentChange(locationId, current.StaffUserId, nextStaff, actor, now, token);
        await tx.CommitAsync(token);
        return new(ChangeAssignmentStatus.Changed,
            added is null ? null : new(added.Id, added.StaffUserId, added.StartDate, added.EndDate), version + 1);
    }

    private async Task ReassignOpenTasks(Guid locationId, Guid oldStaff, Assignment? next, Guid actor,
        DateTimeOffset now, string reason, CancellationToken token)
    {
        var tasks = await db.Set<OperationalTask>().Where(task => task.LocationId == locationId &&
            (task.AssignedStaffUserId == oldStaff || task.AssignedStaffUserId == null) && task.Status != MeterTaskStatus.Completed && task.Status != MeterTaskStatus.Cancelled)
            .Select(task => new { task.Id, task.AssignedStaffUserId, task.Version }).ToArrayAsync(token);
        foreach (var task in tasks)
        {
            var history = new OperationalTaskHistory
            {
                TaskId = task.Id,
                ActorId = actor,
                Action = "responsibility_changed",
                Note = reason,
                OccurredAt = now,
                ResponsibleStaffUserId = next?.StaffUserId,
                TaskVersion = task.Version + 1,
                ChangesJson = JsonSerializer.Serialize(new { previous = task.AssignedStaffUserId, next = next?.StaffUserId }, Json)
            };
            db.Add(history);
            if (next is not null) db.Add(new OperationalTaskNotification { TaskId = task.Id, RecipientUserId = next.StaffUserId, EventId = history.Id, Event = "responsibility_changed" });
        }
        var orders = await db.Set<MaintenanceWorkOrder>().Where(w => w.LocationId == locationId && w.AssignedStaffId == oldStaff &&
            w.Status != WorkOrderStatus.Verified && w.Status != WorkOrderStatus.Cancelled).ToArrayAsync(token);
        var inspections = await db.Set<ContractMoveOut>().Where(m => m.InspectionStaffId == oldStaff &&
            m.Status != MoveOutStatus.Completed && m.InspectedAt == null &&
            db.Set<Contract>().Any(c => c.Id == m.ContractId && c.Room.LocationId == locationId)).ToArrayAsync(token);
        if (next is null && (orders.Length > 0 || inspections.Length > 0))
            throw new BHome.Application.PropertyManagement.PropertyException(409, "staff_specialist_work_unresolved");
        foreach (var order in orders)
        {
            order.AssignedStaffId = next!.StaffUserId; order.Version++;
            db.Add(new IncidentActivity
            {
                IncidentId = order.IncidentId,
                WorkOrderId = order.Id,
                ActorId = actor,
                Action = "reassigned",
                Note = reason,
                OccurredAt = now,
                DataJson = JsonSerializer.Serialize(new { previous = oldStaff, assignedStaffId = next.StaffUserId }, Json)
            });
        }
        foreach (var inspection in inspections)
        {
            inspection.InspectionStaffId = next!.StaffUserId; inspection.Version++;
            db.Add(new ContractMoveOutHistory
            {
                ContractId = inspection.ContractId,
                ActorId = actor,
                Action = "InspectionResponsibilityChanged",
                OccurredAt = now,
                Version = inspection.Version,
                Snapshot = JsonSerializer.Serialize(new { inspection.InspectionStaffId, inspection.Version }, Json)
            });
        }
        await using var command = Command("""
            UPDATE operational_tasks SET assigned_user_id=@next,assigned_at=CASE WHEN @next IS NULL THEN NULL ELSE @now END,
              version=version+1,
              task_data=jsonb_set(jsonb_set(jsonb_set(task_data,'{state,assignedStaffUserId}',COALESCE(to_jsonb(@next::uuid),'null'::jsonb),true),
                '{state,assignmentId}',COALESCE(to_jsonb(@assignment::uuid),'null'::jsonb),true),'{state,updatedAt}',to_jsonb(@now::timestamptz),true),
              history=history||jsonb_build_array(jsonb_build_object('action','assignment-replaced','actorId',@actor,
                'occurredAt',@now,'previousStaffUserId',@old,'staffUserId',@next,'reason',@reason))
            WHERE location_id=@location AND task_type IN ('GENERAL','METER_READ') AND (assigned_user_id=@old OR assigned_user_id IS NULL) AND status NOT IN ('2','3')
            """);
        command.Parameters.AddWithValue("location", locationId); command.Parameters.AddWithValue("old", oldStaff);
        command.Parameters.AddWithValue("actor", actor); command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("reason", reason);
        command.Parameters.Add(new NpgsqlParameter("next", NpgsqlTypes.NpgsqlDbType.Uuid)
        { Value = (object?)next?.StaffUserId ?? DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("assignment", NpgsqlTypes.NpgsqlDbType.Uuid)
        { Value = (object?)next?.Id ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(token);
        await db.SaveChangesAsync(token);
    }

    private async Task NotifyAssignmentChange(Guid locationId, Guid oldStaff, Guid? nextStaff, Guid actor,
        DateTimeOffset now, CancellationToken token)
    {
        foreach (var recipient in new Guid?[] { oldStaff, nextStaff }.Where(x => x.HasValue).Select(x => x!.Value).Distinct())
        {
            await using var command = Command("""
                INSERT INTO notifications(id,record_kind,recipient_user_id,actor_user_id,location_id,event_key,
                  notification_type,related_entity_type,related_entity_id,title,message,event_data,event_at,delivery_status,delivery_history)
                VALUES(@id,'INBOX',@recipient,@actor,@location,@key,'STAFF_ASSIGNMENT_CHANGED','Location',@location,
                  'Location assignment changed','Your Location responsibility has changed.',
                  jsonb_build_object('category','Task','audienceRole','Staff'),@now,'Unconfigured','[]')
                ON CONFLICT(recipient_user_id,event_key) WHERE record_kind='INBOX' DO NOTHING
                """);
            command.Parameters.AddWithValue("id", Guid.NewGuid()); command.Parameters.AddWithValue("recipient", recipient);
            command.Parameters.AddWithValue("actor", actor); command.Parameters.AddWithValue("location", locationId);
            command.Parameters.AddWithValue("key", $"staff-assignment:{locationId:N}:{now.UtcTicks}:{recipient:N}");
            command.Parameters.AddWithValue("now", now); await command.ExecuteNonQueryAsync(token);
        }
    }

    public async Task<IReadOnlyList<LocationSummary>> ListAssignedLocationsAsync(Guid staffId, DateOnly date, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("""
            SELECT l.id,l.name FROM locations l
            WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE
                (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@date AND (a->>'endDate')::date>=@date)
            ORDER BY l.name,l.id
            """);
        query.Parameters.AddWithValue("staff", staffId); query.Parameters.AddWithValue("date", date);
        var result = new List<LocationSummary>();
        await using var reader = await query.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) result.Add(new(reader.GetGuid(0), reader.GetString(1)));
        return result;
    }

    public async Task<bool> IsAssignedAsync(Guid staffId, Guid locationId, CancellationToken token)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("""
            SELECT EXISTS(SELECT 1 FROM locations l WHERE l.id=@location AND EXISTS(
              SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE
              (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@date AND (a->>'endDate')::date>=@date))
            """);
        query.Parameters.AddWithValue("staff", staffId); query.Parameters.AddWithValue("location", locationId); query.Parameters.AddWithValue("date", today);
        return (bool)(await query.ExecuteScalarAsync(token))!;
    }
    private NpgsqlCommand Command(string sql) => new(sql, (NpgsqlConnection)db.Database.GetDbConnection(),
        (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
    private async Task LockStaffAsync(Guid staff, CancellationToken t)
    {
        await using var command = Command("SELECT id FROM users WHERE id=@id FOR SHARE"); command.Parameters.AddWithValue("id", staff);
        await command.ExecuteScalarAsync(t);
    }
}
