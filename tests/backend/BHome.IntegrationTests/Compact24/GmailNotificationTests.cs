using System.Net;
using System.Net.Http.Json;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.Notifications;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task GmailContractExpiryAndEmergencyReusePartiesAndRecheckStaffLocationBeforeSend()
    {
        var w = await Seed(); var other = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var contract = await db.Set<BHome.Domain.TenantContracts.Contract>().SingleAsync(c => c.Id == w.Contracts[0]);
        contract.EndDate = Today.AddDays(7); await db.SaveChangesAsync();
        using var tenant = await Client(w.Tenants[0], host);
        using var form = new MultipartFormDataContent
        {
            { new StringContent(w.Location.ToString()), "LocationId" }, { new StringContent(w.Room.ToString()), "RoomId" },
            { new StringContent("Emergency"), "Severity" }, { new StringContent("Synthetic urgent maintenance report"), "Description" }
        };
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/incidents") { Content = form };
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var response = await tenant.SendAsync(request); response.EnsureSuccessStatusCode();
        var result = (await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("incidentId").GetGuid();
        await Pump(host); await Pump(host);
        var expiry = await db.Set<UserNotification>().Where(n => n.LocationId == w.Location && n.EventType == "CONTRACT_EXPIRY_REMINDER").ToArrayAsync();
        Assert.Equal(3, expiry.Length); Assert.All(expiry, n => Assert.Contains("EMAIL", n.Channels));
        Assert.Contains(expiry, n => n.RecipientUserId == w.Owner.Id); Assert.Contains(expiry, n => n.RecipientUserId == w.Tenants[0].Id);
        var emergency = await db.Set<UserNotification>().Where(n => n.RelatedObjectId == result && n.EventType == "INCIDENT_EMERGENCY_SUBMITTED").ToArrayAsync();
        var emails = emergency.Where(n => n.Channels.Contains("EMAIL")).ToArray();
        Assert.Equal(2, emails.Length); Assert.All(emails, n => Assert.Contains(n.RecipientUserId, new[] { w.Owner.Id, w.Staff.Id }));
        Assert.DoesNotContain(emails, n => n.RecipientUserId == other.Staff.Id);
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().EnqueueDueAsync(default);
        var ownerExpiry = expiry.Single(n => n.RecipientUserId == w.Owner.Id);
        var expiryDelivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_key={"channel:" + ownerExpiry.Id + ":EMAIL"}").SingleAsync();
        await SendEmail(host, expiryDelivery); Assert.Contains(contract.EndDate.ToString("dd/MM/yyyy"), Assert.Single(probe.Messages).Body);
        var staffNotice = emails.Single(n => n.RecipientUserId == w.Staff.Id);
        var delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_key={"channel:" + staffNotice.Id + ":EMAIL"}").SingleAsync();
        var assignment = await db.StaffLocationAssignments.SingleAsync(a => a.LocationId == w.Location && a.StaffUserId == w.Staff.Id);
        assignment.ChangePeriod(Today.AddYears(-1), Today.AddDays(-1)); await db.SaveChangesAsync();
        await SendEmail(host, delivery);
        Assert.Single(probe.Messages);
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task GmailInvoiceAndVerifiedPaymentEventsReachEachEligibleRecipientOnceWithSafeRealDetails()
    {
        var w = await Seed(); var other = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        var period = new DateOnly(Today.Year, Today.Month, 1);
        var invoice = new Invoice
        {
            RoomId = w.Room,
            LocationId = w.Location,
            RoomNumber = "NOT-101",
            LocationName = "Synthetic notification location",
            BillingPeriod = period,
            RepresentativeContractId = w.Contracts[0],
            RepresentativeTenantUserId = w.Tenants[0].Id,
            CreatedByUserId = w.Owner.Id,
            Total = 100000,
            ScheduledFinalDate = period,
            DueDate = Today.AddDays(-1),
            ScheduleSnapshot = "{}",
            Lines = [new InvoiceLine { Category = BHome.Domain.PropertyManagement.ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent", Rate = 100000, Quantity = 1, Amount = 100000, OccupiedDays = 30, PeriodDays = 30, RateDate = period }],
            Recipients = w.Tenants.Select(u => new InvoiceRecipient { TenantUserId = u.Id }).ToList()
        };
        await using (var s = host.Services.CreateAsyncScope())
        {
            var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>(); db.Add(invoice); await db.SaveChangesAsync();
            invoice.Status = InvoiceStatus.Final; invoice.FinalizedAt = DateTimeOffset.UtcNow; invoice.FinalizedByUserId = w.Owner.Id;
            db.Add(new InvoiceIssuedEvent { InvoiceId = invoice.Id, OwnerUserId = w.Owner.Id, OccurredAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        }
        using var owner = await Client(w.Owner, host);
        (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy(DebtEnabled: true, DebtWindowDays: 1))).EnsureSuccessStatusCode();
        await Pump(host); await Pump(host);
        foreach (var amount in new[] { 20000m, 80000m })
        {
            async Task<HttpResponseMessage> Command(string url, object body)
            {
                var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
                request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); return await owner.SendAsync(request);
            }
            var response = await Command("/api/v1/payment-transactions", new PaymentTransferInput("SYNTHETIC-BANK", "SYNTHETIC-" + Guid.NewGuid(), amount,
                "VND", PaymentRules.Timestamp(DateTimeOffset.UtcNow.AddSeconds(-2)), PaymentRules.InvoiceReference(invoice.Id), "SYNTHETIC-STATEMENT", "Owner checked synthetic bank statement", invoice.Id, true));
            response.EnsureSuccessStatusCode(); var transfer = (await response.Content.ReadFromJsonAsync<TransferView>())!;
            (await Command($"/api/v1/payment-transactions/{transfer.Id}/allocate", new PaymentMatchInput(invoice.Id, null, true))).EnsureSuccessStatusCode();
        }
        await Pump(host); await Pump(host);
        await using var scope = host.Services.CreateAsyncScope(); var data = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var notices = await data.Set<UserNotification>().Where(n => n.RelatedObjectId == invoice.Id).ToArrayAsync();
        Assert.DoesNotContain(notices, n => other.Tenants.Any(u => u.Id == n.RecipientUserId));
        foreach (var eventType in new[] { "INVOICE_FINALIZED", "INVOICE_OVERDUE", "PAYMENT_PARTIALLY_CONFIRMED", "INVOICE_FULLY_PAID" })
        {
            var tenantNotices = notices.Where(n => n.AudienceRole == "Tenant" && n.EventType == eventType).ToArray();
            Assert.Equal(3, tenantNotices.Length); Assert.Equal(3, tenantNotices.Select(n => n.RecipientUserId).Distinct().Count());
            Assert.All(tenantNotices, n => Assert.Contains("EMAIL", n.Channels));
        }
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().EnqueueDueAsync(default);
        foreach (var notice in notices.Where(n => n.AudienceRole == "Tenant" && n.EventType != "INVOICE_OVERDUE"))
        {
            var delivery = await data.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_key={"channel:" + notice.Id + ":EMAIL"}").SingleAsync();
            await SendEmail(host, delivery);
        }
        Assert.Equal(9, probe.Messages.Count);
        Assert.All(probe.Messages, message =>
        {
            Assert.Contains("Phòng: NOT-101", message.Body); Assert.Contains("Cơ sở: Synthetic notification location", message.Body);
            Assert.Contains(period.ToString("MM/yyyy"), message.Body); Assert.Contains(invoice.DueDate.ToString("dd/MM/yyyy"), message.Body);
            Assert.DoesNotContain("Mã xác nhận", message.Body); Assert.DoesNotContain("SYNTHETIC-STATEMENT", message.Body);
        });
        // A queued debt reminder becomes irrelevant after verified full payment.
        var overdue = notices.First(n => n.AudienceRole == "Tenant" && n.EventType == "INVOICE_OVERDUE");
        var overdueDelivery = await data.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_key={"channel:" + overdue.Id + ":EMAIL"}").SingleAsync();
        await SendEmail(host, overdueDelivery);
        Assert.Equal("Suppressed", await data.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={overdueDelivery}").SingleAsync());
        Assert.Equal(9, probe.Messages.Count);
    }

    [CompactPostgresFact]
    public async Task GmailExpiredNonIdempotentLeaseRequiresReviewAndUpdatesInboxWithoutResending()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        var (notice, delivery) = await EmailNotice(w, host);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET delivery_status='Processing',lease_token={Guid.NewGuid()},locked_until={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
        await SendEmail(host, delivery); Assert.Empty(probe.Messages);
        Assert.Equal("PendingReview", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        Assert.Equal("PendingReview", (await db.Set<UserNotification>().SingleAsync(n => n.Id == notice)).DeliveryState);
    }

    private sealed class SmtpProbe : INotificationChannelProvider
    {
        public ChannelDeliveryException? Failure;
        public List<ChannelMessage> Messages { get; } = [];
        public bool IsConfigured(string channel) => channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => false;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken t)
        {
            lock (Messages) Messages.Add(message);
            return Failure is null ? Task.FromResult("smtp-accepted:synthetic") : Task.FromException<string>(Failure);
        }
    }

    private WebApplicationFactory<Program> EmailHost(SmtpProbe provider, string environment = "Testing", bool testEnabled = false) => fixture.Factory!.WithWebHostBuilder(b =>
    {
        b.UseEnvironment(environment);
        b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["NotificationChannels:Enabled"] = "true",
            ["NotificationChannels:AutomationEnabled"] = "false",
            ["Email:Enabled"] = "true",
            ["Email:TestEnabled"] = testEnabled.ToString(),
            ["Email:Username"] = "sender@example.invalid",
            ["Email:FromEmail"] = "sender@example.invalid",
            ["Email:AppPassword"] = "SYNTHETIC_TEST_SECRET",
            ["Email:TestRecipient"] = "configured@example.invalid"
        }));
        b.ConfigureServices(s => s.AddSingleton<INotificationChannelProvider>(provider));
    });

    private async Task<(Guid Notice, Guid Delivery)> EmailNotice(Workspace w, WebApplicationFactory<Program> host)
    {
        using var owner = await Client(w.Owner, host);
        var created = await owner.PostAsJsonAsync("/api/v1/announcements", Announcement(w.Location) with { Channels = ["IN_APP", "EMAIL"] });
        created.EnsureSuccessStatusCode(); var draft = (await created.Content.ReadFromJsonAsync<AnnouncementView>())!;
        (await owner.PostAsync($"/api/v1/announcements/{draft.Id}/send", null)).EnsureSuccessStatusCode();
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var notice = await db.Set<UserNotification>().Where(n => n.RelatedObjectId == draft.Id && n.RecipientUserId == w.Tenants[0].Id).Select(n => n.Id).SingleAsync();
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().EnqueueDueAsync(default);
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().EnqueueDueAsync(default);
        var delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_key={"channel:" + notice + ":EMAIL"}").SingleAsync();
        return (notice, delivery);
    }
    private static async Task SendEmail(WebApplicationFactory<Program> host, Guid delivery)
    { await using var scope = host.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().DeliverAsync(delivery, default); }

    [CompactPostgresFact]
    public async Task GmailSafeTransientFailureRetriesWithSameKeyAndConcurrentClaimsSendOnce()
    {
        var w = await Seed(); var probe = new SmtpProbe { Failure = new("email_smtp_450", retryable: true) }; using var host = EmailHost(probe);
        var (notice, delivery) = await EmailNotice(w, host);
        await Task.WhenAll(SendEmail(host, delivery), SendEmail(host, delivery)); Assert.Single(probe.Messages);
        using var tenant = await Client(w.Tenants[0], host);
        (await tenant.PatchAsync($"/api/v1/notifications/{notice}/read", null)).EnsureSuccessStatusCode();
        var states = await tenant.GetFromJsonAsync<NotificationChannelStatus[]>($"/api/v1/notifications/{notice}/deliveries");
        Assert.Equal("Pending", Assert.Single(states!).Status); Assert.NotNull(states![0].NextRetryAt);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
        probe.Failure = null;
        await Task.WhenAll(SendEmail(host, delivery), SendEmail(host, delivery)); Assert.Equal(2, probe.Messages.Count);
        Assert.Single(probe.Messages.Select(m => m.IdempotencyKey).Distinct());
        var row = await tenant.GetFromJsonAsync<NotificationView>($"/api/v1/notifications/{notice}");
        Assert.NotNull(row!.ReadAt); Assert.Equal("Delivered", row.DeliveryState);
        var history = await db.Database.SqlQuery<string>($"SELECT delivery_history::text AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.Contains("smtp-accepted:synthetic", history); Assert.DoesNotContain("SYNTHETIC_TEST_SECRET", history);
        await SendEmail(host, delivery); Assert.Equal(2, probe.Messages.Count);
    }

    [CompactPostgresFact]
    public async Task GmailPermanentAndAmbiguousFailuresStopWithoutDeletingInboxAndRetriesAreBounded()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        foreach (var failure in new[] { new ChannelDeliveryException("email_authentication_failed"), new("email_submission_outcome_unknown", outcomeUnknown: true), new("email_smtp_450", retryable: true) })
        {
            probe.Failure = failure; var (notice, delivery) = await EmailNotice(w, host);
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var start = probe.Messages.Count; var attempts = failure.Retryable ? 4 : 1;
            for (var n = 0; n < attempts; n++)
            {
                await SendEmail(host, delivery);
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
            }
            await SendEmail(host, delivery); Assert.Equal(start + attempts, probe.Messages.Count);
            Assert.Equal(failure.OutcomeUnknown ? "PendingReview" : "PermanentlyFailed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
            Assert.True(await db.Set<UserNotification>().AnyAsync(n => n.Id == notice));
        }
    }

    [CompactPostgresFact]
    public async Task GmailRechecksAccountEmailAndScopeBeforeExternalDelivery()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe);
        var (notice, delivery) = await EmailNotice(w, host);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET email_confirmed=false WHERE id={w.Tenants[0].Id}");
        await SendEmail(host, delivery); Assert.Empty(probe.Messages);
        Assert.Equal("PermanentlyFailed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET email_confirmed=true WHERE id={w.Tenants[0].Id}");
        var disabled = await EmailNotice(w, host);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET is_active=false WHERE id={w.Tenants[0].Id}");
        await SendEmail(host, disabled.Delivery); Assert.Empty(probe.Messages);
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={disabled.Delivery}").SingleAsync());
        Assert.True(await db.Set<UserNotification>().AnyAsync(n => n.Id == notice));
    }

    [CompactPostgresFact]
    public async Task GmailDevelopmentTestRequiresOwnerUsesConfiguredRecipientAndRateLimits()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe, "Development", true);
        using var anonymous = host.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/v1/notifications/email-test", null)).StatusCode);
        using var staff = await Client(w.Staff, host); Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsync("/api/v1/notifications/email-test", null)).StatusCode);
        using var tenant = await Client(w.Tenants[0], host); Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PostAsync("/api/v1/notifications/email-test", null)).StatusCode);
        using var owner = await Client(w.Owner, host); var response = await owner.PostAsync("/api/v1/notifications/email-test", null); response.EnsureSuccessStatusCode();
        Assert.False((await response.Content.ReadFromJsonAsync<EmailTestResult>())!.InboxDeliveryConfirmed);
        Assert.Equal("configured@example.invalid", Assert.Single(probe.Messages).Destination);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await owner.PostAsync("/api/v1/notifications/email-test", null)).StatusCode);
        Assert.Single(probe.Messages);
    }

    [CompactPostgresFact]
    public async Task GmailTestIsDisabledOutsideDevelopmentEvenWithFlagEnabled()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = EmailHost(probe, "Production", true);
        using var owner = await Client(w.Owner, host); Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsync("/api/v1/notifications/email-test", null)).StatusCode); Assert.Empty(probe.Messages);
    }
}
