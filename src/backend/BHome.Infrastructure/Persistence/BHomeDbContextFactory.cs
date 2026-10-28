using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace BHome.Infrastructure.Persistence;

// Migration tooling does not need to start the API, background worker or JWT pipeline.
public sealed class BHomeDbContextFactory : IDesignTimeDbContextFactory<BHomeDbContext>
{
    public BHomeDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Database");
        if (string.IsNullOrWhiteSpace(connection))
            throw new InvalidOperationException("Set ConnectionStrings__Database for migration tooling.");
        return new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(connection).Options);
    }
}
