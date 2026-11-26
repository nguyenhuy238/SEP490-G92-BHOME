using BHome.Application.Billing;
using BHome.Application.Notifications;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Billing;

// Billing runs independently of the general job switch, using the same durable queue.
// The general scheduler/worker already handles these jobs when enabled.
internal sealed class BillingAutomationWorker(IServiceScopeFactory scopes,
    BillingAutomationRuntime runtime, IOptions<JobWorkerOptions> jobs,
    IOptions<NotificationChannelOptions> notifications,
    ILogger<BillingAutomationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        if (!runtime.WorkerEnabled || jobs.Value.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<BillingAutomationScheduling>().EnqueueDueAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                logger.LogError("Billing scheduling failed with {ErrorCode}", exception.GetType().Name);
            }
            try
            {
                var worker = scopes.CreateScope();
                using (worker)
                {
                    var jobsWorker = worker.ServiceProvider.GetRequiredService<PostgresJobWorker>();
                    for (var i = 0; i < 20; i++)
                        if (!await jobsWorker.ProcessAllowedAsync(stoppingToken, ["billing-meter", "billing-draft", "billing-final"])) break;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                logger.LogError("Billing job execution failed with {ErrorCode}", exception.GetType().Name);
            }
            // Do not turn on unrelated notification automation in local snapshots.
            // If the normal notification worker is disabled, publish and deliver
            // only billing events with the same durable inbox/outbox machinery.
            if (!notifications.Value.AutomationEnabled)
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<NotificationEventPublisher>().PublishBillingPendingAsync(stoppingToken);
                    await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().ProcessBillingPendingAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception exception)
                {
                    logger.LogError("Billing notification automation failed with {ErrorCode}", exception.GetType().Name);
                }
            }
            try { await Task.Delay(TimeSpan.FromSeconds(jobs.Value.PollSeconds), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
