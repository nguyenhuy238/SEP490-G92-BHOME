namespace BHome.Infrastructure.Jobs;

internal interface IJobPersistence
{
    Task<BackgroundJobRecord?> ClaimAsync(string[] handlerNames, DateTimeOffset now, Guid leaseToken, int maxAttempts, CancellationToken token);
    Task<int> CompleteAsync(Guid id, Guid leaseToken, CancellationToken token);
    Task<int> FailAsync(Guid id, Guid leaseToken, string state, DateTimeOffset next, string errorCode, CancellationToken token);
}
