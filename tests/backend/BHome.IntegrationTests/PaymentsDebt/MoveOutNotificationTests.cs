using System.Net;
using System.Net.Http.Json;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    private async Task VerifySettlementNotifications(Workspace w, bool deductions, bool returned)
    {
        await Task.WhenAll(PumpNotifications(), PumpNotifications());
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]);
        foreach (var client in new[] { owner, tenant })
        {
            var notices = (await client.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Contract&pageSize=100"))!.Items;
            var closed = Assert.Single(notices, n => n.RelatedObjectId == w.Contract && n.Title == "Hợp đồng đã hoàn tất trả phòng");
            Assert.Equal("Unconfigured", closed.DeliveryState);
            var target = await client.GetFromJsonAsync<NotificationTarget>($"/api/v1/notifications/{closed.Id}/target");
            Assert.Equal(w.Contract, target!.ObjectId); Assert.Equal("Contract", target.ObjectType);
            Assert.Equal(deductions ? 1 : 0, notices.Count(n => n.RelatedObjectId == w.Contract && n.Title == "Owner đã ghi nhận quyết định khấu trừ cọc"));
            Assert.Equal(returned ? 1 : 0, notices.Count(n => n.RelatedObjectId == w.Contract && n.Title == "Giao dịch hoàn cọc đã được xác minh thủ công"));
            Assert.DoesNotContain(notices, n => n.Title.Contains("400000", StringComparison.Ordinal) || n.Summary.Contains("SYN", StringComparison.Ordinal) || n.Summary.Contains("sha256", StringComparison.Ordinal));
            var before = notices.Count;
            await PumpNotifications();
            Assert.Equal(before, (await client.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Contract&pageSize=100"))!.Items.Count);
        }
        using var staff = await Client(w.Staff); using var otherTenant = await Client(w.Tenants[1]);
        foreach (var client in new[] { staff, otherTenant })
            Assert.DoesNotContain((await client.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Contract&pageSize=100"))!.Items, n => n.RelatedObjectId == w.Contract);
        var own = (await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Contract&pageSize=100"))!.Items.First(n => n.RelatedObjectId == w.Contract);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.GetAsync($"/api/v1/notifications/{own.Id}/target")).StatusCode);
    }
}
