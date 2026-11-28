using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class SePayOwnerConnections(BHomePersistenceContext db, IPaymentRepository payments,
    SePayOptions runtime, IOptions<SePayOptions> defaults, IDataProtectionProvider protection,
    ICurrentUser actor, SePayApiClient api, IConfiguration configuration, TimeProvider clock) : ISePayOwnerConnections
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Secrets(string? ApiToken, string? WebhookSecret);
    private sealed record Stored(int Version, string ProtectedSecrets, bool HasApiToken, bool HasWebhookSecret,
        string Gateway, DateTimeOffset? VerifiedAt, SePayReceivingAccount[] Bindings);
    private static void Mode(string mode) { if (mode is not ("Test" or "Live")) throw new PaymentException(400, "invalid_payment_mode"); }
    private void Owner(Guid owner) { if (actor.UserId != owner || !actor.IsInRole(Roles.Owner)) throw new PaymentException(403, "payment_owner_required"); }
    private IDataProtector Protector(Guid owner, string mode) => protection.CreateProtector("BHome.SePay.OwnerConnection.v1", owner.ToString("N"), mode);
    private async Task<Stored?> Read(Guid owner, string mode, CancellationToken token)
    {
        Mode(mode);
        if (db is not Compact24DbContext) return null;
        var data = await db.Database.SqlQuery<string>($"""
            SELECT (business_profile->'sepayConnections'->{mode})::text AS "Value" FROM users WHERE id={owner} AND 'Owner'=ANY(roles)
            """).SingleOrDefaultAsync(token);
        return data is null ? null : JsonSerializer.Deserialize<Stored>(data, Json);
    }
    private Secrets ReadSecrets(Guid owner, string mode, Stored? value) => value is null
        ? new(defaults.Value.For(mode).ApiToken, defaults.Value.For(mode).WebhookSecret)
        : JsonSerializer.Deserialize<Secrets>(Protector(owner, mode).Unprotect(value.ProtectedSecrets), Json)!;
    private async Task Write(Guid owner, string mode, Stored state, int expected, CancellationToken token)
    {
        var data = JsonSerializer.Serialize(state, Json);
        var count = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE users SET business_profile=jsonb_set(COALESCE(business_profile,jsonb_build_object()),ARRAY['sepayConnections'],
                COALESCE(business_profile->'sepayConnections',jsonb_build_object())||jsonb_build_object(CAST({mode} AS text),CAST({data} AS jsonb)),true)
            WHERE id={owner} AND 'Owner'=ANY(roles)
              AND COALESCE((business_profile->'sepayConnections'->{mode}->>'version')::int,0)={expected}
            """, token);
        if (count != 1) throw new PaymentException(409, "sepay_connection_changed");
    }
    public async Task<SePayConnectionView> GetAsync(Guid ownerId, string mode, CancellationToken token)
    {
        Owner(ownerId); var state = await Read(ownerId, mode, token); var fallback = defaults.Value.For(mode);
        var account = await payments.OwnerReceivingAccountForModeAsync(ownerId, mode, token);
        var status = state?.VerifiedAt is not null ? "Connected" : state is not null ? "Configured" : fallback.Enabled ? "ServerConfigured" : "NotConfigured";
        try { if (state is not null) _ = ReadSecrets(ownerId, mode, state); }
        catch (CryptographicException) { status = "KeyUnavailable"; }
        var callback = $"/api/v1/integrations/sepay/{mode}/owners/{ownerId:D}/webhook";
        if (Uri.TryCreate(configuration["Deployment:ApiOrigin"], UriKind.Absolute, out var origin) && origin.Scheme == "https")
            callback = origin.GetLeftPart(UriPartial.Authority) + callback;
        return new(mode, state?.Version ?? 0, state?.HasApiToken ?? !string.IsNullOrEmpty(fallback.ApiToken),
            state?.HasWebhookSecret ?? !string.IsNullOrEmpty(fallback.WebhookSecret), status,
            callback, state?.Gateway, state?.VerifiedAt, account);
    }
    public async Task<SePayConnectionView> SaveAsync(Guid ownerId, string mode, SePayConnectionInput input, CancellationToken token)
    {
        Owner(ownerId); Mode(mode);
        if (db is not Compact24DbContext) throw new PaymentException(503, "sepay_storage_unavailable");
        if (!input.HumanVerified || input.ExpectedVersion < 0 || input.ExpectedAccountVersion < 0 ||
            !Regex.IsMatch(input.BankIdentifier ?? "", "^[0-9]{6}$") || !Regex.IsMatch(input.AccountNumber ?? "", "^[0-9]{6,19}$") ||
            !Regex.IsMatch(input.AccountHolder ?? "", "^[A-Z0-9 ]{5,50}$") || !Regex.IsMatch(input.Gateway ?? "", "^[A-Za-z0-9 -]{2,80}$"))
            throw new PaymentException(400, "invalid_receiving_bank_account");
        if (input.ApiToken is { Length: > 8192 } || input.ApiToken?.Any(char.IsControl) == true ||
            input.WebhookSecret is { Length: > 4096 } || input.WebhookSecret?.Any(char.IsControl) == true ||
            !string.IsNullOrEmpty(input.WebhookSecret) && input.WebhookSecret.Length < 32)
            throw new PaymentException(400, "invalid_sepay_credentials");
        await payments.TransactionAsync(null, null, async () =>
        {
            var old = await Read(ownerId, mode, token);
            if ((old?.Version ?? 0) != input.ExpectedVersion) throw new PaymentException(409, "sepay_connection_changed");
            Secrets saved;
            try { saved = ReadSecrets(ownerId, mode, old); }
            catch (CryptographicException) when (!string.IsNullOrEmpty(input.ApiToken) && !string.IsNullOrEmpty(input.WebhookSecret)) { saved = new(null, null); }
            var secrets = new Secrets(string.IsNullOrEmpty(input.ApiToken) ? saved.ApiToken : input.ApiToken.Trim(),
                string.IsNullOrEmpty(input.WebhookSecret) ? saved.WebhookSecret : input.WebhookSecret);
            var otherMode = mode == "Test" ? "Live" : "Test";
            var other = ReadSecrets(ownerId, otherMode, await Read(ownerId, otherMode, token));
            if (!string.IsNullOrEmpty(secrets.ApiToken) && secrets.ApiToken == other.ApiToken ||
                !string.IsNullOrEmpty(secrets.WebhookSecret) && secrets.WebhookSecret == other.WebhookSecret)
                throw new PaymentException(400, "sepay_credentials_must_differ");
            var previousAccount = await payments.OwnerReceivingAccountForModeAsync(ownerId, mode, token);
            var account = new ReceivingBankAccount
            {
                OwnerUserId = ownerId,
                BankIdentifier = input.BankIdentifier!,
                AccountNumber = input.AccountNumber!,
                AccountHolder = input.AccountHolder!.Trim(),
                Enabled = input.Enabled,
                IsDevelopmentDemo = mode == "Test",
                Version = input.ExpectedAccountVersion + 1,
                ConfirmedByUserId = ownerId,
                ConfirmedAt = PaymentRules.Timestamp(clock.GetUtcNow())
            };
            await payments.SaveOwnerReceivingAccountAsync(ownerId, account, input.ExpectedAccountVersion, token);
            var binding = new SePayReceivingAccount { OwnerUserId = ownerId, BankIdentifier = account.BankIdentifier, Gateway = input.Gateway!, AccountNumber = account.AccountNumber };
            var bindings = (old?.Bindings ?? defaults.Value.For(mode).ReceivingAccounts.ToArray()).Append(binding)
                .DistinctBy(b => (b.OwnerUserId, b.LocationId, b.BankIdentifier, b.Gateway.ToUpperInvariant(), b.AccountNumber)).ToArray();
            var verified = previousAccount is not null && previousAccount.BankIdentifier == account.BankIdentifier && previousAccount.AccountNumber == account.AccountNumber && saved.ApiToken == secrets.ApiToken
                ? old?.VerifiedAt : null;
            var state = new Stored(input.ExpectedVersion + 1, Protector(ownerId, mode).Protect(JsonSerializer.Serialize(secrets, Json)),
                !string.IsNullOrEmpty(secrets.ApiToken), !string.IsNullOrEmpty(secrets.WebhookSecret), input.Gateway!, verified, bindings);
            await Write(ownerId, mode, state, input.ExpectedVersion, token);
            await payments.AuditAsync(ownerId, "SePayConnectionConfigured" + mode, ownerId, clock.GetUtcNow(), token); return true;
        }, token);
        await ApplyOwnerAsync(ownerId, token);
        return await GetAsync(ownerId, mode, token);
    }
    public async Task<SePayConnectionCheck> CheckAsync(Guid ownerId, string mode, CancellationToken token)
    {
        Owner(ownerId); Mode(mode);
        var stored = await Read(ownerId, mode, token); var secrets = ReadSecrets(ownerId, mode, stored);
        var account = await payments.OwnerReceivingAccountForModeAsync(ownerId, mode, token);
        if (account is null || string.IsNullOrEmpty(secrets.ApiToken) || string.IsNullOrEmpty(secrets.WebhookSecret))
            return new(false, "sepay_configuration_incomplete");
        runtime.Mode = mode; runtime.ApiToken = secrets.ApiToken; runtime.WebhookSecret = secrets.WebhookSecret;
        runtime.ApiBaseUrl = mode == "Test" ? "https://userapi-sandbox.sepay.vn/v2" : "https://userapi.sepay.vn/v2";
        var result = await api.CheckAccountAsync(account.BankIdentifier, account.AccountNumber, token);
        if (result is null) return new(false, "sepay_receiving_account_not_linked");
        if (stored is not null)
            await payments.TransactionAsync<bool>(null, null, async () =>
            {
                var binding = new SePayReceivingAccount { OwnerUserId = ownerId, BankIdentifier = account.BankIdentifier, Gateway = result, AccountNumber = account.AccountNumber };
                await Write(ownerId, mode, stored with
                {
                    Version = stored.Version + 1,
                    Gateway = result,
                    VerifiedAt = clock.GetUtcNow(),
                    Bindings = stored.Bindings.Append(binding)
                        .DistinctBy(b => (b.OwnerUserId, b.LocationId, b.BankIdentifier, b.Gateway.ToUpperInvariant(), b.AccountNumber)).ToArray()
                }, stored.Version, token);
                await payments.AuditAsync(ownerId, "SePayConnectionVerified" + mode, ownerId, clock.GetUtcNow(), token); return true;
            }, token);
        await ApplyOwnerAsync(ownerId, token); return new(true, "sepay_connection_verified");
    }
    public async Task ApplyOwnerAsync(Guid ownerId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return;
        var original = defaults.Value;
        runtime.Test = original.Test; runtime.Live = original.Live; runtime.Enabled = original.Enabled; runtime.Mode = original.Mode;
        runtime.InstanceCode = original.InstanceCode; runtime.OwnerUserId = ownerId; runtime.LegacyServerMode = null; runtime.Select(original.Mode);
        var test = original.For("Test").Copy(); var live = original.For("Live").Copy(); var found = false;
        foreach (var profile in new[] { test, live })
        {
            var stored = await Read(ownerId, profile.Mode, token); if (stored is null) continue;
            found = true;
            try
            {
                var secrets = ReadSecrets(ownerId, profile.Mode, stored);
                profile.ApiToken = secrets.ApiToken; profile.WebhookSecret = secrets.WebhookSecret;
                profile.Enabled = stored.HasApiToken && stored.HasWebhookSecret && stored.VerifiedAt is not null;
                profile.ReceivingAccounts = stored.Bindings.ToList();
                profile.ApiBaseUrl = profile.Mode == "Test" ? "https://userapi-sandbox.sepay.vn/v2" : "https://userapi.sepay.vn/v2";
            }
            catch (CryptographicException) { profile.Enabled = false; }
        }
        if (!found) return;
        runtime.Test = test; runtime.Live = live; runtime.Enabled = test.Enabled || live.Enabled;
        runtime.LegacyServerMode = original.Enabled && !original.DualMode ? original.Mode : null;
        var origin = configuration["Deployment:ApiOrigin"] ?? db.Database.GetDbConnection().DataSource + "/" + db.Database.GetDbConnection().Database;
        runtime.InstanceCode = Regex.IsMatch(original.InstanceCode, "^[A-Z0-9]{4}$") ? original.InstanceCode : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(origin)))[..4];
        runtime.Mode = (original.Mode == "Test" ? test : live).Enabled ? original.Mode : test.Enabled ? "Test" : "Live";
        runtime.Select(runtime.Mode);
    }
    public async Task ApplyLocationAsync(Guid locationId, CancellationToken token)
    { if (await payments.ReceivingOwnerAsync(locationId, token) is { } owner) await ApplyOwnerAsync(owner, token); }
    public async Task<IReadOnlyList<SePayOwnerProfile>> ProfilesAsync(CancellationToken token)
    {
        var result = defaults.Value.Profiles.Where(p => !string.IsNullOrEmpty(p.ApiToken))
            .Select(p => new SePayOwnerProfile(null, p.Mode, p.PollIntervalSeconds)).ToList();
        if (db is not Compact24DbContext) return result;
        var owners = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM users WHERE 'Owner'=ANY(roles) AND is_active AND business_profile ? 'sepayConnections'
            """).ToArrayAsync(token);
        foreach (var owner in owners)
        {
            await ApplyOwnerAsync(owner, token);
            foreach (var profile in runtime.Profiles.Where(p => !string.IsNullOrEmpty(p.ApiToken)))
                if (await Read(owner, profile.Mode, token) is not null)
                    result.Add(new(owner, profile.Mode, profile.PollIntervalSeconds));
        }
        return result;
    }
}
