using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Application.Jobs;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.IdentityAccess;

// Recovery evidence uses the existing technical OUTBOX container, never the user inbox.
// Immutable initial payload + append-only state history, serialized by the same user-row lock as Identity sessions.
internal sealed class SmsPasswordRecovery(CompactNotificationWriter sql, IIdentityPersistence persistence,
    IdentitySecurityStore security, UserManager<ApplicationUser> users, ISmsSender sms, IOptions<SmsOptions> smsOptions,
    IOptions<SmsRecoveryOptions> options, TimeProvider clock, IBackgroundJobQueue queue, IDataProtectionProvider protection) : ISmsPasswordRecovery, IBackgroundJobHandler
{
    internal const string JobName = "sms-recovery-delivery";
    public string Name => JobName;
    private sealed record Delivery(Guid UserId, Guid ChallengeId, string Otp);
    private SmsRecoveryOptions Config => options.Value;
    private DateTimeOffset Now => clock.GetUtcNow();
    private sealed record Challenge(Guid Id, string OtpHash, string Binding, string PhoneHash, DateTimeOffset ExpiresAt,
        int Attempts = 0, DateTimeOffset? VerifiedAt = null, string? AuthorizationHash = null,
        DateTimeOffset? AuthorizationExpiresAt = null, DateTimeOffset? ConsumedAt = null);
    private string Mac(string value) => Convert.ToHexString(HMACSHA256.HashData(Convert.FromBase64String(Config.HashKey), Encoding.UTF8.GetBytes("bhome-sms-password-recovery-v1:" + value)));
    private string Binding(ApplicationUser user) => Mac($"binding:{user.Id}:{user.SecurityStamp}:{VietnameseSmsPhone.Normalize(user.PhoneNumber)}");
    private static bool Equal(string a, string b) => a.Length == b.Length && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
    private void RequireAvailable()
    {
        if (!Config.Enabled || !Config.Valid() || !sms.IsConfigured || smsOptions.Value.Mode == "Sandbox" ||
            !smsOptions.Value.EnabledTemplates.Contains("SMS-01") || smsOptions.Value.Mode == "Production" &&
            (!smsOptions.Value.ProductionEnabled || !smsOptions.Value.ApprovedTemplates.Contains("SMS-01") || string.IsNullOrWhiteSpace(smsOptions.Value.Brandname)))
            throw new IntegrationUnavailableException("SMS password recovery is unavailable.");
    }
    private async Task<ApplicationUser?> Find(string identifier, CancellationToken t)
    {
        if (string.IsNullOrWhiteSpace(identifier) || identifier.Length > LoginService.MaxUserNameLength) return null;
        var value = identifier.Trim(); var phone = VietnameseSmsPhone.Normalize(value);
        if (phone is not null)
        {
            var rows = users.Users.Where(u => u.PhoneNumber != null).Select(u => new
            { User = u, Phone = u.PhoneNumber!.Replace(" ", "").Replace("-", "").Replace(".", "").Replace("(", "").Replace(")", "").Replace("+", "") });
            var matches = await rows.Where(r => (r.Phone.StartsWith("0") ? "84" + r.Phone.Substring(1) : r.Phone) == phone).Select(r => r.User).Take(2).ToArrayAsync(t);
            return matches.Length == 1 ? matches[0] : null;
        }
        var normalized = users.NormalizeName(value);
        var found = await users.Users.Where(u => u.NormalizedUserName == normalized || u.NormalizedEmail == normalized).Take(2).ToArrayAsync(t);
        return found.Length == 1 ? found[0] : null;
    }
    private async Task<bool> Eligible(ApplicationUser user, CancellationToken t) => security.IsEligible(user) && user.PhoneNumberConfirmed &&
        VietnameseSmsPhone.Normalize(user.PhoneNumber) is not null && IdentitySecurityStore.SupportedRoles(await security.RolesAsync(user.Id, t)) &&
        !await sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id=@id AND NOT email_confirmed AND reset_token_hash IS NOT NULL AND reset_consumed_at IS NULL)", t, ("id", user.Id));

    public async Task<SmsRecoveryRequested> RequestAsync(string identifier, string requesterIp, CancellationToken t)
    {
        RequireAvailable();
        var id = Guid.NewGuid(); var response = new SmsRecoveryRequested(id, Config.ResendCooldownSeconds, Config.OtpMinutes * 60);
        var now = Now;
        await using (var tx = await persistence.BeginTransactionAsync(t))
        {
            // Distributed rate limits also cover unknown identifiers; no account-dependent API response.
            await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended('bhome-sms-recovery-limits-v1',0))", t);
            var ipHash = Mac("ip:" + requesterIp);
            var ipCount = await sql.Scalar<long>("SELECT count(*) FROM notifications WHERE record_kind='AUDIT' AND notification_type='SmsRecoveryRequest' AND event_at>@since AND event_data->>'ipHash'=@hash", t,
                ("since", now.AddMinutes(-Config.WindowMinutes)), ("hash", ipHash));
            if (ipCount >= Config.MaxIpRequests) throw new NotificationException(429, "sms_recovery_rate_limited");
            var candidate = await Find(identifier, t);
            var accountHash = Mac("account:" + (candidate?.Id.ToString() ?? (VietnameseSmsPhone.Normalize(identifier) ?? identifier.Trim().ToUpperInvariant())));
            var phoneHash = candidate is not null && VietnameseSmsPhone.Normalize(candidate.PhoneNumber) is { } number ? Mac("phone:" + number) : Mac("unknown-phone:" + accountHash);
            var accountCount = await Count("accountHash", accountHash, now.AddMinutes(-Config.WindowMinutes), t);
            var phoneCount = await Count("phoneHash", phoneHash, now.AddMinutes(-Config.WindowMinutes), t);
            var cooldown = await Count("accountHash", accountHash, now.AddSeconds(-Config.ResendCooldownSeconds), t) > 0 ||
                await Count("phoneHash", phoneHash, now.AddSeconds(-Config.ResendCooldownSeconds), t) > 0;
            var audit = JsonSerializer.Serialize(new { recordType = "SmsRecoveryRequest", ipHash, accountHash, phoneHash }, CompactNotificationWriter.Json);
            await sql.Execute("""
                INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
                VALUES(@id,'AUDIT',@key,'SmsRecoveryRequest',@data::jsonb,@now)
                """, t, ("id", Guid.NewGuid()), ("key", "sms-request:" + id), ("data", audit), ("now", now));
            if (candidate is not null && accountCount < Config.MaxAccountRequests && phoneCount < Config.MaxPhoneRequests && !cooldown)
            {
                var user = await security.LockUserAsync(candidate.Id, t);
                if (user is not null && await Eligible(user, t))
                {
                    var otp = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
                    var challenge = new Challenge(id, Mac($"otp:{id}:{user.Id}:{otp}"), Binding(user), Mac("phone:" + VietnameseSmsPhone.Normalize(user.PhoneNumber)), now.AddMinutes(Config.OtpMinutes));
                    await sql.Execute("UPDATE notifications SET delivery_status='Cancelled' WHERE record_kind='OUTBOX' AND related_entity_id=@user AND event_data->>'recordType'='SmsRecoveryChallenge' AND delivery_status NOT IN ('Consumed','Cancelled')", t, ("user", user.Id));
                    var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "SmsRecoveryChallenge", channel = "SMS", purpose = "password-recovery", state = challenge }, CompactNotificationWriter.Json);
                    await sql.Execute("""
                        INSERT INTO notifications(id,record_kind,event_key,notification_type,related_entity_type,related_entity_id,event_data,event_at,delivery_status)
                        VALUES(@id,'OUTBOX',@key,'SmsRecoveryChallenge','User',@user,@data::jsonb,@now,'Pending')
                        """, t, ("id", id), ("key", "sms-recovery:" + id), ("user", user.Id), ("data", data), ("now", now));
                    var encryptedDelivery = protection.CreateProtector("BHOME.SmsRecovery.Delivery.v1").Protect(JsonSerializer.Serialize(new Delivery(user.Id, id, otp)));
                    await queue.EnqueueAsync(new(JobName, "sms-recovery:" + id, JsonSerializer.Serialize(encryptedDelivery)), t);
                    security.Audit("SmsRecoveryRequested", true, user.Id);
                }
            }
            await persistence.SaveChangesAsync(t); await tx.CommitAsync(t);
        }
        return response;
    }
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        RequireAvailable();
        Delivery payload;
        try { payload = JsonSerializer.Deserialize<Delivery>(protection.CreateProtector("BHOME.SmsRecovery.Delivery.v1").Unprotect(JsonSerializer.Deserialize<string>(job.PayloadJson)!))!; }
        catch (Exception e) when (e is CryptographicException or JsonException) { throw new InvalidOperationException("sms_recovery_delivery_invalid"); }
        ApplicationUser? recipient; Challenge? challenge;
        await using (var tx = await persistence.BeginTransactionAsync(t))
        {
            recipient = await security.LockUserAsync(payload.UserId, t); challenge = await Load(payload.UserId, payload.ChallengeId, t);
            if (recipient is null || challenge is null || !await Eligible(recipient, t) || challenge.VerifiedAt is not null || challenge.ExpiresAt <= Now ||
                !Equal(challenge.Binding, Binding(recipient)) || !Equal(challenge.OtpHash, Mac($"otp:{payload.ChallengeId}:{recipient.Id}:{payload.Otp}"))) return;
            // Only Pending may submit. A crashed/ambiguous submission requires review rather than another SMS.
            var claimed = await sql.Execute("UPDATE notifications SET delivery_status='Processing' WHERE id=@id AND delivery_status='Pending'", t, ("id", payload.ChallengeId));
            if (claimed != 1) return;
            var submission = JsonSerializer.Serialize(new { recordType = "SmsSubmission", requestId = SmsGateway.RequestId("recovery:" + payload.ChallengeId), at = Now }, CompactNotificationWriter.Json);
            await sql.Execute("UPDATE notifications SET delivery_history=delivery_history||jsonb_build_array(@history::jsonb) WHERE id=@id", t, ("history", submission), ("id", payload.ChallengeId));
            await tx.CommitAsync(t);
        }
        var id = payload.ChallengeId;
        {
            try
            {
                var receipt = await sms.SendAsync(new(recipient.Id, recipient.PhoneNumber!, "SMS-01",
                    new Dictionary<string, string> { ["OTP"] = payload.Otp, ["MINUTES"] = Config.OtpMinutes.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                    "recovery:" + id, challenge.ExpiresAt), t);
                var history = JsonSerializer.Serialize(new { recordType = "SmsRecoveryDelivery", state = receipt.Status, providerReference = receipt.ProviderReference, at = Now }, CompactNotificationWriter.Json);
                await sql.Execute("UPDATE notifications SET delivery_status=@status,delivery_history=delivery_history||jsonb_build_array(@history::jsonb) WHERE id=@id AND delivery_status='Processing'", t,
                    ("status", receipt.Status), ("history", history), ("id", id));
            }
            catch (Exception e) when (e is ChannelDeliveryException or HttpRequestException or OperationCanceledException)
            {
                // Delivery cannot disclose account existence. No automatic retry of an OTP with unknown submission.
                await sql.Execute("UPDATE notifications SET delivery_status='Failed' WHERE id=@id AND delivery_status='Processing'", CancellationToken.None, ("id", id));
                if (t.IsCancellationRequested) throw;
            }
        }
    }
    private Task<long> Count(string field, string hash, DateTimeOffset since, CancellationToken t)
    {
        // field is selected by this class, never supplied by a caller.
        if (field is not ("accountHash" or "phoneHash")) throw new InvalidOperationException();
        return sql.Scalar<long>($"SELECT count(*) FROM notifications WHERE record_kind='AUDIT' AND notification_type='SmsRecoveryRequest' AND event_at>@since AND event_data->>'{field}'=@hash", t, ("since", since), ("hash", hash));
    }
    private async Task<Challenge?> Load(Guid user, Guid id, CancellationToken t)
    {
        var json = await sql.Scalar<string>("""
            SELECT COALESCE((SELECT h->'state' FROM jsonb_array_elements(delivery_history) WITH ORDINALITY a(h,n)
              WHERE h->>'recordType'='SmsRecoveryState' ORDER BY n DESC LIMIT 1),event_data->'state')::text
            FROM notifications WHERE id=@id AND record_kind='OUTBOX' AND related_entity_id=@user AND event_data->>'recordType'='SmsRecoveryChallenge'
              AND event_data->>'purpose'='password-recovery' AND delivery_status NOT IN ('Consumed','Cancelled','Expired','Failed')
            """, t, ("id", id), ("user", user));
        return json is null ? null : JsonSerializer.Deserialize<Challenge>(json, CompactNotificationWriter.Json);
    }
    private async Task Store(Challenge challenge, string status, CancellationToken t)
    {
        var json = JsonSerializer.Serialize(new { recordType = "SmsRecoveryState", state = challenge, at = Now }, CompactNotificationWriter.Json);
        await sql.Execute("UPDATE notifications SET delivery_status=@status,delivery_history=delivery_history||jsonb_build_array(@history::jsonb) WHERE id=@id", t,
            ("status", status), ("history", json), ("id", challenge.Id));
    }
    public async Task<SmsRecoveryVerified?> VerifyAsync(string identifier, Guid challengeId, string otp, CancellationToken t)
    {
        RequireAvailable(); if (otp.Length != 6 || otp.Any(c => c is < '0' or > '9')) return null;
        var candidate = await Find(identifier, t); if (candidate is null) return null;
        await using var tx = await persistence.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(candidate.Id, t); var challenge = await Load(candidate.Id, challengeId, t);
        if (user is null || !await Eligible(user, t) || challenge is null || challenge.VerifiedAt is not null || challenge.ExpiresAt <= Now ||
            challenge.Attempts >= Config.MaxAttempts || !Equal(challenge.Binding, Binding(user))) return null;
        challenge = challenge with { Attempts = challenge.Attempts + 1 };
        if (!Equal(challenge.OtpHash, Mac($"otp:{challengeId}:{user.Id}:{otp}")))
        {
            await Store(challenge, challenge.Attempts >= Config.MaxAttempts ? "Cancelled" : "PendingVerification", t);
            security.Audit("SmsRecoveryVerified", false, user.Id); await persistence.SaveChangesAsync(t); await tx.CommitAsync(t); return null;
        }
        var authorization = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        challenge = challenge with { OtpHash = "", VerifiedAt = Now, AuthorizationHash = Mac($"authorization:{challengeId}:{user.Id}:{authorization}"), AuthorizationExpiresAt = Now.AddMinutes(Config.AuthorizationMinutes) };
        await Store(challenge, "Verified", t); security.Audit("SmsRecoveryVerified", true, user.Id);
        await persistence.SaveChangesAsync(t); await tx.CommitAsync(t);
        return new(authorization, Config.AuthorizationMinutes * 60);
    }
    public async Task<bool> ResetAsync(string identifier, Guid challengeId, string authorization, string newPassword, CancellationToken t)
    {
        RequireAvailable();
        if (string.IsNullOrWhiteSpace(authorization) || authorization.Length > 256 || string.IsNullOrWhiteSpace(newPassword) || newPassword.Length > LoginService.MaxPasswordLength) return false;
        var candidate = await Find(identifier, t); if (candidate is null) return false;
        await using var tx = await persistence.BeginTransactionAsync(t);
        var user = await security.LockUserAsync(candidate.Id, t); var challenge = await Load(candidate.Id, challengeId, t);
        if (user is null || !await Eligible(user, t) || challenge is null || challenge.VerifiedAt is null || challenge.ConsumedAt is not null ||
            challenge.AuthorizationExpiresAt is not { } authorizationExpiry || authorizationExpiry <= Now || challenge.AuthorizationHash is null || !Equal(challenge.Binding, Binding(user)) ||
            !Equal(challenge.AuthorizationHash, Mac($"authorization:{challengeId}:{user.Id}:{authorization}"))) return false;
        var result = await users.ResetPasswordAsync(user, await users.GeneratePasswordResetTokenAsync(user), newPassword);
        t.ThrowIfCancellationRequested(); security.Audit("PasswordReset", result.Succeeded, user.Id);
        if (result.Succeeded)
        {
            await Store(challenge with { ConsumedAt = Now, AuthorizationHash = null }, "Consumed", t);
            await sql.Execute("UPDATE notifications SET delivery_status='Cancelled' WHERE related_entity_id=@user AND record_kind='OUTBOX' AND event_data->>'recordType'='SmsRecoveryChallenge' AND id<>@id AND delivery_status<>'Consumed'", t, ("user", user.Id), ("id", challenge.Id));
            await persistence.ConsumeResetGrantsAsync(user.Id, Now, t);
            await security.RevokeAllAsync(user.Id, "PasswordReset", t);
        }
        await persistence.SaveChangesAsync(t); await tx.CommitAsync(t); return result.Succeeded;
    }
}
