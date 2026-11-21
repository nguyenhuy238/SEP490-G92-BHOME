namespace BHome.Application.Jobs;
// Extensions to the existing scheduler; contributors only enqueue into the existing durable queue.
public interface IJobScheduleContributor { Task EnqueueDueAsync(CancellationToken t); }
