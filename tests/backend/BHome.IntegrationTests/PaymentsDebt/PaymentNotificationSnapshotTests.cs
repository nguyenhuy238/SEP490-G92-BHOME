using System.Net.Http.Json;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task DebtRemindersDeduplicateAndStopAfterVerifiedPayment()
    {
        var w=await Setup();using var owner=await Client(w.Owner);
        (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy",new NotificationReminderPolicy(DebtEnabled:true,DebtWindowDays:1))).EnsureSuccessStatusCode();
        await PumpNotifications();await PumpNotifications();
        using var tenant=await Client(w.Tenants[0]);var before=(await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Invoice"))!;
        Assert.Single(before.Items,n=>n.RelatedObjectId==w.Invoice&&n.EventType=="INVOICE_OVERDUE");
        var registered=await Post(owner,"/api/v1/payment-transactions",Input(w,100000));registered.EnsureSuccessStatusCode();var transfer=(await registered.Content.ReadFromJsonAsync<TransferView>())!;
        (await Post(owner,$"/api/v1/payment-transactions/{transfer.Id}/allocate",new PaymentMatchInput(w.Invoice,null,true))).EnsureSuccessStatusCode();await PumpNotifications();
        var after=(await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Invoice"))!;
        Assert.Single(after.Items,n=>n.RelatedObjectId==w.Invoice&&n.EventType=="INVOICE_OVERDUE");
    }
    [Fact]
    public async Task DelayedNotificationWorkerPreservesPartialSnapshotAndOnePaidTransitionForAllThreeTenants()
    {
        var w=await Setup();using var owner=await Client(w.Owner);
        foreach(var amount in new[]{20000m,80000m})
        {
            var registered=await Post(owner,"/api/v1/payment-transactions",Input(w,amount));registered.EnsureSuccessStatusCode();var transfer=(await registered.Content.ReadFromJsonAsync<TransferView>())!;
            var command=Guid.NewGuid();var match=new PaymentMatchInput(w.Invoice,null,true);
            (await Post(owner,$"/api/v1/payment-transactions/{transfer.Id}/allocate",match,command)).EnsureSuccessStatusCode();
            (await Post(owner,$"/api/v1/payment-transactions/{transfer.Id}/allocate",match,command)).EnsureSuccessStatusCode();
        }
        await Task.WhenAll(PumpNotifications(),PumpNotifications());await PumpNotifications();
        foreach(var id in w.Tenants)
        {
            using var tenant=await Client(id);var page=(await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Payment"))!;
            var partial=Assert.Single(page.Items,n=>n.RelatedObjectId==w.Invoice&&n.EventType=="PAYMENT_PARTIALLY_CONFIRMED");
            Assert.Contains(20000m.ToString("N0"),partial.Summary);Assert.Contains(80000m.ToString("N0"),partial.Summary);
            var paid=Assert.Single(page.Items,n=>n.RelatedObjectId==w.Invoice&&n.EventType=="INVOICE_FULLY_PAID");Assert.Contains(100000m.ToString("N0"),paid.Summary);
            var status=(await tenant.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{w.Invoice}/payment"))!;Assert.Equal(0,status.OutstandingAmount);
            Assert.All(status.History,h=>Assert.Null(h.PaidByUserId));
        }
    }
}
