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
            var contract = (await BHome.Infrastructure.Modules.PropertyManagement.Persistence.NativeContractSnapshot.LoadAsync(db, w.Contracts[0], default))!;
            await scope.ServiceProvider.GetRequiredService<IPostActivationTenantProvisioning>().ProvisionAsync(contract, w.Owner.Id, default);
            await tx.CommitAsync();
        }
        Assert.Equal(count, await db.Users.CountAsync());
        Assert.Equal(w.Tenants[0].Id, (await db.Set<BHome.Domain.TenantContracts.Resident>().SingleAsync(r => r.Id == w.Residents[0])).TenantUserId);
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
            var contract = (await BHome.Infrastructure.Modules.PropertyManagement.Persistence.NativeContractSnapshot.LoadAsync(db, w.Contracts[1], default))!;
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
            {
                ["NotificationChannels:AutomationEnabled"] = "false",
                ["Jobs:Enabled"] = "false",
                ["Jobs:PollSeconds"] = "1",
                ["Email:AllowedRecipients:1"] = w.Tenants[0].Email
            }));
            b.ConfigureServices(s => { s.AddSingleton<IBackgroundJobHandler>(business); s.AddHostedService<NotificationAutomationWorker>(); });
        });
        var key = "auth-worker-tenant:" + w.Residents[0];
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var active = await db.Set<Contract>().SingleAsync(c => c.Id == w.Contracts[0]);
            active.InitialPaymentRequired = false; // This seeded legacy tenancy has no initial-payment order.
            active.RequiredDeposit = 1000000;
            await db.SaveChangesAsync();
            var payment = Guid.NewGuid(); var allocation = Guid.NewGuid(); var operation = Guid.NewGuid();
            var reference = "SYNTHETIC-MAIN-" + payment.ToString("N"); var now = DateTimeOffset.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
                VALUES({payment},'SYNTHETIC','test',{reference},{reference},{now},1000000,'VND','VERIFIED','MANUAL',{w.Owner.Id},{now})
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
                VALUES({allocation},{payment},{w.Contracts[0]},1000000,{operation},1,{w.Owner.Id},{now},'Synthetic verified Main deposit')
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET email_confirmed=false,reset_token_hash={new string('A', 64)},reset_expires_at={DateTimeOffset.UtcNow.AddSeconds(-1)},reset_consumed_at=NULL WHERE id={w.Tenants[0].Id}");
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET contact_email={w.Tenants[0].Email} WHERE id={w.Residents[0]}");
            var queue = scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>();
            var job = new JobSubmission(AccountInvitationJob.JobName, key, JsonSerializer.Serialize(new ApprovedTenantInvitation(w.Owner.Id, w.Residents[0], w.Contracts[0])));
            await queue.EnqueueAsync(job, default); await queue.EnqueueAsync(job, default);
            await queue.EnqueueAsync(new("auth-audit-business-job-must-not-run", key, "{}"), default);
        }
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (!probe.Messages.Any(m => m.Destination == w.Tenants[0].Email && m.EventType == "TENANT_SETUP_AFTER_ACTIVATION")) await Task.Delay(100, deadline.Token);
        var mail = Assert.Single(probe.Messages, m => m.EventType == "TENANT_SETUP_AFTER_ACTIVATION");
        Assert.Equal(w.Tenants[0].Email, mail.Destination);
        Assert.Contains("Hợp đồng thuê của bạn đã hoạt động", mail.Body);
        Assert.Contains("1.000.000", mail.Body);
        Assert.Contains("Trạng thái tài khoản: Đang hoạt động", mail.Body);
        Assert.Contains(w.Contracts[0].ToString("D"), mail.Body);
        Assert.Contains("tự đặt mật khẩu", mail.Body);
        var attachment = Assert.Single(mail.Attachments!);
        Assert.Equal("application/pdf", attachment.ContentType);
        Assert.Equal("%PDF-1.7 SYNTHETIC MAIN BOTH SIGNED"u8.ToArray(), attachment.Content);
        Assert.Contains(w.Contracts[0].ToString("N"), attachment.FileName);
        Assert.NotNull(mail.ActionUrl);
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
