using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    private static WebApplicationFactory<Program> RecoveryHost(WebApplicationFactory<Program> sms, ResidenceClock clock, int maxIp = 200) => sms.WithWebHostBuilder(b =>
    {
        b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["SmsRecovery:Enabled"] = "true", ["SmsRecovery:HashKey"] = Convert.ToBase64String(new byte[32]), ["SmsRecovery:MaxIpRequests"] = maxIp.ToString() }));
        b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock));
    });
    private static async Task<SmsRecoveryRequested> RecoveryRequest(HttpClient client, string identifier)
    {
        var result = await client.PostAsJsonAsync("/api/v1/auth/sms-recovery/request", new { identifier });
        Assert.Equal(HttpStatusCode.Accepted, result.StatusCode); Assert.Equal("no-store", result.Headers.CacheControl?.ToString());
        return (await result.Content.ReadFromJsonAsync<SmsRecoveryRequested>())!;
    }
    private static async Task<string> RecoveryOtp(WebApplicationFactory<Program> host, Guid user)
    {
        // Run the real durable job worker; neither the OTP verifier nor Identity is mocked.
        var worker = host.Services.GetRequiredService<PostgresJobWorker>();
        for (var i = 0; i < 30 && await worker.ProcessAllowedAsync(default, ["sms-recovery-delivery"]); i++) { }
        var message = host.Services.GetRequiredService<DemoSmsInbox>().List(user, "SMS-01").First();
        return Regex.Match(message.Content, @"\b[0-9]{6}\b").Value;
    }
    private static Task<HttpResponseMessage> VerifyRecovery(HttpClient client, string identifier, SmsRecoveryRequested request, string otp) =>
        client.PostAsJsonAsync("/api/v1/auth/sms-recovery/verify", new { identifier, request.ChallengeId, otp });

    [CompactPostgresTheory]
    [InlineData("Owner")]
    [InlineData("Staff")]
    [InlineData("Tenant")]
    public async Task SmsRecoveryResetsIdentityRevokesSessionsAndRejectsConcurrentReplayForEachRole(string role)
    {
        var w = await Seed(); using var sms = await SmsHost(w); var clock = new ResidenceClock(DateTimeOffset.UtcNow); using var host = RecoveryHost(sms, clock);
        var account = role == "Owner" ? w.Owner : role == "Staff" ? w.Staff : w.Tenants[0];
        await using var s = host.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var email = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == account.Id)).Email!;
        var rolesBefore = await db.Database.SqlQuery<string>($"SELECT roles::text AS \"Value\" FROM users WHERE id={account.Id}").SingleAsync();
        using var old = host.CreateClient(); var login = await old.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password }); login.EnsureSuccessStatusCode();
        var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!; old.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        using var anonymous = host.CreateClient(); var request = await RecoveryRequest(anonymous, email); var otp = await RecoveryOtp(host, account.Id);
        var payloads = await db.Database.SqlQuery<string>($"SELECT event_data::text AS \"Value\" FROM notifications WHERE id={request.ChallengeId}").SingleAsync();
        Assert.DoesNotContain(otp, payloads); Assert.DoesNotContain(email, payloads);
        var wrong = await VerifyRecovery(anonymous, email, request, otp == "000000" ? "000001" : "000000"); Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        var verifies = await Task.WhenAll(VerifyRecovery(anonymous, email, request, otp), VerifyRecovery(anonymous, email, request, otp));
        Assert.Single(verifies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(verifies, r => r.StatusCode == HttpStatusCode.BadRequest);
        var grant = (await verifies.Single(r => r.IsSuccessStatusCode).Content.ReadFromJsonAsync<SmsRecoveryVerified>())!;
        var reset = new { identifier = email, request.ChallengeId, grant.Authorization, newPassword = "Synthetic!Sms-Recovered-927", confirmPassword = "Synthetic!Sms-Recovered-927" };
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/sms-recovery/reset", reset with { confirmPassword = "mismatch" })).StatusCode);
        var resets = await Task.WhenAll(anonymous.PostAsJsonAsync("/api/v1/auth/sms-recovery/reset", reset), anonymous.PostAsJsonAsync("/api/v1/auth/sms-recovery/reset", reset));
        Assert.Single(resets, r => r.StatusCode == HttpStatusCode.NoContent); Assert.Single(resets, r => r.StatusCode == HttpStatusCode.BadRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, (await old.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/refresh", new { session.RefreshToken })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = reset.newPassword })).StatusCode);
        Assert.Equal(rolesBefore, await db.Database.SqlQuery<string>($"SELECT roles::text AS \"Value\" FROM users WHERE id={account.Id}").SingleAsync());
        Assert.True(await db.StaffLocationAssignments.AnyAsync(a => a.StaffUserId == w.Staff.Id && a.LocationId == w.Location));
        Assert.Equal(3, await db.Set<BHome.Domain.TenantContracts.Contract>().CountAsync(c => c.RoomId == w.Room));
        // The fixture's sole Owner is reused by other tests. Restore its synthetic password through Identity.
        if (role == "Owner")
        {
            db.ChangeTracker.Clear(); var manager = s.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<BHome.Infrastructure.Persistence.ApplicationUser>>();
            var user = (await manager.FindByIdAsync(account.Id.ToString()))!;
            Assert.True((await manager.ResetPasswordAsync(user, await manager.GeneratePasswordResetTokenAsync(user), Password)).Succeeded);
        }
    }

    [CompactPostgresFact]
    public async Task SmsRecoveryUnknownUnverifiedAndMissingPhoneRequestsAreGenericAndDoNotSend()
    {
        var w = await Seed(); using var sms = await SmsHost(w); using var host = RecoveryHost(sms, new ResidenceClock(DateTimeOffset.UtcNow));
        await using var s = host.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET phone_confirmed=false WHERE id={w.Tenants[0].Id}");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET phone=NULL WHERE id={w.Tenants[1].Id}");
        using var client = host.CreateClient();
        foreach (var identifier in new[] { "unknown@example.invalid", w.Tenants[0].Id.ToString("N") + ".sms-demo", w.Tenants[1].Id.ToString("N") + ".sms-demo" })
        {
            var response = await RecoveryRequest(client, identifier); Assert.Equal(60, response.RetryAfterSeconds); Assert.Equal(300, response.ExpiresInSeconds);
            Assert.Equal(HttpStatusCode.BadRequest, (await VerifyRecovery(client, identifier, response, "123456")).StatusCode);
        }
        Assert.Empty(host.Services.GetRequiredService<DemoSmsInbox>().List());
    }

    [CompactPostgresFact]
    public async Task SmsRecoveryEnforcesAttemptsCooldownSupersessionExpiryAndIpLimits()
    {
        var w = await Seed(); using var sms = await SmsHost(w); var clock = new ResidenceClock(DateTimeOffset.UtcNow); using var host = RecoveryHost(sms, clock);
        var identifier = w.Tenants[0].Id.ToString("N") + ".sms-demo"; using var client = host.CreateClient();
        var first = await RecoveryRequest(client, identifier); var otp = await RecoveryOtp(host, w.Tenants[0].Id);
        await RecoveryRequest(client, identifier); Assert.Single(host.Services.GetRequiredService<DemoSmsInbox>().List(w.Tenants[0].Id));
        for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.BadRequest, (await VerifyRecovery(client, identifier, first, otp == "000000" ? "000001" : "000000")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await VerifyRecovery(client, identifier, first, otp)).StatusCode);
        clock.Now = clock.Now.AddSeconds(61); var second = await RecoveryRequest(client, identifier); var next = await RecoveryOtp(host, w.Tenants[0].Id);
        clock.Now = clock.Now.AddSeconds(61); var third = await RecoveryRequest(client, identifier); var latest = await RecoveryOtp(host, w.Tenants[0].Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await VerifyRecovery(client, identifier, second, next)).StatusCode);
        clock.Now = clock.Now.AddMinutes(5);
        Assert.Equal(HttpStatusCode.BadRequest, (await VerifyRecovery(client, identifier, third, latest)).StatusCode);
        Assert.Empty(host.Services.GetRequiredService<DemoSmsInbox>().List(w.Tenants[0].Id));
        using var limited = RecoveryHost(sms, new ResidenceClock(clock.Now.AddDays(2)), 1); using var ipClient = limited.CreateClient();
        await RecoveryRequest(ipClient, "unknown-one@example.invalid");
        Assert.Equal(HttpStatusCode.TooManyRequests, (await ipClient.PostAsJsonAsync("/api/v1/auth/sms-recovery/request", new { identifier = "unknown-two@example.invalid" })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task SmsRecoverySandboxCannotPretendToDeliverAnOtpAndPhoneChangeInvalidatesVerifiedGrant()
    {
        var w = await Seed(); using var sms = await SmsHost(w); using var host = RecoveryHost(sms, new ResidenceClock(DateTimeOffset.UtcNow));
        using var client = host.CreateClient(); var identifier = w.Tenants[0].Id.ToString("N") + ".sms-demo";
        var request = await RecoveryRequest(client, identifier); var otp = await RecoveryOtp(host, w.Tenants[0].Id);
        var verify = await VerifyRecovery(client, identifier, request, otp); verify.EnsureSuccessStatusCode(); var grant = (await verify.Content.ReadFromJsonAsync<SmsRecoveryVerified>())!;
        await using var s = host.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET phone_confirmed=false WHERE id={w.Tenants[0].Id}");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/sms-recovery/reset", new { identifier, request.ChallengeId, grant.Authorization, newPassword = "Synthetic!Sms-Recovered-927", confirmPassword = "Synthetic!Sms-Recovered-927" })).StatusCode);
        using var sandbox = host.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["Sms:Mode"] = "Sandbox", ["Sms:ApiKey"] = "synthetic-api", ["Sms:SecretKey"] = "synthetic-secret" })));
        using var sandboxClient = sandbox.CreateClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await sandboxClient.PostAsJsonAsync("/api/v1/auth/sms-recovery/request", new { identifier = "unknown@example.invalid" })).StatusCode);
    }
}
