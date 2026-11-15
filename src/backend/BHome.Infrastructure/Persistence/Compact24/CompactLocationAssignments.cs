using System.Text.Json;
using System.Text.Json.Serialization;
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
    private sealed record Assignment(Guid Id, Guid StaffUserId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] Guid ActorId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] DateTimeOffset RecordedAt,
        DateOnly StartDate, DateOnly EndDate)
    {
        // Existing Compact24 records may use createdByUserId/createdAt instead of
        // actorId/recordedAt. Preserve those and other persisted metadata on edits.
        [JsonExtensionData]
        public Dictionary<string, JsonElement>? AdditionalData { get; init; }
    }

    public async Task<CreateAssignmentResult> CreateAssignmentAsync(Guid actor, Guid locationId, Guid staffId, DateOnly start, DateOnly end, CancellationToken token)
    {
        if (actor == Guid.Empty || locationId == Guid.Empty || staffId == Guid.Empty || start > end) return new(CreateAssignmentStatus.InvalidDateRange);
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", token);
        await db.Database.OpenConnectionAsync(token);
        await using var select = Command("SELECT staff_assignments::text FROM locations WHERE id=@id AND is_active FOR UPDATE");
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
        if (start <= today && end >= today)
            await ReconcileLocationAsync(locationId, entry, actor, entry.RecordedAt, "Location responsibility assigned", token);
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

    public async Task<IReadOnlyList<StaffAssignmentDetail>> ListStaffAssignmentsAsync(Guid staffUserId, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("""
            SELECT l.id,l.name,a.data->>'id',(a.data->>'staffUserId')::uuid,
              (a.data->>'startDate')::date,(a.data->>'endDate')::date
            FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a(data)
            WHERE (a.data->>'staffUserId')::uuid=@staff
            ORDER BY (a.data->>'startDate')::date DESC,l.name,l.id
            """);
        query.Parameters.AddWithValue("staff", staffUserId);
        var result = new List<StaffAssignmentDetail>();
        await using var reader = await query.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
            result.Add(new(Guid.Parse(reader.GetString(2)), reader.GetGuid(3), reader.GetGuid(0),
                reader.GetString(1), DateOnly.FromDateTime(reader.GetDateTime(4)), DateOnly.FromDateTime(reader.GetDateTime(5))));
        return result;
    }

    public Task<ChangeAssignmentResult> ReplaceAssignmentAsync(Guid actorId, Guid locationId, Guid staffUserId,
        DateOnly effectiveFrom, int expectedLocationVersion, string reason, CancellationToken token) =>
        ChangeAsync(actorId, locationId, staffUserId, effectiveFrom, expectedLocationVersion, reason, token);

    public Task<ChangeAssignmentResult> RemoveAssignmentAsync(Guid actorId, Guid locationId, DateOnly effectiveFrom,
        int expectedLocationVersion, string reason, CancellationToken token) =>
        ChangeAsync(actorId, locationId, null, effectiveFrom, expectedLocationVersion, reason, token);

    public Task<UpdateAssignmentPeriodResult> UpdateAssignmentPeriodAsync(Guid actor, Guid assignmentId,
        DateOnly start, DateOnly end, int expectedVersion, string reason, CancellationToken token) =>
        AmendAssignmentAsync(actor, assignmentId, start, end, expectedVersion, reason, token);

    public Task<UpdateAssignmentPeriodResult> CancelFutureAssignmentAsync(Guid actor, Guid assignmentId,
        int expectedVersion, string reason, CancellationToken token) =>
        AmendAssignmentAsync(actor, assignmentId, null, null, expectedVersion, reason, token);

    private async Task<UpdateAssignmentPeriodResult> AmendAssignmentAsync(Guid actor, Guid assignmentId,
        DateOnly? start, DateOnly? end, int expectedVersion, string reason, CancellationToken token)
    {
        if (actor == Guid.Empty || assignmentId == Guid.Empty || start > end || expectedVersion < 1 ||
            string.IsNullOrWhiteSpace(reason)) return new(UpdateAssignmentPeriodStatus.Invalid);
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.OpenConnectionAsync(token);
        await using var find = Command("""
            SELECT id FROM locations
            WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(staff_assignments) a WHERE (a->>'id')::uuid=@assignment)
            """);
        find.Parameters.AddWithValue("assignment", assignmentId);
        if (await find.ExecuteScalarAsync(token) is not Guid locationId)
            return new(UpdateAssignmentPeriodStatus.AssignmentNotFound);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", token);
        await using var select = Command("SELECT staff_assignments::text,version,is_active FROM locations WHERE id=@id FOR UPDATE");
        select.Parameters.AddWithValue("id", locationId);
        string stored; int version; bool active;
        await using (var reader = await select.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token)) return new(UpdateAssignmentPeriodStatus.AssignmentNotFound);
            stored = reader.GetString(0); version = reader.GetInt32(1); active = reader.GetBoolean(2);
        }
        if (version != expectedVersion) return new(UpdateAssignmentPeriodStatus.StaleVersion, LocationVersion: version);
        if (!await db.Users.AnyAsync(u => u.Id == actor && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token))
            throw new UnauthorizedAccessException("Owner authorization is required.");
        var assignments = (JsonSerializer.Deserialize<Assignment[]>(stored, Json) ?? throw new InvalidOperationException("Invalid assignment data.")).ToList();
        var index = assignments.FindIndex(a => a.Id == assignmentId);
        if (index < 0) return new(UpdateAssignmentPeriodStatus.AssignmentNotFound);
        var old = assignments[index];
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
        var current = old.StartDate <= today && today <= old.EndDate;
        var cancelling = start is null;
        Assignment changed;
        if (cancelling)
        {
            if (old.StartDate <= today) return new(UpdateAssignmentPeriodStatus.Invalid);
            assignments.RemoveAt(index);
            changed = old;
        }
        else
        {
            if (!active || old.EndDate < today || end < today ||
                current && start != old.StartDate || !current && start < today)
                return new(UpdateAssignmentPeriodStatus.Invalid);
            await LockStaffAsync(old.StaffUserId, token);
            if (!await StaffAvailableAsync(old.StaffUserId, token)) return new(UpdateAssignmentPeriodStatus.StaffUnavailable);
            if (assignments.Any(a => a.Id != assignmentId && a.StartDate <= end && start <= a.EndDate))
                return new(UpdateAssignmentPeriodStatus.DateRangeOverlaps);
            changed = old with { StartDate = start!.Value, EndDate = end!.Value };
            assignments[index] = changed;
        }
        var json = JsonSerializer.Serialize(assignments.OrderBy(x => x.StartDate).ThenBy(x => x.Id), Json);
        var now = clock.GetUtcNow();
        var history = JsonSerializer.Serialize(new[] { new { action = cancelling ? "StaffAssignmentCancelled" : "StaffAssignmentPeriodChanged", actorId = actor,
            occurredAt = now, assignmentId, before = old, after = cancelling ? null : changed, reason = reason.Trim() } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET staff_assignments=CAST({json} AS jsonb),version=version+1,
              history=history||CAST({history} AS jsonb) WHERE id={locationId}
            """, token);
        if (!cancelling && changed.StartDate <= today && changed.EndDate >= today)
            await ReconcileLocationAsync(locationId, changed, actor, now, reason.Trim(), token);
        await tx.CommitAsync(token);
        return new(UpdateAssignmentPeriodStatus.Changed,
            new(changed.Id, changed.StaffUserId, changed.StartDate, changed.EndDate), version + 1);
    }

    private async Task<ChangeAssignmentResult> ChangeAsync(Guid actor, Guid locationId, Guid? nextStaff,
        DateOnly effectiveFrom, int expectedVersion, string reason, CancellationToken token)
    {
        if (actor == Guid.Empty || locationId == Guid.Empty || expectedVersion < 1 ||
            string.IsNullOrWhiteSpace(reason) || nextStaff == Guid.Empty) return new(ChangeAssignmentStatus.Invalid);
        await using var tx = await db.Database.BeginTransactionAsync(token); await db.Database.OpenConnectionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", token);
        await using var select = Command("SELECT staff_assignments::text,version,is_active FROM locations WHERE id=@id FOR UPDATE");
        select.Parameters.AddWithValue("id", locationId); string stored; int version; bool active;
        await using (var reader = await select.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token)) return new(ChangeAssignmentStatus.LocationNotFound);
            stored = reader.GetString(0); version = reader.GetInt32(1); active = reader.GetBoolean(2);
        }
        if (version != expectedVersion) return new(ChangeAssignmentStatus.StaleVersion, LocationVersion: version);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(),
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
        if (effectiveFrom != today) return new(ChangeAssignmentStatus.Invalid);
        if (!await db.Users.AnyAsync(u => u.Id == actor && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token))
            throw new UnauthorizedAccessException("Owner authorization is required.");
        if (nextStaff.HasValue && !active) return new(ChangeAssignmentStatus.Invalid);
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
            previousStaffUserId = current.StaffUserId, staffUserId = nextStaff, before = current, after = added, reason = reason.Trim()
        } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET staff_assignments=CAST({json} AS jsonb),version=version+1,
              history=history||CAST({history} AS jsonb) WHERE id={locationId}
            """, token);
        await ReconcileLocationAsync(locationId, added, actor, now, reason.Trim(), token, current.StaffUserId, blockSpecialists: true);
        await tx.CommitAsync(token);
        return new(ChangeAssignmentStatus.Changed,
            added is null ? null : new(added.Id, added.StaffUserId, added.StartDate, added.EndDate), version + 1);
    }

    // The scheduler and Owner mutations use the same Location lock and reconciliation.
    // Each Location commits independently so a failed Location can be safely retried.
    internal async Task ReconcileEffectiveAssignmentsAsync(CancellationToken token)
    {
        var locations = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM locations WHERE jsonb_array_length(staff_assignments)>0
                OR EXISTS(SELECT 1 FROM operational_tasks t WHERE t.location_id=locations.id
                    AND ((t.task_type IN ('GENERAL','METER_READ') AND t.status NOT IN ('2','3'))
                         OR (t.task_type='WORK_ORDER' AND t.status NOT IN ('Verified','Cancelled'))))
                OR EXISTS(SELECT 1 FROM contracts c JOIN rooms r ON r.id=c.room_id WHERE r.location_id=locations.id
                    AND c.move_out->'current'->>'inspectionStaffId' IS NOT NULL
                    AND c.move_out->'current'->>'inspectedAt' IS NULL
                    AND COALESCE(c.move_out->'current'->>'status','0')<>'5')
            ORDER BY id
            """).ToArrayAsync(token);
        Exception? failure = null;
        foreach (var locationId in locations)
        {
            try
            {
                await ReconcileEffectiveLocationAsync(locationId, token);
            }
            catch (Exception ex) when (!token.IsCancellationRequested)
            {
                // One broken Location must not prevent other Locations from rolling over.
                // Report failure to the durable job runner so the failed work is retried.
                failure ??= ex;
            }
            finally
            {
                db.ChangeTracker.Clear();
            }
        }
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private async Task ReconcileEffectiveLocationAsync(Guid locationId, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()},0))", token);
        await db.Database.OpenConnectionAsync(token);
        await using var select = Command("SELECT staff_assignments::text,is_active FROM locations WHERE id=@id FOR UPDATE");
        select.Parameters.AddWithValue("id", locationId);
        Assignment[] assignments;
        bool active;
        await using (var reader = await select.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token)) return;
            assignments = JsonSerializer.Deserialize<Assignment[]>(reader.GetString(0), Json)
                ?? throw new InvalidOperationException("Invalid assignment data.");
            active = reader.GetBoolean(1);
        }
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var next = active ? assignments.SingleOrDefault(a => a.StartDate <= today && today <= a.EndDate) : null;
        if (next is not null)
        {
            await LockStaffAsync(next.StaffUserId, token);
            if (!await StaffAvailableAsync(next.StaffUserId, token)) next = null;
        }
        var previous = assignments.Where(a => a.StartDate <= today && a.Id != next?.Id)
            .OrderByDescending(a => a.EndDate).FirstOrDefault();
        await ReconcileLocationAsync(locationId, next, Guid.Empty, now,
            "Effective Location responsibility changed", token, previous?.StaffUserId);
        await tx.CommitAsync(token);
    }

    private sealed record ReconciledResponsibility(Guid? AssignmentId, Guid? StaffUserId, Guid EventId);

    private async Task ReconcileLocationAsync(Guid locationId, Assignment? next, Guid actor,
        DateTimeOffset now, string reason, CancellationToken token, Guid? previousStaff = null, bool blockSpecialists = false)
    {
        var tasks = await db.Set<OperationalTask>().Where(task => task.LocationId == locationId &&
            task.Status != MeterTaskStatus.Completed && task.Status != MeterTaskStatus.Cancelled)
            .Select(task => new { task.Id, task.AssignedStaffUserId, task.AssignmentId, task.AssignedAt, task.DueAt, task.Version }).ToArrayAsync(token);
        var orders = await db.Set<MaintenanceWorkOrder>().Where(w => w.LocationId == locationId &&
            w.Status != WorkOrderStatus.Verified && w.Status != WorkOrderStatus.Cancelled).ToArrayAsync(token);
        var inspections = await db.Set<ContractMoveOut>().Where(m => m.InspectionStaffId != null &&
            m.Status != MoveOutStatus.Completed && m.InspectedAt == null &&
            db.Set<Contract>().Any(c => c.Id == m.ContractId && c.Room.LocationId == locationId)).ToArrayAsync(token);
        // Manual removal retains the existing explicit Owner resolution requirement.
        // A calendar expiry cannot be rejected: keep specialist records intact, alert Owner,
        // and transfer them when a new eligible responsibility becomes effective.
        if (next is null && blockSpecialists && (orders.Length > 0 || inspections.Length > 0))
            throw new BHome.Application.PropertyManagement.PropertyException(409, "staff_specialist_work_unresolved");

        var nextStaff = next?.StaffUserId;
        var nextAssignment = next?.Id;
        foreach (var task in tasks)
        {
            if (task.AssignedStaffUserId == nextStaff && task.AssignmentId == nextAssignment) continue;
            // Compact24 maps both the scalar columns and the state JSON to this row.
            // Mutate once, then append one typed history record (no second root write).
            var count = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE operational_tasks SET assigned_user_id={nextStaff},
                    assigned_at=CASE WHEN {nextStaff}::uuid IS NULL THEN NULL ELSE {now} END,
                    version=version+1,
                    task_data=jsonb_set(task_data,ARRAY['state'],COALESCE(task_data->'state',jsonb_build_object())||
                        jsonb_build_object('assignedStaffUserId',{nextStaff}::uuid,'assignmentId',{nextAssignment}::uuid,
                            'assignedAt',CASE WHEN {nextStaff}::uuid IS NULL THEN NULL ELSE {now} END,
                            'updatedAt',{now},'version',version+1),true)
                WHERE id={task.Id} AND version={task.Version} AND status NOT IN ('2','3')
                """, token);
            if (count != 1) throw new DbUpdateConcurrencyException("Operational task changed during responsibility reconciliation.");
            var history = new OperationalTaskHistory
            {
                TaskId = task.Id,
                ActorId = actor,
                Action = "responsibility_changed",
                Note = reason,
                OccurredAt = now,
                WasOverdue = task.DueAt < now,
                ResponsibleStaffUserId = nextStaff,
                TaskVersion = task.Version + 1,
                ChangesJson = JsonSerializer.Serialize(new { previous = task.AssignedStaffUserId, next = nextStaff, previousAssignmentId = task.AssignmentId, previousAssignedAt = task.AssignedAt, assignmentId = nextAssignment }, Json)
            };
            db.Add(history);
            if (next is not null) db.Add(new OperationalTaskNotification { TaskId = task.Id, RecipientUserId = next.StaffUserId, EventId = history.Id, Event = "responsibility_changed" });
        }
        foreach (var order in orders.Where(o => nextStaff.HasValue && o.AssignedStaffId != nextStaff))
        {
            var oldStaff = order.AssignedStaffId;
            order.AssignedStaffId = nextStaff!.Value; order.Version++;
            db.Add(new IncidentActivity
            {
                IncidentId = order.IncidentId,
                WorkOrderId = order.Id,
                ActorId = actor,
                Action = "reassigned",
                Note = reason,
                OccurredAt = now,
                DataJson = JsonSerializer.Serialize(new { previous = oldStaff, assignedStaffId = nextStaff }, Json)
            });
        }
        foreach (var inspection in inspections.Where(i => nextStaff.HasValue && i.InspectionStaffId != nextStaff))
        {
            var oldStaff = inspection.InspectionStaffId;
            inspection.InspectionStaffId = nextStaff; inspection.Version++;
            db.Add(new ContractMoveOutHistory
            {
                ContractId = inspection.ContractId,
                ActorId = actor,
                Action = "InspectionResponsibilityChanged",
                OccurredAt = now,
                Version = inspection.Version,
                Snapshot = JsonSerializer.Serialize(new { previous = oldStaff, inspection.InspectionStaffId, inspection.Version, reason }, Json)
            });
        }
        await db.SaveChangesAsync(token);
        await using var marker = Command("""
            SELECT h::text FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.history) WITH ORDINALITY a(h,n)
            WHERE l.id=@location AND h->>'action'='StaffResponsibilityReconciled' ORDER BY n DESC LIMIT 1
            """);
        marker.Parameters.AddWithValue("location", locationId);
        var saved = (string?)await marker.ExecuteScalarAsync(token);
        var previous = saved is null ? null : JsonSerializer.Deserialize<ReconciledResponsibility>(saved, Json);
        var transition = previous is null || previous.AssignmentId != nextAssignment || previous.StaffUserId != nextStaff;
        var eventId = transition ? Guid.NewGuid() : previous!.EventId;
        if (transition)
        {
            var history = JsonSerializer.Serialize(new[] { new { action = "StaffResponsibilityReconciled", actorId = actor,
                occurredAt = now, assignmentId = nextAssignment, staffUserId = nextStaff, eventId, reason } }, Json);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE locations SET history=history||CAST({history} AS jsonb) WHERE id={locationId}", token);
            foreach (var recipient in new Guid?[] { previous is null ? previousStaff : previous.StaffUserId, nextStaff }
                .Where(x => x.HasValue).Select(x => x!.Value).Distinct())
                await NotifyAsync(locationId, recipient, actor, eventId, "STAFF_ASSIGNMENT_CHANGED", "Staff",
                    "Phân công cơ sở đã thay đổi", "Trách nhiệm phụ trách cơ sở của bạn đã thay đổi.", now, token);
        }
        if (next is null && (tasks.Length > 0 || orders.Length > 0 || inspections.Length > 0))
        {
            var owners = await db.Users.Where(u => u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner))
                .Select(u => u.Id).ToArrayAsync(token);
            foreach (var owner in owners)
                await NotifyAsync(locationId, owner, actor, eventId, "STAFF_RESPONSIBILITY_UNRESOLVED", "Owner",
                    "Cơ sở chưa có nhân viên phụ trách",
                    "Cơ sở có công việc chưa hoàn tất. Hãy phân công nhân viên đủ điều kiện để tiếp tục xử lý.", now, token);
        }
    }

    private async Task NotifyAsync(Guid locationId, Guid recipient, Guid actor, Guid eventId,
        string type, string role, string title, string message, DateTimeOffset now, CancellationToken token)
    {
        var actorId = actor == Guid.Empty ? (Guid?)null : actor;
        var key = $"staff-assignment:{eventId:N}:{recipient:N}:{type}";
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,recipient_user_id,actor_user_id,location_id,event_key,
              notification_type,related_entity_type,related_entity_id,title,message,event_data,event_at,delivery_status,delivery_history)
            VALUES({Guid.NewGuid()},'INBOX',{recipient},{actorId},{locationId},{key},{type},'Location',{locationId},
              {title},{message},jsonb_build_object('category','Task','audienceRole',{role}),{now},'Unconfigured','[]')
            ON CONFLICT(recipient_user_id,event_key) WHERE record_kind='INBOX' DO NOTHING
            """, token);
    }

    public async Task<IReadOnlyList<LocationSummary>> ListAssignedLocationsAsync(Guid staffId, DateOnly date, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        await using var query = Command("""
            SELECT l.id,l.name FROM locations l
            WHERE l.is_active AND EXISTS(SELECT 1 FROM users u WHERE u.id=@staff AND u.is_active AND 'Staff'=ANY(u.roles))
              AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE
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
            SELECT EXISTS(SELECT 1 FROM locations l WHERE l.id=@location AND l.is_active
              AND EXISTS(SELECT 1 FROM users u WHERE u.id=@staff AND u.is_active AND 'Staff'=ANY(u.roles)) AND EXISTS(
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
    private Task<bool> StaffAvailableAsync(Guid staff, CancellationToken token) =>
        db.Users.AnyAsync(u => u.Id == staff && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Staff), token);
}
