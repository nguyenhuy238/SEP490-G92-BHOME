using BHome.Application.Jobs;
using BHome.Application.Operations;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class RecurringOperationsJob(IOperationsRepository repository, IBackgroundJobQueue queue,
    TimeProvider clock) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "recurring-operational-tasks";

    public Task EnqueueDueAsync(CancellationToken t)
    {
        var minute = clock.GetUtcNow().ToString("yyyyMMddHHmm");
        return queue.EnqueueAsync(new(Name, $"recurring-operational-tasks/{minute}", "{}"), t);
    }

    public async Task ExecuteAsync(JobExecution job, CancellationToken t) =>
        _ = await repository.GenerateDueRecurringTasksAsync(clock.GetUtcNow(), t);
}
