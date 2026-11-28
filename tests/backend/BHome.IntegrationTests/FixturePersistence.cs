using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests;

// Only direct test fixture seeding and persisted-state assertions use this adapter.
// API requests and repositories continue to resolve the strict runtime context.
internal static class FixturePersistence
{
    internal static BHomePersistenceContext GetFixturePersistence(this IServiceProvider services) =>
        services.GetService<Compact24ArchiveContext>() ??
        services.GetRequiredService<BHomePersistenceContext>();
}
