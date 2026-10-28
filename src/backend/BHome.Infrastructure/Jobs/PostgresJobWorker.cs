using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
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

    private async Task<bool> ProcessOneAsync(CancellationToken stoppingToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        BackgroundJobRecord? job;
        var now = DateTimeOffset.UtcNow;
        var lockToken = Guid.NewGuid();
        await using (var transaction = await db.Database.BeginTransactionAsync(stoppingToken))
        {
            // Row locks and a lease allow multiple API instances without simultaneous normal claims.
            job = await db.BackgroundJobs.FromSqlInterpolated($"""
                SELECT * FROM "BackgroundJobs"
                WHERE ("State" = 'Pending' AND "AvailableAt" <= {now})
                   OR ("State" = 'Processing' AND "LockedUntil" < {now})
                ORDER BY "AvailableAt" LIMIT 1 FOR UPDATE SKIP LOCKED
                """).FirstOrDefaultAsync(stoppingToken);
            if (job is null) return false;
            if (job.Attempts >= MaxAttempts)
            {
                job.State = "Failed";
                job.LastErrorCode = "LeaseExpiredAfterFinalAttempt";
                await db.SaveChangesAsync(stoppingToken);
                await transaction.CommitAsync(stoppingToken);
                logger.LogError("Job {JobId} exhausted attempts; manual review required", job.Id);
                return true;
            }
            job.State = "Processing";
            job.LockToken = lockToken;
            job.LockedUntil = now.AddMinutes(2);
            job.Attempts++;
            await db.SaveChangesAsync(stoppingToken);
            await transaction.CommitAsync(stoppingToken);
        }

        using var logScope = logger.BeginScope(new Dictionary<string, object> { ["JobId"] = job.Id, ["JobName"] = job.Name });
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        try
        {
            var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().SingleOrDefault(h => h.Name == job.Name)
                ?? throw new InvalidOperationException("No handler registered.");
            await handler.ExecuteAsync(new JobExecution(job.Id, job.IdempotencyKey, job.PayloadJson), timeout.Token);
            timeout.Token.ThrowIfCancellationRequested();
            var updated = await db.BackgroundJobs.Where(j => j.Id == job.Id && j.LockToken == lockToken)
                .ExecuteUpdateAsync(setters => setters.SetProperty(j => j.State, "Completed")
                    .SetProperty(j => j.LockedUntil, (DateTimeOffset?)null), stoppingToken);
            if (updated == 1) logger.LogInformation("Job completed on attempt {Attempt}", job.Attempts);
            else logger.LogWarning("Job lease was lost; completion was not recorded");
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            var state = job.Attempts >= MaxAttempts ? "Failed" : "Pending";
            var next = DateTimeOffset.UtcNow.AddSeconds(Math.Pow(2, job.Attempts) * 5 + Random.Shared.Next(5));
            var updated = await db.BackgroundJobs.Where(j => j.Id == job.Id && j.LockToken == lockToken)
                .ExecuteUpdateAsync(setters => setters.SetProperty(j => j.State, state)
                    .SetProperty(j => j.AvailableAt, next).SetProperty(j => j.LockedUntil, (DateTimeOffset?)null)
                    .SetProperty(j => j.LastErrorCode, exception.GetType().Name), stoppingToken);
            logger.LogWarning("Job attempt {Attempt} failed with {ErrorCode}; state {State}; update recorded {Recorded}", job.Attempts,
                exception.GetType().Name, state, updated == 1);
        }
        return true;
    }
}
