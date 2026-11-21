using System.Diagnostics;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application.Contracts;
using BHome.Domain.IdentityAccess;

namespace BHome.DigitalSigning.Application.Services;

// The Viettel MySign account the provider runs on: configuration (DigitalSigning:Viettel), overridden field by field by
// what an Owner saved. A field left blank keeps the configured value, so a deployment that only sets variables works
// without a saved row. The client secret is stored encrypted and never returned.
public sealed class SigningAccountService(
    ICurrentUser user, ISigningSettingsStore store, ISecretProtector protector, DigitalSigningPolicy policy,
    SigningAccountCache cache, TimeProvider clock) : IViettelAccountSource
{
    private const string Database = "DATABASE";
    private const string Configuration = "CONFIGURATION";
    private const string None = "NONE";

    // Asked by the provider on every call; a saved change applies within the cache's few seconds on every server.
    public async Task<ViettelAccount> CurrentAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (cache.TryGet(now) is { } known) return known;
        var row = await store.FindAsync(cancellationToken);
        var account = Merge(row, Secret(row).Value);
        cache.Set(account, now);
        return account;
    }

    public async Task<ViettelSettingsView> ViewAsync(CancellationToken cancellationToken)
    {
        RequireOwner();
        return View(await store.FindAsync(cancellationToken));
    }

    public async Task<ViettelSettingsView> SaveAsync(SaveViettelSettings input, CancellationToken cancellationToken)
    {
        var actor = RequireOwner();
        var baseUrl = Trimmed(input.BaseUrl);
        RequireHttpUrl(baseUrl);
        var secret = SecretInput(input.ClientSecret);
        var before = await store.FindAsync(cancellationToken);
        var secretEncrypted = input.ClearSecret ? null
            : secret is not null ? protector.Protect(secret)
            : Readable(before?.ClientSecretEncrypted);
        await SaveRowAsync(new ViettelSettingsRow(baseUrl, Limited(input.ClientId, 200, "Client ID"),
            Limited(input.ProfileId, 200, "Profile ID"), secretEncrypted, actor, clock.GetUtcNow()), cancellationToken);
        return View(await store.FindAsync(cancellationToken));
    }

    // "Dùng cấu hình của máy chủ": forgets what was saved, so configuration applies again.
    public async Task<ViettelSettingsView> ResetAsync(CancellationToken cancellationToken)
    {
        var actor = RequireOwner();
        await SaveRowAsync(new ViettelSettingsRow(null, null, null, null, actor, clock.GetUtcNow()), cancellationToken);
        return View(await store.FindAsync(cancellationToken));
    }

    // "Kiểm tra kết nối": logs in to Viettel as one registered signer with the account in force. Nothing is signed.
    public async Task<ConnectionTestResult> TestAsync(ISigningProvider provider, string? providerUserId,
        CancellationToken cancellationToken)
    {
        RequireOwner();
        var userId = providerUserId?.Trim();
        if (string.IsNullOrEmpty(userId) || userId.Length > 100)
            throw DigitalSigningException.Invalid("Nhập mã thuê bao MySign của một người ký để kiểm tra.");
        var started = Stopwatch.StartNew();
        string? refused;
        try
        {
            refused = await provider.CheckAccountAsync(userId, cancellationToken);
        }
        catch (SigningProviderException failure)
        {
            refused = failure.Message;
        }
        return new ConnectionTestResult(refused is null, started.ElapsedMilliseconds, refused ?? "OK");
    }

    private async Task SaveRowAsync(ViettelSettingsRow row, CancellationToken cancellationToken)
    {
        await store.SaveAsync(row, cancellationToken);
        cache.Clear();
    }

    private ViettelAccount Merge(ViettelSettingsRow? row, string? secret)
    {
        var defaults = policy.ViettelDefaults;
        return defaults with
        {
            BaseUrl = Pick(row?.BaseUrl, defaults.BaseUrl),
            ClientId = Pick(row?.ClientId, defaults.ClientId),
            ClientSecret = Pick(secret, defaults.ClientSecret),
            ProfileId = Pick(row?.ProfileId, defaults.ProfileId)
        };
    }

    private ViettelSettingsView View(ViettelSettingsRow? row)
    {
        var (secret, unreadable) = Secret(row);
        var account = Merge(row, secret);
        var defaults = policy.ViettelDefaults;
        return new ViettelSettingsView(
            account.BaseUrl ?? "", Source(row?.BaseUrl, defaults.BaseUrl),
            account.ClientId ?? "", Source(row?.ClientId, defaults.ClientId),
            account.ProfileId ?? "", Source(row?.ProfileId, defaults.ProfileId),
            !string.IsNullOrWhiteSpace(account.ClientSecret), Hint(account.ClientSecret),
            Source(secret, defaults.ClientSecret), unreadable, row?.UpdatedByUserId, row?.UpdatedAt);
    }

    // A secret saved under a key that has since changed no longer decrypts: say so, and let the configured one work meanwhile.
    private (string? Value, bool Unreadable) Secret(ViettelSettingsRow? row)
    {
        if (row?.ClientSecretEncrypted is null) return (null, false);
        try
        {
            return (protector.Unprotect(row.ClientSecretEncrypted), false);
        }
        catch (SecretUnreadableException)
        {
            return (null, true);
        }
    }

    // A stored secret is carried over only while it still decrypts.
    private string? Readable(string? encrypted)
    {
        if (encrypted is null) return null;
        try
        {
            protector.Unprotect(encrypted);
            return encrypted;
        }
        catch (SecretUnreadableException)
        {
            return null;
        }
    }

    // The account signs for the whole deployment, so only an Owner changes or tests it.
    private Guid RequireOwner()
    {
        if (user.UserId is not { } id || id == Guid.Empty)
            throw new DigitalSigningException(DigitalSigningError.Unauthenticated, "Bạn cần đăng nhập.");
        if (!user.IsInRole(Roles.Owner))
            throw DigitalSigningException.Forbidden("Chỉ chủ nhà cấu hình được tài khoản ký số.");
        return id;
    }

    private static string? Pick(string? saved, string? configured) => string.IsNullOrWhiteSpace(saved) ? configured : saved;

    private static string Source(string? saved, string? configured) =>
        !string.IsNullOrWhiteSpace(saved) ? Database : !string.IsNullOrWhiteSpace(configured) ? Configuration : None;

    // The last four characters, enough to tell two secrets apart without revealing either.
    private static string Hint(string? secret)
    {
        var trimmed = secret?.Trim() ?? "";
        return trimmed.Length <= 8 ? "" : trimmed[^4..];
    }

    private static string? SecretInput(string? typed)
    {
        var value = Trimmed(typed);
        if (value is not null && value.Any(char.IsWhiteSpace))
            throw DigitalSigningException.Invalid("Client secret không được chứa khoảng trắng hoặc xuống dòng.");
        if (value is { Length: > 500 }) throw DigitalSigningException.Invalid("Client secret tối đa 500 ký tự.");
        return value;
    }

    private static string? Limited(string? typed, int max, string what)
    {
        var value = Trimmed(typed);
        return value is null || value.Length <= max
            ? value
            : throw DigitalSigningException.Invalid($"{what} tối đa {max} ký tự.");
    }

    private static void RequireHttpUrl(string? url)
    {
        if (url is null) return;
        if (url.Length > 300 || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw DigitalSigningException.Invalid("Địa chỉ cổng ký số phải là URL http(s), tối đa 300 ký tự.");
    }

    private static string? Trimmed(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

// Shared by every request on this server: the account read from the database a few seconds ago.
public sealed class SigningAccountCache
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(10);
    private volatile Entry? entry;

    private sealed record Entry(ViettelAccount Account, DateTimeOffset LoadedAt);

    public ViettelAccount? TryGet(DateTimeOffset now) => entry is { } known && now - known.LoadedAt < Ttl ? known.Account : null;

    public void Set(ViettelAccount account, DateTimeOffset now) => entry = new Entry(account, now);

    public void Clear() => entry = null;
}
