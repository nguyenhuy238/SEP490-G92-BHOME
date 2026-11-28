using BHome.Application.Common;
using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Ocr;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;
namespace BHome.Infrastructure.Modules.Billing;

internal sealed partial class BillingAutomationEngine(BHomePersistenceContext db, IBillingAutomationSchedules schedules, TimeProvider clock, IInvoiceRepository invoiceRepository, IFixedChargeCoverage fixedCoverage,
    BHome.Application.PaymentsDebt.SePay.IPaymentCodeRegistry paymentCodes, BHome.Application.PaymentsDebt.SePay.SePayOptions sepay) : IBillingAutomationEngine
{
    private DateOnly Today => clock.BusinessToday();
    public Task<IReadOnlyList<BillingQueueView>> QueueAsync(Guid location, DateOnly period, CancellationToken t) => db is Compact24DbContext compact
        ? NativeBillingJobPersistence.QueueAsync(compact, location, period, t)
        : db.BillingQueueAsync(location, period, t);
    public async Task<IReadOnlyList<BillingAutomationAttempt>> AttemptsAsync(Guid location, DateOnly period, CancellationToken t) => db is Compact24DbContext compact
        ? await NativeBillingJobPersistence.AttemptsAsync(compact, location, period, t)
        : await (from a in db.Set<BillingAutomationAttempt>().AsNoTracking() join e in db.Set<BillingAutomationExecution>() on a.ExecutionId equals e.Id where e.LocationId == location && e.BillingPeriod == period orderby a.StartedAt descending select a).Take(100).ToArrayAsync(t);
    internal static DateTimeOffset DueAt(DateOnly date) => new(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(new TimeOnly(23, 59, 59)), TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")), TimeSpan.Zero);
    private Task<bool> ActiveRole(Guid actor, string role, CancellationToken t) => db is Compact24DbContext compact
        ? NativeBillingAutomationPersistence.ActiveRoleAsync(compact, actor, role, t)
        : (from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id == actor && u.IsActive && r.Name == role select u.Id).AnyAsync(t);
    public async Task<IReadOnlyList<BillingAutomationExecution>> ExecutionsAsync(Guid location, DateOnly period, CancellationToken t) => db is Compact24DbContext compact
        ? await NativeBillingJobPersistence.ExecutionsAsync(compact, location, period, t)
        : await db.Set<BillingAutomationExecution>().AsNoTracking().Where(e => e.LocationId == location && e.BillingPeriod == period).OrderByDescending(e => e.LastStartedAt).Take(100).ToArrayAsync(t);
    private async Task<bool> Eligible(BillingAutomationPlan p, DateOnly period, string phase, CancellationToken t)
    {
        var selected = await schedules.ForPeriodAsync(p.LocationId, period, t);
        return selected?.Id == p.Id && p.Enabled && (phase != "Final" || p.AuthorizeAutomaticFinalization) && await ActiveRole(p.AuthorizedByUserId, Roles.Owner, t) &&
            (db is Compact24DbContext compact ? await compact.Set<BHome.Domain.Locations.Location>().AnyAsync(l => l.Id == p.LocationId && l.IsActive, t) : await db.Locations.AnyAsync(l => l.Id == p.LocationId && l.IsActive, t))
            && Today >= ScheduledDate(p, period, phase);
    }
    internal static DateOnly ScheduledDate(BillingAutomationPlan p, DateOnly period, string phase) => phase switch
    { "Meter" => InvoiceMath.CalendarDate(period, p.MeterDay, 0), "Draft" => InvoiceMath.CalendarDate(period, BillingAutomationService.Calendar(p).DraftDay, BillingAutomationService.Calendar(p).DraftMonthOffset), "Final" => InvoiceMath.CalendarDate(period, BillingAutomationService.Calendar(p).FinalDay, BillingAutomationService.Calendar(p).FinalMonthOffset), _ => throw new InvoiceException(400, "invalid_billing_job_phase") };
    public async Task<BillingAutomationExecution?> ExecuteAsync(BillingJobInput x, string phase, CancellationToken t)
    {
        BillingAutomationService.ValidatePeriod(x.BillingPeriod);
        var native = db as Compact24DbContext;
        var p = (native is not null ? await NativeBillingAutomationPersistence.PlanAsync(native, x.PlanId, t)
            : await db.Set<BillingAutomationPlan>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == x.PlanId, t)) ?? throw new InvoiceException(404, "billing_automation_not_found");
        if (!await Eligible(p, x.BillingPeriod, phase, t)) return null;
        BillingAutomationExecution e; var token = Guid.NewGuid();
        await using (var tx = await db.Database.BeginTransactionAsync(t))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({p.Id + "/" + x.BillingPeriod + "/" + phase},0))", t);
            var previous = native is not null ? await NativeBillingJobPersistence.ExecutionAsync(native, p.Id, x.BillingPeriod, phase, t, locked: true)
                : await db.Set<BillingAutomationExecution>().SingleOrDefaultAsync(e => e.PlanId == p.Id && e.BillingPeriod == x.BillingPeriod && e.Phase == phase, t);
            e = previous ?? new() { PlanId = p.Id, LocationId = p.LocationId, BillingPeriod = x.BillingPeriod, Phase = phase };
            if (e.LockedUntil > clock.GetUtcNow()) return e;
            var previousToken = e.LockToken;
            if (e.Status == "Processing")
            {
                var attempt = new BillingAutomationAttempt { ExecutionId = e.Id, Sequence = e.Attempts, Status = "LeaseExpired", StartedAt = e.LastStartedAt, FinishedAt = clock.GetUtcNow() };
                if (native is not null) await NativeBillingJobPersistence.AppendAttemptAsync(native, attempt, t);
                else db.Add(attempt);
            }
            if (native is null && e.Attempts == 0) db.Add(e);
            e.Attempts++; e.Status = "Processing"; e.LastStartedAt = clock.GetUtcNow(); e.LockedUntil = clock.GetUtcNow().AddMinutes(2); e.LockToken = token; e.LastErrorCode = null;
            if (native is not null) await NativeBillingJobPersistence.SaveAsync(native, e, previous is null, previousToken, t);
            else await db.SaveChangesAsync(t);
            await tx.CommitAsync(t);
        }
        var sequence = e.Attempts; var started = e.LastStartedAt; var errors = new List<object>(); var existing = 0;
        try
        {
            Guid? after = null; var from = phase == "Meter" ? InvoiceMath.CalendarDate(x.BillingPeriod, p.MeterDay, 0) : x.BillingPeriod; var end = phase == "Meter" ? from : x.BillingPeriod.AddMonths(1).AddDays(-1);
            while (true)
            {
                var rooms = native is not null ? await native.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.LocationId == p.LocationId && (after == null || r.Id.CompareTo(after.Value) > 0) &&
                    (phase == "Meter" || native.Set<BHome.Domain.Billing.Invoice>().Any(i => i.Type == "PERIODIC" && i.RoomId == r.Id && i.BillingPeriod == x.BillingPeriod) ||
                        native.Set<BHome.Domain.TenantContracts.Contract>().Any(c => c.RoomId == r.Id && c.ActivatedAt != null &&
                        (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal) &&
                        (c.Status == ContractStatus.Active || c.Status == ContractStatus.Superseded || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Expired) &&
                        c.StartDate <= end && (c.ActualEndDate ?? c.EndDate) > end)))
                    .OrderBy(r => r.Id).Select(r => r.Id).Take(100).ToArrayAsync(t)
                    : await db.Set<Room>().AsNoTracking().Where(r => r.LocationId == p.LocationId && (after == null || r.Id.CompareTo(after.Value) > 0) &&
                    (phase == "Meter" || db.PeriodicInvoices().Any(i => i.RoomId == r.Id && i.BillingPeriod == x.BillingPeriod) || db.Set<Contract>().Any(c => c.RoomId == r.Id && c.ActivatedAt != null &&
                        (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) &&
                        (c.Status == ContractStatus.Active || c.Status == ContractStatus.Superseded || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Expired) &&
                        c.StartDate <= end && (c.ActualEndDate ?? c.EndDate) > end)))
                    .OrderBy(r => r.Id).Select(r => r.Id).Take(100).ToArrayAsync(t);
                if (rooms.Length == 0) break;
                foreach (var room in rooms)
                {
                    if (phase == "Draft") { existing += await GenerateDraft(p, x.BillingPeriod, room, errors, t); continue; }
                    if (phase == "Final") { existing += await FinalizeDraft(p, x.BillingPeriod, room, errors, t); continue; }
                    db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
                    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({p.LocationId.ToString()},0))", t);
                    var lockedLocation = native is not null
                        ? (await native.Set<BHome.Domain.PropertyManagement.Room>().FromSqlInterpolated($"SELECT * FROM rooms WHERE id={room} FOR UPDATE").AsNoTracking().SingleAsync(t)).LocationId
                        : (await db.Locked<Room>(room).SingleAsync(t)).LocationId;
                    if (lockedLocation != p.LocationId) { await tx.CommitAsync(t); continue; }
                    if (!await Eligible(p, x.BillingPeriod, phase, t)) { errors.Add(new { roomId = room, code = "automation_authorization_changed" }); await tx.CommitAsync(t); break; }
                    existing += await GenerateMeterTasks(p, x.BillingPeriod, room, errors, t);
                    if (native is null) await db.SaveChangesAsync(t);
                    await tx.CommitAsync(t);
                }
                after = rooms[^1];
            }
            await Finish(errors.Count == 0 ? "Completed" : "PendingInputs", null);
        }
        catch (OperationCanceledException) when (t.IsCancellationRequested) { throw; }
        catch (Exception ex) { await Finish("Failed", ex.GetType().Name); throw; }
        return native is not null ? await NativeBillingJobPersistence.ByIdAsync(native, e.Id, t)
            : await db.Set<BillingAutomationExecution>().AsNoTracking().SingleAsync(r => r.Id == e.Id, t);
        async Task Finish(string status, string? code)
        {
            db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
            if (native is not null)
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({p.Id + "/" + x.BillingPeriod + "/" + phase},0))", t);
            var current = native is not null ? (await NativeBillingJobPersistence.ExecutionAsync(native, p.Id, x.BillingPeriod, phase, t, locked: true))!
                : await db.Set<BillingAutomationExecution>().SingleAsync(r => r.Id == e.Id, t);
            if (current.LockToken != token) return;
            current.Status = status; current.LastErrorCode = code; current.ExceptionsJson = JsonSerializer.Serialize(errors); current.ExistingCount = existing;
            current.CreatedCount = native is not null ? await NativeBillingJobPersistence.CreatedCountAsync(native, p.Id, x.BillingPeriod, phase, t)
                : phase == "Meter" ? await db.Set<OperationalTask>().CountAsync(task => task.AutomationPlanId == p.Id && task.BillingPeriod == x.BillingPeriod, t) : phase == "Draft" ? await db.Set<Invoice>().CountAsync(i => i.AutomationPlanId == p.Id && i.BillingPeriod == x.BillingPeriod, t) : await db.Set<Invoice>().CountAsync(i => i.AutomationFinalizationPlanId == p.Id && i.BillingPeriod == x.BillingPeriod, t);
            current.FinishedAt = clock.GetUtcNow(); current.LockedUntil = null; current.LockToken = null;
            var attempt = new BillingAutomationAttempt { ExecutionId = e.Id, Sequence = sequence, Status = status, StartedAt = started, FinishedAt = current.FinishedAt.Value, SummaryJson = JsonSerializer.Serialize(new { current.CreatedCount, current.ExistingCount, errors, errorCode = code }) };
            if (native is not null)
            {
                await NativeBillingJobPersistence.SaveAsync(native, current, false, token, t);
                await NativeBillingJobPersistence.AppendAttemptAsync(native, attempt, t);
            }
            else { db.Add(attempt); await db.SaveChangesAsync(t); }
            await tx.CommitAsync(t);
        }
    }
    private async Task<int> GenerateMeterTasks(BillingAutomationPlan plan, DateOnly period, Guid room, List<object> errors, CancellationToken t)
    {
        var readingDate = InvoiceMath.CalendarDate(period, plan.MeterDay, 0); var due = DueAt(InvoiceMath.CalendarDate(period, plan.MeterDueDay, plan.MeterDueMonthOffset)); var existing = 0;
        var native = db as Compact24DbContext;
        var assignments = await CurrentAssignmentsAsync(plan.LocationId, t);
        var assignees = assignments.Select(a => a.StaffUserId).Distinct().ToArray();
        var assignment = assignees.Length == 1 ? assignments.OrderByDescending(a => a.StartDate).ThenBy(a => a.Id).First() : null;
        foreach (var type in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var meters = native is not null
                ? (await native.Set<BHome.Domain.Billing.Meter>().AsNoTracking().Where(m => m.RoomId == room && m.UtilityType == type && m.IsActive && m.InstalledOn <= readingDate).Take(2).ToArrayAsync(t))
                : await db.Set<Meter>().AsNoTracking().Where(m => m.RoomId == room && m.UtilityType == type && m.IsActive && m.InstalledOn <= readingDate).Take(2).ToArrayAsync(t);
            var previous = native is not null ? await NativeBillingJobPersistence.PeriodicTaskAsync(native, room, type, period, t)
                : await db.Set<OperationalTask>().SingleOrDefaultAsync(task => task.BillingRoomId == room && task.BillingUtilityType == type && task.BillingPeriod == period, t);
            if (previous is not null)
            {
                existing++;
                if (previous.Status == MeterTaskStatus.Cancelled) errors.Add(new { roomId = room, utilityType = type, code = "cancelled_period_requires_review" });
                if (meters.Length != 1 || previous.MeterId != meters[0].Id) errors.Add(new { roomId = room, utilityType = type, code = "meter_replacement_review_required" });
                if (previous.AutomationPlanId is not null && previous.Status is not (MeterTaskStatus.Completed or MeterTaskStatus.Cancelled))
                {
                    // The recorded Staff is a routing snapshot, not an access grant.
                    // Refresh it from the effective Location responsibility on retries.
                    if (assignment is not null && (previous.AssignedStaffUserId != assignment.StaffUserId || previous.AssignmentId != assignment.Id))
                    {
                        var originalVersion = previous.Version;
                        previous.AssignedStaffUserId = assignment.StaffUserId;
                        previous.AssignmentId = assignment.Id;
                        previous.AssignedAt = clock.GetUtcNow();
                        previous.Version++;
                        var assigned = new OperationalTaskHistory { TaskId = previous.Id, ActorId = plan.AuthorizedByUserId, Action = "scheduled_meter_assigned", TaskVersion = previous.Version, ResponsibleStaffUserId = assignment.StaffUserId, OccurredAt = clock.GetUtcNow() };
                        var notification = new OperationalTaskNotification { TaskId = previous.Id, RecipientUserId = assignment.StaffUserId, EventId = assigned.Id, Event = "scheduled_meter_assigned" };
                        if (native is not null)
                        {
                            await NativeBillingJobPersistence.UpdateRoutingAsync(native, previous, originalVersion, t);
                            await NativeBillingJobPersistence.AppendTaskEventAsync(native, assigned, notification, t);
                        }
                        else { db.Add(assigned); db.Add(notification); }
                    }
                    else if (assignment is null)
                        errors.Add(new { roomId = room, utilityType = type, code = "staff_assignment_required", taskId = previous.Id });
                }
                continue;
            }
            if (meters.Length != 1) { errors.Add(new { roomId = room, utilityType = type, code = "active_meter_configuration_required" }); continue; }
            var task = new OperationalTask
            {
                Kind = OperationalTaskKind.MeterReading,
                LocationId = plan.LocationId,
                MeterId = meters[0].Id,
                BillingRoomId = room,
                BillingUtilityType = type,
                AutomationPlanId = plan.Id,
                Purpose = ReadingPurpose.Periodic,
                BillingPeriod = period,
                ReadingDate = readingDate,
                DueAt = due,
                Title = type == UtilityType.Electricity ? "Ghi chỉ số điện định kỳ" : "Ghi chỉ số nước định kỳ",
                Requirements = "Đối chiếu ảnh và xác nhận chỉ số thực tế trước khi lưu.",
                EvidenceRequired = true,
                AssignedStaffUserId = assignment?.StaffUserId,
                AssignmentId = assignment?.Id,
                AssignedAt = assignment is null ? null : clock.GetUtcNow()
            };
            var history = new OperationalTaskHistory { TaskId = task.Id, ActorId = plan.AuthorizedByUserId, Action = "scheduled_meter_created", Note = "JOB-09", TaskVersion = 1, ResponsibleStaffUserId = assignment?.StaffUserId, OccurredAt = clock.GetUtcNow(), ChangesJson = JsonSerializer.Serialize(new { planId = plan.Id, period, type }) };
            var notice = assignment is null ? null : new OperationalTaskNotification { TaskId = task.Id, RecipientUserId = assignment.StaffUserId, EventId = history.Id, Event = "scheduled_meter_created" };
            if (native is not null)
            {
                await NativeCaptureWrites.TaskAsync(native, task, true, 0, t);
                await NativeBillingJobPersistence.AppendTaskEventAsync(native, history, notice, t);
            }
            else { db.Add(task); db.Add(history); if (notice is not null) db.Add(notice); }
            if (assignment is null) errors.Add(new { roomId = room, utilityType = type, code = "staff_assignment_required", taskId = task.Id });
        }
        return existing;
    }
    private async Task<NativeBillingJobPersistence.StaffAssignment[]> CurrentAssignmentsAsync(Guid location, CancellationToken t)
    {
        if (db is Compact24DbContext compact) return await NativeBillingJobPersistence.AssignmentsAsync(compact, location, Today, t);
        var eligibleStaff = from u in db.Users
                            join grant in db.UserRoles on u.Id equals grant.UserId
                            join role in db.Roles on grant.RoleId equals role.Id
                            where u.IsActive && role.Name == Roles.Staff
                            select u.Id;
        return await db.StaffLocationAssignments.AsNoTracking().Where(a => a.LocationId == location && a.StartDate <= Today && a.EndDate >= Today && eligibleStaff.Contains(a.StaffUserId))
            .Select(a => new NativeBillingJobPersistence.StaffAssignment(a.Id, a.StaffUserId, a.StartDate, a.EndDate)).ToArrayAsync(t);
    }
    public async Task AssignMeterAsync(Guid taskId, MeterAssignmentInput x, Guid actor, CancellationToken t)
    {
        db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
        var native = db as Compact24DbContext;
        var task = (native is not null ? await NativeBillingJobPersistence.LockedMeterTaskAsync(native, taskId, t)
            : await db.Locked<OperationalTask>(taskId).SingleOrDefaultAsync(t)) ?? throw new InvoiceException(404, "meter_task_not_found");
        if (task.AutomationPlanId == null || task.Version != x.ExpectedVersion || task.Status is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled) throw new InvoiceException(409, "meter_task_changed_or_closed");
        var assignmentId = native is not null
            ? (await NativeBillingJobPersistence.AssignmentsAsync(native, task.LocationId, Today, t)).SingleOrDefault(a => a.StaffUserId == x.StaffUserId)?.Id
            : await db.StaffLocationAssignments.Where(a => a.LocationId == task.LocationId && a.StaffUserId == x.StaffUserId && a.StartDate <= Today && a.EndDate >= Today).Select(a => (Guid?)a.Id).SingleOrDefaultAsync(t);
        if (assignmentId is null || !await ActiveRole(x.StaffUserId, Roles.Staff, t) || native is not null && !await StaffEmploymentEligibility.IsEligibleAsync(native, x.StaffUserId, Today, t)) throw new InvoiceException(400, "staff_assignment_required");
        var originalVersion = task.Version;
        task.AssignedStaffUserId = x.StaffUserId; task.AssignmentId = assignmentId; task.AssignedAt = clock.GetUtcNow(); task.Version++;
        var history = new OperationalTaskHistory { TaskId = task.Id, ActorId = actor, Action = "scheduled_meter_assigned", TaskVersion = task.Version, ResponsibleStaffUserId = x.StaffUserId, OccurredAt = clock.GetUtcNow() };
        var notice = new OperationalTaskNotification { TaskId = task.Id, RecipientUserId = x.StaffUserId, EventId = history.Id, Event = "scheduled_meter_assigned" };
        if (native is not null)
        {
            await NativeBillingJobPersistence.UpdateRoutingAsync(native, task, originalVersion, t);
            await NativeBillingJobPersistence.AppendTaskEventAsync(native, history, notice, t);
        }
        else { db.Add(history); db.Add(notice); await db.SaveChangesAsync(t); }
        await tx.CommitAsync(t);
    }
}
