using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Notifications;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.PaymentsDebt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.TestHost;
using BHome.Infrastructure.Modules.Notifications;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24RefundTests
{
    private sealed class ReceiptNoticeChannelProbe : INotificationChannelProvider
    {
        public List<ChannelMessage> Messages { get; } = [];
        public bool IsConfigured(string channel) => true;
        public bool SupportsIdempotency(string channel) => true;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken token)
        { Messages.Add(message); return Task.FromResult("synthetic-accepted"); }
    }

    [CompactPostgresFact]
    public async Task QueuedReceiptRefundChannelDeliveryRechecksProofBeforeContactingProvider()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, receipt) = await Setup(fixture); using var client = owner;
            var sourceRoute = $"/api/v1/payment-transactions/{receipt}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(sourceRoute));
            var row = await Value<RefundView>(await Post(owner, sourceRoute, new RefundInput(source.Beneficiaries[0].Id, 20000, "Synthetic return", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", new RefundDecision(row.Version, true, "Synthetic approval", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Execute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-QUEUED-NOTICE", Photo()));
            await PumpRefundNotices(fixture);
            var provider = new ReceiptNoticeChannelProbe();
            using var host = fixture.Capture.Factory.WithWebHostBuilder(b =>
            {
                b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["NotificationChannels:Enabled"] = "true" }));
                b.ConfigureServices(s => s.AddSingleton<INotificationChannelProvider>(provider));
            });
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var worker = scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>(); await worker.EnqueueDueAsync(default);
            var notice = await db.Set<UserNotification>().Where(n => n.RelatedObjectId == row.Id && n.AudienceRole == "Tenant" &&
                n.Title == "Hoàn tiền chuyển dư đã được xác minh thực hiện").Select(n => n.Id).SingleAsync();
            var delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'={notice.ToString()} AND event_data->>'channel'='EMAIL'").SingleAsync();
            var history = await db.Database.SqlQuery<string>($"SELECT history::text AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync();
            var invalid = System.Text.Json.JsonDocument.Parse(history).RootElement.EnumerateArray().Last().GetRawText().Replace("sha256", "missingHash", StringComparison.Ordinal);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({invalid}::jsonb) WHERE id={row.Id}");
            await worker.DeliverAsync(delivery, default);
            Assert.Empty(provider.Messages);
            Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
            Assert.True(await db.Set<UserNotification>().AnyAsync(n => n.Id == notice));
            Assert.Equal("COMPLETED", await db.Database.SqlQuery<string>($"SELECT status AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync());
        }
        finally { await fixture.DisposeAsync(); }
    }

    private static async Task PumpRefundNotices(Compact24WorkflowFixture fixture)
    {
        for (var i = 0; i < 3; i++)
        {
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);
        }
    }
    private static async Task<HttpClient> LoginUser(Compact24WorkflowFixture fixture, Guid id)
    {
        await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope();
        var email = await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().Users.Where(u => u.Id == id).Select(u => u.Email).SingleAsync();
        var client = fixture.Capture.Factory.CreateClient();
        var login = await Value<LoginResult>(await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken); return client;
    }
    private static async Task<NotificationView[]> RefundNotices(HttpClient client, Guid refundId) =>
        (await Value<PagedResult<NotificationView>>(await client.GetAsync("/api/v1/notifications?category=Payment&pageSize=100")))
        .Items.Where(n => n.RelatedObjectType == "Refund" && n.RelatedObjectId == refundId).ToArray();

    [CompactPostgresFact]
    public async Task ReceiptRefundNotificationsFollowActualBeneficiaryAndReauthorizeTargetsWithoutCurrentRoom()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, receipt) = await Setup(fixture); using var ownerClient = owner;
            var sourceRoute = $"/api/v1/payment-transactions/{receipt}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(sourceRoute));
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var person = await db.Set<Resident>().SingleAsync(r => r.Id == source.Beneficiaries[0].Id);
            using var tenant = await LoginUser(fixture, person.TenantUserId!.Value);
            var otherId = await db.Users.Where(u => u.Id != person.TenantUserId && EF.Property<string[]>(u, "roles").Contains("Tenant")).Select(u => u.Id).FirstAsync();
            using var other = await LoginUser(fixture, otherId);
            using var staff = await LoginUser(fixture, await db.Users.Where(u => EF.Property<string[]>(u, "roles").Contains("Staff")).Select(u => u.Id).SingleAsync());
            var rejected = await Value<RefundView>(await Post(owner, sourceRoute, new RefundInput(person.Id, 20000, "PRIVATE_REFUND_REQUEST", true), Guid.NewGuid()));
            rejected = await Value<RefundView>(await Post(owner, $"{Root}/{rejected.Id}/decision", new RefundDecision(rejected.Version, false, "PRIVATE_REFUND_REJECTION", true), Guid.NewGuid()));
            await Task.WhenAll(PumpRefundNotices(fixture), PumpRefundNotices(fixture));
            Assert.Equal(2, (await RefundNotices(tenant, rejected.Id)).Length);
            var row = await Value<RefundView>(await Post(owner, sourceRoute, new RefundInput(person.Id, 20000, "PRIVATE_REFUND_REQUEST", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", new RefundDecision(row.Version, true, "PRIVATE_REFUND_APPROVAL", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Execute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, "PRIVATE_REFUND_BANK_PROOF", Photo()));
            person.RoomId = null; await db.SaveChangesAsync();
            await Task.WhenAll(PumpRefundNotices(fixture), PumpRefundNotices(fixture));
            var mine = await RefundNotices(tenant, row.Id); Assert.Equal(3, mine.Length);
            Assert.Equal(3, (await RefundNotices(owner, row.Id)).Length);
            Assert.Empty(await RefundNotices(other, row.Id)); Assert.Empty(await RefundNotices(staff, row.Id));
            var completed = Assert.Single(mine, n => n.Title == "Hoàn tiền chuyển dư đã được xác minh thực hiện");
            Assert.Equal("Unconfigured", completed.DeliveryState);
            Assert.Equal("EXCESS_PAYMENT_OR_REFUND_STATUS", completed.EventType);
            var target = await Value<NotificationTarget>(await tenant.GetAsync($"/api/v1/notifications/{completed.Id}/target"));
            Assert.Equal("Refund", target.ObjectType); Assert.Equal(row.Id, target.ObjectId);
            var ownerNotice = (await RefundNotices(owner, row.Id))[0];
            var ownerTarget = await Value<NotificationTarget>(await owner.GetAsync($"/api/v1/notifications/{ownerNotice.Id}/target"));
            Assert.Equal("BankTransfer", ownerTarget.ObjectType); Assert.Equal(receipt, ownerTarget.ObjectId);
            Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/v1/notifications/{completed.Id}/target")).StatusCode);
            var forged = new UserNotification
            {
                RecipientUserId = otherId,
                AudienceRole = "Tenant",
                Category = "Payment",
                RelatedObjectType = "Refund",
                RelatedObjectId = row.Id,
                Title = "Synthetic stale entitlement",
                Summary = "Synthetic",
                EventKey = "synthetic-refund-stale-recipient",
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Add(forged); await db.SaveChangesAsync();
            Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/v1/notifications/{forged.Id}/target")).StatusCode);
            foreach (var client in new[] { owner, tenant }) Assert.DoesNotContain("PRIVATE_REFUND_", await client.GetStringAsync("/api/v1/notifications?category=Payment&pageSize=100"));
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task ReceiptRefundCompletionNoticeWaitsForConsistentExecutionProofAndRecoversWithoutDuplicates()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, receipt) = await Setup(fixture); using var client = owner;
            var sourceRoute = $"/api/v1/payment-transactions/{receipt}/refunds";
            var source = await Value<RefundSource>(await owner.GetAsync(sourceRoute));
            var row = await Value<RefundView>(await Post(owner, sourceRoute, new RefundInput(source.Beneficiaries[0].Id, 20000, "Synthetic return", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", new RefundDecision(row.Version, true, "Synthetic approval", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Execute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-REFUND-NOTICE", Photo()));
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var original = await db.Database.SqlQuery<string>($"SELECT history::text AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync();
            var record = System.Text.Json.JsonDocument.Parse(original).RootElement.EnumerateArray().Last().GetRawText();
            var invalid = record.Replace("sha256", "missingHash", StringComparison.Ordinal);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({invalid}::jsonb) WHERE id={row.Id}");
            await PumpRefundNotices(fixture);
            Assert.Equal(2, (await RefundNotices(owner, row.Id)).Length);
            Assert.DoesNotContain(await RefundNotices(owner, row.Id), n => n.Title == "Hoàn tiền chuyển dư đã được xác minh thực hiện");
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({record}::jsonb) WHERE id={row.Id}");
            await Task.WhenAll(PumpRefundNotices(fixture), PumpRefundNotices(fixture));
            Assert.Equal(3, (await RefundNotices(owner, row.Id)).Length);
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task ExternalReceiptRefundNotifiesOnlyOwnerWithoutCreatingResidentOrAccount()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            var (owner, receipt) = await Setup(fixture, verifiedPayer: false); using var client = owner;
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var users = await db.Users.CountAsync(); var residents = await db.Set<Resident>().CountAsync();
            var context = await Value<ExternalPaymentPayerContext>(await owner.GetAsync($"/api/v1/payment-transactions/{receipt}/external-payer"));
            var payer = await Value<ExternalPaymentPayer>(await Post(owner, $"/api/v1/payment-transactions/{receipt}/external-payer",
                new ExternalPaymentPayerInput(context.TransferFingerprint, "PRIVATE_EXTERNAL_PAYER", "Synthetic verification", true, true), Guid.NewGuid()));
            var row = await Value<RefundView>(await Post(owner, $"/api/v1/payment-transactions/{receipt}/refunds", new RefundInput(null, 20000, "Synthetic external return", true, payer.Id), Guid.NewGuid()));
            row = await Value<RefundView>(await Post(owner, $"{Root}/{row.Id}/decision", new RefundDecision(row.Version, true, "Synthetic approval", true), Guid.NewGuid()));
            row = await Value<RefundView>(await Execute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, "SYN-EXTERNAL-NOTICE", Photo()));
            await Task.WhenAll(PumpRefundNotices(fixture), PumpRefundNotices(fixture));
            Assert.Equal(3, (await RefundNotices(owner, row.Id)).Length);
            Assert.Equal(3, await db.Set<UserNotification>().CountAsync(n => n.RelatedObjectType == "Refund" && n.RelatedObjectId == row.Id && n.AudienceRole == "Owner"));
            Assert.False(await db.Set<UserNotification>().AnyAsync(n => n.RelatedObjectId == row.Id && n.AudienceRole != "Owner"));
            Assert.DoesNotContain("PRIVATE_EXTERNAL_PAYER", await owner.GetStringAsync("/api/v1/notifications?category=Payment&pageSize=100"));
            Assert.Equal(users, await db.Users.CountAsync()); Assert.Equal(residents, await db.Set<Resident>().CountAsync());
        }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task PreAccountDepositReceiptRefundNotifiesOwnerOnlyFromCanonicalPayerSnapshot()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            await new PaymentLedgerTests(fixture.Capture).DepositReceiptPreservesPartialFundsAndReturnsExcessToActualPayer(holding: false, external: false);
            await PumpRefundNotices(fixture);
            await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var notifications = await db.Set<UserNotification>().Where(n => n.RelatedObjectType == "Refund").ToArrayAsync();
            Assert.Equal(3, notifications.Length); Assert.All(notifications, n => Assert.Equal("Owner", n.AudienceRole));
        }
        finally { await fixture.DisposeAsync(); }
    }
}
