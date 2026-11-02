using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Modules.IncidentMaintenance;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using OpenCvSharp;

namespace BHome.IntegrationTests.IncidentMaintenance;

[Trait("Category", "Docker")]
public sealed class IncidentApiTests(IncidentFixture fixture) : IClassFixture<IncidentFixture>
{
    private const string Base = "/api/v1/incidents";
    private const string Orders = "/api/v1/work-orders";
    private const string Password = "Synthetic-Incident-Password!123";
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private sealed record Actor(Guid Id, HttpClient Client);
    private sealed record Workspace(Actor Owner, Actor Staff, Actor Tenant, Guid Location, Guid Room, Guid Asset, Guid Contract);
    private async Task<Actor> User(string role)
    {
        var id = Guid.NewGuid(); var email = id.ToString("N") + "@example.invalid";
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser { Id = id, Email = email, UserName = email, LockoutEnabled = true };
            Assert.True((await manager.CreateAsync(user, Password)).Succeeded); Assert.True((await manager.AddToRoleAsync(user, role)).Succeeded);
        }
        var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });
        response.EnsureSuccessStatusCode(); var login = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken); return new(id, client);
    }
    private async Task<Workspace> Setup(bool assigned = true)
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff); var tenant = await User(Roles.Tenant);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var chain = await db.Set<Chain>().Select(c => c.Id).SingleAsync();
        var location = new Location("Synthetic incident location") { ChainId = chain };
        var room = new Room { LocationId = location.Id, RoomNumber = "SYNTHETIC-01", Status = RoomStatus.Occupied };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = owner.Id, DisplayLabel = "Synthetic representative" };
        var asset = new Asset { LocationId = location.Id, RoomId = room.Id, Name = "Synthetic pump", Category = "Synthetic", Condition = "Before" };
        var contract = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = owner.Id,
            TenantUserId = tenant.Id,
            RepresentativeResidentId = resident.Id,
            StartDate = Today.AddDays(-10),
            EndDate = Today.AddDays(100),
            MonthlyRent = 1000000,
            RequiredDeposit = 0,
            Status = ContractStatus.Active,
            ActivatedByUserId = owner.Id,
            ActivatedAt = DateTimeOffset.UtcNow,
            Terms = "Synthetic terms",
            Residents = [new() { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = Today.AddDays(-10) }]
        };
        db.AddRange(location, room, resident, asset, contract);
        if (assigned) db.Add(new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddDays(-20), Today.AddDays(20)));
        await db.SaveChangesAsync(); return new(owner, staff, tenant, location.Id, room.Id, asset.Id, contract.Id);
    }
    private static byte[] Image()
    { using var image = new Mat(12, 12, MatType.CV_8UC3, Scalar.White); Cv2.ImEncode(".png", image, out var bytes); return bytes; }
    private static async Task<T> Ok<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static async Task<HttpResponseMessage> Send(Actor actor, string path, object input, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(input) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await actor.Client.SendAsync(request);
    }
    private static async Task<HttpResponseMessage> Submit(Actor actor, Workspace w, bool emergency = false, Guid? key = null,
        byte[]? photo = null, Guid? room = null, Guid? asset = null, string description = "Synthetic incident description")
    {
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(w.Location.ToString()), "locationId"); form.Add(new StringContent((room ?? w.Room).ToString()), "roomId");
        form.Add(new StringContent((asset ?? w.Asset).ToString()), "assetId"); form.Add(new StringContent(description), "description");
        form.Add(new StringContent(emergency ? "Emergency" : "Normal"), "severity");
        if (photo is not null)
        { var content = new ByteArrayContent(photo); content.Headers.ContentType = new("image/png"); form.Add(content, "images", "synthetic.png"); }
        using var request = new HttpRequestMessage(HttpMethod.Post, Base) { Content = form };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await actor.Client.SendAsync(request);
    }
    private static Task<IncidentView?> Report(Actor actor, Guid id) => actor.Client.GetFromJsonAsync<IncidentView>($"{Base}/{id}");
    private static Task<WorkOrderView?> Work(Actor actor, Guid id) => actor.Client.GetFromJsonAsync<WorkOrderView>($"{Orders}/{id}");
    private async Task<Guid> Create(Workspace w, Actor? reporter = null, bool emergency = false)
        => (await Ok<IncidentCommandResult>(await Submit(reporter ?? w.Tenant, w, emergency))).IncidentId;
    private static async Task Review(Workspace w, Guid incident)
    {
        var report = (await Report(w.Owner, incident))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Base}/{incident}/review", new IncidentReview(report.Version, "Technical", "Water")));
    }
    private static async Task<Guid> Assign(Workspace w, Guid incident)
    {
        var report = (await Report(w.Owner, incident))!;
        return (await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Base}/{incident}/work-orders",
            new WorkOrderAssign(report.Version, w.Staff.Id, "Synthetic expected outcome", DateTimeOffset.UtcNow.AddDays(2))))).WorkOrderId!.Value;
    }
    private static async Task<Guid> Upload(Actor actor, Guid incident, IncidentEvidenceKind kind, Guid? work = null)
        => (await Ok<IncidentCommandResult>(await UploadResponse(actor, incident, kind, work, Image()))).ResourceId!.Value;
    private static async Task<HttpResponseMessage> UploadResponse(Actor actor, Guid incident, IncidentEvidenceKind kind, Guid? work, byte[] bytes, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"{Base}/{incident}/evidence?kind={kind}" + (work is { } id ? "&workOrderId=" + id : ""))
        { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new("image/png"); request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return await actor.Client.SendAsync(request);
    }
    private static async Task ProposeAndStart(Workspace w, Guid work)
    {
        var before = (await Work(w.Staff, work))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{work}/proposal", new RepairProposal(before.Version, "Synthetic inspection", "Synthetic solution", 60, 100000m, [])));
        before = (await Work(w.Owner, work))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{work}/plan-decision", new PlanDecision(before.Version, true)));
        before = (await Work(w.Staff, work))!;
        Assert.True(before.PlanApproved); Assert.True(before.CanStart); Assert.Equal("PendingApproval", before.Status);
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{work}/start", new WorkOrderAction(before.Version)));
    }
    private static async Task Complete(Workspace w, Guid incident, Guid work)
    {
        var evidence = await Upload(w.Staff, incident, IncidentEvidenceKind.Completion, work);
        var state = (await Work(w.Staff, work))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{work}/submit", new WorkOrderAction(state.Version, "Synthetic completed result", [evidence])));
    }
    private static async Task<HttpResponseMessage> Verify(Workspace w, Guid work, Guid? key = null, decimal cost = 100000m)
    {
        var state = (await Work(w.Owner, work))!;
        return await Send(w.Owner, $"{Orders}/{work}/verify", new MaintenanceVerification(state.Version, cost, "Synthetic verification", cost != 100000m ? "Synthetic variance reason" : null, "Repaired"), key);
    }

    [Fact]
    public async Task FullWorkflowRetainsReworkAndClosesOnlyAfterAllRequiredOrders()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident); var work = await Assign(w, incident);
        var other = await Assign(w, incident);
        var initial = (await Work(w.Staff, work))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{work}/start", new WorkOrderAction(initial.Version))).StatusCode);
        await ProposeAndStart(w, work);
        var running = (await Work(w.Staff, work))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{work}/submit", new WorkOrderAction(running.Version, "Missing evidence"))).StatusCode);
        await Complete(w, incident, work);
        var state = (await Work(w.Owner, work))!;
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Orders}/{work}/rework", new WorkOrderAction(state.Version))).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{work}/rework", new WorkOrderAction(state.Version, "Synthetic rework")));
        await Complete(w, incident, work);
        var key = Guid.NewGuid(); state = (await Work(w.Owner, work))!;
        var verification = new MaintenanceVerification(state.Version, 100000m, "Synthetic verification", null, "Repaired");
        var responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Send(w.Owner, $"{Orders}/{work}/verify", verification, key)));
        foreach (var response in responses) await Ok<IncidentCommandResult>(response);
        Assert.Equal("InProgress", (await Report(w.Owner, incident))!.Status);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            Assert.Equal(AssetStatus.NeedsRepair, (await db.Set<Asset>().SingleAsync(a => a.Id == w.Asset)).Status);
            Assert.Single(await db.Set<MaintenanceExpense>().Where(e => e.IncidentId == incident).ToArrayAsync());
        }
        var remaining = (await Work(w.Owner, other))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{other}/cancel", new IncidentDecision(remaining.Version, "No additional work needed", AssetStatus: AssetStatus.Active, AssetCondition: "Repaired")));
        Assert.Equal("Resolved", (await Report(w.Tenant, incident))!.Status);
        var history = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<IncidentActivityView>>($"{Base}/{incident}/history"))!;
        Assert.All(history.Items, a => { Assert.Null(a.DataJson); Assert.Null(a.ActorId); });
        Assert.DoesNotContain(history.Items, a => a.Action is "proposal_submitted" or "plan_approved" or "verified");
        var notification = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<IncidentNotificationView>>($"{Base}/notifications"))!;
        Assert.Contains(notification.Items, n => n.IncidentId == incident && n.Event == "resolved" && n.DeliveryState == "Pending");
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope(); var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(AssetStatus.Active, (await finalDb.Set<Asset>().SingleAsync(a => a.Id == w.Asset)).Status);
        Assert.Single(await finalDb.Set<MaintenanceHistory>().Where(h => h.WorkOrderId == work).ToArrayAsync());
        var maintenance = (await w.Owner.Client.GetFromJsonAsync<IncidentPage<MaintenanceHistoryView>>($"{Orders}/maintenance-history?locationId={w.Location}"))!;
        Assert.Contains(maintenance.Items, h => h.WorkOrderId == work && h.Action == "verified" && h.ActualCost == 100000);
        Assert.Contains(maintenance.Items, h => h.WorkOrderId == other && h.Action == "work_order_cancelled");
        Assert.Single(await finalDb.SecurityAudit.Where(a => a.Event == "Incident_verified" && finalDb.Set<IncidentActivity>().Any(h => h.Id == a.TargetId && h.IncidentId == incident)).ToArrayAsync());
    }

    [Fact]
    public async Task TenantIsolationFilesAndHistoricalAccessAreCheckedServerSide()
    {
        var w = await Setup(); var stranger = await User(Roles.Tenant); var incident = await Create(w);
        var photo = await Upload(w.Tenant, incident, IncidentEvidenceKind.Report);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"{Base}/{incident}")).StatusCode);
        using var imageRequest = new HttpRequestMessage(HttpMethod.Get, $"{Base}/{incident}/evidence/{photo}"); imageRequest.Headers.Accept.ParseAdd("image/png");
        var denied = await stranger.Client.SendAsync(imageRequest); Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        Assert.Equal("application/problem+json", denied.Content.Headers.ContentType!.MediaType);
        Assert.DoesNotContain("objectKey", await w.Tenant.Client.GetStringAsync($"{Base}/{incident}/evidence"));
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync(Orders)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync($"{Base}/{incident}/expenses")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Staff, $"{Base}/{incident}/review", new IncidentReview(1, "x", "x"))).StatusCode);
        var otherRoom = Guid.NewGuid(); Assert.Equal(HttpStatusCode.NotFound, (await Submit(w.Tenant, w, room: otherRoom)).StatusCode);
        var page = (await stranger.Client.GetFromJsonAsync<IncidentPage<IncidentView>>($"{Base}?locationId={w.Location}"))!;
        Assert.Equal(0, page.TotalCount); Assert.Empty(page.Items);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            await db.Set<Contract>().Where(c => c.Id == w.Contract).ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, ContractStatus.Terminated));
        }
        Assert.Equal(HttpStatusCode.OK, (await w.Tenant.Client.GetAsync($"{Base}/{incident}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Submit(w.Tenant, w)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await UploadResponse(w.Tenant, incident, IncidentEvidenceKind.Report, null, Image())).StatusCode);
    }

    [Fact]
    public async Task ReplacementStaffNeedsOwnerReassignmentAndOldStaffCannotReplay()
    {
        var w = await Setup(); var key = Guid.NewGuid();
        var incident = (await Ok<IncidentCommandResult>(await Submit(w.Staff, w, key: key))).IncidentId;
        await Review(w, incident); var work = await Assign(w, incident); var next = await User(Roles.Staff);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            await db.StaffLocationAssignments.Where(a => a.LocationId == w.Location).ExecuteUpdateAsync(s => s.SetProperty(a => a.EndDate, Today.AddDays(-1)));
            db.Add(new StaffLocationAssignment(w.Location, next.Id, w.Owner.Id, Today, Today.AddDays(10))); await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await Submit(w.Staff, w, key: key)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Staff.Client.GetAsync($"{Orders}/{work}")).StatusCode);
        var view = (await Work(next, work))!; Assert.Null(view.EstimatedCost);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(next, $"{Orders}/{work}/proposal", new RepairProposal(view.Version, "Inspection", "Solution", 10, 0, []))).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{work}/reassign", new WorkOrderReassign(view.Version, next.Id, "Responsibility changed")));
        var updated = w with { Staff = next }; await ProposeAndStart(updated, work);
        var history = (await w.Owner.Client.GetFromJsonAsync<IncidentPage<IncidentActivityView>>($"{Base}/{incident}/history?pageSize=100"))!;
        Assert.Contains(history.Items, h => h.Action == "reassigned" && h.DataJson!.Contains(w.Staff.Id.ToString()));
        var staffHistory = (await next.Client.GetFromJsonAsync<IncidentPage<IncidentActivityView>>($"{Base}/{incident}/history?pageSize=100"))!;
        Assert.All(staffHistory.Items, h => Assert.Null(h.DataJson));
    }

    [Fact]
    public async Task EmergencyPersistsNotificationsAndCostMustBeConfirmedExactlyOnce()
    {
        var w = await Setup(); var incident = await Create(w, emergency: true);
        Assert.False((await Report(w.Owner, incident))!.EscalationEnabled);
        var notifications = (await w.Staff.Client.GetFromJsonAsync<IncidentPage<IncidentNotificationView>>($"{Base}/notifications"))!;
        Assert.Contains(notifications.Items, n => n.IncidentId == incident && n.HighPriority);
        var report = (await Report(w.Staff, incident))!;
        var ackInput = new WorkOrderAction(report.Version);
        var ack = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Send(w.Staff, $"{Base}/{incident}/acknowledge", ackInput)));
        Assert.Single(ack, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(ack, r => r.StatusCode == HttpStatusCode.Conflict);
        var receipt = await Upload(w.Staff, incident, IncidentEvidenceKind.EmergencyAction);
        report = (await Report(w.Staff, incident))!;
        var entry = await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Base}/{incident}/emergency-actions", new EmergencyEntry(report.Version, "Synthetic containment", [receipt], 50000)));
        await Review(w, incident); report = (await Report(w.Owner, incident))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Base}/{incident}/resolve", new IncidentDecision(report.Version, "Safe now"))).StatusCode);
        var cost = new EmergencyCostDecision(report.Version, true, "Receipt checked"); var costKey = Guid.NewGuid();
        foreach (var response in await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Send(w.Owner, $"{Base}/{incident}/emergency-actions/{entry.ResourceId}/cost-decision", cost, costKey))))
            await Ok<IncidentCommandResult>(response);
        var expenses = (await w.Owner.Client.GetFromJsonAsync<ExpenseView[]>($"{Base}/{incident}/expenses"))!;
        Assert.Equal(50000m, Assert.Single(expenses).Amount);
        report = (await Report(w.Owner, incident))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Base}/{incident}/resolve", new IncidentDecision(report.Version, "Containment sufficient, no repair required")));
        var auto = await Create(w, w.Staff, true); Assert.NotNull((await Report(w.Owner, auto))!.AcknowledgedAt);
    }

    [Fact]
    public async Task DirectCompletionRequiresPhotoAndExplicitCostAndDoesNotDuplicateExpenses()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident);
        var report = (await Report(w.Owner, incident))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Base}/{incident}/direct-completion", new DirectCompletion(report.Version, 10000, "Fixed", [], "Fixed"))).StatusCode);
        var image = await Upload(w.Owner, incident, IncidentEvidenceKind.Direct); report = (await Report(w.Owner, incident))!;
        var input = new DirectCompletion(report.Version, 10000, "Synthetic direct fix", [image], "Fixed"); var key = Guid.NewGuid();
        foreach (var response in await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Send(w.Owner, $"{Base}/{incident}/direct-completion", input, key))))
            await Ok<IncidentCommandResult>(response);
        Assert.Equal("Resolved", (await Report(w.Owner, incident))!.Status);
        Assert.Single((await w.Owner.Client.GetFromJsonAsync<ExpenseView[]>($"{Base}/{incident}/expenses"))!);
        var noCost = await Create(w); await Review(w, noCost); var zeroImage = await Upload(w.Owner, noCost, IncidentEvidenceKind.Direct);
        report = (await Report(w.Owner, noCost))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Base}/{noCost}/direct-completion", new DirectCompletion(report.Version, 0, "No cost repair", [zeroImage], "Fixed")));
        Assert.Empty((await w.Owner.Client.GetFromJsonAsync<ExpenseView[]>($"{Base}/{noCost}/expenses"))!);
    }

    [Fact]
    public async Task CancelledOnlyWorkDoesNotAutoResolveAndAssetTracksOtherIncidents()
    {
        var w = await Setup(); var first = await Create(w); await Review(w, first); var work = await Assign(w, first); await ProposeAndStart(w, work);
        var second = await Create(w); await Review(w, second); var secondWork = await Assign(w, second);
        var secondState = (await Work(w.Owner, secondWork))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{secondWork}/cancel", new IncidentDecision(secondState.Version, "Owner cancelled", AssetStatus: AssetStatus.Active, AssetCondition: "Still other repair")));
        Assert.Equal("InProgress", (await Report(w.Owner, second))!.Status);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            Assert.Equal(AssetStatus.UnderRepair, (await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Set<Asset>().SingleAsync(a => a.Id == w.Asset)).Status);
        var report = (await Report(w.Owner, second))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Base}/{second}/resolve", new IncidentDecision(report.Version, "Handled by original incident")));
        await Complete(w, first, work); await Ok<IncidentCommandResult>(await Verify(w, work));
        await using var final = fixture.Factory.Services.CreateAsyncScope();
        Assert.Equal(AssetStatus.Active, (await final.ServiceProvider.GetRequiredService<BHomeDbContext>().Set<Asset>().SingleAsync(a => a.Id == w.Asset)).Status);
    }

    [Fact]
    public async Task FailedUploadRollsBackBusinessRowsAndDurableStagingCleansOrphan()
    {
        var w = await Setup(); fixture.Storage.FailWrites = true;
        try { Assert.Equal(HttpStatusCode.InternalServerError, (await Submit(w.Tenant, w, photo: Image())).StatusCode); }
        finally { fixture.Storage.FailWrites = false; }
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.False(await db.Set<IncidentReport>().AnyAsync(r => r.LocationId == w.Location));
        var upload = Assert.Single(await db.Set<IncidentFileUpload>().Where(u => u.LocationId == w.Location).ToArrayAsync());
        Assert.True(fixture.Storage.Objects.ContainsKey(upload.ObjectKey));
        await IncidentFileCleanup.CleanupAsync(db, fixture.Storage, DateTimeOffset.UtcNow.AddHours(2), default);
        Assert.False(fixture.Storage.Objects.ContainsKey(upload.ObjectKey));
        var incident = await Create(w); var photo = await Upload(w.Tenant, incident, IncidentEvidenceKind.Report);
        await IncidentFileCleanup.CleanupAsync(db, fixture.Storage, DateTimeOffset.UtcNow.AddHours(2), default);
        Assert.Equal(HttpStatusCode.OK, (await w.Tenant.Client.GetAsync($"{Base}/{incident}/evidence/{photo}")).StatusCode);
    }

    [Fact]
    public async Task StaleCompetingVerificationAndCancellationHaveOneWinner()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident); var work = await Assign(w, incident);
        await ProposeAndStart(w, work); await Complete(w, incident, work); var state = (await Work(w.Owner, work))!;
        var responses = await Task.WhenAll(
            Send(w.Owner, $"{Orders}/{work}/verify", new MaintenanceVerification(state.Version, 100000, "Verified", null, "Fixed")),
            Send(w.Owner, $"{Orders}/{work}/cancel", new IncidentDecision(state.Version, "Cancelled", AssetStatus: AssetStatus.NeedsRepair, AssetCondition: "Pending repair")));
        Assert.Single(responses, r => r.IsSuccessStatusCode); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        var final = (await Work(w.Owner, work))!;
        var expenses = (await w.Owner.Client.GetFromJsonAsync<ExpenseView[]>($"{Base}/{incident}/expenses"))!;
        Assert.Equal(final.Status == "Verified" ? 1 : 0, expenses.Length);
    }

    [Fact]
    public async Task InputScopeLimitsClassificationCancellationAndDuplicatesRejectInvalidPaths()
    {
        var w = await Setup(); var key = Guid.NewGuid();
        var created = await Ok<IncidentCommandResult>(await Submit(w.Tenant, w, key: key));
        Assert.Equal(created, await Ok<IncidentCommandResult>(await Submit(w.Tenant, w, key: key)));
        Assert.Equal(HttpStatusCode.Conflict, (await Submit(w.Tenant, w, key: key, description: "Different description")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Submit(w.Tenant, w, description: "short")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Submit(w.Tenant, w, photo: [1, 2, 3])).StatusCode);
        var report = (await Report(w.Owner, created.IncidentId))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Base}/{report.Id}/work-orders", new WorkOrderAssign(report.Version, w.Staff.Id, "Do work", DateTimeOffset.UtcNow.AddDays(1)))).StatusCode);
        await Review(w, report.Id); report = (await Report(w.Tenant, report.Id))!;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Tenant, $"{Base}/{report.Id}/cancel", new IncidentDecision(report.Version, "Changed mind"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Base}/{report.Id}/duplicate", new IncidentDecision(report.Version, "Duplicate", report.Id))).StatusCode);
        var duplicate = await Create(w); var dupState = (await Report(w.Owner, duplicate))!;
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Base}/{duplicate}/duplicate", new IncidentDecision(dupState.Version, "Same issue", report.Id)));
        var foreign = await Setup(); Assert.Equal(HttpStatusCode.NotFound, (await Submit(w.Staff, w, asset: foreign.Asset)).StatusCode);
        var beforeReview = await Create(w); var before = (await Report(w.Tenant, beforeReview))!;
        await Ok<IncidentCommandResult>(await Send(w.Tenant, $"{Base}/{beforeReview}/cancel", new IncidentDecision(before.Version, "No longer needed")));
        Assert.Equal("Cancelled", (await Report(w.Tenant, beforeReview))!.Status);
        var limited = await Create(w);
        for (var i = 0; i < 5; i++) await Upload(w.Tenant, limited, IncidentEvidenceKind.Report);
        Assert.Equal(HttpStatusCode.Conflict, (await UploadResponse(w.Tenant, limited, IncidentEvidenceKind.Report, null, Image())).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await UploadResponse(w.Tenant, limited, IncidentEvidenceKind.Report, null, new byte[5_000_001])).StatusCode);
    }

    [Fact]
    public async Task DatabaseGuardsHistoryAndDowngradeAndRejectsInvalidWorkState()
    {
        var w = await Setup(); var incident = await Create(w);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await using var connection = new NpgsqlConnection(fixture.ConnectionString); await connection.OpenAsync();
        await using (var command = new NpgsqlCommand("UPDATE \"IncidentActivities\" SET \"Note\" = 'tampered' WHERE \"IncidentId\" = @id", connection))
        { command.Parameters.AddWithValue("id", incident); Assert.Equal("23514", (await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync())).SqlState); }
        var history = await db.Set<IncidentActivity>().FirstAsync(a => a.IncidentId == incident); history.Note = "tampered";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync()); db.ChangeTracker.Clear();
        var order = new MaintenanceWorkOrder
        {
            IncidentId = incident,
            LocationId = w.Location,
            RoomId = w.Room,
            AssignedStaffId = w.Staff.Id,
            Status = WorkOrderStatus.InProgress,
            ExpectedOutcome = "Invalid unapproved",
            TargetCompletionAt = DateTimeOffset.UtcNow
        };
        db.Add(order); var invalid = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23514", Assert.IsType<PostgresException>(invalid.InnerException).SqlState); db.ChangeTracker.Clear();
        var migrations = db.Database.GetMigrations().ToArray(); var previous = migrations[^2];
        await Assert.ThrowsAsync<PostgresException>(() => db.GetService<IMigrator>().MigrateAsync(previous));
        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Equal(migrations, (await db.Database.GetAppliedMigrationsAsync()).ToArray());
    }

    [Fact]
    public async Task NotificationFailureLeavesCommittedIncidentAndDeliveryCanReplayWithoutDoubleSend()
    {
        var w = await Setup(); var incident = await Create(w, emergency: true); Guid notification;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            notification = await db.Set<IncidentNotification>().Where(n => n.IncidentId == incident && n.RecipientId == w.Owner.Id).Select(n => n.Id).SingleAsync();
            var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "incident.notification");
            await Assert.ThrowsAsync<IntegrationUnavailableException>(() => handler.ExecuteAsync(new(Guid.NewGuid(), notification.ToString("N"), JsonSerializer.Serialize(new { NotificationId = notification })), default));
        }
        Assert.Equal("Submitted", (await Report(w.Tenant, incident))!.Status);
        var delivery = new RecordingProvider();
        using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<INotificationProvider>(); s.AddSingleton<INotificationProvider>(delivery); }));
        async Task Deliver()
        {
            await using var scope = host.Services.CreateAsyncScope(); var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "incident.notification");
            await handler.ExecuteAsync(new(Guid.NewGuid(), notification.ToString("N"), JsonSerializer.Serialize(new { NotificationId = notification })), default);
        }
        await Task.WhenAll(Deliver(), Deliver(), Deliver()); Assert.Equal(1, delivery.Count);
        var notifications = (await w.Owner.Client.GetFromJsonAsync<IncidentPage<IncidentNotificationView>>($"{Base}/notifications?pageSize=100"))!;
        Assert.Equal("Delivered", Assert.Single(notifications.Items, n => n.Id == notification).DeliveryState);
    }
    private sealed class RecordingProvider : INotificationProvider
    {
        private int count; public int Count => count;
        public Task<string> DeliverAsync(NotificationDelivery delivery, CancellationToken cancellationToken)
        { Interlocked.Increment(ref count); Assert.DoesNotContain("cost", delivery.Parameters.Keys); return Task.FromResult("synthetic-reference"); }
    }

    [Fact]
    public async Task MultiRoleTenantCannotUseUnassignedStaffRoleToReadInternalWorkOrEvidence()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident); var work = await Assign(w, incident);
        var internalPhoto = await Upload(w.Staff, incident, IncidentEvidenceKind.Inspection, work);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var tenant = (await users.FindByIdAsync(w.Tenant.Id.ToString()))!;
            Assert.True((await users.AddToRoleAsync(tenant, Roles.Staff)).Succeeded);
        }
        var loginResponse = await w.Tenant.Client.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Tenant.Id.ToString("N") + "@example.invalid", password = Password });
        var login = await Ok<LoginResult>(loginResponse); w.Tenant.Client.DefaultRequestHeaders.Authorization = new("Bearer", login.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await w.Tenant.Client.GetAsync($"{Base}/{incident}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Tenant.Client.GetAsync($"{Orders}/{work}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Tenant.Client.GetAsync($"{Base}/{incident}/emergency-actions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Tenant.Client.GetAsync($"{Base}/{incident}/evidence/{internalPhoto}")).StatusCode);
        var history = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<IncidentActivityView>>($"{Base}/{incident}/history"))!;
        Assert.All(history.Items, h => { Assert.Null(h.DataJson); Assert.Null(h.ActorId); });
        var listing = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<WorkOrderView>>($"{Orders}?locationId={w.Location}"))!;
        Assert.Equal(0, listing.TotalCount); Assert.Empty(listing.Items);
        var maintenance = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<MaintenanceHistoryView>>($"{Orders}/maintenance-history?locationId={w.Location}"))!;
        Assert.Equal(0, maintenance.TotalCount); Assert.Empty(maintenance.Items);
        var ownReport = await Ok<IncidentCommandResult>(await Submit(w.Tenant, w));
        Assert.Equal("Submitted", (await Report(w.Tenant, ownReport.IncidentId))!.Status);
    }

    [Fact]
    public async Task ReportingLookupsExposeOnlyAssignedOrActiveTenancyRoomsAndAllowedAssets()
    {
        var w = await Setup(); var foreign = await Setup(); Guid otherRoomId; Guid commonAssetId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var other = new Room { LocationId = w.Location, RoomNumber = "SYNTHETIC-OTHER" };
            var privateAsset = new Asset { LocationId = w.Location, RoomId = other.Id, Name = "Other Tenant asset", Category = "Synthetic", Condition = "Synthetic" };
            var common = new Asset { LocationId = w.Location, CommonArea = "Synthetic corridor", Name = "Common light", Category = "Synthetic", Condition = "Synthetic" };
            db.AddRange(other, privateAsset, common); await db.SaveChangesAsync(); otherRoomId = other.Id; commonAssetId = common.Id;
        }
        var rooms = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<IncidentReportingRoom>>($"{Base}/reporting-rooms?locationId={w.Location}"))!;
        Assert.Equal(w.Room, Assert.Single(rooms.Items).RoomId); Assert.Equal(1, rooms.TotalCount);
        var staffRooms = (await w.Staff.Client.GetFromJsonAsync<IncidentPage<IncidentReportingRoom>>($"{Base}/reporting-rooms?locationId={w.Location}"))!;
        Assert.Equal(2, staffRooms.TotalCount);
        var assets = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<IncidentReportingAsset>>($"{Base}/reporting-assets?locationId={w.Location}"))!;
        Assert.Equal(2, assets.TotalCount); Assert.Contains(assets.Items, a => a.AssetId == w.Asset); Assert.Contains(assets.Items, a => a.AssetId == commonAssetId);
        var hidden = (await w.Tenant.Client.GetFromJsonAsync<IncidentPage<IncidentReportingAsset>>($"{Base}/reporting-assets?roomId={otherRoomId}"))!;
        Assert.Equal(0, hidden.TotalCount);
        var foreignRooms = (await w.Staff.Client.GetFromJsonAsync<IncidentPage<IncidentReportingRoom>>($"{Base}/reporting-rooms?locationId={foreign.Location}"))!;
        Assert.Equal(0, foreignRooms.TotalCount);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Owner.Client.GetAsync($"{Base}/reporting-assets")).StatusCode);
        var report = await Create(w); await Review(w, report); var order = await Assign(w, report);
        var linked = (await w.Owner.Client.GetFromJsonAsync<IncidentPage<WorkOrderView>>($"{Orders}?incidentId={report}"))!;
        Assert.Equal(order, Assert.Single(linked.Items).Id);
    }

    [Fact]
    public async Task ProposalRevisionInvalidatesApprovalAndEvidenceCannotBeTakenFromAnotherWorkOrder()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident); var work = await Assign(w, incident);
        var second = await Assign(w, incident); var state = (await Work(w.Staff, work))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{work}/proposal", new RepairProposal(state.Version, "Inspection", "Solution", 30, 100000, [])));
        state = (await Work(w.Owner, work))!;
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Orders}/{work}/plan-decision", new { version = state.Version, reason = "Missing decision" })).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{work}/plan-decision", new PlanDecision(state.Version, true)));
        state = (await Work(w.Staff, work))!;
        await Ok<IncidentCommandResult>(await Send(w.Staff, $"{Orders}/{work}/proposal", new RepairProposal(state.Version, "Revised inspection", "Revised solution", 40, 100000, [])));
        state = (await Work(w.Staff, work))!; Assert.False(state.PlanApproved);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Orders}/{work}/start", new WorkOrderAction(state.Version))).StatusCode);
        await Ok<IncidentCommandResult>(await Send(w.Owner, $"{Orders}/{work}/plan-decision", new PlanDecision(state.Version, false, "Revise again")));
        Assert.Equal("Assigned", (await Work(w.Staff, work))!.Status);
        await ProposeAndStart(w, work); await ProposeAndStart(w, second);
        var foreign = await Upload(w.Staff, incident, IncidentEvidenceKind.Completion, second);
        state = (await Work(w.Staff, work))!;
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Staff, $"{Orders}/{work}/submit", new WorkOrderAction(state.Version, "Completed", [foreign]))).StatusCode);
        await Complete(w, incident, work); state = (await Work(w.Owner, work))!;
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Orders}/{work}/verify", new { version = state.Version, result = "Missing amount", assetCondition = "Fixed" })).StatusCode);
        foreach (var cost in new[] { -1m, 0.5m })
            Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Orders}/{work}/verify", new MaintenanceVerification(state.Version, cost, "Invalid amount", "Variance", "Fixed"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, $"{Orders}/{work}/verify", new MaintenanceVerification(state.Version, 200000, "Different amount", null, "Fixed"))).StatusCode);
        await Ok<IncidentCommandResult>(await Verify(w, work, cost: 200000));
    }

    [Fact]
    public async Task PropertyApiCannotOverrideAssetWhileWorkIsAssigned()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident); await Assign(w, incident);
        var asset = (await w.Owner.Client.GetFromJsonAsync<BHome.Application.PropertyManagement.AssetDto>($"/api/v1/assets/{w.Asset}"))!;
        var input = new BHome.Application.PropertyManagement.AssetWrite(w.Location, w.Room, null, null, asset.Name, asset.Category,
            "Bypassed", AssetStatus.Active, asset.Version, "Attempted manual change");
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PutAsJsonAsync($"/api/v1/assets/{w.Asset}", input)).StatusCode);
    }

    [Fact]
    public async Task CommonAreaUsesActiveResidenceAndMissingStaffRemainsVisibleToOwner()
    {
        var w = await Setup(false);
        async Task<HttpResponseMessage> CommonArea()
        {
            using var content = new MultipartFormDataContent();
            content.Add(new StringContent(w.Location.ToString()), "locationId"); content.Add(new StringContent("Synthetic corridor"), "commonArea");
            content.Add(new StringContent("Normal"), "severity"); content.Add(new StringContent("Synthetic common area issue"), "description");
            using var request = new HttpRequestMessage(HttpMethod.Post, Base) { Content = content };
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); return await w.Tenant.Client.SendAsync(request);
        }
        var created = await Ok<IncidentCommandResult>(await CommonArea()); var report = (await Report(w.Owner, created.IncidentId))!;
        Assert.Null(report.RoomId); Assert.False(report.StaffAvailable); await Review(w, report.Id);
        report = (await Report(w.Owner, report.Id))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Base}/{report.Id}/work-orders", new WorkOrderAssign(report.Version, w.Staff.Id, "Expected", DateTimeOffset.UtcNow.AddDays(1)))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await db.Set<ContractResident>().Where(r => r.ContractId == w.Contract).ExecuteUpdateAsync(s => s.SetProperty(r => r.ResidenceFrom, Today.AddDays(1)));
        Assert.Equal(HttpStatusCode.NotFound, (await CommonArea()).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await UploadResponse(w.Tenant, report.Id, IncidentEvidenceKind.Report, null, Image())).StatusCode);
    }

    [Fact]
    public async Task ConcurrentAddingWorkAndFinalVerificationNeverCloseWithOpenWork()
    {
        var w = await Setup(); var incident = await Create(w); await Review(w, incident); var work = await Assign(w, incident);
        await ProposeAndStart(w, work); await Complete(w, incident, work);
        var state = (await Work(w.Owner, work))!; var report = (await Report(w.Owner, incident))!;
        var results = await Task.WhenAll(
            Send(w.Owner, $"{Orders}/{work}/verify", new MaintenanceVerification(state.Version, 100000, "Verified", null, "Fixed")),
            Send(w.Owner, $"{Base}/{incident}/work-orders", new WorkOrderAssign(report.Version, w.Staff.Id, "Additional work", DateTimeOffset.UtcNow.AddDays(1))));
        Assert.True(results[0].IsSuccessStatusCode);
        Assert.True(results[1].IsSuccessStatusCode || results[1].StatusCode == HttpStatusCode.Conflict);
        report = (await Report(w.Owner, incident))!;
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var open = await db.Set<MaintenanceWorkOrder>().AnyAsync(w => w.IncidentId == incident && w.Status != WorkOrderStatus.Verified && w.Status != WorkOrderStatus.Cancelled);
        Assert.Equal(open ? "InProgress" : "Resolved", report.Status);
    }

    [Fact]
    public async Task EmptyIncidentMigrationCanDowngradeAndUpgradeWithoutChangingExistingRooms()
    {
        var isolated = new IncidentFixture();
        try
        {
            await isolated.InitializeAsync();
            await using var scope = isolated.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var chain = await db.Set<Chain>().Select(c => c.Id).SingleAsync();
            var location = new Location("Synthetic migration location") { ChainId = chain };
            var room = new Room { LocationId = location.Id, RoomNumber = "MIGRATION-ONLY" }; db.AddRange(location, room); await db.SaveChangesAsync();
            var migrations = db.Database.GetMigrations().ToArray(); await db.GetService<IMigrator>().MigrateAsync(migrations[^2]);
            Assert.True(await db.Set<Room>().AnyAsync(r => r.Id == room.Id));
            await db.Database.MigrateAsync(); Assert.True(await db.Set<Room>().AnyAsync(r => r.Id == room.Id));
            Assert.Empty(await db.Database.GetPendingMigrationsAsync()); Assert.False(db.Database.HasPendingModelChanges());
        }
        finally { await isolated.DisposeAsync(); }
    }

    [Fact]
    public async Task ExpiredStaffDoesNotReceiveQueuedDeliveryAndSwaggerDescribesMultipartAndBinaryBodies()
    {
        var w = await Setup(); var incident = await Create(w, w.Staff, true); Guid notification;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            Assert.True((await users.AddToRoleAsync((await users.FindByIdAsync(w.Staff.Id.ToString()))!, Roles.Tenant)).Succeeded);
            notification = await db.Set<IncidentNotification>().Where(n => n.IncidentId == incident && n.RecipientId == w.Staff.Id).Select(n => n.Id).SingleAsync();
            await db.StaffLocationAssignments.Where(a => a.LocationId == w.Location).ExecuteUpdateAsync(s => s.SetProperty(a => a.EndDate, Today.AddDays(-1)));
            var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "incident.notification");
            await handler.ExecuteAsync(new(Guid.NewGuid(), notification.ToString("N"), JsonSerializer.Serialize(new { NotificationId = notification })), default);
            Assert.Equal("Suppressed", (await db.Set<IncidentNotification>().SingleAsync(n => n.Id == notification)).DeliveryState);
        }
        using var development = fixture.Factory.WithWebHostBuilder(b => b.UseEnvironment("Development"));
        using var client = development.CreateClient();
        using var swagger = JsonDocument.Parse(await client.GetStringAsync("/swagger/v1/swagger.json"));
        var paths = swagger.RootElement.GetProperty("paths"); var submit = paths.GetProperty(Base).GetProperty("post");
        Assert.True(submit.GetProperty("requestBody").GetProperty("content").TryGetProperty("multipart/form-data", out _));
        Assert.True(submit.GetProperty("responses").TryGetProperty("201", out _));
        Assert.Contains(submit.GetProperty("parameters").EnumerateArray(), p => p.GetProperty("name").GetString() == "Idempotency-Key" && p.GetProperty("required").GetBoolean());
        var upload = paths.GetProperty(Base + "/{id}/evidence").GetProperty("put");
        Assert.Equal("binary", upload.GetProperty("requestBody").GetProperty("content").GetProperty("image/png").GetProperty("schema").GetProperty("format").GetString());
    }
}
