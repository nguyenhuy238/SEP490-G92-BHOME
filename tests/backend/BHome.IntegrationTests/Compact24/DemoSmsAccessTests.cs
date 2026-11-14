using System.Net;
using System.Net.Http.Json;
using BHome.Application.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task DemoSmsInboxRequiresAuthenticationEnforcesRecipientIsolationAndIsUnavailableInProduction()
    {
        var w = await Seed(); using var sms = await SmsHost(w); var clock = new ResidenceClock(DateTimeOffset.UtcNow); using var host = RecoveryHost(sms, clock);
        using var anonymous = host.CreateClient(); using var owner = await Client(w.Owner, host); using var tenant = await Client(w.Tenants[0], host); using var staff = await Client(w.Staff, host);
        var request = await RecoveryRequest(anonymous, w.Tenants[0].UserName!); var otp = await RecoveryOtp(host, w.Tenants[0].Id);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/demo/sms")).StatusCode);
        var messages = (await owner.GetFromJsonAsync<DemoSmsView[]>("/api/v1/demo/sms?template=SMS-01"))!;
        var message = Assert.Single(messages); Assert.Contains(otp, message.Content); Assert.StartsWith("***", message.MaskedPhone); Assert.Equal("Simulated", message.Status);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/api/v1/demo/sms/{message.Id}")).StatusCode);
        Assert.Single((await tenant.GetFromJsonAsync<DemoSmsView[]>("/api/v1/demo/sms"))!);
        Assert.Empty((await staff.GetFromJsonAsync<DemoSmsView[]>("/api/v1/demo/sms"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.GetAsync($"/api/v1/demo/sms?recipient={w.Tenants[0].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.GetAsync($"/api/v1/demo/sms/{message.Id}")).StatusCode);
        using var production = host.WithWebHostBuilder(b => b.UseEnvironment("Production")); using var prodOwner = await Client(w.Owner, production);
        Assert.Equal(HttpStatusCode.NotFound, (await prodOwner.GetAsync("/api/v1/demo/sms")).StatusCode);
        clock.Now = clock.Now.AddMinutes(5);
        // Old access token remains within its normal lifetime, but expired OTP content is gone.
        Assert.Empty((await owner.GetFromJsonAsync<DemoSmsView[]>("/api/v1/demo/sms"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/v1/demo/sms/{message.Id}")).StatusCode);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var durable = await db.Database.SqlQuery<string>($"SELECT event_data::text||delivery_history::text AS \"Value\" FROM notifications WHERE id={request.ChallengeId}").SingleAsync();
        Assert.DoesNotContain(otp, durable);
    }
}
