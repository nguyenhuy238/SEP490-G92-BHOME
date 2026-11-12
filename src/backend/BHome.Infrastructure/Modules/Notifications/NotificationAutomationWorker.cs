using BHome.Application.Notifications;
using BHome.Infrastructure.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

// Notification-only operation does not enable invoice finalization, contract expiry or other business jobs.
internal sealed class NotificationAutomationWorker(IServiceScopeFactory scopes, IOptions<NotificationChannelOptions> options,
    IOptions<JobWorkerOptions> jobs, ILogger<NotificationAutomationWorker> logger,
    IOptions<BHome.Infrastructure.IdentityAccess.AuthenticationEmailOptions> authentication,
    IHostEnvironment environment) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var authenticationOnly = !options.Value.AutomationEnabled;
        if (jobs.Value.Enabled || authenticationOnly && !authentication.Value.Configured(environment.IsDevelopment())) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                if (!authenticationOnly) await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(stoppingToken);
                await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().ProcessPendingAsync(stoppingToken, authenticationOnly);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogWarning("Notification automation deferred with {ErrorCode}", e.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, jobs.Value.PollSeconds)), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
