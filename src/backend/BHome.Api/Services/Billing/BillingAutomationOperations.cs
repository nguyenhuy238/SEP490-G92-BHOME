using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Billing;

public sealed class BillingAutomationOperations(IBillingAutomationEngine engine, IBillingAutomationSchedules schedules, ICurrentUser user, PermissionAccess permissions, BillingAutomationRuntime runtime, TimeProvider clock,
    CaptureService capture, ICaptureRepository captureRepository)
{
    private bool ManualActionsAllowed => runtime.AllowsManualActions(user.UserId, user.IsInRole(Roles.Owner));
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
        var p = await schedules.ForPeriodAsync(location, period, t); var today = clock.BusinessToday();
        var workerEnabled = runtime.WorkerEnabled;
        if (p is null) return new(ManualActionsAllowed, "Asia/Ho_Chi_Minh", today, [], workerEnabled);
        var c = BillingAutomationService.Calendar(p);
        var phases = new[] { new BillingPhasePreview("Meter", InvoiceMath.CalendarDate(period, p.MeterDay, 0), false), new("Draft", InvoiceMath.CalendarDate(period, c.DraftDay, c.DraftMonthOffset), false), new("Final", InvoiceMath.CalendarDate(period, c.FinalDay, c.FinalMonthOffset), false) };
        // "Eligible" describes automatic scheduling, not developer-initiated run-now.
        // Do not advertise a runnable phase when billing workers are globally disabled.
        return new(ManualActionsAllowed, p.TimeZone, today, phases.Select(x => x with { Eligible = workerEnabled && p.Enabled && today >= x.ScheduledDate && (x.Phase != "Final" || p.AuthorizeAutomaticFinalization) }).ToArray(), workerEnabled);
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
        if (!ManualActionsAllowed) throw new InvoiceException(403, "developer_actions_disabled");
        BillingAutomationService.ValidatePeriod(x.BillingPeriod);
        if (x.MeterId == Guid.Empty || x.Purpose is not (ReadingPurpose.Initial or ReadingPurpose.Periodic))
            throw new InvoiceException(400, "invalid_manual_meter_task");
        var location = await captureRepository.ActiveMeterLocationAsync(x.MeterId, t) ?? throw new InvoiceException(404, "meter_not_found");
        await Owner(location, t);
        var plan = await schedules.ForPeriodAsync(location, x.BillingPeriod, t) ?? throw new InvoiceException(409, "billing_automation_required");
        // A disabled plan still supplies its immutable calendar for explicitly requested
        // tests; it must never start a background scheduler. Gate on the server VN business
        // date, not the date entered into the task by the caller.
        var assignmentDate = InvoiceMath.CalendarDate(x.BillingPeriod, plan.MeterDay, 0);
        var today = clock.BusinessToday();
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
