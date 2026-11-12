using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class SePayAutomationWorker(IServiceScopeFactory scopes, SePayOptions options, IOptions<JobWorkerOptions> jobs,
    PostgresJobWorker worker, ILogger<SePayAutomationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<SePayScheduling>().EnqueueDueAsync(stoppingToken);
                if (!jobs.Value.Enabled && await worker.ProcessOneAsync(stoppingToken, ["sepay-reconcile-" + options.Mode.ToLowerInvariant(), "sepay-poll-" + options.Mode.ToLowerInvariant()])) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning("SePay automation deferred with {ErrorCode}", error.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
