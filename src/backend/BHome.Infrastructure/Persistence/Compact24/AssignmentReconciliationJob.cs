using BHome.Application.Jobs;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class AssignmentReconciliationJob(CompactLocationAssignments assignments,
    IBackgroundJobQueue queue, TimeProvider clock) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "staff-assignment-reconciliation";

    public Task EnqueueDueAsync(CancellationToken token)
    {
        var minute = clock.GetUtcNow().ToString("yyyyMMddHHmm", System.Globalization.CultureInfo.InvariantCulture);
        return queue.EnqueueAsync(new(Name, $"{Name}/{minute}", "{}"), token);
    }

    public Task ExecuteAsync(JobExecution job, CancellationToken token) =>
        assignments.ReconcileEffectiveAssignmentsAsync(token);
}
