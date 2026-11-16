using System.Net;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    private WebApplicationFactory<Program> RecoveryHost(SmtpProbe probe) => AuthenticationHost(probe)
        .WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AuthenticationEmail:WebInvitationUrl"] = "",
            ["AuthenticationEmail:MobileInvitationUrl"] = "",
            ["AuthenticationEmail:WebVerificationUrl"] = "",
            ["AuthenticationEmail:MobileVerificationUrl"] = ""
        })));

    [CompactPostgresTheory]
    [InlineData("Owner", false)]
    [InlineData("Owner", true)]
    [InlineData("Staff", false)]
    [InlineData("Staff", true)]
    [InlineData("Tenant", false)]
    [InlineData("Tenant", true)]
    public async Task RecoveryAcceptsEmailAndUsernameForEveryRoleWithOnlyResetCallbacks(string role, bool byUsername)
    {
        var probe = new SmtpProbe(); using var host = RecoveryHost(probe);
        await using var scope = host.Services.CreateAsyncScope();
        var user = new BHome.Infrastructure.Persistence.ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = Guid.NewGuid().ToString("N"),
            Email = Guid.NewGuid().ToString("N") + "@example.invalid",
            EmailConfirmed = true
        };
        user = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, user, role, Password);
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        // The fixture deliberately shares its single Owner. Do not depend on another test's cooldown.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_expires_at={DateTimeOffset.UtcNow.AddMinutes(-1)} WHERE id={user.Id} AND reset_token_hash IS NOT NULL");
        using var client = host.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = byUsername ? " " + user.UserName + " " : user.Email });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var unknown = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = "unknown@example.invalid" });
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
        Assert.Equal(await response.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.Empty(probe.Messages);
        Assert.True(await db.Database.SqlQuery<bool>($"SELECT reset_token_hash IS NOT NULL AND reset_consumed_at IS NULL AND reset_expires_at>now() AS \"Value\" FROM users WHERE id={user.Id}").SingleAsync());
        var delivery = await AuthenticationDelivery(host, user.Id);
        await SendEmail(host, delivery); await SendEmail(host, delivery);
        var mail = Assert.Single(probe.Messages);
        Assert.StartsWith("https://owner.example.invalid/reset-password#", mail.ActionUrl);
        Assert.Equal(role != "Owner", mail.Body.Contains("bhome://reset-password?", StringComparison.Ordinal));
        Assert.Equal("Sent", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
    }

    [CompactPostgresTheory]
    [InlineData("inactive")]
    [InlineData("unconfirmed")]
    [InlineData("missing-email")]
    public async Task RecoveryIneligibleAccountsReturnIdenticalAcceptedWithoutGrantOrEmail(string reason)
    {
        var w = await Seed(); var user = w.Tenants[0]; var probe = new SmtpProbe(); using var host = RecoveryHost(probe);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        if (reason == "inactive") await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        if (reason == "unconfirmed") await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        if (reason == "missing-email") await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Email, (string?)null).SetProperty(u => u.NormalizedEmail, (string?)null));
        try
        {
            using var client = host.CreateClient();
            var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.UserName });
            var unknown = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = "unknown@example.invalid" });
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode); Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
            Assert.Equal(await response.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
            Assert.True(await db.Database.SqlQuery<bool>($"SELECT reset_token_hash IS NULL AS \"Value\" FROM users WHERE id={user.Id}").SingleAsync());
            Assert.False(await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_data->>'recipient'={user.Id.ToString()} AND event_data ? 'protectedAuthenticationEmail') AS \"Value\"").SingleAsync());
            Assert.Empty(probe.Messages);
        }
        finally
        {
            if (reason == "missing-email") await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Email, user.Email).SetProperty(u => u.NormalizedEmail, user.Email!.ToUpperInvariant()));
        }
    }

    [CompactPostgresFact]
    public async Task RecoveryDurablyAcceptsWithSmtpDisabledAndDefersWithoutSpendingRetryAttempts()
    {
        var w = await Seed(); var probe = new SmtpProbe { Available = false };
        using var configured = RecoveryHost(probe);
        using var host = configured.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["Email:Enabled"] = "false", ["NotificationChannels:Mode"] = "Unconfigured" })));
        using var client = host.CreateClient();
        foreach (var identifier in new[] { w.Tenants[0].Email, w.Tenants[0].Email, "unknown@example.invalid" })
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = identifier })).StatusCode);
        var delivery = await AuthenticationDelivery(host, w.Tenants[0].Id);
        await SendEmail(host, delivery); await SendEmail(host, delivery);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal("Pending", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        Assert.Equal(0, await db.Database.SqlQuery<int>($"SELECT jsonb_array_length(delivery_history) AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications WHERE event_data ? 'protectedAuthenticationEmail' AND event_data->>'recipient'={w.Tenants[0].Id.ToString()}").SingleAsync());
        Assert.Empty(probe.Messages);
        probe.Available = true; await SendEmail(host, delivery); await SendEmail(host, delivery);
        Assert.Single(probe.Messages);
    }

    [CompactPostgresTheory]
    [InlineData("untrusted")]
    [InlineData("disabled-channels")]
    [InlineData("missing-web-fallback")]
    public async Task RecoveryConfigurationFailuresAreGenericBeforeAccountLookup(string reason)
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var configured = RecoveryHost(probe);
        using var host = configured.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            [reason == "disabled-channels" ? "NotificationChannels:Enabled" : "AuthenticationEmail:WebResetUrl"] =
                reason == "disabled-channels" ? "false" : reason == "untrusted" ? "https://attacker.invalid/reset-password" : ""
        })));
        using var client = host.CreateClient();
        var known = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[0].Email });
        var unknown = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = "unknown@example.invalid" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, known.StatusCode); Assert.Equal(known.StatusCode, unknown.StatusCode);
        Assert.DoesNotContain(w.Tenants[0].Email!, await known.Content.ReadAsStringAsync());
        Assert.Empty(probe.Messages);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.True(await db.Database.SqlQuery<bool>($"SELECT reset_token_hash IS NULL AS \"Value\" FROM users WHERE id={w.Tenants[0].Id}").SingleAsync());
    }

    [CompactPostgresTheory]
    [InlineData("outbox")]
    [InlineData("grant")]
    public async Task RecoveryPersistenceFailureRollsBackGrantInboxOutboxAndAudit(string stage)
    {
        var w = await Seed(); var user = w.Tenants[0]; var probe = new SmtpProbe(); using var host = RecoveryHost(probe);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        // Unique, synthetic constraint in this disposable database only. Fail before or after queueing.
        var constraint = "recovery_probe_" + Guid.NewGuid().ToString("N");
        var table = stage == "outbox" ? "notifications" : "users";
        var condition = stage == "outbox" ? $"record_kind<>'OUTBOX' OR event_data->>'recipient'<>'{user.Id}'" : $"id<>'{user.Id}' OR reset_token_hash IS NULL";
        var add = $"ALTER TABLE {table} ADD CONSTRAINT {constraint} CHECK ({condition})";
        var drop = $"ALTER TABLE {table} DROP CONSTRAINT {constraint}";
        await db.Database.ExecuteSqlRawAsync(add);
        try
        {
            using var client = host.CreateClient();
            var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.Email });
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.DoesNotContain(user.Email!, await response.Content.ReadAsStringAsync());
            Assert.True(await db.Database.SqlQuery<bool>($"SELECT reset_token_hash IS NULL AS \"Value\" FROM users WHERE id={user.Id}").SingleAsync());
            Assert.Equal(0, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications WHERE (event_data->>'recipient'={user.Id.ToString()} OR recipient_user_id={user.Id} OR actor_user_id={user.Id}) AND notification_type IN ('CHANNEL_DELIVERY','PASSWORD_RESET_REQUESTED','PasswordResetRequested')").SingleAsync());
            Assert.Empty(probe.Messages);
        }
        finally { await db.Database.ExecuteSqlRawAsync(drop); }
        // A failed request must not leave a cooldown or poison subsequent requests.
        using var retry = host.CreateClient();
        Assert.Equal(HttpStatusCode.Accepted, (await retry.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.Email })).StatusCode);
        await SendEmail(host, await AuthenticationDelivery(host, user.Id)); Assert.Single(probe.Messages);
    }

    [CompactPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RecoveryDeferredEmailsSuppressExpiredAndSupersededTokens(bool superseded)
    {
        var w = await Seed(); var probe = new SmtpProbe { Available = false }; var clock = new VerificationClock();
        using var configured = RecoveryHost(probe);
        using var host = configured.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock)));
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[0].Email })).StatusCode);
        var stale = await AuthenticationDelivery(host, w.Tenants[0].Id);
        clock.Now = clock.Now.AddMinutes(superseded ? 2 : 16);
        if (superseded)
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[0].Email })).StatusCode);
        probe.Available = true; await SendEmail(host, stale); Assert.Empty(probe.Messages);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={stale}").SingleAsync());
        if (superseded) { await SendEmail(host, await AuthenticationDelivery(host, w.Tenants[0].Id)); Assert.Single(probe.Messages); }
    }

    [Fact]
    public void AuthenticationCallbackConfigurationIsIndependentAndKeepsBrowserFallbackAndTrustRules()
    {
        var options = new AuthenticationEmailOptions
        {
            WebResetUrl = "https://owner.example.invalid/reset-password",
            MobileResetUrl = "bhome://reset-password",
            TrustedOrigins = ["https://owner.example.invalid", "bhome://reset-password", "bhome://accept-invitation", "bhome://confirm-email"]
        };
        Assert.True(options.PasswordResetConfigured(false)); Assert.True(options.AnyConfigured(false));
        Assert.False(options.InvitationConfigured(false)); Assert.False(options.VerificationConfigured(false));
        options.WebResetUrl = "";
        options.WebInvitationUrl = "https://owner.example.invalid/accept-invitation"; options.MobileInvitationUrl = "bhome://accept-invitation";
        Assert.True(options.InvitationConfigured(false)); Assert.False(options.PasswordResetConfigured(false));
        options.WebInvitationUrl = "";
        options.WebVerificationUrl = "https://owner.example.invalid/confirm-email"; options.MobileVerificationUrl = "bhome://confirm-email";
        Assert.True(options.VerificationConfigured(false)); Assert.True(options.AnyConfigured(false));
        foreach (var malicious in new[] { "bhome://confirm-email", "http://owner.example.invalid/confirm-email", "https://owner.example.invalid/confirm-email?next=evil", "https://owner.example.invalid/confirm-email#evil", "https://user@owner.example.invalid/confirm-email" })
        { options.WebVerificationUrl = malicious; Assert.False(options.VerificationConfigured(false)); }
    }

    [CompactPostgresFact]
    public async Task RecoveryOutboxWriteOutageFailsForEveryIdentifierWithoutPersistingAProbe()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = RecoveryHost(probe);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var constraint = "recovery_outage_" + Guid.NewGuid().ToString("N");
        var add = $"ALTER TABLE notifications ADD CONSTRAINT {constraint} CHECK (record_kind<>'OUTBOX') NOT VALID";
        var drop = $"ALTER TABLE notifications DROP CONSTRAINT {constraint}";
        await db.Database.ExecuteSqlRawAsync(add);
        try
        {
            using var client = host.CreateClient();
            foreach (var identifier in new[] { w.Tenants[0].Email, "unknown@example.invalid" })
            {
                var response = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = identifier });
                Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
                Assert.DoesNotContain(identifier!, await response.Content.ReadAsStringAsync());
            }
            Assert.True(await db.Database.SqlQuery<bool>($"SELECT reset_token_hash IS NULL AS \"Value\" FROM users WHERE id={w.Tenants[0].Id}").SingleAsync());
        }
        finally { await db.Database.ExecuteSqlRawAsync(drop); }
        using var retry = host.CreateClient();
        Assert.Equal(HttpStatusCode.Accepted, (await retry.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = "unknown@example.invalid" })).StatusCode);
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_key LIKE 'authentication-email:acceptance:%') AS \"Value\"").SingleAsync());
        Assert.Empty(probe.Messages);
    }

    [CompactPostgresFact]
    public async Task VerificationAndInvitationUseTheirOwnCallbacksWithoutRequiringPasswordRecovery()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var configured = AuthenticationHost(probe);
        using var host = configured.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["AuthenticationEmail:WebResetUrl"] = "", ["AuthenticationEmail:MobileResetUrl"] = "" })));
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Users.Where(u => u.Id == w.Tenants[0].Id || u.Id == w.Staff.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        using var anonymous = host.CreateClient();
        Assert.Equal(HttpStatusCode.Accepted, (await anonymous.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = w.Tenants[0].Email })).StatusCode);
        using var owner = await Client(w.Owner, host);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsync($"/api/v1/staff/{w.Staff.Id}/invitation", null)).StatusCode);
        await SendEmail(host, await AuthenticationDelivery(host, w.Tenants[0].Id));
        await SendEmail(host, await AuthenticationDelivery(host, w.Staff.Id));
        Assert.Contains(probe.Messages, m => m.EventType == "EMAIL_CONFIRMATION_REQUESTED");
        Assert.Contains(probe.Messages, m => m.EventType == "ACCOUNT_INVITATION");
    }
}
