using System.Security.Cryptography;
using System.Text.Json;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;

namespace BHome.DigitalSigning.Sandbox;

// Which MySign the sandbox talks to. Sandbox:Provider = Auto (default): the real Viettel MySign as soon as an account
// is configured (saved on the page or set in the environment), the fake one until then. Fake or Viettel force one.
internal sealed class SandboxMode(string? setting, Type realProvider)
{
    public string Setting { get; } = setting?.Trim() is { Length: > 0 } value ? value : "Auto";
    public Type RealProvider { get; } = realProvider;

    public async Task<bool> UsesViettelAsync(IViettelAccountSource accounts, CancellationToken cancellationToken) =>
        Setting.Equals("Viettel", StringComparison.OrdinalIgnoreCase) ||
        (!Setting.Equals("Fake", StringComparison.OrdinalIgnoreCase) && (await accounts.CurrentAsync(cancellationToken)).IsConfigured);
}

// Hands each call to the real or the fake MySign, decided again on every call so a saved account applies at once.
internal sealed class SandboxSigningProvider(
    IServiceProvider services, IViettelAccountSource accounts, FakeMySign fake, SandboxMode mode) : ISigningProvider
{
    public string Code => SigningProviders.ViettelMySign;

    public async Task<IReadOnlyList<RemoteCredential>> ListCredentialsAsync(string providerUserId, string? serialNumber,
        CancellationToken cancellationToken)
        => await (await CurrentAsync(cancellationToken)).ListCredentialsAsync(providerUserId, serialNumber, cancellationToken);

    public async Task<string> RequestSignatureAsync(SignHashRequest request, CancellationToken cancellationToken)
        => await (await CurrentAsync(cancellationToken)).RequestSignatureAsync(request, cancellationToken);

    public async Task<SignStatus> GetStatusAsync(string providerUserId, string providerTransactionId,
        CancellationToken cancellationToken)
        => await (await CurrentAsync(cancellationToken)).GetStatusAsync(providerUserId, providerTransactionId, cancellationToken);

    // "Kiểm tra kết nối" always asks the real Viettel: the fake one would accept anything.
    public Task<string?> CheckAccountAsync(string providerUserId, CancellationToken cancellationToken)
        => Real().CheckAccountAsync(providerUserId, cancellationToken);

    private async Task<ISigningProvider> CurrentAsync(CancellationToken cancellationToken)
        => await mode.UsesViettelAsync(accounts, cancellationToken) ? Real() : fake;

    private ISigningProvider Real() => (ISigningProvider)services.GetRequiredService(mode.RealProvider);
}

// The Viettel account saved on the page, kept on this machine only (never in the repository), so it survives restarts.
internal sealed class FileSettingsStore(string path) : ISigningSettingsStore
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public async Task<ViettelSettingsRow?> FindAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return null;
        await using var file = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<ViettelSettingsRow>(file, cancellationToken: cancellationToken);
    }

    public async Task SaveAsync(ViettelSettingsRow row, CancellationToken cancellationToken)
    {
        await Gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(row), cancellationToken);
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            Gate.Release();
        }
    }
}

internal static class SandboxData
{
    public static string Folder { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BHome", "DigitalSigningSandbox");

    // A key of this machine's own for the saved client secret, made once. Not a production secret store: the key
    // sits beside what it protects. It only keeps the secret out of the repository and out of plain sight.
    public static string SecretKey()
    {
        var file = Path.Combine(Folder, "secret.key");
        if (File.Exists(file)) return File.ReadAllText(file).Trim();
        Directory.CreateDirectory(Folder);
        var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        File.WriteAllText(file, key);
        return key;
    }
}
