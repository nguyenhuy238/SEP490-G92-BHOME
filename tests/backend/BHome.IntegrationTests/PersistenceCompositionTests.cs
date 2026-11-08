using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

public sealed class PersistenceCompositionTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task EachSchemaHasAValidServiceGraphAndOnlyItsSupportedJobs(bool compact)
    {
        await using var factory = new ApiFactory
        {
            UseCompact24 = compact,
            ConfigureTestHost = builder => builder.UseDefaultServiceProvider(options =>
            {
                options.ValidateOnBuild = true;
                options.ValidateScopes = true;
            })
        };
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(compact ? typeof(Compact24DbContext) : typeof(BHomeDbContext), db.GetType());
        var names = services.GetServices<IBackgroundJobHandler>().Select(h => h.Name).Order().ToArray();
        var shared = new[] { "billing-draft", "billing-final", "billing-meter", "contract-expiry",
            "incident.notification", "notification-publish", "notification-delivery" };
        var expected = compact ? shared.Concat(["notification-channels", "recurring-operational-tasks"]) : shared;
        Assert.Equal(expected.Order(), names);
        Assert.Equal(compact ? 5 : 3, services.GetServices<IJobScheduleContributor>().Count());
        if (!compact) Assert.Null(services.GetService<Compact24DbContext>());
    }
}
