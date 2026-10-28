using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace BHome.Api.Configuration;

internal sealed class DatabaseHealthCheck(IServiceScopeFactory scopeFactory) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            if (!await db.Database.CanConnectAsync(cancellationToken))
                return HealthCheckResult.Unhealthy("Database unavailable.");
            if ((await db.Database.GetPendingMigrationsAsync(cancellationToken)).Any())
                return HealthCheckResult.Unhealthy("Database migrations pending.");
            return HealthCheckResult.Healthy();
        }
        catch (Exception) { return HealthCheckResult.Unhealthy("Database unavailable."); }
    }
}
