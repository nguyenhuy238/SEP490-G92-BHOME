using System.Net;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.Infrastructure;

/// <summary>A signed-in session returned by POST /api/v1/auth/login (fields per docs/api/API_CONVENTIONS.md).</summary>
public sealed record LoginSession(PlanAccount Account, string AccessToken, string? RefreshToken, string? SessionId, string? UserId, JsonElement Body);

/// <summary>
/// Shared by every test class through <see cref="PlanCollection"/>. Caches one session per account so the suite stays under
/// the auth rate limit; a cached session is checked with GET /api/v1/session and replaced when it is no longer valid.
/// Tests that end, revoke or rotate a session must use <see cref="NewSessionAsync"/> instead of the cache.
/// </summary>
public sealed class PlanSessions : IAsyncLifetime
{
    private readonly Dictionary<string, LoginSession> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _lock = new(1, 1);

    public PlanApi Api { get; } = new();

    public static async Task<LoginSession> LoginAsync(PlanApi api, PlanAccount account, string? device = null)
    {
        var response = await api.PostAsync("api/v1/auth/login", new { email = account.Email, password = account.Password, device });
        var body = await response.TextAsync();
        Skip.If(
            response.StatusCode != HttpStatusCode.OK,
            $"Precondition failed: account '{account.Name}' ({account.Email}) could not sign in (HTTP {(int)response.StatusCode}). Body: {body}");
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement.Clone();
        return new LoginSession(
            account,
            root.Str("accessToken") ?? throw new InvalidOperationException("Login answer has no accessToken: " + body),
            root.Str("refreshToken"),
            root.Str("sessionId"),
            root.Str("userId"),
            root);
    }

    /// <summary>Cached, still-valid session for an account name from the settings (owner, staff, tenant, …).</summary>
    public async Task<LoginSession> SessionAsync(string accountName)
    {
        var account = PlanSettings.Current.Account(accountName);
        await _lock.WaitAsync();
        try
        {
            if (_cache.TryGetValue(account.Name, out var cached))
            {
                using var probe = await Api.GetAsync("api/v1/session", cached.AccessToken);
                if (probe.StatusCode == HttpStatusCode.OK)
                {
                    return cached;
                }
            }

            var fresh = await LoginAsync(Api, account);
            _cache[account.Name] = fresh;
            return fresh;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<string> TokenAsync(string accountName) => (await SessionAsync(accountName)).AccessToken;

    /// <summary>A brand-new session that is not cached (for sign-out, refresh, password tests).</summary>
    public Task<LoginSession> NewSessionAsync(string accountName, string? device = null)
        => LoginAsync(Api, PlanSettings.Current.Account(accountName), device);

    /// <summary>Drop a cached session after a test revoked every session of that account.</summary>
    public void Forget(string accountName) => _cache.Remove(accountName);

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        Api.Dispose();
        _lock.Dispose();
        return Task.CompletedTask;
    }
}

[CollectionDefinition(Name)]
public sealed class PlanCollection : ICollectionFixture<PlanSessions>
{
    public const string Name = "BHOME integration test plan";
}
