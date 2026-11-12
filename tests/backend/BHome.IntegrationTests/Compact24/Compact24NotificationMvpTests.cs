using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Locations;
using BHome.Domain.Notifications;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24NotificationMvpTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Password = "Synthetic!Notification-927";
    private sealed record Workspace(ApplicationUser Owner, ApplicationUser Staff, ApplicationUser[] Tenants, Guid Location, Guid Room, Guid[] Contracts, Guid[] Residents);
    private static DateOnly Today => BHome.Application.Billing.BillingAutomationDates.BusinessDate(DateTimeOffset.UtcNow);
    private async Task<Workspace> Seed()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        async Task<ApplicationUser> Account(string role)
        {
            if (role == "Owner" && await db.Users.FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains("Owner")) is { } existing) return existing;
            var user = new ApplicationUser { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.invalid", EmailConfirmed = true };
            return await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, user, role, Password);
        }
        var owner = await Account("Owner"); var staff = await Account("Staff");
        var tenants = new[] { await Account("Tenant"), await Account("Tenant"), await Account("Tenant") };
        var location = new Location("Synthetic notification location") { Address = "Synthetic address" }; db.Add(location);
        var room = new Room { LocationId = location.Id, RoomNumber = "NOT-101", Capacity = 4, Status = RoomStatus.Occupied }; db.Add(room);
        db.Add(new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddYears(-1), Today.AddYears(1)));
        var contracts = new List<Guid>(); var residents = new List<Guid>();
        foreach (var user in tenants)
        {
            var resident = new Resident { RoomId = room.Id, OwnerUserId = owner.Id, TenantUserId = user.Id, DisplayLabel = "Synthetic occupant", VerificationStatus = IdentityVerificationStatus.Verified }; db.Add(resident);
            var c = new Contract
            {
                RoomId = room.Id,
                OwnerSignerId = owner.Id,
                TenantUserId = user.Id,
                RepresentativeResidentId = resident.Id,
                StartDate = Today.AddMonths(-1),
                EndDate = Today.AddYears(1),
                Status = ContractStatus.Active,
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = owner.Id,
                Terms = "Synthetic terms",
                Residents = [new ContractResident { ResidentId = resident.Id, ResidenceFrom = Today.AddMonths(-1) }]
            };
            db.Add(c); contracts.Add(c.Id); residents.Add(resident.Id);
        }
        await db.SaveChangesAsync(); return new(owner, staff, tenants, location.Id, room.Id, contracts.ToArray(), residents.ToArray());
    }
    private async Task<HttpClient> Client(ApplicationUser user, WebApplicationFactory<Program>? host = null)
    {
        var client = (host ?? fixture.Factory!).CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password }); response.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken); return client;
    }
    private async Task Pump(WebApplicationFactory<Program>? host = null)
    { await using var s = (host ?? fixture.Factory!).Services.CreateAsyncScope(); await s.ServiceProvider.GetRequiredService<INotificationEventPublisher>().PublishPendingAsync(default); }
    private sealed class ResidenceClock(DateTimeOffset at) : TimeProvider
    { internal DateTimeOffset Now = at; public override DateTimeOffset GetUtcNow() => Now; }

    [CompactPostgresFact]
    public async Task ResidenceDeliveryCannotReuseAnotherActiveContractAfterTheOriginalOccupancyCloses()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy(ResidenceEnabled: true, ResidenceFrequency: "WEEKLY", LocalSendHour: 0))).EnsureSuccessStatusCode();
        await using var check = fixture.Factory!.Services.CreateAsyncScope(); var data = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await data.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET actual_residence_from={Today.AddDays(-1)},registration_status='Pending' WHERE contract_id={w.Contracts[0]}");
        await Pump();
        var notice = await data.Set<UserNotification>().Where(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "TEMPORARY_RESIDENCE_ACTION").Select(n => n.Id).SingleAsync();
        await data.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET actual_move_out_date={Today} WHERE contract_id={w.Contracts[0]}");
        // A new eligible occupancy must not make the old Contract-specific reminder deliverable again.
        await data.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO contract_residents(contract_id,resident_id,resident_role,residence_from,actual_residence_from,registration_status)
            VALUES({w.Contracts[1]},{w.Residents[0]},1,{Today},{Today},'Pending')
            """);
        var provider = new ChannelProbe(); using var host = fixture.Factory.WithWebHostBuilder(b =>
        { b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["NotificationChannels:Enabled"] = "true" })); b.ConfigureServices(s => s.AddSingleton<INotificationChannelProvider>(provider)); });
        await using var scope = host.Services.CreateAsyncScope(); var worker = scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>();
        await worker.EnqueueDueAsync(default);
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'={notice.ToString()}").SingleAsync();
        await worker.DeliverAsync(delivery, default);
        Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        Assert.Empty(provider.Messages);
    }

    [CompactPostgresFact]
    public async Task ResidenceRemindersContinuePerConfiguredWindowStopOnClosureAndNeverReachStaff()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy(ResidenceEnabled: true, ResidenceFrequency: "WEEKLY", LocalSendHour: 0))).EnsureSuccessStatusCode();
        await using var check = fixture.Factory!.Services.CreateAsyncScope(); var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET actual_residence_from={Today.AddDays(-1)},registration_status='Pending',owner_confirmed_at={DateTimeOffset.UtcNow} WHERE contract_id={w.Contracts[0]}"); // Legacy stamp is not Completed.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET actual_residence_from={Today.AddDays(-1)},actual_move_out_date={Today},registration_status='InProgress' WHERE contract_id={w.Contracts[1]}");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET actual_residence_from={Today.AddDays(-1)},registration_status='Completed' WHERE contract_id={w.Contracts[2]}");
        var clock = new ResidenceClock(new DateTimeOffset(Today.ToDateTime(new TimeOnly(12, 0)), TimeSpan.FromHours(7)).ToUniversalTime());
        using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<TimeProvider>(clock)));
        async Task<UserNotification[]> Notices() => await db.Set<UserNotification>().AsNoTracking().Where(n => n.LocationId == w.Location && n.EventType == "TEMPORARY_RESIDENCE_ACTION").ToArrayAsync();
        await Task.WhenAll(Pump(host), Pump(host));
        var first = await Notices(); Assert.Equal(2, first.Length); Assert.All(first, n => { Assert.Equal(w.Residents[0], n.RelatedObjectId); Assert.Contains(n.RecipientUserId, new[] { w.Owner.Id, w.Tenants[0].Id }); });
        clock.Now = clock.Now.AddDays(8); await Task.WhenAll(Pump(host), Pump(host));
        Assert.Equal(4, (await Notices()).Length);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET registration_status='Completed' WHERE contract_id={w.Contracts[0]}");
        clock.Now = clock.Now.AddDays(8); await Pump(host); Assert.Equal(4, (await Notices()).Length);
        // Synthetic legacy role mismatch must never grant Staff a residence reminder.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET registration_status='Pending' WHERE contract_id={w.Contracts[2]}");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET user_id={w.Staff.Id} WHERE id={w.Residents[2]}");
        await Pump(host); await Pump(host);
        var final = await Notices(); Assert.Equal(5, final.Length); Assert.DoesNotContain(final, n => n.RecipientUserId == w.Staff.Id);
        Assert.Single(final, n => n.RelatedObjectId == w.Residents[2] && n.RecipientUserId == w.Owner.Id);
        Assert.DoesNotContain(final, n => n.RelatedObjectId == w.Residents[1]);
    }
    private static AnnouncementWrite Announcement(Guid location) => new("Synthetic notice", "Synthetic maintenance information", new("LOCATION", LocationIds: [location]), ["IN_APP", "EMAIL", "PUSH"]);

    [CompactPostgresFact]
    public async Task AnnouncementCreateReplaysConcurrentlyRejectsChangedPayloadAndRecoversDraftsForOwnerOnly()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); using var tenant = await Client(w.Tenants[0]);
        var key = Guid.NewGuid(); var input = Announcement(w.Location);
        static Task<HttpResponseMessage> Create(HttpClient client, AnnouncementWrite body, Guid key)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/announcements") { Content = JsonContent.Create(body) };
            request.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(request);
        }
        var responses = await Task.WhenAll(Create(owner, input, key), Create(owner, input, key));
        foreach (var response in responses) response.EnsureSuccessStatusCode();
        var draft = (await responses[0].Content.ReadFromJsonAsync<AnnouncementView>())!;
        Assert.Equal(draft.Id, (await responses[1].Content.ReadFromJsonAsync<AnnouncementView>())!.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Create(owner, input with { Body = "Changed synthetic body" }, key)).StatusCode);
        var staffDraftResponse = await Create(staff, input, key); staffDraftResponse.EnsureSuccessStatusCode();
        Assert.NotEqual(draft.Id, (await staffDraftResponse.Content.ReadFromJsonAsync<AnnouncementView>())!.Id);
        var drafts = (await owner.GetFromJsonAsync<AnnouncementView[]>("/api/v1/announcements/drafts?page=1&pageSize=100"))!;
        Assert.Single(drafts, d => d.Id == draft.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/announcements/drafts")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync("/api/v1/announcements/drafts")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/v1/announcements/drafts?pageSize=101")).StatusCode);
        (await owner.PostAsync($"/api/v1/announcements/{draft.Id}/send", null)).EnsureSuccessStatusCode();
        var replay = await Create(owner, input, key); replay.EnsureSuccessStatusCode();
        Assert.Equal("Sent", (await replay.Content.ReadFromJsonAsync<AnnouncementView>())!.Status);
        Assert.DoesNotContain((await owner.GetFromJsonAsync<AnnouncementView[]>("/api/v1/announcements/drafts?pageSize=100"))!, d => d.Id == draft.Id);
    }

    [CompactPostgresFact]
    public async Task RoomAndContractReadsRejectOtherTenantsEvenInTheSameRoom()
    {
        var w = await Seed(); var outside = await Seed(); using var a = await Client(w.Tenants[0]); using var stranger = await Client(outside.Tenants[0]);
        Assert.Equal(w.Room, Assert.Single((await a.GetFromJsonAsync<TenantRoomView[]>("/api/v1/tenant/rooms"))!).Id);
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync($"/api/v1/tenant/rooms/{w.Room}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/tenant/rooms/{w.Room}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await a.GetAsync($"/api/v1/rooms/{w.Room}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await a.GetAsync($"/api/v1/contracts/{w.Contracts[1]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await a.GetAsync($"/api/v1/contracts/{w.Contracts[1]}/activation-readiness")).StatusCode);
        var page = await a.GetFromJsonAsync<BHome.Application.Contracts.ContractPage>("/api/v1/contracts");
        Assert.All(page!.Items, c => Assert.Equal(w.Contracts[0], c.Id));
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET residence_to={Today.AddDays(-1)} WHERE contract_id={w.Contracts[0]}");
        Assert.Empty((await a.GetFromJsonAsync<TenantRoomView[]>("/api/v1/tenant/rooms"))!);
    }
    [CompactPostgresFact]
    public async Task AnnouncementSnapshotsThreeRecipientsRejectsCrossLocationAndCannotBeSentTwice()
    {
        var w = await Seed(); var other = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/v1/announcements/preview-recipients", new NotificationAudience("LOCATION", LocationIds: [other.Location]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/v1/announcements/preview-recipients", new NotificationAudience("USER", UserIds: [other.Tenants[0].Id]))).StatusCode);
        var preview = await owner.PostAsJsonAsync("/api/v1/announcements/preview-recipients", new NotificationAudience("ROOM", RoomIds: [w.Room])); preview.EnsureSuccessStatusCode();
        Assert.Equal(3, (await preview.Content.ReadFromJsonAsync<RecipientPreview>())!.RecipientCount);
        var created = await owner.PostAsJsonAsync("/api/v1/announcements", Announcement(w.Location)); created.EnsureSuccessStatusCode(); var draft = (await created.Content.ReadFromJsonAsync<AnnouncementView>())!;
        var sends = await Task.WhenAll(owner.PostAsync($"/api/v1/announcements/{draft.Id}/send", null), owner.PostAsync($"/api/v1/announcements/{draft.Id}/send", null)); Assert.All(sends, r => r.EnsureSuccessStatusCode());
        foreach (var user in w.Tenants)
        {
            using var tenant = await Client(user); var page = await tenant.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<NotificationView>>("/api/v1/notifications?category=Announcement");
            var notice = Assert.Single(page!.Items, n => n.RelatedObjectId == draft.Id); Assert.Equal("ANNOUNCEMENT_SENT", notice.EventType);
            Assert.Equal(HttpStatusCode.OK, (await tenant.GetAsync($"/api/v1/notifications/{notice.Id}")).StatusCode);
            using var stranger = await Client(other.Tenants[0]); Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/notifications/{notice.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await stranger.PatchAsync($"/api/v1/notifications/{notice.Id}/read", null)).StatusCode);
        }
    }
    [CompactPostgresFact]
    public async Task PushDevicesAreOwnedAndTokensNeverAppearInResponses()
    {
        var w = await Seed(); using var a = await Client(w.Tenants[0]); using var b = await Client(w.Tenants[1]);
        var token = "Synthetic-Push-" + Guid.NewGuid(); var response = await a.PostAsJsonAsync("/api/v1/notifications/devices", new PushDeviceWrite(token, "Android")); response.EnsureSuccessStatusCode();
        Assert.DoesNotContain(token, await response.Content.ReadAsStringAsync()); var device = (await response.Content.ReadFromJsonAsync<PushDeviceView>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/v1/notifications/devices/{device.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await b.PostAsJsonAsync("/api/v1/notifications/devices", new PushDeviceWrite(token, "iOS"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync($"/api/v1/notifications/devices/{device.Id}")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task PasswordChangeRevokesSessionAndPublishesSafeSecurityNotice()
    {
        var w = await Seed(); using var client = await Client(w.Tenants[0]);
        (await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = Password, newPassword = "Synthetic!Changed-Password-725" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode); await Pump();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var notices = await db.Set<UserNotification>().Where(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "PASSWORD_CHANGED").ToArrayAsync(); Assert.Single(notices);
        Assert.DoesNotContain("Password-725", JsonSerializer.Serialize(notices)); await Pump(); Assert.Equal(1, await db.Set<UserNotification>().CountAsync(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "PASSWORD_CHANGED"));
    }
    [CompactPostgresFact]
    public async Task ReminderPolicyIsOwnerOnlyAndDoesNotInventEmergencySla()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var initial = await owner.GetFromJsonAsync<NotificationReminderPolicy>($"/api/v1/locations/{w.Location}/notification-policy"); Assert.False(initial!.EmergencyEnabled); Assert.False(initial.ResidenceEnabled);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy(EmergencyEnabled: true))).StatusCode);
    }
    [CompactPostgresFact]
    public async Task ResidenceWeeklyAndMonthlyDeduplicateAndStopAfterCompletedRegistration()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        { var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET actual_residence_from={Today.AddDays(-1)},registration_status='Pending' WHERE contract_id={w.Contracts[0]}"); }
        foreach (var frequency in new[] { "WEEKLY", "MONTHLY" })
        {
            (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy(ResidenceEnabled: true, ResidenceFrequency: frequency, LocalSendHour: 0))).EnsureSuccessStatusCode();
            await Pump(); await Pump();
        }
        await using var check = fixture.Factory!.Services.CreateAsyncScope(); var data = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(2, await data.Set<UserNotification>().CountAsync(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "TEMPORARY_RESIDENCE_ACTION"));
        await data.Database.ExecuteSqlInterpolatedAsync($"UPDATE contract_residents SET registration_status='Completed',owner_confirmed_by_user_id={w.Owner.Id},owner_confirmed_at={DateTimeOffset.UtcNow} WHERE contract_id={w.Contracts[0]}");
        await Pump(); Assert.Equal(2, await data.Set<UserNotification>().CountAsync(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "TEMPORARY_RESIDENCE_ACTION"));
        var provider = new ChannelProbe(); using var host = fixture.Factory!.WithWebHostBuilder(b =>
        { b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { { "NotificationChannels:Enabled", "true" } })); b.ConfigureServices(s => s.AddSingleton<INotificationChannelProvider>(provider)); });
        var notice = await data.Set<UserNotification>().Where(n => n.RecipientUserId == w.Tenants[0].Id && n.EventType == "TEMPORARY_RESIDENCE_ACTION").Select(n => n.Id).FirstAsync();
        await using (var s = host.Services.CreateAsyncScope())
        {
            var worker = s.ServiceProvider.GetRequiredService<NotificationChannelWorker>(); await worker.EnqueueDueAsync(default);
            var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'={notice.ToString()}").SingleAsync();
            await worker.DeliverAsync(delivery, default);
            Assert.Equal("Suppressed", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        }
        Assert.Empty(provider.Messages);
    }
    [CompactPostgresFact]
    public async Task EmergencyUsesAssignedStaffAndReadingInboxDoesNotAcknowledge()
    {
        var w = await Seed(); var other = await Seed(); using var owner = await Client(w.Owner);
        var incident = new IncidentReport { LocationId = w.Location, RoomId = w.Room, ReporterId = w.Tenants[0].Id, ReporterRole = "Tenant", Description = "Synthetic emergency", Severity = IncidentSeverity.Emergency };
        await using (var s = fixture.Factory!.Services.CreateAsyncScope()) { var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>(); db.Add(incident); await db.SaveChangesAsync(); await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE incident_reports SET reported_at={DateTimeOffset.UtcNow.AddMinutes(-40)} WHERE id={incident.Id}"); }
        (await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}/notification-policy", new NotificationReminderPolicy(EmergencyEnabled: true, EmergencyFirstEscalationMinutes: 10, EmergencyOverdueMinutes: 20))).EnsureSuccessStatusCode(); await Pump();
        using var staff = await Client(w.Staff); var page = await staff.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<NotificationView>>("/api/v1/notifications?category=Incident");
        var notice = Assert.Single(page!.Items, n => n.RelatedObjectId == incident.Id && n.EventType == "EMERGENCY_ACK_OVERDUE");
        (await staff.PatchAsync($"/api/v1/notifications/{notice.Id}/read", null)).EnsureSuccessStatusCode();
        await using var check = fixture.Factory!.Services.CreateAsyncScope(); var data = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Null((await data.Set<IncidentReport>().SingleAsync(i => i.Id == incident.Id)).AcknowledgedAt);
        Assert.False(await data.Set<UserNotification>().AnyAsync(n => n.RelatedObjectId == incident.Id && n.RecipientUserId == other.Staff.Id));
        await Pump(); Assert.Equal(1, await data.Set<UserNotification>().CountAsync(n => n.RelatedObjectId == incident.Id && n.RecipientUserId == w.Staff.Id && n.EventType == "EMERGENCY_ACK_OVERDUE"));
    }
    private sealed class ChannelProbe : INotificationChannelProvider
    {
        public List<ChannelMessage> Messages { get; } = []; public int Failures;
        public bool IsConfigured(string channel) => true; public bool SupportsIdempotency(string channel) => true;
        public Task<string> SendAsync(ChannelMessage message, CancellationToken t) { Messages.Add(message); if (Failures-- > 0) throw new HttpRequestException("Synthetic private error"); return Task.FromResult("synthetic-accepted"); }
    }
    private sealed class InvitationMailbox : IPasswordResetDelivery
    {
        public string? Token;
        public bool IsAvailable => true;
        public Task SendAsync(Guid userId, string destination, string token, CancellationToken t) { Token = token; return Task.CompletedTask; }
    }
    [CompactPostgresFact]
    public async Task OwnerCreatesStaffWithExplicitRoleAndSendsOneTimeInvitation()
    {
        var w = await Seed(); var mailbox = new InvitationMailbox(); using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<IPasswordResetDelivery>(mailbox)));
        using var owner = await Client(w.Owner, host); var email = Guid.NewGuid().ToString("N") + "@example.invalid";
        var input = new BHome.Application.Operations.StaffCreate(email, "Synthetic staff", null, Password, new(null, "PartTime", Today, null, null, null, "Active"));
        var response = await owner.PostAsJsonAsync("/api/v1/staff", input); response.EnsureSuccessStatusCode(); var staff = (await response.Content.ReadFromJsonAsync<BHome.Application.Operations.StaffView>())!;
        (await owner.PostAsync($"/api/v1/staff/{staff.UserId}/invitation", null)).EnsureSuccessStatusCode(); Assert.NotNull(mailbox.Token);
        using var anonymous = host.CreateClient(); Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", new AcceptInvitationRequest(email, mailbox.Token!, Password))).StatusCode);
        await Pump(host); await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.True(await db.Set<UserNotification>().AnyAsync(n => n.RecipientUserId == staff.UserId && n.EventType == "STAFF_ACCOUNT_CREATED"));
    }
    [CompactPostgresFact]
    public async Task NotificationOnlyAutomationRunsWithoutEnablingFinancialJobs()
    {
        var w = await Seed(); var provider = new ChannelProbe(); using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { { "NotificationChannels:Enabled", "true" }, { "NotificationChannels:AutomationEnabled", "true" }, { "Jobs:Enabled", "false" }, { "Jobs:PollSeconds", "1" } }));
            b.ConfigureServices(s => { s.AddSingleton<INotificationChannelProvider>(provider); s.AddHostedService<NotificationAutomationWorker>(); });
        });
        using var owner = await Client(w.Owner, host); var created = await owner.PostAsJsonAsync("/api/v1/announcements", Announcement(w.Location) with { Channels = ["IN_APP", "EMAIL"] }); created.EnsureSuccessStatusCode(); var draft = (await created.Content.ReadFromJsonAsync<AnnouncementView>())!;
        (await owner.PostAsync($"/api/v1/announcements/{draft.Id}/send", null)).EnsureSuccessStatusCode();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (provider.Messages.Count < 3) await Task.Delay(100, deadline.Token);
        await using var scope = host.Services.CreateAsyncScope(); var config = scope.ServiceProvider.GetRequiredService<IConfiguration>(); Assert.False(config.GetValue<bool>("Jobs:Enabled"));
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(3, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM contracts WHERE room_id={w.Room} AND status=3").SingleAsync());
        Assert.Equal(0, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM invoices WHERE room_id={w.Room}").SingleAsync());
    }
    [CompactPostgresFact]
    public async Task OccupantInvitationIsOwnerScopedOneTimeAndNeverStoredAsRawNotificationToken()
    {
        var w = await Seed(); var mailbox = new InvitationMailbox(); using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<IPasswordResetDelivery>(mailbox)));
        Guid resident;
        await using (var s = host.Services.CreateAsyncScope())
        {
            var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>(); var person = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic co-occupant" }; resident = person.Id;
            db.Add(person); db.Add(new ContractResident { ContractId = w.Contracts[0], ResidentId = resident, ResidenceFrom = Today.AddDays(-1), Role = ResidentType.CoOccupant }); await db.SaveChangesAsync();
            var repository = s.ServiceProvider.GetRequiredService<BHome.Application.Billing.IInvoiceRepository>();
            Assert.Contains(await repository.OccupanciesAsync(w.Room, Today, Today.AddDays(1), default), o => !o.ContactsComplete);
        }
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); var email = Guid.NewGuid().ToString("N") + "@example.invalid";
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync($"/api/v1/residents/{resident}/invitation", new TenantInvitationRequest(email))).StatusCode);
        var invited = await owner.PostAsJsonAsync($"/api/v1/residents/{resident}/invitation", new TenantInvitationRequest(email)); invited.EnsureSuccessStatusCode(); Assert.NotNull(mailbox.Token);
        using var anonymous = host.CreateClient(); var accept = new AcceptInvitationRequest(email, mailbox.Token!, Password);
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", accept)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", accept)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password })).StatusCode);
        await using var check = host.Services.CreateAsyncScope(); var data = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.False(await data.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM notifications WHERE event_data::text LIKE {'%' + mailbox.Token + '%'}) AS \"Value\"").SingleAsync());
        Assert.All(await check.ServiceProvider.GetRequiredService<BHome.Application.Billing.IInvoiceRepository>().OccupanciesAsync(w.Room, Today, Today.AddDays(1), default), o => Assert.True(o.ContactsComplete));
    }
    [CompactPostgresFact]
    public async Task ChannelRetryPreservesInboxAndUsesStableKeyWithoutCrossTenantStatusLeaks()
    {
        var w = await Seed(); var provider = new ChannelProbe { Failures = 1 }; using var host = fixture.Factory!.WithWebHostBuilder(b =>
        { b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { { "NotificationChannels:Enabled", "true" }, { "NotificationChannels:RetrySeconds", "1" } })); b.ConfigureServices(s => s.AddSingleton<INotificationChannelProvider>(provider)); });
        using var owner = await Client(w.Owner, host); var created = await owner.PostAsJsonAsync("/api/v1/announcements", Announcement(w.Location) with { Channels = ["IN_APP", "EMAIL"] }); created.EnsureSuccessStatusCode(); var draft = (await created.Content.ReadFromJsonAsync<AnnouncementView>())!;
        (await owner.PostAsync($"/api/v1/announcements/{draft.Id}/send", null)).EnsureSuccessStatusCode();
        await using (var s = host.Services.CreateAsyncScope()) await s.ServiceProvider.GetRequiredService<NotificationChannelWorker>().EnqueueDueAsync(default);
        Guid delivery; Guid notice;
        await using (var s = host.Services.CreateAsyncScope())
        {
            var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>(); notice = await db.Set<UserNotification>().Where(n => n.RelatedObjectId == draft.Id && n.RecipientUserId == w.Tenants[0].Id).Select(n => n.Id).SingleAsync();
            delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'={notice.ToString()}").SingleAsync();
            await s.ServiceProvider.GetRequiredService<NotificationChannelWorker>().DeliverAsync(delivery, default);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
        }
        await using (var s = host.Services.CreateAsyncScope()) await s.ServiceProvider.GetRequiredService<NotificationChannelWorker>().DeliverAsync(delivery, default);
        Assert.Equal(2, provider.Messages.Count); Assert.Equal(provider.Messages[0].IdempotencyKey, provider.Messages[1].IdempotencyKey);
        using var a = await Client(w.Tenants[0], host); var states = await a.GetFromJsonAsync<NotificationChannelStatus[]>($"/api/v1/notifications/{notice}/deliveries"); Assert.Equal("Sent", Assert.Single(states!).Status);
        using var b = await Client(w.Tenants[1], host); Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/v1/notifications/{notice}/deliveries")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync($"/api/v1/notifications/{notice}")).StatusCode);
    }
}
