using BHome.Application.Common;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Domain.IdentityAccess;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.TenantContracts;
using BHome.Domain.StaffOperations;
using BHome.Domain.Locations;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactLocationAssignments(Compact24DbContext db, TimeProvider clock,
    ISetupWorkspaceStore? workspace = null) : ILocationAssignments, IStaffLocationAccess
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
        if (!await StaffEmploymentEligibility.IsEligibleAsync(db, staffId, start, token))
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
        var today = clock.BusinessToday();
        if (start <= today && end >= today)
            await ReconcileLocationAsync(locationId, entry, actor, entry.RecordedAt, "Location responsibility assigned", token);
        await NotifyAssignmentAsync(locationId, entry, "STAFF_ASSIGNMENT_CREATED", token);
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
        var today = clock.BusinessToday();
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
            if (!await StaffAvailableAsync(old.StaffUserId, start!.Value <= today ? today : start.Value, token)) return new(UpdateAssignmentPeriodStatus.StaffUnavailable);
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
        await NotifyAssignmentAsync(locationId, changed, cancelling ? "STAFF_ASSIGNMENT_CANCELLED" : "STAFF_ASSIGNMENT_UPDATED", token, version + 1);
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
        var today = clock.BusinessToday();
        if (effectiveFrom != today) return new(ChangeAssignmentStatus.Invalid);
        if (!await db.Users.AnyAsync(u => u.Id == actor && u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token))
            throw new UnauthorizedAccessException("Owner authorization is required.");
        if (nextStaff.HasValue && !active) return new(ChangeAssignmentStatus.Invalid);
        if (nextStaff is { } lockedStaff) await LockStaffAsync(lockedStaff, token);
        if (nextStaff is { } staff && !await StaffAvailableAsync(staff, today, token))
            return new(ChangeAssignmentStatus.StaffUnavailable);
        var assignments = (JsonSerializer.Deserialize<Assignment[]>(stored, Json) ?? throw new InvalidOperationException("Invalid assignment data.")).ToList();
        var current = assignments.SingleOrDefault(a => a.StartDate <= today && a.EndDate >= today);
        if (current is null) return new(ChangeAssignmentStatus.NoCurrentAssignment);
        if (nextStaff == current.StaffUserId) return new(ChangeAssignmentStatus.Invalid);
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
        await NotifyAssignmentAsync(locationId, current, "STAFF_ASSIGNMENT_REMOVED", token, version + 1);
        if (added is not null) await NotifyAssignmentAsync(locationId, added, "STAFF_ASSIGNMENT_CREATED", token, version + 1);
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
        var today = clock.BusinessToday();
        var next = active ? assignments.SingleOrDefault(a => a.StartDate <= today && today <= a.EndDate) : null;
        if (next is not null)
        {
            await LockStaffAsync(next.StaffUserId, token);
            if (!await StaffAvailableAsync(next.StaffUserId, today, token)) next = null;
        }
        var previous = assignments.Where(a => a.StartDate <= today && a.Id != next?.Id)
            .OrderByDescending(a => a.EndDate).FirstOrDefault();
        await ReconcileLocationAsync(locationId, next, Guid.Empty, now,
            "Effective Location responsibility changed", token, previous?.StaffUserId,
            effectiveAssignments: assignments);
        await tx.CommitAsync(token);
    }

    private sealed record ReconciledResponsibility(Guid? AssignmentId, Guid? StaffUserId, Guid EventId);

    private async Task ReconcileLocationAsync(Guid locationId, Assignment? next, Guid actor,
        DateTimeOffset now, string reason, CancellationToken token, Guid? previousStaff = null,
        bool blockSpecialists = false, Assignment[]? effectiveAssignments = null)
    {
        var tasks = await NativeAssignmentReconciliation.TasksAsync(db, locationId, token);
        var orders = await NativeAssignmentReconciliation.OrdersAsync(db, locationId, token);
        var inspections = await NativeAssignmentReconciliation.InspectionsAsync(db, locationId, token);
        // Manual removal still requires Owner resolution for unfinished AdHoc/meter work.
        // The automatically-created Location handover is different: it remains open and
        // Location-owned during a responsibility gap, ready for the next eligible Staff.
        if (next is null && blockSpecialists && (orders.Length > 0 || inspections.Length > 0))
            throw new BHome.Application.PropertyManagement.PropertyException(409, "staff_specialist_work_unresolved");
        if (next is null && blockSpecialists && tasks.Any(task => task.Kind != OperationalTaskKind.LocationAssetHandover &&
            !(task.Kind == OperationalTaskKind.MeterReading && task.Purpose == ReadingPurpose.Periodic)))
            throw new BHome.Application.PropertyManagement.PropertyException(409, "staff_operational_tasks_unresolved");

        var nextStaff = next?.StaffUserId;
        var nextAssignment = next?.Id;
        foreach (var task in tasks)
        {
            // A Location handover is Location-owned work, not an assignment-owned task.
            // With no current Staff, leave it open but inaccessible to Staff. When a new
            // responsibility becomes effective, transfer this same task and preserve its
            // checklist/evidence/history rather than cancelling it and creating another.
            if (task.Kind == OperationalTaskKind.LocationAssetHandover && nextAssignment is null)
                continue;
            if (task.AssignedStaffUserId == nextStaff && task.AssignmentId == nextAssignment) continue;

            if (task.Kind == OperationalTaskKind.LocationAssetHandover)
            {
                LocationAssetInventorySnapshot snapshot;
                try
                {
                    snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.LocationAssetInventoryJson, Json)
                        ?? throw new JsonException("Missing inventory snapshot.");
                }
                catch (JsonException)
                {
                    throw new InvalidOperationException("Cannot transfer a Location task with an invalid inventory snapshot.");
                }
                if (snapshot.AssignmentId != task.AssignmentId || snapshot.Items is null ||
                    snapshot.Items.Select(item => item.Id).Distinct().Count() != snapshot.Items.Length)
                    throw new InvalidOperationException("Cannot transfer a Location task with an inconsistent inventory snapshot.");

                var previousStaffForHandover = task.AssignedStaffUserId;
                var transferredItems = snapshot.Items.Select(item =>
                    item.Checked && !item.Inherited
                        ? item with
                        {
                            // Keep the original checker through repeated Staff replacements.
                            PriorStaffTaskId = item.PriorStaffTaskId ?? task.Id,
                            PriorStaffUserId = item.PriorStaffUserId ?? previousStaffForHandover
                        }
                        : item).ToArray();
                var transferredSnapshot = snapshot with
                {
                    AssignmentId = nextAssignment!.Value,
                    EffectiveFrom = next!.StartDate,
                    Items = transferredItems
                };
                // OperationalTaskService reads this embedded snapshot with default JSON
                // options; keep the same PascalCase wire shape as task creation/update.
                var snapshotJson = JsonSerializer.Serialize(transferredSnapshot);
                // A submitted result or an Owner-approved preview is bound to the old
                // assignment. Return it to InProgress so the successor explicitly reviews
                // and resubmits; the old submission/approval remains in append-only history.
                var nextStatus = task.Status == MeterTaskStatus.PendingVerification
                    ? MeterTaskStatus.InProgress : task.Status;
                var nextResult = task.Status == MeterTaskStatus.PendingVerification ? null : task.Result;
                var statusText = ((int)nextStatus).ToString(System.Globalization.CultureInfo.InvariantCulture);
                var handoverUpdateCount = await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE operational_tasks SET assigned_user_id={nextStaff}, assigned_at={now},
                        status={statusText}, version=version+1,
                        task_data=jsonb_set(task_data,ARRAY['state'],
                            COALESCE(task_data->'state',jsonb_build_object())||
                            jsonb_build_object('assignedStaffUserId',{nextStaff}::uuid,'assignmentId',{nextAssignment}::uuid,
                                'assignedAt',{now},'updatedAt',{now},'version',version+1,
                                'locationAssetInventoryJson',{snapshotJson},'status',{(int)nextStatus},'result',CAST({nextResult} AS text)),true)
                    WHERE id={task.Id} AND version={task.Version} AND status NOT IN ('2','3')
                    """, token);
                if (handoverUpdateCount != 1) throw new DbUpdateConcurrencyException("Location handover changed during responsibility transfer.");
                var handoverHistory = new OperationalTaskHistory
                {
                    TaskId = task.Id,
                    ActorId = actor,
                    Action = "responsibility_changed",
                    Note = reason,
                    OccurredAt = now,
                    WasOverdue = task.DueAt < now,
                    ResponsibleStaffUserId = nextStaff,
                    TaskVersion = task.Version + 1,
                    ChangesJson = JsonSerializer.Serialize(new
                    {
                        previousStaffUserId = previousStaffForHandover,
                        previousAssignmentId = task.AssignmentId,
                        newStaffUserId = nextStaff,
                        newAssignmentId = nextAssignment,
                        previousStatus = task.Status.ToString(),
                        status = nextStatus.ToString(),
                        preservedTaskId = task.Id,
                        checkedItems = transferredItems.Count(item => item.Checked),
                        reason
                    }, Json)
                };
                await NativeAssignmentReconciliation.TaskHistoryAsync(db, handoverHistory, token);
                await NativeAssignmentReconciliation.TaskNoticeAsync(db, new OperationalTaskNotification
                {
                    TaskId = task.Id,
                    RecipientUserId = nextStaff!.Value,
                    EventId = handoverHistory.Id,
                    Event = "responsibility_changed"
                }, token);
                continue;
            }

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
            await NativeAssignmentReconciliation.TaskHistoryAsync(db, history, token);
            if (next is not null) await NativeAssignmentReconciliation.TaskNoticeAsync(db, new OperationalTaskNotification { TaskId = task.Id, RecipientUserId = next.StaffUserId, EventId = history.Id, Event = "responsibility_changed" }, token);
        }
        foreach (var order in orders.Where(o => nextStaff.HasValue && o.AssignedStaffId != nextStaff))
        {
            var oldStaff = order.AssignedStaffId;
            var oldVersion = order.Version;
            order.AssignedStaffId = nextStaff!.Value; order.Version++;
            await NativeIncidentWrites.WriteAsync(db, order, false, oldVersion, token);
            await NativeIncidentWrites.WriteAsync(db, new IncidentActivity
            {
                IncidentId = order.IncidentId,
                WorkOrderId = order.Id,
                ActorId = actor,
                Action = "reassigned",
                Note = reason,
                OccurredAt = now,
                DataJson = JsonSerializer.Serialize(new { previous = oldStaff, assignedStaffId = nextStaff }, Json)
            }, true, null, token);
        }
        foreach (var inspection in inspections.Where(i => nextStaff.HasValue && i.InspectionStaffId != nextStaff))
        {
            await NativeAssignmentReconciliation.InspectionAsync(db, inspection, nextStaff!.Value, actor, now, reason, token);
        }
        if (next is not null)
            await LocationAssetInventoryTaskFactory.EnsureAsync(db, workspace, locationId, next.Id,
                next.StaffUserId, next.StartDate, actor == Guid.Empty ? next.ActorId : actor, now, token);
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
            // Scheduled rollover has no Owner request to emit an assignment email.
            // The same persisted reconciliation marker prevents duplicate notices on retries.
            if (actor == Guid.Empty && effectiveAssignments is not null)
            {
                var ended = previous?.AssignmentId is { } prior
                    ? effectiveAssignments.FirstOrDefault(a => a.Id == prior)
                    : null;
                if (ended is not null)
                    await NotifyAssignmentAsync(locationId, ended, "STAFF_ASSIGNMENT_ENDED", token,
                        reconciliationEventId: eventId);
                if (next is not null)
                    await NotifyAssignmentAsync(locationId, next, "STAFF_ASSIGNMENT_ACTIVATED", token,
                        reconciliationEventId: eventId);
            }
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

    // The notification and its EMAIL channel are persisted in the assignment transaction.
    // JOB-04 delivers after commit; provider failure cannot roll back a Staff assignment.
    // Category Account deliberately preserves access to this personal assignment notice
    // for future dates and after a Location's Staff access has been revoked.
    private async Task NotifyAssignmentAsync(Guid locationId, Assignment assignment, string eventType,
        CancellationToken token, int? locationVersion = null, Guid? reconciliationEventId = null)
    {
        var location = await db.Set<BHome.Domain.Locations.Location>().AsNoTracking().Where(l => l.Id == locationId)
            .Select(l => new { l.Name, l.Address }).SingleAsync(token);
        var staff = await db.Users.AsNoTracking().Where(u => u.Id == assignment.StaffUserId)
            .Select(u => new { u.Email, Name = EF.Property<string>(u, "full_name") }).SingleAsync(token);
        var action = eventType switch
        {
            "STAFF_ASSIGNMENT_CREATED" => "Bạn đã được phân công phụ trách cơ sở",
            "STAFF_ASSIGNMENT_UPDATED" => "Thời gian phân công cơ sở đã được cập nhật",
            "STAFF_ASSIGNMENT_CANCELLED" => "Phân công cơ sở sắp tới đã bị hủy",
            "STAFF_ASSIGNMENT_ACTIVATED" => "Phân công phụ trách cơ sở của bạn đã bắt đầu hiệu lực",
            "STAFF_ASSIGNMENT_ENDED" => "Trách nhiệm phụ trách cơ sở của bạn đã kết thúc",
            _ => "Bạn đã được thôi phân công phụ trách cơ sở"
        };
        var message = $"Xin chào {(string.IsNullOrWhiteSpace(staff.Name) ? "nhân viên" : staff.Name.Trim())},\n\n{action}.\n" +
            $"Cơ sở: {location.Name}\nĐịa chỉ: {location.Address}\n" +
            $"Vai trò: Nhân viên phụ trách cơ sở (Staff)\nEmail đăng nhập: {staff.Email}\n" +
            $"Thời gian phân công: {assignment.StartDate:dd/MM/yyyy} – {assignment.EndDate:dd/MM/yyyy}.";
        var discriminator = reconciliationEventId is { } transitionId ? transitionId.ToString("N") : locationVersion?.ToString() ?? "created";
        var key = $"staff-assignment-email:{assignment.Id:N}:{eventType}:{discriminator}";
        await new CompactNotificationWriter(db, clock).Emit(assignment.StaffUserId, Roles.Staff, locationId,
            key, eventType, "Account", action, message, "Account", assignment.StaffUserId, token,
            channels: ["IN_APP", "EMAIL"]);
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
        if (!await StaffAvailableAsync(staffId, date, token)) return [];
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
        var today = clock.BusinessToday();
        if (!await StaffAvailableAsync(staffId, today, token)) return false;
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
    private NpgsqlCommand Command(string sql) => db.CreateSqlCommand(sql);
    private async Task LockStaffAsync(Guid staff, CancellationToken t)
    {
        await using var command = Command("SELECT id FROM users WHERE id=@id FOR SHARE"); command.Parameters.AddWithValue("id", staff);
        await command.ExecuteScalarAsync(t);
    }
    private Task<bool> StaffAvailableAsync(Guid staff, DateOnly date, CancellationToken token) =>
        StaffEmploymentEligibility.IsEligibleAsync(db, staff, date, token);
}
