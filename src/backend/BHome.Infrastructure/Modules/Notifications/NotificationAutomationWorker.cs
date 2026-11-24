using BHome.Application.Notifications;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

// Notification-only operation does not enable invoice finalization, contract expiry or other business jobs.
internal sealed class NotificationAutomationWorker(IServiceScopeFactory scopes, IOptions<NotificationChannelOptions> options,
    IOptions<JobWorkerOptions> jobs, ILogger<NotificationAutomationWorker> logger,
    IOptions<BHome.Infrastructure.IdentityAccess.AuthenticationEmailOptions> authentication,
    IHostEnvironment environment, IOptions<BHome.Application.IdentityAccess.SmsRecoveryOptions> recovery) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.WhenAll(
        DeliverAuthenticationAsync(stoppingToken), PublishNotificationsAsync(stoppingToken));

    private async Task DeliverAuthenticationAsync(CancellationToken stoppingToken)
    {
        if (jobs.Value.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            // Committed authentication emails must still drain if publishing an
            // unrelated domain notification fails. Use a separate DbContext scope.
            try
            {
                await using var deliveryScope = scopes.CreateAsyncScope();
                await deliveryScope.ServiceProvider.GetRequiredService<PostgresJobWorker>()
                    .ProcessAllowedAsync(stoppingToken, [AccountInvitationJob.JobName, SmsPasswordRecovery.JobName]);
                await deliveryScope.ServiceProvider.GetRequiredService<NotificationChannelWorker>()
                    .ProcessPendingAsync(stoppingToken, authenticationOnly: true);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogWarning("Notification delivery deferred with {ErrorCode}", e.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, jobs.Value.PollSeconds)), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    private async Task PublishNotificationsAsync(CancellationToken stoppingToken)
    {
        // BackgroundService.StartAsync runs synchronously until the first incomplete
        // await. Resolving notification/job persistence can block startup for minutes;
        // allow Kestrel to start independently of the notification delivery loop.
        await Task.Yield();
        var businessEmailOnly = !options.Value.AutomationEnabled && options.Value.ContractAndInvoiceEmailEnabled;
        var authenticationOnly = !options.Value.AutomationEnabled && !businessEmailOnly;
        if (jobs.Value.Enabled || authenticationOnly && !authentication.Value.AnyConfigured(environment.IsDevelopment()) && !recovery.Value.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                // Reuse the durable job lease/retry implementation, allowing account invitations only.
                // Jobs.Enabled remains false: invoice/contract/payment automation cannot run here.
                await scope.ServiceProvider.GetRequiredService<PostgresJobWorker>()
                    .ProcessAllowedAsync(stoppingToken, [AccountInvitationJob.JobName, SmsPasswordRecovery.JobName]);
                if (!authenticationOnly) await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(stoppingToken);
                else await scope.ServiceProvider.GetRequiredService<CompactNotificationEvents>().PublishAuthenticationAsync(stoppingToken);
                if (!authenticationOnly) await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>()
                    .ProcessPendingAsync(stoppingToken, businessEmailOnly: businessEmailOnly);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogWarning("Notification automation deferred with {ErrorCode}", e.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, jobs.Value.PollSeconds)), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
