using System.Net;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    private async Task<WebApplicationFactory<Program>> SmsHost(Workspace w)
    {
        var config = new Dictionary<string, string?>
        {
            ["Sms:Enabled"] = "true",
            ["Sms:Mode"] = "Mock",
            ["Sms:DemoIsolated"] = "true",
            ["NotificationChannels:Enabled"] = "true",
            ["NotificationChannels:Mode"] = "Sandbox"
        };
        var accounts = new[] { w.Owner, w.Staff }.Concat(w.Tenants).ToArray();
        var phonePrefix = "09" + System.Security.Cryptography.RandomNumberGenerator.GetInt32(1000000, 9999999).ToString();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        for (var index = 0; index < accounts.Length; index++)
        {
            var account = accounts[index]; var name = account.Id.ToString("N") + ".sms-demo";
            // Dedicated synthetic recipient identities, never actual Tenant contacts.
            var phone = phonePrefix + index;
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET username={name},normalized_username={name.ToUpperInvariant()},email={name + "@sms-demo.example.invalid"},normalized_email={(name + "@sms-demo.example.invalid").ToUpperInvariant()},phone={phone},phone_confirmed=true WHERE id={account.Id}");
            config[$"Sms:DemoAccounts:{account.Id}"] = phone;
            account.Email = name + "@sms-demo.example.invalid"; account.UserName = name; account.PhoneNumber = phone;
        }
        for (var index = 0; index < 6; index++) config[$"Sms:EnabledTemplates:{index}"] = $"SMS-0{index + 1}";
        return fixture.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(config)));
    }
    private async Task<Invoice> SmsInvoice(Workspace w, int offset = 0, decimal total = 100000, int dueOffset = -1)
    {
        var invoice = new Invoice
        {
            RoomId = w.Room,
            LocationId = w.Location,
            RoomNumber = "NOT-101",
            LocationName = "Synthetic notification location",
            RepresentativeContractId = w.Contracts[0],
            RepresentativeTenantUserId = w.Tenants[0].Id,
            BillingPeriod = new DateOnly(Today.Year, Today.Month, 1).AddMonths(offset),
            Status = InvoiceStatus.Draft,
            DueDate = Today.AddDays(dueOffset),
            CreatedByUserId = w.Owner.Id,
            ScheduleSnapshot = "{}",
            ScheduledFinalDate = new DateOnly(Today.Year, Today.Month, 1).AddMonths(offset),
            Total = total,
            Recipients = [new() { TenantUserId = w.Tenants[0].Id }, new() { TenantUserId = w.Tenants[1].Id }],
            Lines = [new() { Category = BHome.Domain.PropertyManagement.ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent", Amount = total, Rate = total, Quantity = 1, RateDate = Today, OccupiedDays = 30, PeriodDays = 30 }]
        };
        await using var s = fixture.Factory!.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        db.Add(invoice); await db.SaveChangesAsync();
        invoice.Status = InvoiceStatus.Final; invoice.FinalizedAt = DateTimeOffset.UtcNow; invoice.FinalizedByUserId = w.Owner.Id;
        db.Add(new InvoiceIssuedEvent { InvoiceId = invoice.Id, OwnerUserId = w.Owner.Id, OccurredAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(); return invoice;
    }
    private static async Task DispatchSms(WebApplicationFactory<Program> host)
    {
        await using var scope = host.Services.CreateAsyncScope(); var worker = scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>();
        await worker.EnqueueDueAsync(default); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var recipients = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<SmsOptions>>().Value.DemoAccounts.Keys.ToArray();
        var ids = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'channel'='SMS' AND event_data->>'recipient'=ANY({recipients}) AND delivery_status='Pending'").ToArrayAsync();
        Assert.True(scope.ServiceProvider.GetRequiredService<ISmsSender>().IsConfigured, "SMS gateway not configured in fixture");
        var smsNotices = await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM notifications WHERE record_kind='INBOX' AND event_data->'state'->'channels' ? 'SMS'").SingleAsync();
        Assert.True(smsNotices > 0, "No SMS channel on published inbox");
        foreach (var id in ids) await worker.DeliverAsync(id, default);
        var failures = await db.Database.SqlQuery<string>($"SELECT delivery_history::text AS \"Value\" FROM notifications WHERE event_data->>'channel'='SMS' AND event_data->>'recipient'=ANY({recipients}) AND delivery_status IN ('PermanentlyFailed','PendingReview')").ToArrayAsync();
        Assert.True(failures.Length == 0, string.Join("\n", failures));
    }

    [CompactPostgresFact]
    public async Task FinalizedInvoicePublishesDynamicSmsAndDeduplicatesNormalizedRoomRecipients()
    {
        var w = await Seed(); using var host = await SmsHost(w);
        // Two eligible occupants share one normalized contact. One SMS per invoice/phone.
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var sharedPhone = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == w.Tenants[0].Id)).PhoneNumber!;
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET phone={"+84 " + sharedPhone[1..]} WHERE id={w.Tenants[1].Id}");
        host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<SmsOptions>>().Value.DemoAccounts[w.Tenants[1].Id.ToString()] = sharedPhone;
        var invoice = await SmsInvoice(w); await Task.WhenAll(Pump(host), Pump(host)); await DispatchSms(host); await DispatchSms(host);
        var messages = host.Services.GetRequiredService<DemoSmsInbox>().List();
        var sms = Assert.Single(messages, m => m.TemplateId == "SMS-03");
        Assert.Contains(invoice.RoomNumber, sms.Content); Assert.Contains(invoice.BillingPeriod.ToString("MM/yyyy"), sms.Content);
        Assert.Equal("Simulated", sms.Status);
        // Changing a confirmed destination must not replay an already published invoice event.
        foreach (var user in w.Tenants.Take(2))
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET phone={"0912345678"} WHERE id={user.Id}");
        await DispatchSms(host);
        Assert.Single(host.Services.GetRequiredService<DemoSmsInbox>().List(), m => m.TemplateId == "SMS-03");
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications d JOIN notifications n ON n.id=(d.event_data->>'notificationId')::uuid WHERE d.event_data->>'channel'='SMS' AND d.delivery_status='Simulated' AND n.related_entity_id={invoice.Id}").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task DebtSmsRechecksZeroBalanceAndCurrentDueDateBeforeDelivery()
    {
        var w = await Seed(); using var host = await SmsHost(w); var paid = await SmsInvoice(w, -1, 0); var unpaid = await SmsInvoice(w, dueOffset: 1);
        await using var s = host.Services.CreateAsyncScope(); var sql = s.ServiceProvider.GetRequiredService<CompactNotificationWriter>();
        foreach (var invoice in new[] { paid, unpaid })
            await sql.Emit(w.Tenants[0].Id, "Tenant", w.Location, "synthetic-debt:" + invoice.Id, "INVOICE_OVERDUE", "Invoice", "Debt", "Debt", "Invoice", invoice.Id, default);
        var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await DispatchSms(host); Assert.Empty(host.Services.GetRequiredService<DemoSmsInbox>().List());
        var invoiceIds = new[] { paid.Id, unpaid.Id };
        Assert.Equal(2, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications d JOIN notifications n ON n.id=(d.event_data->>'notificationId')::uuid WHERE d.event_data->>'channel'='SMS' AND d.delivery_status='Suppressed' AND n.related_entity_id=ANY({invoiceIds})").SingleAsync());
    }

    [CompactPostgresFact]
    public async Task ExpiryUsesThirtyDayWindowAndDoesNotRepeatAcrossDailyPublication()
    {
        var w = await Seed(); using var host = await SmsHost(w);
        await using var s = host.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET end_date={Today.AddDays(20)} WHERE id={w.Contracts[0]}");
        await Pump(host); await Pump(host); await DispatchSms(host); await Pump(host); await DispatchSms(host);
        Assert.Single(host.Services.GetRequiredService<DemoSmsInbox>().List(), m => m.TemplateId == "SMS-05" && m.RecipientId == w.Tenants[0].Id);
        Assert.DoesNotContain(host.Services.GetRequiredService<DemoSmsInbox>().List(), m => m.TemplateId == "SMS-05" && m.RecipientId != w.Tenants[0].Id);
    }

    [CompactPostgresFact]
    public async Task SigningSmsRequiresAnActualInvitationAndEmergencyUsesResponsibleRecipients()
    {
        var w = await Seed(); using var host = await SmsHost(w);
        await using var s = host.Services.CreateAsyncScope(); var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var sql = s.ServiceProvider.GetRequiredService<CompactNotificationWriter>();
        await sql.Emit(w.Tenants[0].Id, "Tenant", w.Location, "draft-signing", "CONTRACT_SIGNING_INVITATION", "Contract", "Signing", "Signing", "Contract", w.Contracts[0], default);
        await DispatchSms(host); Assert.Empty(host.Services.GetRequiredService<DemoSmsInbox>().List());
        var email = await db.Users.Where(u => u.Id == w.Tenants[0].Id).Select(u => u.Email).SingleAsync();
        db.Add(new ContractSigningInvitation
        {
            ContractId = w.Contracts[0],
            ResidentId = w.Residents[0],
            ApprovedByUserId = w.Owner.Id,
            TokenHash = new string('A', 64),
            RecipientEmail = email!,
            DocumentObjectKey = "synthetic.pdf",
            DocumentHash = new string('B', 64),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1)
        });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET status=1 WHERE id={w.Contracts[0]}");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO notifications(id,record_kind,event_key,notification_type,related_entity_id,event_data,event_at) VALUES({Guid.NewGuid()},'AUDIT',{Guid.NewGuid().ToString()},'InternalSigningInvitationApproved',{w.Contracts[0]},'{{}}'::jsonb,{DateTimeOffset.UtcNow})");
        var report = new IncidentReport { LocationId = w.Location, RoomId = w.Room, ReporterId = w.Tenants[0].Id, ReporterRole = "Tenant", Description = "Synthetic emergency", Severity = IncidentSeverity.Emergency };
        db.Add(report); await db.SaveChangesAsync();
        await sql.Emit(w.Owner.Id, "Owner", w.Location, "emergency:" + report.Id, "INCIDENT_EMERGENCY_SUBMITTED", "Incident", "Emergency", "Emergency", "Incident", report.Id, default);
        await sql.Emit(w.Staff.Id, "Staff", w.Location, "emergency:" + report.Id, "INCIDENT_EMERGENCY_SUBMITTED", "Incident", "Emergency", "Emergency", "Incident", report.Id, default);
        await sql.Emit(w.Tenants[1].Id, "Tenant", w.Location, "emergency:" + report.Id, "INCIDENT_EMERGENCY_SUBMITTED", "Incident", "Emergency", "Emergency", "Incident", report.Id, default);
        await Pump(host); await DispatchSms(host);
        var messages = host.Services.GetRequiredService<DemoSmsInbox>().List();
        Assert.Single(messages, m => m.TemplateId == "SMS-02");
        Assert.Equal(2, messages.Count(m => m.TemplateId == "SMS-06"));
        Assert.All(messages.Where(m => m.TemplateId == "SMS-06"), m => Assert.Contains(m.RecipientId, new[] { w.Owner.Id, w.Staff.Id }));
        Assert.False(EsmsDeliveryCallback.TrustedSource(IPAddress.Loopback));
        Assert.True(EsmsDeliveryCallback.TrustedSource(IPAddress.Parse("103.29.26.39")));
    }
}
