using System.Text.Json;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>A test account named in the plan (or supplied through environment variables).</summary>
public sealed record PlanAccount(string Name, string Email, string Password, string? Phone);

/// <summary>
/// Run configuration. Defaults are read from plan-tests.settings.json; every value can be overridden:
/// BHOME_IT_BASE_URL, BHOME_IT_DB (Npgsql connection string), BHOME_IT_INSECURE_TLS (true/false),
/// BHOME_IT_ACCOUNT_{NAME}_EMAIL / _PASSWORD / _PHONE (NAME = OWNER, STAFF, TENANT or any extra account a test asks for).
/// </summary>
public sealed class PlanSettings
{
    private readonly Dictionary<string, PlanAccount> _accounts;

    private PlanSettings(Uri baseUrl, bool acceptAnyServerCertificate, string? database, Dictionary<string, PlanAccount> accounts)
    {
        BaseUrl = baseUrl;
        AcceptAnyServerCertificate = acceptAnyServerCertificate;
        Database = database;
        _accounts = accounts;
    }

    public static PlanSettings Current { get; } = Load();

    public Uri BaseUrl { get; }

    public bool AcceptAnyServerCertificate { get; }

    public string? Database { get; }

    /// <summary>Returns a configured account or skips the test, naming the missing environment variables.</summary>
    public PlanAccount Account(string name)
    {
        var key = name.ToLowerInvariant();
        var envName = name.ToUpperInvariant();
        var email = Environment.GetEnvironmentVariable($"BHOME_IT_ACCOUNT_{envName}_EMAIL");
        var password = Environment.GetEnvironmentVariable($"BHOME_IT_ACCOUNT_{envName}_PASSWORD");
        var phone = Environment.GetEnvironmentVariable($"BHOME_IT_ACCOUNT_{envName}_PHONE");
        _accounts.TryGetValue(key, out var configured);
        email ??= configured?.Email;
        password ??= configured?.Password;
        phone ??= configured?.Phone;
        Skip.If(
            string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password),
            $"Test account '{name}' is not configured. Set BHOME_IT_ACCOUNT_{envName}_EMAIL and BHOME_IT_ACCOUNT_{envName}_PASSWORD.");
        return new PlanAccount(key, email!, password!, phone);
    }

    private static PlanSettings Load()
    {
        var file = Path.Combine(AppContext.BaseDirectory, "plan-tests.settings.json");
        var baseUrl = "https://localhost:7240";
        var insecure = true;
        string? database = null;
        var accounts = new Dictionary<string, PlanAccount>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(file))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var root = doc.RootElement;
            if (root.TryGetProperty("baseUrl", out var b) && b.ValueKind == JsonValueKind.String) baseUrl = b.GetString()!;
            if (root.TryGetProperty("acceptAnyServerCertificate", out var i) && i.ValueKind is JsonValueKind.True or JsonValueKind.False) insecure = i.GetBoolean();
            if (root.TryGetProperty("database", out var d) && d.ValueKind == JsonValueKind.String) database = d.GetString();
            if (root.TryGetProperty("accounts", out var a) && a.ValueKind == JsonValueKind.Object)
            {
                foreach (var p in a.EnumerateObject())
                {
                    accounts[p.Name] = new PlanAccount(
                        p.Name,
                        p.Value.TryGetProperty("email", out var e) ? e.GetString() ?? "" : "",
                        p.Value.TryGetProperty("password", out var pw) ? pw.GetString() ?? "" : "",
                        p.Value.TryGetProperty("phone", out var ph) ? ph.GetString() : null);
                }
            }
        }

        baseUrl = Environment.GetEnvironmentVariable("BHOME_IT_BASE_URL") ?? baseUrl;
        database = Environment.GetEnvironmentVariable("BHOME_IT_DB") ?? database;
        if (bool.TryParse(Environment.GetEnvironmentVariable("BHOME_IT_INSECURE_TLS"), out var envInsecure)) insecure = envInsecure;
        return new PlanSettings(new Uri(baseUrl.TrimEnd('/') + "/"), insecure, string.IsNullOrWhiteSpace(database) ? null : database, accounts);
    }
}
