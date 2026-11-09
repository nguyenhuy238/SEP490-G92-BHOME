using BHome.Infrastructure.Jobs;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.PropertyManagement;

// Enables desired-inventory automation independently of financial and Contract lifecycle jobs.
internal sealed class AssetTemplateAutomationWorker(IServiceScopeFactory scopes, IConfiguration configuration,
    IOptions<JobWorkerOptions> jobs, ILogger<AssetTemplateAutomationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue<bool>("OwnerSetup:AssetSyncEnabled") || jobs.Value.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<AssetTemplateSyncJob>().ExecuteAsync(new(Guid.Empty, "asset-sync-poll", "{}"), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogWarning("Asset template synchronization deferred with {ErrorCode}", e.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
