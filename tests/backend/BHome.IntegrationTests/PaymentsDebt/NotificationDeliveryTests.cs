using System.Net;
using System.Net.Http.Json;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private sealed class DeliveryClock:TimeProvider
    {private DateTimeOffset now=DateTimeOffset.UtcNow;public override DateTimeOffset GetUtcNow()=>now;public void Advance(int seconds)=>now=now.AddSeconds(seconds);}
    private sealed class TestNotificationProvider(int failures,bool idempotency=true):INotificationProvider
    {
        public bool IsConfigured=>true;public bool SupportsIdempotency=>idempotency;
        public readonly System.Collections.Concurrent.ConcurrentBag<string> Keys=[];private int calls;
        public int Calls=>calls;
        public Task<string> DeliverAsync(NotificationDelivery delivery,CancellationToken t){Keys.Add(delivery.IdempotencyKey);var call=Interlocked.Increment(ref calls);if(call<=failures)throw new TimeoutException("PRIVATE_PROVIDER_TOKEN");return Task.FromResult("TEST_ONLY_RECEIPT");}
    }
    private static NotificationDeliveryOptions DeliveryOptions()=>new(){Enabled=true,MaxAttempts=2,InitialRetrySeconds=1,MaximumRetrySeconds=10,RequestTimeoutSeconds=1,LeaseSeconds=5};
    private async Task<bool> AttemptDelivery(Guid id,INotificationProvider provider,DeliveryClock clock)
    {
        await using var s=fixture.Factory.Services.CreateAsyncScope();return await new NotificationDeliveryService(s.ServiceProvider.GetRequiredService<INotificationDeliveryStore>(),provider,s.ServiceProvider.GetRequiredService<IBackgroundJobQueue>(),DeliveryOptions(),clock).DeliverAsync(id,default);
    }
    private async Task<Guid> DeliveryNotice(Workspace w)
    {
        await using var s=fixture.Factory.Services.CreateAsyncScope();var db=s.ServiceProvider.GetRequiredService<BHomeDbContext>();var n=Notice(w.Tenants[0],"Tenant","delivery:"+Guid.NewGuid(),w.Invoice,w.Location);db.Add(n);await db.SaveChangesAsync();return n.Id;
    }
    [Fact]
    public async Task DeliveryRetriesUseOneStableKeyAndPreservePaidLedgerAndInAppReadState()
    {
        var w=await Setup();using var owner=await Client(w.Owner);var transferResponse=await Post(owner,"/api/v1/payment-transactions",Input(w));transferResponse.EnsureSuccessStatusCode();var transfer=(await transferResponse.Content.ReadFromJsonAsync<TransferView>())!;(await Post(owner,$"/api/v1/payment-transactions/{transfer.Id}/allocate",new PaymentMatchInput(w.Invoice,w.Tenants[0],true))).EnsureSuccessStatusCode();
        var id=await DeliveryNotice(w);var provider=new TestNotificationProvider(1);var clock=new DeliveryClock();
        await Task.WhenAll(AttemptDelivery(id,provider,clock),AttemptDelivery(id,provider,clock));Assert.Equal(1,provider.Calls);Assert.False(await AttemptDelivery(id,provider,clock));
        using var tenant=await Client(w.Tenants[0]);(await tenant.PostAsync($"/api/v1/notifications/{id}/read",null)).EnsureSuccessStatusCode();clock.Advance(2);await Task.WhenAll(AttemptDelivery(id,provider,clock),AttemptDelivery(id,provider,clock));Assert.Equal(2,provider.Calls);Assert.Single(provider.Keys.Distinct());Assert.False(await AttemptDelivery(id,provider,clock));
        await using var s=fixture.Factory.Services.CreateAsyncScope();var db=s.ServiceProvider.GetRequiredService<BHomeDbContext>();var notification=await db.Set<UserNotification>().SingleAsync(n=>n.Id==id);Assert.Equal("Delivered",notification.DeliveryState);Assert.Equal(2,notification.DeliveryAttempts);Assert.NotNull(notification.ReadAt);Assert.Equal(2,await db.Set<NotificationDeliveryAttempt>().CountAsync(a=>a.NotificationId==id));
        Assert.Equal(100000,(await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{w.Invoice}/payment"))!.PaidAmount);Assert.DoesNotContain("PRIVATE_PROVIDER_TOKEN",await owner.GetStringAsync("/api/v1/notifications/delivery-status"));
    }
    [Fact]
    public async Task DeliveryFailureStopsAtConfiguredLimitAndUnsupportedAmbiguityRequiresReview()
    {
        var w=await Setup();var id=await DeliveryNotice(w);var provider=new TestNotificationProvider(100);var clock=new DeliveryClock();await AttemptDelivery(id,provider,clock);clock.Advance(2);await AttemptDelivery(id,provider,clock);clock.Advance(20);Assert.False(await AttemptDelivery(id,provider,clock));Assert.Equal(2,provider.Calls);
        var ambiguous=await DeliveryNotice(w);var unsupported=new TestNotificationProvider(100,false);await AttemptDelivery(ambiguous,unsupported,clock);clock.Advance(20);Assert.False(await AttemptDelivery(ambiguous,unsupported,clock));Assert.Equal(1,unsupported.Calls);
        await using var s=fixture.Factory.Services.CreateAsyncScope();var db=s.ServiceProvider.GetRequiredService<BHomeDbContext>();Assert.Equal("Failed",(await db.Set<UserNotification>().SingleAsync(n=>n.Id==id)).DeliveryState);Assert.Equal("PendingReview",(await db.Set<UserNotification>().SingleAsync(n=>n.Id==ambiguous)).DeliveryState);
    }
    [Fact]
    public async Task ExpiredDeliveryLeaseDoesNotResendWithoutProviderIdempotencyAndUnconfiguredNeverReportsSuccess()
    {
        var w=await Setup();var id=await DeliveryNotice(w);var clock=new DeliveryClock();
        await using(var s=fixture.Factory.Services.CreateAsyncScope()){var claim=await s.ServiceProvider.GetRequiredService<INotificationDeliveryStore>().ClaimAsync(id,clock.GetUtcNow(),DeliveryOptions(),false,default);Assert.NotNull(claim);}
        clock.Advance(6);var provider=new TestNotificationProvider(0,false);Assert.False(await AttemptDelivery(id,provider,clock));Assert.Equal(0,provider.Calls);
        var unconfigured=await DeliveryNotice(w);await using(var s=fixture.Factory.Services.CreateAsyncScope()){Assert.False(await s.ServiceProvider.GetRequiredService<NotificationDeliveryService>().DeliverAsync(unconfigured,default));var db=s.ServiceProvider.GetRequiredService<BHomeDbContext>();Assert.Equal("PendingReview",(await db.Set<UserNotification>().SingleAsync(n=>n.Id==id)).DeliveryState);var untouched=await db.Set<UserNotification>().SingleAsync(n=>n.Id==unconfigured);Assert.Equal("Unconfigured",untouched.DeliveryState);Assert.Equal(0,untouched.DeliveryAttempts);}
        using var tenant=await Client(w.Tenants[0]);Assert.Equal(HttpStatusCode.Forbidden,(await tenant.GetAsync("/api/v1/notifications/delivery-status")).StatusCode);using var owner=await Client(w.Owner);var status=(await owner.GetFromJsonAsync<DeliveryOverview>("/api/v1/notifications/delivery-status"))!;Assert.False(status.Configured);
    }
}
