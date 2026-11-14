namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>Synthetic test data helpers (plan: "Test accounts: synthetic only", NFR 2.5).</summary>
public static class PlanData
{
    private static readonly TimeZoneInfo Vietnam = FindVietnam();

    /// <summary>Unique, readable name so repeated runs against the same database never collide.</summary>
    public static string Unique(string prefix) => $"{prefix} IT-{DateTime.UtcNow:MMddHHmmss}-{Guid.NewGuid().ToString("N")[..6]}";

    /// <summary>Current business date in Asia/Ho_Chi_Minh (docs/api: business dates use the Vietnam zone).</summary>
    public static DateOnly TodayVietnam => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Vietnam));

    public static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd");

    /// <summary>A tiny valid PNG (1×1) for evidence uploads where the plan only needs "a photo".</summary>
    public static byte[] TinyPng { get; } = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    public static Dictionary<string, string> IdempotencyKey(string? key = null) => new() { ["Idempotency-Key"] = key ?? Guid.NewGuid().ToString() };

    private static TimeZoneInfo FindVietnam()
    {
        foreach (var id in new[] { "Asia/Ho_Chi_Minh", "SE Asia Standard Time" })
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var tz))
            {
                return tz;
            }
        }

        return TimeZoneInfo.CreateCustomTimeZone("ICT", TimeSpan.FromHours(7), "ICT", "ICT");
    }
}

/// <summary>
/// Reasons used with [Fact(Skip = ...)] when a plan step cannot be driven from outside the API
/// (black-box run): moving the server clock, forcing a storage/notification failure, or triggering a background job.
/// </summary>
public static class PlanSkip
{
    public const string ServerClock = "Not automatable black-box: the plan needs the server time to move forward. Run manually (or with a test host that controls the clock).";
    public const string FailureInjection = "Not automatable black-box: the plan needs a storage/notification failure to be simulated inside the server. Run manually.";
    public const string BackgroundJob = "Not automatable black-box: the plan needs a background job to be triggered on demand; docs/api does not document a route for it. Run manually.";
}
