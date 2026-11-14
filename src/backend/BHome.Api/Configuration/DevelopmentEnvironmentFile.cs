using Microsoft.Extensions.Configuration.Json;
using Microsoft.Extensions.Configuration.Memory;

namespace BHome.Api.Configuration;

// Gives Development F5/dotnet run the same .env fallback as Start-Api.ps1.
// User-secrets, process environment and command-line arguments retain higher priority.
public static class DevelopmentEnvironmentFile
{
    public static void Load(ConfigurationManager configuration, string contentRoot)
    {
        if (Environment.GetEnvironmentVariable("BHOME_ENV_FILE") is { Length: > 0 } selected)
        {
            AddFile(configuration, selected); return;
        }
        var root = new DirectoryInfo(contentRoot);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "src", "backend", "BHome.sln"))) root = root.Parent;
        if (root is not null) AddFile(configuration, Path.Combine(root.FullName, ".env"));
    }

    public static void AddFile(ConfigurationManager configuration, string path)
    {
        if (!File.Exists(path)) return;
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in File.ReadLines(path))
        {
            var at = line.IndexOf('='); if (at <= 0 || line.StartsWith('#')) continue;
            var name = line[..at].Trim();
            if (!System.Text.RegularExpressions.Regex.IsMatch(name,
                "^((ConnectionStrings|Jwt|Sessions|AuthRateLimit|AuthWeb|AuthenticationEmail|Sms|SmsRecovery|ObjectStorage|Jobs|Email|Cors|BankIntegration|SePay|NotificationIntegration|NotificationChannels|OwnerSetup|ElectronicContractIntegration|Ocr|IdentityProtection|Capture|Kestrel|MobileDevelopment|Api|MainDraft|DevelopmentDatabase|DigitalSigning|ContractSigning|AnonymousSigning|HoldingTesting)__[^=]+|AllowedHosts)$")) continue;
            values[name.Replace("__", ":", StringComparison.Ordinal)] = line[(at + 1)..].Trim().Trim('\'', '"');
        }
        var afterAppSettings = 0;
        for (var i = 0; i < configuration.Sources.Count; i++)
            if (configuration.Sources[i] is JsonConfigurationSource json &&
                Path.GetFileName(json.Path)?.StartsWith("appsettings", StringComparison.OrdinalIgnoreCase) == true) afterAppSettings = i + 1;
        configuration.Sources.Insert(afterAppSettings, new MemoryConfigurationSource { InitialData = values });
    }
}
