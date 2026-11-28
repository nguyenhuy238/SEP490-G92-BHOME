using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
namespace BHome.Application.Billing;

public sealed record BillingJobInput(Guid PlanId, DateOnly BillingPeriod);
public sealed record BillingRunInput(Guid LocationId, DateOnly BillingPeriod, string Phase);
public sealed record MeterAssignmentInput(Guid StaffUserId, int ExpectedVersion);
// Dedicated developer-only manual task request: the billing period selects the immutable
// effective plan; ReadingDate is optional and defaults to its configured meter day.
public sealed record BillingManualMeterTaskInput(Guid MeterId, ReadingPurpose Purpose, DateOnly BillingPeriod, DateOnly? ReadingDate = null);
public sealed record BillingAutomationRuntime(bool DeveloperActionsEnabled, bool WorkerEnabled = false, Guid? StagingDemoOwnerId = null, bool DeployedDemoEnabled = false)
{
    public bool ManualActionsEnabled { get; init; }
    public bool CanRunManualActions => DeveloperActionsEnabled || ManualActionsEnabled;
    // Explicit staging opt-in retains its own scope; Demo Clock alone permits
    // individual manual workflow only, not run-now batches or notification publishing.
    public bool AllowsManualActions(Guid? actorId, bool isOwner) => DeveloperActionsEnabled ||
        (isOwner && actorId is not null && (ManualActionsEnabled || actorId == StagingDemoOwnerId || DeployedDemoEnabled && StagingDemoOwnerId is null));
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
