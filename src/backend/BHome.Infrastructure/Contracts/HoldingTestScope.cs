using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt.SePay;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace BHome.Infrastructure.Contracts;

internal sealed class HoldingTestScope(IConfiguration configuration, IHostEnvironment environment, SePayOptions options) : IHoldingTestScope
{
    private bool SigningSandboxAvailable => environment.EnvironmentName is "Development" or "Testing" or "Staging" && options.Enabled && options.Mode == "Test";
    private Guid[] Locations => configuration.GetSection("HoldingTesting:LocationIds").Get<string[]>()?
        .Select(x => Guid.TryParse(x, out var id) ? id : Guid.Empty).Where(x => x != Guid.Empty).Distinct().ToArray() ?? [];
    public bool AllowsExternalDatabase
    {
        get
        {
            if (!configuration.GetValue<bool>("HoldingTesting:Enabled") || !SigningSandboxAvailable ||
                !options.Valid(environment.EnvironmentName) || Locations.Length == 0) return false;
            var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
            return target.Host is { } host && host.EndsWith(".neon.tech", StringComparison.OrdinalIgnoreCase) &&
                host == configuration["HoldingTesting:DatabaseHost"] && target.Database == configuration["HoldingTesting:DatabaseName"] &&
                target.SslMode == SslMode.VerifyFull && target.ChannelBinding == ChannelBinding.Require;
        }
    }
    public bool Allows(Guid locationId)
    {
        if (!SigningSandboxAvailable) return false;
        if (AllowsExternalDatabase && Locations.Contains(locationId)) return true;
        if (!options.TestingAvailable(environment.EnvironmentName) || !options.Valid(environment.EnvironmentName)) return false;
        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
        if (environment.IsStaging() && configuration.GetValue<bool>("HoldingTesting:Enabled") && Locations.Contains(locationId) &&
                options.ReceivingAccounts.Any(account => account.LocationId == locationId) &&
                !string.IsNullOrWhiteSpace(target.Host) && !string.IsNullOrWhiteSpace(target.Database) &&
                target.Host == configuration["HoldingTesting:DatabaseHost"] &&
                target.Database == configuration["HoldingTesting:DatabaseName"])
            return true;
        var pattern = environment.IsEnvironment("Testing") ? "^bhome_compact24_(?:dev_)?[a-f0-9]{32}$" : "^bhome_compact24_dev_[a-f0-9]{32}$";
        // The deployed Staging stack reaches its isolated disposable database through
        // Docker DNS. Require the Staging anchor and the same development database name guard.
        var anchoredStaging = environment.IsStaging() && configuration["Deployment:Environment"] == "Staging";
        var localHost = (target.Host is "localhost" or "127.0.0.1" or "::1") &&
            (!environment.IsStaging() || anchoredStaging);
        var stagingDocker = anchoredStaging && target.Host == "postgres";
        return (localHost || stagingDocker) && System.Text.RegularExpressions.Regex.IsMatch(target.Database ?? "", pattern);
    }
}
