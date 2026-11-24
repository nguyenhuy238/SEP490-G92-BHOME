using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
namespace BHome.Application.Billing;

public sealed record BillingJobInput(Guid PlanId, DateOnly BillingPeriod);
public sealed record BillingRunInput(Guid LocationId, DateOnly BillingPeriod, string Phase);
public sealed record MeterAssignmentInput(Guid StaffUserId, int ExpectedVersion);
// Dedicated developer-only manual task request: the billing period selects the immutable
// effective plan; ReadingDate is optional and defaults to its configured meter day.
public sealed record BillingManualMeterTaskInput(Guid MeterId, ReadingPurpose Purpose, DateOnly BillingPeriod, DateOnly? ReadingDate = null);
public sealed record BillingAutomationRuntime(bool DeveloperActionsEnabled, bool WorkerEnabled = false)
{
    public bool ManualActionsEnabled { get; init; }
    public bool CanRunManualActions => DeveloperActionsEnabled || ManualActionsEnabled;
}
public sealed record BillingPhasePreview(string Phase, DateOnly ScheduledDate, bool Eligible);
public sealed record BillingAutomationPreview(bool DeveloperActionsEnabled, string TimeZone, DateOnly BusinessDate, IReadOnlyList<BillingPhasePreview> Phases, bool WorkerEnabled = false);
public sealed record BillingQueueView(Guid Id, string Name, string State, int Attempts, DateTimeOffset AvailableAt, DateTimeOffset? LockedUntil, string? LastErrorCode);
public interface IBillingAutomationEngine
{
    Task<BillingAutomationExecution?> ExecuteAsync(BillingJobInput input, string phase, CancellationToken t);
    Task<IReadOnlyList<BillingAutomationExecution>> ExecutionsAsync(Guid locationId, DateOnly period, CancellationToken t);
    Task AssignMeterAsync(Guid taskId, MeterAssignmentInput input, Guid actor, CancellationToken t);
    Task<IReadOnlyList<BillingAutomationAttempt>> AttemptsAsync(Guid locationId, DateOnly period, CancellationToken t);
    Task<IReadOnlyList<BillingQueueView>> QueueAsync(Guid locationId, DateOnly period, CancellationToken t);
}
public sealed class BillingAutomationJobHandler(string name, string phase, IBillingAutomationEngine engine, bool enabled = true) : IBackgroundJobHandler
{
    public string Name => name;
    public bool Enabled => enabled;
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    { await engine.ExecuteAsync(JsonSerializer.Deserialize<BillingJobInput>(job.PayloadJson) ?? throw new ArgumentException("invalid_billing_job"), phase, t); }
}
public sealed class BillingAutomationOperations(IBillingAutomationEngine engine, IBillingAutomationSchedules schedules, ICurrentUser user, PermissionAccess permissions, BillingAutomationRuntime runtime, TimeProvider clock,
    CaptureService capture, ICaptureRepository captureRepository)
{
    private async Task<Guid> Owner(Guid location, CancellationToken t)
    {
        if (user.UserId is not { } actor) throw new InvoiceException(401, "authentication_required");
        if (!await permissions.CanAccessAsync(Permissions.Locations.Manage, new(location, null), t)) throw new InvoiceException(403, "billing_automation_owner_required"); return actor;
    }
    public async Task<IReadOnlyList<BillingAutomationExecution>> ListAsync(Guid location, DateOnly period, CancellationToken t)
    { await Owner(location, t); BillingAutomationService.ValidatePeriod(period); return await engine.ExecutionsAsync(location, period, t); }
    public async Task<IReadOnlyList<BillingAutomationAttempt>> AttemptsAsync(Guid location, DateOnly period, CancellationToken t)
    { await Owner(location, t); BillingAutomationService.ValidatePeriod(period); return await engine.AttemptsAsync(location, period, t); }
    public async Task<IReadOnlyList<BillingQueueView>> QueueAsync(Guid location, DateOnly period, CancellationToken t)
    { await Owner(location, t); BillingAutomationService.ValidatePeriod(period); return await engine.QueueAsync(location, period, t); }
    public async Task<BillingAutomationPreview> PreviewAsync(Guid location, DateOnly period, CancellationToken t)
    {
        await Owner(location, t); BillingAutomationService.ValidatePeriod(period);
        var p = await schedules.ForPeriodAsync(location, period, t); var today = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
        if (p is null) return new(runtime.CanRunManualActions, "Asia/Ho_Chi_Minh", today, [], runtime.WorkerEnabled);
        var c = BillingAutomationService.Calendar(p);
        var phases = new[] { new BillingPhasePreview("Meter", InvoiceMath.CalendarDate(period, p.MeterDay, 0), false), new("Draft", InvoiceMath.CalendarDate(period, c.DraftDay, c.DraftMonthOffset), false), new("Final", InvoiceMath.CalendarDate(period, c.FinalDay, c.FinalMonthOffset), false) };
        // "Eligible" describes automatic scheduling, not developer-initiated run-now.
        // Do not advertise a runnable phase when billing workers are globally disabled.
        return new(runtime.CanRunManualActions, p.TimeZone, today, phases.Select(x => x with { Eligible = runtime.WorkerEnabled && p.Enabled && today >= x.ScheduledDate && (x.Phase != "Final" || p.AuthorizeAutomaticFinalization) }).ToArray(), runtime.WorkerEnabled);
    }
    public async Task<BillingAutomationExecution?> RunAsync(BillingRunInput x, CancellationToken t)
    {
        await Owner(x.LocationId, t); if (!runtime.CanRunManualActions) throw new InvoiceException(403, "developer_actions_disabled"); BillingAutomationService.ValidatePeriod(x.BillingPeriod);
        if (x.Phase is not ("Meter" or "Draft" or "Final")) throw new InvoiceException(400, "invalid_billing_job_phase");
        var plan = await schedules.ForPeriodAsync(x.LocationId, x.BillingPeriod, t) ?? throw new InvoiceException(409, "billing_automation_required");
        return await engine.ExecuteAsync(new(plan.Id, x.BillingPeriod), x.Phase, t);
    }
    public async Task<IdResult> CreateManualMeterTaskAsync(BillingManualMeterTaskInput x, CancellationToken t)
    {
        if (!runtime.CanRunManualActions) throw new InvoiceException(403, "developer_actions_disabled");
        BillingAutomationService.ValidatePeriod(x.BillingPeriod);
        if (x.MeterId == Guid.Empty || x.Purpose is not (ReadingPurpose.Initial or ReadingPurpose.Periodic))
            throw new InvoiceException(400, "invalid_manual_meter_task");
        var location = await captureRepository.ActiveMeterLocationAsync(x.MeterId, t) ?? throw new InvoiceException(404, "meter_not_found");
        await Owner(location, t);
        var plan = await schedules.ForPeriodAsync(location, x.BillingPeriod, t) ?? throw new InvoiceException(409, "billing_automation_required");
        // A disabled plan still supplies its immutable calendar for explicitly requested
        // tests; it must never start a background scheduler. Gate on the real VN business
        // date, not the date entered into the task by the caller.
        var assignmentDate = InvoiceMath.CalendarDate(x.BillingPeriod, plan.MeterDay, 0);
        var today = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
        if (today < assignmentDate) throw new InvoiceException(409, "meter_assignment_date_not_reached");
        var readingDate = x.ReadingDate ?? assignmentDate;
        if (readingDate > today) throw new InvoiceException(409, "meter_reading_date_not_reached");
        if (x.Purpose == ReadingPurpose.Periodic && readingDate != assignmentDate)
            throw new InvoiceException(400, "periodic_reading_date_must_match_schedule");
        if (x.Purpose == ReadingPurpose.Initial && readingDate > assignmentDate)
            throw new InvoiceException(409, "initial_reading_after_periodic_date");
        return await capture.CreateTaskAsync(new(x.MeterId, x.Purpose, readingDate,
            x.Purpose == ReadingPurpose.Periodic ? x.BillingPeriod : null), t);
    }
    public async Task AssignAsync(Guid taskId, MeterAssignmentInput x, CancellationToken t)
    { var actor = await Owner(Guid.Empty, t); await engine.AssignMeterAsync(taskId, x, actor, t); }
    public async Task<BillingRepresentativeSelection?> RepresentativeAsync(Guid room, DateOnly period, CancellationToken t)
    { await Owner(Guid.Empty, t); BillingAutomationService.ValidatePeriod(period); return await schedules.RepresentativeAsync(room, period, t); }
    public async Task<BillingRepresentativeSelection> SelectAsync(BillingRepresentativeInput x, CancellationToken t)
    { var actor = await Owner(Guid.Empty, t); BillingAutomationService.ValidatePeriod(x.BillingPeriod); if (x.RoomId == Guid.Empty || x.ContractId == Guid.Empty || x.ExpectedVersion < 0) throw new InvoiceException(400, "invalid_billing_representative"); return await schedules.SelectRepresentativeAsync(x, actor, clock.GetUtcNow(), t); }
}
