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
            ["AuthenticationEmail:WebVerificationUrl"] = "https://owner.example.invalid/confirm-email",
            ["AuthenticationEmail:MobileVerificationUrl"] = "bhome://confirm-email",
            ["AuthenticationEmail:TrustedOrigins:0"] = "https://owner.example.invalid",
            ["AuthenticationEmail:TrustedOrigins:1"] = "bhome://reset-password",
            ["AuthenticationEmail:TrustedOrigins:2"] = "bhome://accept-invitation",
            ["AuthenticationEmail:TrustedOrigins:3"] = "bhome://confirm-email"
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
        var mail = Assert.Single(probe.Messages); Assert.StartsWith("https://owner.example.invalid/reset-password#", mail.ActionUrl);
        Assert.Contains("bhome://reset-password?", mail.Body);
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Fragment.TrimStart('#'));
        var token = query["token"].ToString(); Assert.NotEmpty(token);
        var nativeQuery = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(mail.Body.Split('\n').Last()).Query);
        Assert.Equal(token, nativeQuery["token"].ToString());
        Assert.Equal(query["userName"].ToString(), nativeQuery["userName"].ToString());
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
        var publisher = scope.ServiceProvider.GetRequiredService<CompactNotificationEvents>();
        await publisher.PublishAuthenticationAsync(default); await publisher.PublishAuthenticationAsync(default);
        var completed = await db.Set<BHome.Domain.Notifications.UserNotification>().Where(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "PASSWORD_RESET_COMPLETED").ToArrayAsync();
        Assert.Single(completed);
        Assert.False(await db.Set<BHome.Domain.Notifications.UserNotification>().AnyAsync(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "PASSWORD_CHANGED"));
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
        var expiredQuery = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(first.ActionUrl!).Fragment.TrimStart('#'));
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_expires_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={w.Tenants[1].Id}");
        var originalHash = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == w.Tenants[1].Id)).PasswordHash;
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", new { userName = expiredQuery["userName"].ToString(), token = expiredQuery["token"].ToString(), newPassword = "Synthetic!Expired-Rejected-725" })).StatusCode);
        Assert.Equal(originalHash, (await db.Users.AsNoTracking().SingleAsync(u => u.Id == w.Tenants[1].Id)).PasswordHash);
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
        while (!probe.Messages.Any(m => m.Destination == w.Tenants[0].Email && m.EventType == "PASSWORD_RESET_REQUESTED")) await Task.Delay(100, deadline.Token);
        Assert.Single(probe.Messages, m => m.Destination == w.Tenants[0].Email && m.EventType == "PASSWORD_RESET_REQUESTED");
        Assert.DoesNotContain(probe.Messages, m => m.EventType.StartsWith("INVOICE_") || m.EventType.StartsWith("INCIDENT_") || m.EventType.StartsWith("CONTRACT_"));
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(3, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM contracts WHERE room_id={w.Room} AND status=3").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task AuthenticationInvitationsQueueRoleSpecificLinksPreservePendingSetupAndAreOneTime()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe);
        using var owner = await Client(w.Owner, host);
        var email = Guid.NewGuid().ToString("N") + "@example.invalid";
        var created = await owner.PostAsJsonAsync("/api/v1/staff", new BHome.Application.Operations.StaffCreate(email, "Synthetic invited staff", null, Password,
            new(null, "PartTime", Today, null, null, null, "Active")));
        created.EnsureSuccessStatusCode(); var staff = (await created.Content.ReadFromJsonAsync<BHome.Application.Operations.StaffView>())!;
        using var beforeInvitation = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await beforeInvitation.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await beforeInvitation.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = email })).StatusCode);
        await using var pendingScope = host.Services.CreateAsyncScope();
        var pendingDb = pendingScope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.False(await pendingDb.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_data->>'recipient'={staff.UserId.ToString()} AND event_data->>'authenticationKind'='EmailConfirmation') AS \"Value\"").SingleAsync());
        Assert.Equal(1, await pendingDb.Users.CountAsync(u => u.NormalizedEmail == email.ToUpperInvariant()));
        var response = await owner.PostAsync($"/api/v1/staff/{staff.UserId}/invitation", null); response.EnsureSuccessStatusCode();
        Assert.Equal("Queued", (await response.Content.ReadFromJsonAsync<TenantInvitationResult>())!.DeliveryState);
        var repeated = await owner.PostAsync($"/api/v1/staff/{staff.UserId}/invitation", null); repeated.EnsureSuccessStatusCode();
        Assert.Equal("ExistingInvitationPreserved", (await repeated.Content.ReadFromJsonAsync<TenantInvitationResult>())!.DeliveryState);
        using var anonymous = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password })).StatusCode);
        var delivery = await AuthenticationDelivery(host, staff.UserId); await SendEmail(host, delivery);
        var mail = Assert.Single(probe.Messages); Assert.Contains("Staff", mail.Title);
        Assert.DoesNotContain(Password, mail.Body); Assert.StartsWith("https://owner.example.invalid/accept-invitation#", mail.ActionUrl);
        Assert.Contains("bhome://accept-invitation?", mail.Body);
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Fragment.TrimStart('#'));
        var accept = new AcceptInvitationRequest(query["userName"].ToString(), query["token"].ToString(), "Synthetic!Invited-725");
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", accept with { Token = "invalid" })).StatusCode);
        await pendingDb.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_expires_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={staff.UserId}");
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", accept)).StatusCode);
        (await owner.PostAsync($"/api/v1/staff/{staff.UserId}/invitation", null)).EnsureSuccessStatusCode();
        await SendEmail(host, await AuthenticationDelivery(host, staff.UserId));
        Assert.Equal(2, probe.Messages.Count); Assert.All(probe.Messages, m => Assert.Equal(email, m.Destination));
        var fresh = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(probe.Messages[1].ActionUrl!).Fragment.TrimStart('#'));
        var oldAccept = accept;
        accept = accept with { Token = fresh["token"].ToString() };
        Assert.NotEqual(oldAccept.Token, accept.Token);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", oldAccept)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", accept)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", accept)).StatusCode);
        var login = await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = accept.NewPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var session = await TestAuthResponse.ReadAsync(login.Content);
        anonymous.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken);
        Assert.Equal("[]", await anonymous.GetStringAsync("/api/v1/capture/locations"));
        Assert.Equal(HttpStatusCode.Forbidden, (await anonymous.GetAsync("/api/v1/staff")).StatusCode);
        await pendingDb.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET is_active=false WHERE id={staff.UserId}");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task AuthenticationTenantProvisionIsOwnerScopedAndSmtpFailureKeepsAccountAndEncryptedGrant()
    {
        var w = await Seed(); var probe = new SmtpProbe { Failure = new("email_smtp_450", retryable: true) }; using var host = AuthenticationHost(probe);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET user_id=NULL,contact_email={"invited-" + Guid.NewGuid().ToString("N") + "@example.invalid"} WHERE id={w.Residents[0]}");
        var email = await db.Set<BHome.Domain.TenantContracts.Resident>().Where(r => r.Id == w.Residents[0]).Select(r => r.ContactEmail).SingleAsync();
        using var staff = await Client(w.Staff, host);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync($"/api/v1/residents/{w.Residents[0]}/invitation", new TenantInvitationRequest(email!))).StatusCode);
        using var owner = await Client(w.Owner, host);
        var response = await owner.PostAsJsonAsync($"/api/v1/residents/{w.Residents[0]}/invitation", new TenantInvitationRequest(email!)); response.EnsureSuccessStatusCode();
        var invited = (await response.Content.ReadFromJsonAsync<TenantInvitationResult>())!; Assert.Equal("Queued", invited.DeliveryState);
        var delivery = await AuthenticationDelivery(host, invited.UserId); await SendEmail(host, delivery);
        var mail = Assert.Single(probe.Messages); Assert.Contains("Chào mừng", mail.Title);
        Assert.Equal(invited.UserId, await db.Set<BHome.Domain.TenantContracts.Resident>().Where(r => r.Id == w.Residents[0]).Select(r => r.TenantUserId).SingleAsync());
        Assert.False((await db.Users.AsNoTracking().SingleAsync(u => u.Id == invited.UserId)).EmailConfirmed);
        Assert.Equal("Pending", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        var accountStatus = await owner.GetFromJsonAsync<BHome.Application.Operations.ResidentAdministrationView>($"/api/v1/residents/{w.Residents[0]}");
        Assert.Equal("Pending", accountStatus!.Account!.DeliveryState);
        Assert.Equal(3, await db.Database.SqlQuery<int>($"SELECT status::int AS \"Value\" FROM contracts WHERE id={w.Contracts[0]}").SingleAsync());
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_expires_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={invited.UserId}");
        using var anonymous = host.CreateClient();
        var q = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Fragment.TrimStart('#'));
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", new AcceptInvitationRequest(q["userName"].ToString(), q["token"].ToString(), "Synthetic!Invited-725"))).StatusCode);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
        await SendEmail(host, delivery); Assert.Single(probe.Messages);
    }

    [CompactPostgresFact]
    public async Task AuthenticationSecurityNoticesIgnoreFailedChangesDeduplicateAndDoNotRollbackPasswordOnSmtpFailure()
    {
        var w = await Seed(); var probe = new SmtpProbe { Failure = new("email_smtp_450", retryable: true) }; using var host = AuthenticationHost(probe);
        using var client = await Client(w.Tenants[0], host);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = "Wrong!Password-725", newPassword = "Synthetic!Changed-725" })).StatusCode);
        await using var scope = host.Services.CreateAsyncScope(); var publisher = scope.ServiceProvider.GetRequiredService<CompactNotificationEvents>();
        await publisher.PublishAuthenticationAsync(default);
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.False(await db.Set<BHome.Domain.Notifications.UserNotification>().AnyAsync(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "PASSWORD_CHANGED"));
        (await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = Password, newPassword = "Synthetic!Changed-725" })).EnsureSuccessStatusCode();
        await publisher.PublishAuthenticationAsync(default); await publisher.PublishAuthenticationAsync(default);
        var notice = await db.Set<BHome.Domain.Notifications.UserNotification>().SingleAsync(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "PASSWORD_CHANGED");
        Assert.Contains("giờ Việt Nam", notice.Summary); Assert.DoesNotContain("Synthetic!Changed-725", notice.Summary);
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().ProcessPendingAsync(default, true);
        Assert.Single(probe.Messages, m => m.EventType == "PASSWORD_CHANGED" && m.Destination == w.Tenants[0].Email);
        using var anonymous = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Tenants[0].Email, password = "Synthetic!Changed-725" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task AuthenticationStatusAndExistingIdentityLockoutNotifyOnlyAffectedAccountOnce()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe);
        using var anonymous = host.CreateClient();
        for (var n = 0; n < 5; n++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Tenants[0].Email, password = "Wrong!Password-725" })).StatusCode);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET is_active=false WHERE id={w.Tenants[1].Id}");
        var publisher = scope.ServiceProvider.GetRequiredService<CompactNotificationEvents>();
        await publisher.PublishAuthenticationAsync(default); await publisher.PublishAuthenticationAsync(default);
        var locked = await db.Set<BHome.Domain.Notifications.UserNotification>().Where(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "ACCOUNT_LOCKED").ToArrayAsync();
        Assert.Single(locked);
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().ProcessPendingAsync(default, true);
        Assert.Single(probe.Messages, m => m.EventType == "ACCOUNT_LOCKED" && m.Destination == w.Tenants[0].Email);
        Assert.Single(probe.Messages, m => m.EventType == "ACCOUNT_DEACTIVATED" && m.Destination == w.Tenants[1].Email);
        Assert.DoesNotContain(probe.Messages, m => m.Destination == w.Tenants[2].Email);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET is_active=true WHERE id={w.Tenants[1].Id}");
        await publisher.PublishAuthenticationAsync(default);
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().ProcessPendingAsync(default, true);
        Assert.Single(probe.Messages, m => m.EventType == "ACCOUNT_ACTIVATED" && m.Destination == w.Tenants[1].Email);
    }

    [CompactPostgresFact]
    public async Task AuthenticationPublicRecoveryRateLimitAndUnconfirmedAccountsDoNotSendEmail()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var configured = AuthenticationHost(probe);
        await using (var scope = configured.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().Users.Where(u => u.Id == w.Tenants[0].Id).ExecuteUpdateAsync(x => x.SetProperty(u => u.EmailConfirmed, false));
        using var host = configured.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["AuthRateLimit:PermitLimit"] = "2" })));
        using var anonymous = host.CreateClient();
        foreach (var identifier in new[] { w.Tenants[0].Email!, "invalid-email" })
            Assert.Equal(HttpStatusCode.Accepted, (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = identifier })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = "unknown@example.invalid" })).StatusCode);
        await using var check = host.Services.CreateAsyncScope(); var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_data->>'protectedAuthenticationEmail' IS NOT NULL AND event_data->>'recipient'={w.Tenants[0].Id.ToString()}) AS \"Value\"").SingleAsync());
        Assert.Empty(probe.Messages);
    }
}
