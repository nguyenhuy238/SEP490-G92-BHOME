using System.Net;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task SmsDeliveryCallbackRequiresTrustedSourceMatchingReceiptAndAnIdempotentTerminalReport()
    {
        using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["Sms:Enabled"] = "true", ["Sms:Mode"] = "Production", ["Sms:ProductionEnabled"] = "true", ["Sms:ApiKey"] = "synthetic-api", ["Sms:SecretKey"] = "synthetic-secret" })));
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = Guid.NewGuid(); var request = SmsGateway.RequestId("synthetic-callback:" + id);
        var data = System.Text.Json.JsonSerializer.Serialize(new { recordType = "ChannelDelivery", channel = "SMS" });
        var history = System.Text.Json.JsonSerializer.Serialize(new object[]
        {
            new { recordType = "SmsSubmission", requestId = request },
            new { recordType = "ChannelAttempt", providerReference = "synthetic-provider-id", state = "ProviderAccepted" }
        });
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,delivery_history)
            VALUES({id},'OUTBOX',{id.ToString()},'CHANNEL_DELIVERY',{data}::jsonb,
                {DateTimeOffset.UtcNow},'ProviderAccepted',{history}::jsonb)
            """);
        var callback = scope.ServiceProvider.GetRequiredService<EsmsDeliveryCallback>();
        var report = new EsmsDeliveryReport("synthetic-provider-id", request, 5, 1, 0, 1, 2);
        Assert.False(EsmsDeliveryCallback.TrustedSource(IPAddress.Parse("2001:db8::671d:1a27")));
        Assert.True(EsmsDeliveryCallback.TrustedSource(IPAddress.Parse("::ffff:103.29.26.39")));
        Assert.False(await callback.ApplyAsync(report, IPAddress.Loopback, default));
        Assert.False(await callback.ApplyAsync(report, IPAddress.Parse("2001:db8::671d:1a27"), default));
        Assert.False(await callback.ApplyAsync(report with { SMSID = "wrong-provider-id" }, IPAddress.Parse("103.29.26.39"), default));
        Assert.False(await callback.ApplyAsync(report with { SendSuccess = 0 }, IPAddress.Parse("103.29.26.39"), default));
        Assert.True(await callback.ApplyAsync(report, IPAddress.Parse("103.29.26.39"), default));
        Assert.True(await callback.ApplyAsync(report, IPAddress.Parse("103.29.26.39"), default));
        Assert.Equal("Delivered", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={id}").SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications n CROSS JOIN LATERAL jsonb_array_elements(n.delivery_history) h WHERE n.id={id} AND h->>'recordType'='SmsDeliveryReport'").SingleAsync());
    }
}
