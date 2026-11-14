using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt.SePay;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace BHome.Infrastructure.Contracts;

internal sealed class HoldingTestScope(IConfiguration configuration, IHostEnvironment environment, SePayOptions options) : IHoldingTestScope
{
    private Guid[] Locations => configuration.GetSection("HoldingTesting:LocationIds").Get<string[]>()?
        .Select(x => Guid.TryParse(x, out var id) ? id : Guid.Empty).Where(x => x != Guid.Empty).Distinct().ToArray() ?? [];
    public bool AllowsExternalDatabase
    {
        get
        {
            if (!configuration.GetValue<bool>("HoldingTesting:Enabled") || !options.TestingAvailable(environment.EnvironmentName) ||
                !options.Valid(environment.EnvironmentName) || Locations.Length == 0) return false;
            var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
            return target.Host is { } host && host.EndsWith(".neon.tech", StringComparison.OrdinalIgnoreCase) &&
                host == configuration["HoldingTesting:DatabaseHost"] && target.Database == configuration["HoldingTesting:DatabaseName"] &&
                target.SslMode == SslMode.VerifyFull && target.ChannelBinding == ChannelBinding.Require;
        }
    }
    public bool Allows(Guid locationId)
    {
        if (AllowsExternalDatabase && Locations.Contains(locationId)) return true;
        if (!options.TestingAvailable(environment.EnvironmentName) || !options.Valid(environment.EnvironmentName)) return false;
        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
        var pattern = environment.IsEnvironment("Testing") ? "^bhome_compact24_(?:dev_)?[a-f0-9]{32}$" : "^bhome_compact24_dev_[a-f0-9]{32}$";
        return target.Host is "localhost" or "127.0.0.1" or "::1" && System.Text.RegularExpressions.Regex.IsMatch(target.Database ?? "", pattern);
    }
}
