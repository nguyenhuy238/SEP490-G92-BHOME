using System.Net;
using System.Net.Http.Json;
using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Domain.Notifications;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    private sealed class DepositNoticeChannelProbe : INotificationChannelProvider
    {
        public List<ChannelMessage> Messages { get; } = [];
        public bool IsConfigured(string channel) => true;
        public bool SupportsIdempotency(string channel) => true;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken token)
        { Messages.Add(message); return Task.FromResult("synthetic-accepted"); }
    }

    internal async Task DepositRefundNotifiesAgreedRecipientInsteadOfContractTenant()
    {
        var w = await Setup(sharedContract: true); await ReadySettlementFixture(w, false, agreedDeposit: 400000);
        using var owner = await Client(w.Owner); using var representative = await Client(w.Tenants[0]);
        using var beneficiary = await Client(w.Tenants[1]); using var other = await Client(w.Tenants[2]); using var staff = await Client(w.Staff);
        var contract = $"/api/v1/contracts/{w.Contract}"; var sourceRoute = contract + "/deposit-refunds";
        await RefundValue<ContractId>(await Post(owner, contract + "/deposit-verifications",
            new DepositInput("SYN-AGREED-" + Guid.NewGuid(), 400000, "Synthetic verified principal")));
        var source = await RefundValue<RefundSource>(await owner.GetAsync(sourceRoute)); Assert.Equal(3, source.Beneficiaries.Count);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var person = await db.Set<Resident>().SingleAsync(r => r.TenantUserId == w.Tenants[1]);
        var input = new DepositRefundInput(new(person.Id, 400000, "PRIVATE_AGREEMENT_REASON", true), source.FinancialReference!, true, true);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, sourceRoute, input with { BeneficiaryVerified = false })).StatusCode);
        var key = Guid.NewGuid();
        var row = await RefundValue<RefundView>(await Post(owner, sourceRoute, input, key));
        Assert.Equal(row.Id, (await RefundValue<RefundView>(await Post(owner, sourceRoute, input, key))).Id);
        Assert.Equal(person.Id, row.BeneficiaryResidentId);
        row = await RefundValue<RefundView>(await Post(owner, $"/api/v1/refund-requests/{row.Id}/decision",
            new RefundDecision(row.Version, true, "PRIVATE_AGREEMENT_APPROVAL", true)));
        using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
        row = await RefundValue<RefundView>(await DepositExecute(owner, row, Guid.NewGuid(), DateTimeOffset.UtcNow, image.ImEncode(".png")));
        var history = await db.Database.SqlQuery<string>($"SELECT history::text AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync();
        var record = System.Text.Json.JsonDocument.Parse(history).RootElement.EnumerateArray().Last().GetRawText();
        var invalid = record.Replace("sha256", "missingHash", StringComparison.Ordinal);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({invalid}::jsonb) WHERE id={row.Id}");
        await Task.WhenAll(PumpNotifications(), PumpNotifications());
        async Task<NotificationView[]> Mine(HttpClient client) => (await RefundValue<PagedResult<NotificationView>>(
            await client.GetAsync("/api/v1/notifications?category=Payment&pageSize=100"))).Items.Where(n => n.RelatedObjectId == row.Id).ToArray();
        Assert.Equal(2, (await Mine(beneficiary)).Length);
        Assert.DoesNotContain(await Mine(beneficiary), n => n.Title == "Giao dịch hoàn cọc đã được xác minh thủ công");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({record}::jsonb) WHERE id={row.Id}");
        person.RoomId = null; await db.SaveChangesAsync();
        await Task.WhenAll(PumpNotifications(), PumpNotifications());
        var mine = await Mine(beneficiary); Assert.Equal(3, mine.Length);
        foreach (var client in new[] { representative, other, staff }) Assert.Empty(await Mine(client));
        Assert.Single((await RefundValue<PagedResult<TenantRefundView>>(await beneficiary.GetAsync("/api/v1/tenant/refunds"))).Items, r => r.Id == row.Id);
        Assert.DoesNotContain((await RefundValue<PagedResult<TenantRefundView>>(await representative.GetAsync("/api/v1/tenant/refunds"))).Items, r => r.Id == row.Id);
        var completed = Assert.Single(mine, n => n.Title == "Giao dịch hoàn cọc đã được xác minh thủ công");
        var target = await RefundValue<NotificationTarget>(await beneficiary.GetAsync($"/api/v1/notifications/{completed.Id}/target"));
        Assert.Equal("Refund", target.ObjectType); Assert.Equal(row.Id, target.ObjectId);
        Assert.Equal(HttpStatusCode.NotFound, (await representative.GetAsync($"/api/v1/notifications/{completed.Id}/target")).StatusCode);
        var forged = new UserNotification
        {
            RecipientUserId = w.Tenants[0],
            AudienceRole = "Tenant",
            Category = "Payment",
            RelatedObjectType = "Refund",
            RelatedObjectId = row.Id,
            Title = "Synthetic",
            Summary = "Synthetic",
            EventKey = "synthetic-agreed-recipient",
            CreatedAt = DateTimeOffset.UtcNow
        };
        db.Add(forged); await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await representative.GetAsync($"/api/v1/notifications/{forged.Id}/target")).StatusCode);
        Assert.DoesNotContain("PRIVATE_AGREEMENT_", await beneficiary.GetStringAsync("/api/v1/notifications?category=Payment&pageSize=100"));
        var completedKey = "deposit-refund:" + row.Id + ":" + row.Version + ":Completed";
        var published = await db.Set<UserNotification>().Where(n => n.EventKey == completedKey).ToArrayAsync();
        Assert.Equal(2, published.Length);
        Assert.Contains(published, n => n.RecipientUserId == w.Owner && n.RelatedObjectType == "Contract" && n.RelatedObjectId == w.Contract);
        Assert.DoesNotContain(published, n => n.RecipientUserId == w.Tenants[0] || n.AudienceRole == "Staff");
        // A proof that becomes invalid after publication must suppress queued channels for both
        // the Owner contract target and the beneficiary refund target, without changing finance.
        var provider = new DepositNoticeChannelProbe();
        using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["NotificationChannels:Enabled"] = "true" }));
            b.ConfigureServices(s => s.AddSingleton<INotificationChannelProvider>(provider));
        });
        await using var deliveryScope = host.Services.CreateAsyncScope(); var deliveryDb = deliveryScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var worker = deliveryScope.ServiceProvider.GetRequiredService<NotificationChannelWorker>(); await worker.EnqueueDueAsync(default);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE refund_requests SET history=history||jsonb_build_array({invalid}::jsonb) WHERE id={row.Id}");
        foreach (var notice in published)
        {
            var delivery = await deliveryDb.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'={notice.Id.ToString()} AND event_data->>'channel'='EMAIL'").SingleAsync();
            await worker.DeliverAsync(delivery, default);
            Assert.Equal("Suppressed", await deliveryDb.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        }
        Assert.Empty(provider.Messages);
        Assert.Equal("COMPLETED", await db.Database.SqlQuery<string>($"SELECT status AS \"Value\" FROM refund_requests WHERE id={row.Id}").SingleAsync());
    }
}
