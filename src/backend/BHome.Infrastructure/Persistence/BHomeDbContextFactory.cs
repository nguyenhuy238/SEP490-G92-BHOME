using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace BHome.Infrastructure.Persistence;

// Offline source-schema tooling only. The normal API uses Compact24DbContext.
public sealed class BHomeDbContextFactory : IDesignTimeDbContextFactory<BHomeDbContext>
{
    public BHomeDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("BHOME_COMPACT24_SOURCE");
        if (string.IsNullOrWhiteSpace(connection))
            throw new InvalidOperationException("Set BHOME_COMPACT24_SOURCE to a dedicated legacy source; this factory does not migrate the runtime database.");
        var target = new Npgsql.NpgsqlConnectionStringBuilder(connection);
        if (target.Host is not ("127.0.0.1" or "localhost" or "::1") ||
            !System.Text.RegularExpressions.Regex.IsMatch(target.Database ?? "", "^bhome_compact24_source_[a-f0-9]{32}$"))
            throw new InvalidOperationException("A dedicated, explicitly named legacy source database is required.");
        return new BHomeDbContext(new DbContextOptionsBuilder<BHomeDbContext>().UseNpgsql(connection).Options);
    }
}
