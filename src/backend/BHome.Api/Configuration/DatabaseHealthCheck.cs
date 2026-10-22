using BHome.Infrastructure.Persistence;
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
            return await db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy() : HealthCheckResult.Unhealthy("Database unavailable.");
        }
        catch (Exception) { return HealthCheckResult.Unhealthy("Database unavailable."); }
    }
}
