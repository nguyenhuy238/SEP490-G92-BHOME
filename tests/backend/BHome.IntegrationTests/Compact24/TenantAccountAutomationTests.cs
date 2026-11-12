using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Application.Operations;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Domain.TenantContracts;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task ApprovedExistingTenantLinkIsReusedAndWaitsForSetupWithoutCreatingAnotherIdentity()
    {
        var w = await Seed(); using var previous = await Client(w.Tenants[0]);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var count = await db.Users.CountAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET email_confirmed=false WHERE id={w.Tenants[0].Id}");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET contact_email={w.Tenants[0].Email} WHERE id={w.Residents[0]}");
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var contract = await db.Set<Contract>().Include(c => c.Residents).SingleAsync(c => c.Id == w.Contracts[0]);
            await scope.ServiceProvider.GetRequiredService<IPostActivationTenantProvisioning>().ProvisionAsync(contract, w.Owner.Id, default);
            await tx.CommitAsync();
        }
        Assert.Equal(count, await db.Users.CountAsync());
        Assert.Equal(w.Tenants[0].Id, (await db.Set<Resident>().SingleAsync(r => r.Id == w.Residents[0])).TenantUserId);
        Assert.Equal(HttpStatusCode.Unauthorized, (await previous.GetAsync("/api/v1/auth/me")).StatusCode);
        using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Tenants[0].Email, password = Password })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task MatchingEmailWithoutAnApprovedTenantLinkCannotSilentlyAttachAnExistingIdentity()
    {
        var w = await Seed(); await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); var count = await db.Users.CountAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET user_id=NULL,contact_email={w.Tenants[0].Email} WHERE id={w.Residents[1]}");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET tenant_user_id=NULL WHERE id={w.Contracts[1]}");
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var contract = await db.Set<Contract>().Include(c => c.Residents).SingleAsync(c => c.Id == w.Contracts[1]);
            var failure = await Assert.ThrowsAsync<ContractException>(() => scope.ServiceProvider.GetRequiredService<IPostActivationTenantProvisioning>().ProvisionAsync(contract, w.Owner.Id, default));
            Assert.Equal("email_requires_explicit_account_link", failure.Code);
        }
        Assert.Equal(count, await db.Users.CountAsync());
    }

    private sealed class BusinessJobProbe : IBackgroundJobHandler
    {
        public string Name => "auth-audit-business-job-must-not-run";
        public int Executed;
        public Task ExecuteAsync(JobExecution job, CancellationToken t) { Interlocked.Increment(ref Executed); return Task.CompletedTask; }
    }
    [CompactPostgresFact]
    public async Task AuthOnlyWorkerDispatchesApprovedMainTenantInvitationWithoutRunningBusinessJobsAndExposesSafeStatus()
    {
        var w = await Seed(); var probe = new SmtpProbe(); var business = new BusinessJobProbe();
        using var configured = AuthenticationHost(probe);
        using var host = configured.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            { ["NotificationChannels:AutomationEnabled"] = "false", ["Jobs:Enabled"] = "false", ["Jobs:PollSeconds"] = "1" }));
            b.ConfigureServices(s => { s.AddSingleton<IBackgroundJobHandler>(business); s.AddHostedService<NotificationAutomationWorker>(); });
        });
        var key = "auth-worker-tenant:" + w.Residents[0];
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET email_confirmed=false,reset_token_hash={new string('A', 64)},reset_expires_at={DateTimeOffset.UtcNow.AddSeconds(-1)},reset_consumed_at=NULL WHERE id={w.Tenants[0].Id}");
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET contact_email={w.Tenants[0].Email} WHERE id={w.Residents[0]}");
            var queue = scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>();
            var job = new JobSubmission(AccountInvitationJob.JobName, key, JsonSerializer.Serialize(new ApprovedTenantInvitation(w.Owner.Id, w.Residents[0], w.Contracts[0])));
            await queue.EnqueueAsync(job, default); await queue.EnqueueAsync(job, default);
            await queue.EnqueueAsync(new("auth-audit-business-job-must-not-run", key, "{}"), default);
        }
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (!probe.Messages.Any(m => m.Destination == w.Tenants[0].Email && m.EventType == "ACCOUNT_INVITATION")) await Task.Delay(100, deadline.Token);
        var mail = Assert.Single(probe.Messages, m => m.EventType == "ACCOUNT_INVITATION");
        Assert.Equal(w.Tenants[0].Email, mail.Destination);
        using var owner = await Client(w.Owner, host);
        ResidentAdministrationView? detail;
        do
        {
            detail = await owner.GetFromJsonAsync<ResidentAdministrationView>($"/api/v1/residents/{w.Residents[0]}");
            if (detail!.Account!.DeliveryState == "Sent") break;
            await Task.Delay(100, deadline.Token);
        } while (true);
        Assert.False(detail.Account.EmailConfirmed); Assert.Equal("Queued", detail.Account.InvitationDispatchState);
        Assert.Null(detail.Account.InvitationAcceptedAt);
        var serialized = JsonSerializer.Serialize(detail.Account); Assert.DoesNotContain("token", serialized, StringComparison.OrdinalIgnoreCase);
        using var anonymous = host.CreateClient();
        var query = QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Fragment.TrimStart('#'));
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", new AcceptInvitationRequest(query["userName"].ToString(), query["token"].ToString(), "Synthetic!Tenant-Setup-725"))).StatusCode);
        detail = await owner.GetFromJsonAsync<ResidentAdministrationView>($"/api/v1/residents/{w.Residents[0]}");
        Assert.True(detail!.Account!.EmailConfirmed); Assert.NotNull(detail.Account.InvitationAcceptedAt);
        await using var check = host.Services.CreateAsyncScope(); var context = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal("Pending", await context.Database.SqlQuery<string>($"SELECT status AS \"Value\" FROM operational_tasks WHERE task_data->>'name'='auth-audit-business-job-must-not-run' AND task_data->>'idempotencyKey'={key}").SingleAsync());
        Assert.Equal(0, business.Executed);
        Assert.Equal(1, await context.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM operational_tasks WHERE task_data->>'name'={AccountInvitationJob.JobName} AND task_data->>'idempotencyKey'={key}").SingleAsync());
        Assert.Equal(3, await context.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM contracts WHERE room_id={w.Room} AND status=3").SingleAsync());
        using var tenant = await Client(w.Tenants[1], host);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"/api/v1/residents/{w.Residents[0]}")).StatusCode);
    }
}
