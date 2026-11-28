using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BHome.Infrastructure.Jobs;

namespace BHome.Infrastructure.Persistence.Compact24;

/// <summary>
/// Reconciles effective Location responsibilities when the general background-job
/// runner is intentionally disabled (for example, during local development).
/// This worker never processes billing, contracts, or any other job family.
/// </summary>
internal sealed class StaffAssignmentReconciliationWorker(
    IServiceScopeFactory scopes,
    IConfiguration configuration,
    IOptions<JobWorkerOptions> jobs,
    ILogger<StaffAssignmentReconciliationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield(); // Never block API startup on a database connection.
        if (!configuration.GetValue<bool>("StaffAssignments:AutoReconcileEnabled") || jobs.Value.Enabled)
            return; // The normal scheduled job already owns this work when Jobs:Enabled=true.

        var pollSeconds = Math.Clamp(configuration.GetValue<int?>("StaffAssignments:PollSeconds") ?? 60, 30, 300);
        logger.LogInformation("Location responsibility reconciliation worker started");
        try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<CompactLocationAssignments>()
                    .ReconcileEffectiveAssignmentsAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                // Do not expose database or account information through provider exception messages.
                logger.LogError("Location responsibility reconciliation failed: {ErrorCode}",
                    exception.GetType().Name);
            }

            try { await Task.Delay(TimeSpan.FromSeconds(pollSeconds), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
