using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Npgsql;
using System.Text.RegularExpressions;

namespace BHome.Infrastructure.Persistence.Compact24;

// Explicit operator tooling only. The API never invokes migrations at startup.
public sealed class Compact24DbContextFactory : IDesignTimeDbContextFactory<Compact24DbContext>
{
    public const string DevelopmentDirectHost = "ep-royal-water-ao5mauq0.c-2.ap-southeast-1.aws.neon.tech";

    public static NpgsqlConnectionStringBuilder ValidateTarget(string? connection, string? branch)
    {
        NpgsqlConnectionStringBuilder target;
        try { target = new(connection ?? ""); }
        catch (ArgumentException) { throw new InvalidOperationException("Invalid Compact24 direct configuration; credentials suppressed."); }
        var isolatedLocal = target.Host is "127.0.0.1" or "localhost" or "::1" &&
            Regex.IsMatch(target.Database ?? "", "^bhome_compact24_[a-f0-9]{32}$");
        var development = target.Host == DevelopmentDirectHost && target.Database == "neondb" && branch == "development" &&
            target.SslMode == SslMode.VerifyFull && target.ChannelBinding == ChannelBinding.Require;
        if (!isolatedLocal && !development)
            throw new InvalidOperationException("Use an isolated local Compact24 database or the verified development direct endpoint with BHOME_DATABASE_BRANCH=development.");
        target.Pooling = false;
        target.IncludeErrorDetail = false;
        target.LogParameters = false;
        target.PersistSecurityInfo = false;
        return target;
    }

    public Compact24DbContext CreateDbContext(string[] args)
    {
        var target = ValidateTarget(Environment.GetEnvironmentVariable("BHOME_COMPACT24_DIRECT"),
            Environment.GetEnvironmentVariable("BHOME_DATABASE_BRANCH"));
        return new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(target.ConnectionString).Options);
    }
}
