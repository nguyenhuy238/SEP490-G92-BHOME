using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace BHome.Infrastructure;

// Deployment origins are configuration anchors, never inferred from an HTTP Host header.
// Existing callback keys remain supported; when anchors are supplied they must agree.
public static class EnvironmentConfiguration
{
    public static void ApplyDeploymentDefaults(ConfigurationManager config)
    {
        var owner = config["Deployment:OwnerOrigin"]?.TrimEnd('/');
        var api = config["Deployment:ApiOrigin"]?.TrimEnd('/');
        if (string.IsNullOrEmpty(owner) || string.IsNullOrEmpty(api)) return;
        var defaults = new Dictionary<string, string?>
        {
            ["AuthenticationEmail:WebResetUrl"] = owner + "/reset-password",
            ["AuthenticationEmail:WebInvitationUrl"] = owner + "/accept-invitation",
            ["AuthenticationEmail:WebVerificationUrl"] = owner + "/confirm-email",
            ["AnonymousSigning:PublicSigningUrl"] = owner + "/contract-signing",
            ["ContractSigning:InvitationLink:PublicOpenUrl"] = api + "/open/sign-contract",
            ["ContractSigning:InvitationLink:MobileAppUrl"] = "bhome://sign-contract",
            ["AuthenticationEmail:MobileResetUrl"] = "bhome://reset-password",
            ["AuthenticationEmail:MobileInvitationUrl"] = "bhome://accept-invitation",
            ["AuthenticationEmail:MobileVerificationUrl"] = "bhome://confirm-email"
        };
        if (!config.GetSection("AuthenticationEmail:TrustedOrigins").GetChildren().Any())
            foreach (var (value, index) in new[] { owner, "bhome://reset-password", "bhome://accept-invitation", "bhome://confirm-email" }.Select((v, i) => (v, i)))
                defaults[$"AuthenticationEmail:TrustedOrigins:{index}"] = value;
        if (!config.GetSection("AuthWeb:AllowedOrigins").GetChildren().Any()) defaults["AuthWeb:AllowedOrigins:0"] = owner;
        if (!config.GetSection("Cors:AllowedOrigins").GetChildren().Any())
        {
            defaults["Cors:AllowedOrigins:0"] = owner;
            if (config["Deployment:PublicOrigin"] is { Length: > 0 } publicOrigin) defaults["Cors:AllowedOrigins:1"] = publicOrigin;
        }
        // Only absent legacy keys receive defaults. Explicit overrides are checked for agreement below.
        config.AddInMemoryCollection(defaults.Where(entry => config[entry.Key] is null).ToArray());
    }

    public static IReadOnlyList<string> Errors(IConfiguration config, string environment)
    {
        var errors = new List<string>();
        if (environment is not ("Development" or "Testing" or "Staging" or "Production"))
            errors.Add("Use a supported host environment: Development, Staging, Production (Testing only for automated tests).");
        var development = environment is "Development" or "Testing";
        var deployed = environment is "Staging" or "Production";
        var owner = config["Deployment:OwnerOrigin"];
        var api = config["Deployment:ApiOrigin"];
        if (deployed && config["Deployment:Environment"] != environment)
            errors.Add("Deployment:Environment must match the host environment; use its dedicated configuration file.");
        if (deployed && (string.IsNullOrWhiteSpace(owner) || string.IsNullOrWhiteSpace(api)))
            errors.Add("Deployment:OwnerOrigin and Deployment:ApiOrigin are required for Staging/Production.");

        bool Check(string key, string? value, bool https = false, bool originOnly = false)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
                uri.Scheme is not ("https" or "http") || uri.UserInfo.Length > 0 ||
                uri.Query.Length > 0 || uri.Fragment.Length > 0 ||
                (originOnly && uri.AbsolutePath != "/") ||
                ((https || !development) && uri.Scheme != "https") ||
                (deployed && (uri.IsLoopback || TemporaryHost(uri.Host))))
            {
                errors.Add($"{key} must be a trusted absolute {(https || !development ? "HTTPS" : "HTTP(S)")} URL without credentials, query or fragment; deployed URLs cannot use loopback or temporary tunnels.");
                return false;
            }
            return true;
        }
        if (owner is { Length: > 0 }) Check("Deployment:OwnerOrigin", owner, originOnly: true);
        if (api is { Length: > 0 }) Check("Deployment:ApiOrigin", api, originOnly: true);
        if (config["Deployment:PublicOrigin"] is { Length: > 0 } publicSite)
            Check("Deployment:PublicOrigin", publicSite, originOnly: true);
        void Match(string key, string? value, string? expected)
        {
            if (Uri.TryCreate(value, UriKind.Absolute, out var u) && Uri.TryCreate(expected, UriKind.Absolute, out var e) &&
                !string.Equals(u.GetLeftPart(UriPartial.Authority), e.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
                errors.Add($"{key} must belong to its configured Deployment origin.");
        }
        foreach (var key in new[] { "WebResetUrl", "WebInvitationUrl", "WebVerificationUrl", "StaffPortalUrl" })
        {
            var name = "AuthenticationEmail:" + key;
            if (Check(name, config[name])) Match(name, config[name], owner);
        }
        const string signing = "AnonymousSigning:PublicSigningUrl";
        if (Check(signing, config[signing], https: true) && deployed) Match(signing, config[signing], owner);
        const string open = "ContractSigning:InvitationLink:PublicOpenUrl";
        if (Check(open, config[open])) Match(open, config[open], api);

        var auth = config.GetSection("AuthenticationEmail").Get<AuthenticationEmailOptions>() ?? new();
        foreach (var trusted in auth.TrustedOrigins)
        {
            if (trusted.StartsWith("bhome://", StringComparison.OrdinalIgnoreCase))
            {
                if (!auth.Trusted(trusted, development)) errors.Add("AuthenticationEmail:TrustedOrigins contains an unsupported Mobile callback.");
            }
            else if (Check("AuthenticationEmail:TrustedOrigins", trusted, originOnly: true) && deployed)
                Match("AuthenticationEmail:TrustedOrigins", trusted, owner);
        }
        foreach (var key in new[] { "MobileResetUrl", "MobileInvitationUrl", "MobileVerificationUrl" })
            if (config["AuthenticationEmail:" + key] is { Length: > 0 } value && !auth.Trusted(value, development))
                errors.Add($"AuthenticationEmail:{key} must be a configured trusted Mobile callback.");
        if (deployed && (!auth.VerificationConfigured(false) || !auth.Configured(false)))
            errors.Add("AuthenticationEmail requires trusted invitation, reset and verification callbacks for this deployment.");
        var cors = config.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        var web = config.GetSection("AuthWeb:AllowedOrigins").Get<string[]>() ?? [];
        foreach (var (key, values) in new[] { ("Cors:AllowedOrigins", cors), ("AuthWeb:AllowedOrigins", web) })
            foreach (var value in values)
            {
                // Existing native development origins are not public Web URLs.
                if (development && value == "capacitor://localhost") continue;
                if (Check(key, value, originOnly: true) && deployed)
                {
                    var permitted = (key == "AuthWeb:AllowedOrigins" ? new[] { owner } : new[] { owner, config["Deployment:PublicOrigin"] })
                        .Where(v => !string.IsNullOrWhiteSpace(v));
                    if (!permitted.Contains(value, StringComparer.OrdinalIgnoreCase))
                        errors.Add($"{key} must use an origin from this deployment.");
                }
            }
        if (deployed && (!web.Contains(owner, StringComparer.OrdinalIgnoreCase) || !cors.Contains(owner, StringComparer.OrdinalIgnoreCase)))
            errors.Add("AuthWeb:AllowedOrigins and Cors:AllowedOrigins must include Deployment:OwnerOrigin.");
        if (web.Any(v => !cors.Contains(v, StringComparer.OrdinalIgnoreCase)))
            errors.Add("Every AuthWeb:AllowedOrigins entry must also be allowed by Cors:AllowedOrigins.");
        if (deployed && config["AllowedHosts"]?.Split(';').Any(h => h == "*") == true)
            errors.Add("AllowedHosts must list explicit deployment hostnames.");
        if (deployed)
        {
            var hosts = (config["AllowedHosts"] ?? "").Split(';', StringSplitOptions.TrimEntries);
            foreach (var origin in new[] { owner, api })
                if (Uri.TryCreate(origin, UriKind.Absolute, out var target) && !hosts.Contains(target.Host, StringComparer.OrdinalIgnoreCase))
                    errors.Add("AllowedHosts must include the configured Owner and API hostnames for this deployment.");
        }
        if (environment == "Development")
        {
            try
            {
                var db = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Database") ?? "");
                if (!(db.Host ?? "").Split(',').All(h => h is "localhost" or "127.0.0.1" or "::1") &&
                    !config.GetValue<bool>("DevelopmentDatabase:AllowRemoteDatabase"))
                    errors.Add("Development database must be loopback. An isolated remote development DB requires explicit DevelopmentDatabase:AllowRemoteDatabase=true; never point it at Staging/Production.");
            }
            catch (ArgumentException) { errors.Add("ConnectionStrings:Database is invalid; connection details were withheld."); }
        }
        var sepay = config.GetSection("SePay").Get<SePayOptions>() ?? new();
        if (!sepay.Valid(environment)) errors.Add("SePay environment, mode, API or credentials are invalid; Production cannot use Test mode.");
        if (environment == "Production" && config["SePay:Mode"] == "Test")
            errors.Add("SePay:Mode must be Live in Production, even while disabled; enabling Live requires separate authorization and credentials.");
        return errors;
    }

    public static bool TemporaryHost(string host) => new[] { "trycloudflare.com", "ngrok.io", "ngrok-free.app", "ngrok-free.dev", "ngrok.app", "ngrok.dev" }
        .Any(suffix => host.Equals(suffix, StringComparison.OrdinalIgnoreCase) || host.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase));
}
