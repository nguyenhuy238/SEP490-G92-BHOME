namespace BHome.Application.Jobs;

public sealed record JobSubmission(string Name, string IdempotencyKey, string PayloadJson);
public sealed record JobExecution(Guid Id, string IdempotencyKey, string PayloadJson);

public interface IBackgroundJobQueue
{
    Task EnqueueAsync(JobSubmission submission, CancellationToken cancellationToken);
}

public interface IBackgroundJobHandler
{
    string Name { get; }
    Task ExecuteAsync(JobExecution job, CancellationToken cancellationToken);
}
