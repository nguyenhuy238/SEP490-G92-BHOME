using BHome.Application.IncidentMaintenance;
using BHome.Application.IncidentMaintenance.Jobs;
using BHome.Application.IncidentMaintenance.Services;
using BHome.Application.Jobs;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.IncidentMaintenance;

// FE-06 registrations (MODULES.md step 6).
internal static class IncidentMaintenanceModule
{
    public static IServiceCollection AddIncidentMaintenance(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<IncidentMaintenanceOptions>().Bind(configuration.GetSection(IncidentMaintenanceOptions.Section))
            .Validate(o => o.IsValid(), "Incident reminder/overdue minutes are outside supported bounds.").ValidateOnStart();
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<IncidentMaintenanceOptions>>().Value);

        services.AddScoped<IIncidentMaintenanceStore, IncidentMaintenanceStore>();
        services.AddScoped<IMaintenanceDirectory, MaintenanceDirectory>();
        services.AddScoped<IMaintenanceExpenseRecorder, MaintenanceExpenseRecorder>();
        services.AddScoped<ITenantRoomScope, UnavailableTenantRoomScope>();

        services.AddScoped<MaintenanceAccess>();
        services.AddScoped<MaintenanceEvidence>();
        services.AddScoped<MaintenanceNotifier>();
        services.AddScoped<IncidentReportService>();
        services.AddScoped<EmergencyResponseService>();
        services.AddScoped<IncidentReviewService>();
        services.AddScoped<WorkOrderService>();
        services.AddScoped<AssetService>();

        services.AddScoped<IBackgroundJobHandler, IncidentNotificationJobHandler>();
        services.AddScoped<EmergencyEscalationJob>();
        services.AddHostedService<EmergencyEscalationWorker>();
        return services;
    }
}

// Runs JOB-11 every minute when background jobs are enabled (same switch as the job worker).
internal sealed class EmergencyEscalationWorker(IServiceScopeFactory scopes, IOptions<JobWorkerOptions> jobs,
    ILogger<EmergencyEscalationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!jobs.Value.Enabled) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<EmergencyEscalationJob>().RunAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                logger.LogWarning("Emergency escalation run failed ({ErrorType})", exception.GetType().Name);
            }
        }
    }
}
