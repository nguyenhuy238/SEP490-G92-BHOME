using System.Net;
using System.Net.Http.Json;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using BHome.Application.Jobs;
using BHome.Infrastructure.IdentityAccess;
using System.Text.Json;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    private sealed class VerificationClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    [CompactPostgresFact]
    public async Task EmailVerificationEnablesRecoveryOnlyAfterOneTimeConfirmationWithoutChangingPasswordOrSessions()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe);
        using var session = await Client(w.Tenants[2], host); using var anonymous = host.CreateClient();
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Users.Where(u => u.Id == w.Tenants[2].Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        var before = await db.Users.AsNoTracking().SingleAsync(u => u.Id == w.Tenants[2].Id);
        (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = before.Email })).EnsureSuccessStatusCode();
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_data->>'protectedAuthenticationEmail' IS NOT NULL AND event_data->>'recipient'={before.Id.ToString()}) AS \"Value\"").SingleAsync());
        var results = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => anonymous.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = before.Email })));
        Assert.All(results, r => Assert.Equal(HttpStatusCode.Accepted, r.StatusCode));
        var unknown = await anonymous.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = "unknown@example.invalid" });
        Assert.Equal(await results[0].Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        var delivery = await AuthenticationDelivery(host, before.Id); await SendEmail(host, delivery);
        var mail = Assert.Single(probe.Messages); Assert.Equal("EMAIL_CONFIRMATION_REQUESTED", mail.EventType);
        Assert.StartsWith("bhome://confirm-email?", mail.ActionUrl);
        var q = QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Query);
        var confirm = new { userName = q["userName"].ToString(), token = q["token"].ToString() };
        var payload = await db.Database.SqlQuery<string>($"SELECT event_data::text AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.DoesNotContain(confirm.token, payload); Assert.DoesNotContain(before.Email!, payload);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/confirm-email", confirm with { token = "invalid" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/confirm-email", confirm with { userName = w.Tenants[0].Email! })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/confirm-email", confirm)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/confirm-email", confirm)).StatusCode);
        var after = await db.Users.AsNoTracking().SingleAsync(u => u.Id == before.Id);
        Assert.True(after.EmailConfirmed); Assert.Equal(before.PasswordHash, after.PasswordHash); Assert.Equal(before.SecurityStamp, after.SecurityStamp);
        Assert.Equal(HttpStatusCode.OK, (await session.GetAsync("/api/v1/auth/me")).StatusCode);
        await SendEmail(host, delivery); Assert.Single(probe.Messages);
        (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = before.Email })).EnsureSuccessStatusCode();
        await SendEmail(host, await AuthenticationDelivery(host, before.Id));
        Assert.Single(probe.Messages, m => m.EventType == "PASSWORD_RESET_REQUESTED");
    }

    [CompactPostgresTheory]
    [InlineData("expired")]
    [InlineData("email-changed")]
    [InlineData("inactive")]
    [InlineData("stamp-changed")]
    [InlineData("superseded")]
    public async Task EmailVerificationRejectsInvalidatedLinksAndSuppressesStaleDelivery(string reason)
    {
        var w = await Seed(); var probe = new SmtpProbe(); var clock = new VerificationClock();
        using var configured = AuthenticationHost(probe);
        using var host = configured.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock)));
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = w.Tenants[0].Id;
        await db.Users.Where(u => u.Id == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        using var client = host.CreateClient();
        (await client.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = w.Tenants[0].Email })).EnsureSuccessStatusCode();
        var delivery = await AuthenticationDelivery(host, id);
        // Inspect through the same protected delivery resolver; the token remains local to this synthetic test.
        await SendEmail(host, delivery); var mail = Assert.Single(probe.Messages);
        var q = QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Query);
        if (reason == "expired") clock.Now = clock.Now.AddHours(1);
        if (reason == "email-changed") await db.Users.Where(u => u.Id == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Email, "changed@example.invalid"));
        if (reason == "inactive") await db.Users.Where(u => u.Id == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        if (reason == "stamp-changed")
        {
            var stamp = Guid.NewGuid().ToString("N");
            await db.Users.Where(u => u.Id == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.SecurityStamp, stamp));
        }
        if (reason == "superseded")
        {
            clock.Now = clock.Now.AddMinutes(2);
            (await client.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = w.Tenants[0].Email })).EnsureSuccessStatusCode();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/confirm-email", new { userName = q["userName"].ToString(), token = q["token"].ToString() })).StatusCode);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET delivery_status='Pending',next_delivery_at={DateTimeOffset.UtcNow.AddMinutes(-1)} WHERE id={delivery}");
        await SendEmail(host, delivery); Assert.Single(probe.Messages);
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task EmailVerificationCannotConsumeInvitationOrBypassPendingProvisioningAndKeepsLoginAvailable()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = w.Tenants[0].Id;
        await db.Users.Where(u => u.Id == id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        using var client = host.CreateClient();
        (await client.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = w.Tenants[0].Email })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Tenants[0].Email, password = Password })).StatusCode);
        var delivery = await AuthenticationDelivery(host, id);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_token_hash='synthetic-invitation',reset_expires_at={DateTimeOffset.UtcNow.AddMinutes(15)},reset_consumed_at=NULL WHERE id={id}");
        await SendEmail(host, delivery); Assert.Empty(probe.Messages);
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        (await client.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = w.Tenants[0].Email })).EnsureSuccessStatusCode();
        Assert.Equal("synthetic-invitation", await db.Database.SqlQuery<string>($"SELECT reset_token_hash AS \"Value\" FROM users WHERE id={id}").SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications WHERE event_data->>'authenticationKind'='EmailConfirmation' AND event_data->>'recipient'={id.ToString()}").SingleAsync());
        var pending = w.Tenants[1];
        await db.Users.Where(u => u.Id == pending.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new(AccountInvitationJob.JobName,
            "synthetic-pending:" + pending.Id, JsonSerializer.Serialize(new ApprovedTenantInvitation(w.Owner.Id, w.Residents[1], w.Contracts[1]))), default);
        (await client.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = pending.Email })).EnsureSuccessStatusCode();
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_data->>'authenticationKind'='EmailConfirmation' AND event_data->>'recipient'={pending.Id.ToString()}) AS \"Value\"").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task EmailVerificationRetriesTheSameLinkAndDoesNotRequireVerificationConfigurationForExistingRecovery()
    {
        var w = await Seed(); var probe = new SmtpProbe { Failure = new("email_smtp_450", retryable: true) };
        using var host = AuthenticationHost(probe); using var client = host.CreateClient();
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Users.Where(u => u.Id == w.Tenants[2].Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false));
        (await client.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = w.Tenants[2].Email })).EnsureSuccessStatusCode();
        var delivery = await AuthenticationDelivery(host, w.Tenants[2].Id); await SendEmail(host, delivery);
        Assert.Equal("Pending", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        var first = Assert.Single(probe.Messages);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddMinutes(-1)} WHERE id={delivery}");
        probe.Failure = null; await SendEmail(host, delivery);
        Assert.Equal(first.ActionUrl, probe.Messages[1].ActionUrl); Assert.Equal(first.IdempotencyKey, probe.Messages[1].IdempotencyKey);
        using var missing = host.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["AuthenticationEmail:WebVerificationUrl"] = "" })));
        using var unavailable = missing.CreateClient();
        foreach (var identifier in new[] { w.Tenants[2].Email, "unknown@example.invalid" })
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await unavailable.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = identifier })).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await unavailable.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[0].Email })).StatusCode);
    }
}
