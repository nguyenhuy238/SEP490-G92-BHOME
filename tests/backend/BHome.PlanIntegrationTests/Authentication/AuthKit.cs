using System.Globalization;
using System.Text;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.Authentication;

/// <summary>Small helpers shared by the Authentication sheet tests (routes from the plan, tables/columns named in the plan).</summary>
internal static class AuthKit
{
    public const string Login = "api/v1/auth/login";
    public const string Me = "api/v1/auth/me";
    public const string Refresh = "api/v1/auth/refresh";
    public const string Logout = "api/v1/auth/logout";
    public const string Profile = "api/v1/profile";

    /// <summary>True when BHOME_IT_DB is set, so "before" values can be read without skipping the HTTP part.</summary>
    public static bool DbOn => PlanSettings.Current.Database is not null;

    public static Task<HttpResponseMessage> LoginAsync(PlanApi api, string email, string password, string? device = null)
        => api.PostAsync(Login, new { email, password, device });

    /// <summary>roles array of a login / me answer (empty when absent).</summary>
    public static string[] Roles(JsonElement json)
    {
        var roles = json.Find("roles");
        return roles is { ValueKind: JsonValueKind.Array }
            ? roles.Value.EnumerateArray().Select(r => r.GetString() ?? string.Empty).ToArray()
            : [];
    }

    /// <summary>Reads one AspNetUsers column (name as written in the plan) for the account, looked up by NormalizedEmail.</summary>
    public static async Task<object?> UserColumnAsync(string column, string email)
    {
        await PlanDb.RequirePlanTableAsync("AspNetUsers");
        return await PlanDb.ScalarAsync(
            $"SELECT \"{column}\" FROM \"AspNetUsers\" WHERE \"NormalizedEmail\" = upper(@e) LIMIT 1",
            ("e", email.Trim()));
    }

    /// <summary>Runs an UPDATE on AspNetUsers for the account (seeding / restoring steps the plan asks for).</summary>
    public static async Task UpdateUserAsync(string setClause, string email)
    {
        await PlanDb.RequirePlanTableAsync("AspNetUsers");
        await PlanDb.ExecuteAsync($"UPDATE \"AspNetUsers\" SET {setClause} WHERE \"NormalizedEmail\" = upper(@e)", ("e", email.Trim()));
    }

    /// <summary>Total rows of a plan table.</summary>
    public static async Task<long> CountAsync(string table)
    {
        await PlanDb.RequirePlanTableAsync(table);
        return Long(await PlanDb.ScalarAsync($"SELECT COUNT(*) FROM \"{table}\""));
    }

    /// <summary>Hash of the whole table content, to check that "no row was modified".</summary>
    public static async Task<string> FingerprintAsync(string table)
    {
        await PlanDb.RequirePlanTableAsync(table);
        return (await PlanDb.ScalarAsync($"SELECT COALESCE(md5(string_agg(t::text, '|' ORDER BY t::text)), '') FROM \"{table}\" t"))?.ToString() ?? string.Empty;
    }

    /// <summary>Replaces a value inside the JWT payload segment while keeping the original signature.</summary>
    public static string TamperPayload(string jwt, string from, string to)
    {
        var parts = jwt.Split('.');
        Assert.True(parts.Length == 3, "The access token is not a JWT (header.payload.signature).");
        var payload = Encoding.UTF8.GetString(FromBase64Url(parts[1]));
        var tampered = payload.Replace(from, to, StringComparison.Ordinal);
        Assert.True(tampered != payload, $"The JWT payload does not contain {from}: {payload}");
        parts[1] = Convert.ToBase64String(Encoding.UTF8.GetBytes(tampered)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return string.Join('.', parts);
    }

    /// <summary>A password that satisfies the documented policy (12+ chars, upper, lower, digit, symbol).</summary>
    public static long Long(object? value) => Convert.ToInt64(value, CultureInfo.InvariantCulture);

    public static int Int(object? value) => Convert.ToInt32(value, CultureInfo.InvariantCulture);

    public static double Double(object? value) => Convert.ToDouble(value, CultureInfo.InvariantCulture);

    public static string NewStrongPassword() => $"ItPwd@{Random.Shared.Next(10000000, 99999999)}x";

    private static byte[] FromBase64Url(string s)
    {
        var b = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(b.PadRight(b.Length + ((4 - (b.Length % 4)) % 4), '='));
    }
}
