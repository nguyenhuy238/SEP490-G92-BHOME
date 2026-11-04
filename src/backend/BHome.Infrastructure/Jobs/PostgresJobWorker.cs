using BHome.Application.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Jobs;

internal sealed class PostgresJobWorker(IServiceScopeFactory scopeFactory, IOptions<JobWorkerOptions> options,
    ILogger<PostgresJobWorker> logger) : BackgroundService
{
    private const int MaxAttempts = 4;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled) return;
        logger.LogInformation("Background worker started");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await ProcessOneAsync(stoppingToken)) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                // Do not log exception messages: provider/database messages may include sensitive input.
                logger.LogError("Background worker failed with {ErrorCode}", exception.GetType().Name);
            }

            try { await Task.Delay(TimeSpan.FromSeconds(options.Value.PollSeconds), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    internal async Task<bool> ProcessOneAsync(CancellationToken stoppingToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var persistence = scope.ServiceProvider.GetRequiredService<IJobPersistence>();
        var handlers = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().ToDictionary(h => h.Name, StringComparer.Ordinal);
        var names = handlers.Keys.ToArray();
        var now = DateTimeOffset.UtcNow;
        var lockToken = Guid.NewGuid();
        var job = await persistence.ClaimAsync(names, now, lockToken, MaxAttempts, stoppingToken);
        if (job is null) return false;
        if (job.State == "Failed")
        {
            logger.LogError("Job {JobId} exhausted attempts; manual review required", job.Id);
            return true;
        }

        using var logScope = logger.BeginScope(new Dictionary<string, object> { ["JobId"] = job.Id, ["JobName"] = job.Name });
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        try
        {
            var handler = handlers[job.Name];
            await handler.ExecuteAsync(new JobExecution(job.Id, job.IdempotencyKey, job.PayloadJson), timeout.Token);
            timeout.Token.ThrowIfCancellationRequested();
            var updated = await persistence.CompleteAsync(job.Id, lockToken, stoppingToken);
            if (updated == 1) logger.LogInformation("Job completed on attempt {Attempt}", job.Attempts);
            else logger.LogWarning("Job lease was lost; completion was not recorded");
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            var state = job.Attempts >= MaxAttempts ? "Failed" : "Pending";
            var next = DateTimeOffset.UtcNow.AddSeconds(Math.Pow(2, job.Attempts) * 5 + Random.Shared.Next(5));
            var updated = await persistence.FailAsync(job.Id, lockToken, state, next, exception.GetType().Name, stoppingToken);
            logger.LogWarning("Job attempt {Attempt} failed with {ErrorCode}; state {State}; update recorded {Recorded}", job.Attempts,
                exception.GetType().Name, state, updated == 1);
        }
        return true;
    }
}
