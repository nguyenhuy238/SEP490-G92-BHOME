using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.Notifications;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private async Task PumpNotifications()
    {for(var i=0;i<5;i++){await using var s=fixture.Factory.Services.CreateAsyncScope();await s.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default);}}
    [Fact]
    public async Task InvoicePaymentAndAdjustmentEventsReachEntitledRecipientsWithoutPrivateDataOrReplayDuplicates()
    {
        var(w,_,draft)=await FinalWorkspace();await RunPhase(w,"Final");await PumpNotifications();using var owner=await Client(w.Owner);var final=(await owner.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"))!;
        foreach(var id in w.Tenants){using var c=await Client(id);var notices=(await c.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Invoice"))!;Assert.Single(notices.Items,n=>n.RelatedObjectId==draft.Id);}
        var input=Input(w with{Invoice=draft.Id},100050,"PRIVATE_BANK_REFERENCE");var command=Guid.NewGuid();var registration=await Post(owner,"/api/v1/payment-transactions",input,command);registration.EnsureSuccessStatusCode();var transfer=(await registration.Content.ReadFromJsonAsync<TransferView>())!;
        var allocationKey=Guid.NewGuid();(await Post(owner,$"/api/v1/payment-transactions/{transfer.Id}/allocate",new PaymentMatchInput(draft.Id,w.Tenants[0],true),allocationKey)).EnsureSuccessStatusCode();
        (await Post(owner,$"/api/v1/payment-transactions/{transfer.Id}/allocate",new PaymentMatchInput(draft.Id,w.Tenants[0],true),allocationKey)).EnsureSuccessStatusCode();await Task.WhenAll(PumpNotifications(),PumpNotifications());
        foreach(var id in w.Tenants){using var c=await Client(id);var notices=(await c.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Payment"))!;Assert.Single(notices.Items,n=>n.RelatedObjectId==draft.Id);Assert.All(notices.Items,n=>Assert.Equal("Unconfigured",n.DeliveryState));Assert.DoesNotContain("PRIVATE_BANK_REFERENCE",await c.GetStringAsync("/api/v1/notifications"));}
        using var tenant=await Client(w.Tenants[0]);var response=await Post(tenant,$"/api/v1/invoices/{draft.Id}/adjustment-requests",new AdjustmentSubmit(null,90000,"PRIVATE_TENANT_REASON",[],final.Version));response.EnsureSuccessStatusCode();var request=(await response.Content.ReadFromJsonAsync<AdjustmentView>())!;await PumpNotifications();
        Assert.Contains((await owner.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Adjustment"))!.Items,n=>n.RelatedObjectId==request.Id);
        var reject=new AdjustmentDecisionInput(1,final.Version,0,null,null,"PRIVATE_OWNER_REASON",true);var rejectKey=Guid.NewGuid();(await Post(owner,$"/api/v1/invoice-adjustments/{request.Id}/reject",reject,rejectKey)).EnsureSuccessStatusCode();(await Post(owner,$"/api/v1/invoice-adjustments/{request.Id}/reject",reject,rejectKey)).EnsureSuccessStatusCode();await PumpNotifications();
        var own=(await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Adjustment"))!;Assert.Single(own.Items,n=>n.RelatedObjectId==request.Id);Assert.DoesNotContain("PRIVATE_",await tenant.GetStringAsync("/api/v1/notifications"));Assert.DoesNotContain("PRIVATE_",await owner.GetStringAsync("/api/v1/notifications"));
        using var other=await Client(w.Tenants[1]);Assert.DoesNotContain((await other.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Adjustment"))!.Items,n=>n.RelatedObjectId==request.Id);
        var approvedRequest=await Post(tenant,$"/api/v1/invoices/{draft.Id}/adjustment-requests",new AdjustmentSubmit(null,100000,"PRIVATE_APPROVED_REQUEST",[],final.Version));approvedRequest.EnsureSuccessStatusCode();var approved=(await approvedRequest.Content.ReadFromJsonAsync<AdjustmentView>())!;
        (await Post(owner,$"/api/v1/invoice-adjustments/{approved.Id}/approve",new AdjustmentDecisionInput(1,final.Version,0,100000,null,"PRIVATE_APPROVED_REASON",true))).EnsureSuccessStatusCode();await PumpNotifications();
        Assert.Contains((await other.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Adjustment"))!.Items,n=>n.RelatedObjectType=="Invoice"&&n.RelatedObjectId==draft.Id);Assert.DoesNotContain("PRIVATE_",await other.GetStringAsync("/api/v1/notifications"));Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync($"/api/v1/invoice-adjustments/{approved.Id}")).StatusCode);
        Assert.Equal(100050,(await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{draft.Id}/payment"))!.PaidAmount);
        using var staff=await Client(w.Staff);Assert.Equal(HttpStatusCode.Forbidden,(await staff.PostAsync("/api/v1/notifications/process-events",null)).StatusCode);
    }
    [Fact]
    public async Task ExistingContractExpiryAndMeterTaskSourcesPublishThroughOneInbox()
    {
        var(w,_,_)=await MeterWorkspace();await RunMeter(w);
        await using(var s=fixture.Factory.Services.CreateAsyncScope())
        {
            var db=s.ServiceProvider.GetRequiredService<BHomeDbContext>();await db.Set<Contract>().Where(c=>c.Id==w.Contract).ExecuteUpdateAsync(set=>set.SetProperty(c=>c.EndDate,CurrentPeriod().AddDays(20)));
            var handler=s.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h=>h.Name=="contract-expiry");await handler.ExecuteAsync(new(Guid.NewGuid(),"synthetic-expiry-notice","{}"),default);
        }
        await PumpNotifications();using var staff=await Client(w.Staff);using var owner=await Client(w.Owner);using var tenant=await Client(w.Tenants[0]);
        Assert.Equal(2,(await staff.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Task"))!.TotalCount);
        Assert.Single((await owner.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Contract"))!.Items,n=>n.RelatedObjectId==w.Contract);
        Assert.Single((await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Contract"))!.Items,n=>n.RelatedObjectId==w.Contract);
        await PumpNotifications();Assert.Equal(2,(await staff.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Task"))!.TotalCount);
    }
    [Fact]
    public async Task UnallocatedTransferDoesNotCreatePaymentConfirmedNotification()
    {
        var w=await Setup();using var owner=await Client(w.Owner);(await Post(owner,"/api/v1/payment-transactions",Input(w,90000))).EnsureSuccessStatusCode();await PumpNotifications();
        Assert.Equal(0,(await owner.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Payment"))!.TotalCount);
        foreach(var id in w.Tenants){using var tenant=await Client(id);Assert.Equal(0,(await tenant.GetFromJsonAsync<PagedResult<NotificationView>>("/api/v1/notifications?category=Payment"))!.TotalCount);}
    }
}
