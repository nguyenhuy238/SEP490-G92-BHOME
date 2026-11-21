using System.Net;
using System.Text.RegularExpressions;
using Npgsql;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>
/// The plan tests can change accounts, contracts and payments on a running API.
/// Never allow HTTP or PostgreSQL access from a normal solution/CI test run.
/// </summary>
internal static class PlanExecutionGate
{
    private const string OptInName = "BHOME_IT_ALLOW_EXTERNAL_API_TESTS";
    private const string ApiUrlName = "BHOME_IT_BASE_URL";
    private const string DatabaseName = "BHOME_IT_DB";

    internal static void RequireAuthorized()
    {
        var reason = RejectionReason(
            Environment.GetEnvironmentVariable(OptInName),
            Environment.GetEnvironmentVariable(ApiUrlName),
            Environment.GetEnvironmentVariable(DatabaseName));

        Skip.If(reason is not null, reason);
    }

    // Pure validation lets the guard be tested without changing environment variables,
    // opening a socket, or affecting concurrent xUnit cases.
    internal static string? RejectionReason(string? optIn, string? baseUrl, string? database)
    {
        if (!string.Equals(optIn, "true", StringComparison.OrdinalIgnoreCase))
            return $"External plan tests are disabled. Set {OptInName}=true only for a disposable API/DB fixture.";

        if (string.IsNullOrWhiteSpace(baseUrl) ||
            !Uri.TryCreate(baseUrl, UriKind.Absolute, out var api) ||
            api.Scheme is not ("http" or "https") ||
            !IsLoopback(api.Host) ||
            api.IsDefaultPort || api.Port == 7240 ||
            api.UserInfo.Length > 0 || api.Query.Length > 0 || api.Fragment.Length > 0 ||
            api.AbsolutePath != "/")
        {
            return $"Set {ApiUrlName} explicitly to a dedicated loopback HTTP(S) API port (not the normal 7240 port).";
        }

        if (string.IsNullOrWhiteSpace(database))
            return $"Set {DatabaseName} explicitly to the disposable PostgreSQL fixture used by that API.";

        try
        {
            var options = new NpgsqlConnectionStringBuilder(database);
            if (!IsLoopback(options.Host) ||
                options.Port == 5432 ||
                !Regex.IsMatch(options.Database ?? "", "^bhome_plan_it_[0-9a-f]{32}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            {
                return $"{DatabaseName} must target a loopback PostgreSQL fixture on a non-default port with database bhome_plan_it_<32 hex characters>.";
            }
        }
        catch (ArgumentException)
        {
            return $"{DatabaseName} is not a valid PostgreSQL connection string for a disposable fixture.";
        }

        return null;
    }

    private static bool IsLoopback(string? host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        (IPAddress.TryParse(host?.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip));
}
