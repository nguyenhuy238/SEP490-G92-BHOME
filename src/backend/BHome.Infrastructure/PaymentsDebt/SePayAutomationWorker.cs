using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class SePayAutomationWorker(IServiceScopeFactory scopes, IOptions<SePayOptions> configuration, IOptions<JobWorkerOptions> jobs,
    PostgresJobWorker worker, ILogger<SePayAutomationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Do not hold up Kestrel startup while the first payment/activation
        // scheduling query initializes or waits for external persistence.
        await Task.Yield();
        var pendingVerifiedMoveOutRecovery = true;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                if (pendingVerifiedMoveOutRecovery)
                {
                    // A valid payment may have been allocated before this
                    // process version learned to close an accepted move-out.
                    // Inspect the already-verified local ledger once at start,
                    // never poll SePay or manufacture a webhook signature.
                    pendingVerifiedMoveOutRecovery = false;
                    var recovered = 0;
                    foreach (var profile in await scope.ServiceProvider.GetRequiredService<ISePayOwnerConnections>().ProfilesAsync(stoppingToken))
                    {
                        await using var recovery = scopes.CreateAsyncScope();
                        if (profile.OwnerId is { } owner)
                            await recovery.ServiceProvider.GetRequiredService<ISePayOwnerConnections>().ApplyOwnerAsync(owner, stoppingToken);
                        recovery.ServiceProvider.GetRequiredService<SePayOptions>().Select(profile.Mode);
                        recovered += await recovery.ServiceProvider.GetRequiredService<SePayService>().RecoverPreviouslyVerifiedMoveOutsAsync(stoppingToken);
                    }
                    if (recovered > 0)
                        logger.LogInformation("Completed {Count} previously verified move-outs", recovered);
                }
                _ = configuration;
                await scope.ServiceProvider.GetRequiredService<SePayScheduling>().EnqueueDueAsync(stoppingToken);
                await scope.ServiceProvider.GetRequiredService<MainContractActivationScheduling>().EnqueueDueAsync(stoppingToken);
                if (!jobs.Value.Enabled && await worker.ProcessAllowedAsync(stoppingToken, ["sepay-reconcile-test", "sepay-reconcile-live", "sepay-poll-test", "sepay-poll-live", MainContractActivationJob.JobName])) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning("SePay automation deferred with {ErrorCode}", error.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
