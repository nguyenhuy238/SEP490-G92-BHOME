using System.Net;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
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
    private WebApplicationFactory<Program> AuthenticationHost(SmtpProbe probe) => EmailHost(probe).WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
        c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AuthenticationEmail:WebResetUrl"] = "https://owner.example.invalid/reset-password",
            ["AuthenticationEmail:WebInvitationUrl"] = "https://owner.example.invalid/accept-invitation",
            ["AuthenticationEmail:MobileResetUrl"] = "bhome://reset-password",
            ["AuthenticationEmail:MobileInvitationUrl"] = "bhome://accept-invitation",
            ["AuthenticationEmail:TrustedOrigins:0"] = "https://owner.example.invalid",
            ["AuthenticationEmail:TrustedOrigins:1"] = "bhome://reset-password",
            ["AuthenticationEmail:TrustedOrigins:2"] = "bhome://accept-invitation"
        })));

    private static async Task<Guid> AuthenticationDelivery(WebApplicationFactory<Program> host, Guid user)
    {
        await using var s = host.Services.CreateAsyncScope();
        var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        return await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'protectedAuthenticationEmail' IS NOT NULL AND event_data->>'recipient'={user.ToString()} ORDER BY event_at DESC LIMIT 1").SingleAsync();
    }

    [CompactPostgresFact]
    public async Task AuthenticationResetByEmailIsGenericDeduplicatedEncryptedAndRevokesSessionsAfterOneUse()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe);
        using var oldSession = await Client(w.Tenants[0], host); using var anonymous = host.CreateClient();
        var responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[0].Email })));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Accepted, r.StatusCode));
        var unknown = await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = "unknown@example.invalid" });
        Assert.Equal(await responses[0].Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.Empty(probe.Messages);
        var delivery = await AuthenticationDelivery(host, w.Tenants[0].Id);
        await SendEmail(host, delivery);
        var mail = Assert.Single(probe.Messages); Assert.StartsWith("bhome://reset-password?", mail.ActionUrl);
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Query);
        var token = query["token"].ToString(); Assert.NotEmpty(token);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var stored = await db.Database.SqlQuery<string>($"SELECT event_data::text AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.DoesNotContain(token, stored); Assert.DoesNotContain(mail.ActionUrl!, stored); Assert.DoesNotContain(w.Tenants[0].Email!, stored);
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'protectedAuthenticationEmail' IS NOT NULL AND event_data->>'recipient'={w.Tenants[0].Id.ToString()}").SingleAsync());
        var reset = new { userName = query["userName"].ToString(), token, newPassword = "Synthetic!Recovered-725" };
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset with { token = "bad" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset with { newPassword = "short" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await oldSession.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Tenants[0].Email, password = reset.newPassword })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task AuthenticationResetRetriesTransientSmtpButNeverSendsExpiredOrSupersededLinks()
    {
        var w = await Seed(); var probe = new SmtpProbe { Failure = new("email_smtp_450", retryable: true) }; using var host = AuthenticationHost(probe);
        using var client = host.CreateClient();
        (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[1].Email })).EnsureSuccessStatusCode();
        var delivery = await AuthenticationDelivery(host, w.Tenants[1].Id); await SendEmail(host, delivery);
        var first = Assert.Single(probe.Messages);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
        probe.Failure = null; await SendEmail(host, delivery);
        Assert.Equal(first.ActionUrl, probe.Messages[1].ActionUrl); Assert.Equal(first.IdempotencyKey, probe.Messages[1].IdempotencyKey);
        (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[2].Email })).EnsureSuccessStatusCode();
        var expired = await AuthenticationDelivery(host, w.Tenants[2].Id);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_expires_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={w.Tenants[2].Id}");
        await SendEmail(host, expired); Assert.Equal(2, probe.Messages.Count);
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={expired}").SingleAsync());
        (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[2].Email })).EnsureSuccessStatusCode();
        var fresh = await AuthenticationDelivery(host, w.Tenants[2].Id); Assert.NotEqual(expired, fresh);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_consumed_at={DateTimeOffset.UtcNow} WHERE id={w.Tenants[2].Id}");
        await SendEmail(host, fresh); Assert.Equal(2, probe.Messages.Count);
    }

    [Fact]
    public void AuthenticationCallbacksRejectUntrustedOriginsQueriesAndProductionLocalhost()
    {
        var options = new AuthenticationEmailOptions { TrustedOrigins = ["https://owner.example.invalid", "http://localhost:5173", "bhome://reset-password"] };
        Assert.True(options.Trusted("https://owner.example.invalid/reset-password", false));
        Assert.False(options.Trusted("https://attacker.invalid/reset-password", false));
        Assert.False(options.Trusted("https://owner.example.invalid/reset-password?next=https://attacker.invalid", false));
        Assert.False(options.Trusted("http://localhost:5173/reset-password", false));
        Assert.True(options.Trusted("http://localhost:5173/reset-password", true));
        Assert.True(options.Trusted("bhome://reset-password", false));
        Assert.False(options.Trusted("javascript:alert(1)", true));
    }

    [CompactPostgresFact]
    public async Task AuthenticationOnlyWorkerDeliversRecoveryWithoutPublishingBusinessBacklog()
    {
        var w = await Seed(); var probe = new SmtpProbe();
        using var configured = AuthenticationHost(probe);
        using var host = configured.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            { ["NotificationChannels:AutomationEnabled"] = "false", ["Jobs:Enabled"] = "false", ["Jobs:PollSeconds"] = "1" }));
            b.ConfigureServices(s => s.AddHostedService<NotificationAutomationWorker>());
        });
        using var client = host.CreateClient();
        (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = w.Tenants[0].Email })).EnsureSuccessStatusCode();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (probe.Messages.Count == 0) await Task.Delay(100, deadline.Token);
        Assert.Equal("PASSWORD_RESET_REQUESTED", Assert.Single(probe.Messages).EventType);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(3, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM contracts WHERE room_id={w.Room} AND status=3").SingleAsync());
    }
}
