using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.StaffOperations;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Modules.StaffOperations;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Ocr;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.IntegrationTests.StaffOperations;

[Trait("Category", "Docker")]
public sealed class OperationalTaskApiTests(CaptureFixture fixture) : IClassFixture<CaptureFixture>
{
    private const string Base = "/api/v1/operational-tasks";
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private sealed record Actor(HttpClient Client, Guid Id);
    private sealed record Workspace(Actor Owner, Actor Staff, Actor Tenant, Guid Location);
    private async Task<Actor> User(string role)
    {
        var name = Guid.NewGuid().ToString("N") + "@example.invalid";
        using var owner = fixture.Factory.CreateClient();
        var id = Guid.NewGuid();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<ApplicationUser>>();
            var user = new ApplicationUser { Id = id, UserName = name, Email = name, LockoutEnabled = true };
            Assert.True((await users.CreateAsync(user, "Synthetic-Task!539")).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        }
        var client = fixture.Factory.CreateClient();
        var login = await Success<LoginResult>(await client.PostAsJsonAsync("/api/v1/auth/login", new { email = name, password = "Synthetic-Task!539" }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return new(client, id);
    }
    private async Task<Workspace> Setup(bool assigned = true)
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff); var tenant = await User(Roles.Tenant);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var chainId = await db.Set<BHome.Domain.PropertyManagement.Chain>().Select(x => x.Id).SingleAsync();
        var location = new Location("Synthetic Task Location") { ChainId = chainId }; db.Add(location);
        if (assigned) db.Add(new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddDays(-10), Today.AddDays(10)));
        await db.SaveChangesAsync(); return new(owner, staff, tenant, location.Id);
    }
    private static TaskCreate Input(Workspace w, bool evidence = true) => new(w.Location,
        new("Synthetic task", "Synthetic work requirements", OperationalTaskPriority.High, DateTimeOffset.UtcNow.AddDays(2), evidence));
    private static async Task<HttpResponseMessage> Send(Actor actor, string path, object input, Guid? key = null, HttpMethod? method = null)
    {
        using var request = new HttpRequestMessage(method ?? HttpMethod.Post, path) { Content = JsonContent.Create(input) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await actor.Client.SendAsync(request);
    }
    private static async Task<T> Success<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static async Task<TaskView> Action(Actor actor, TaskView task, string action, string? note = null, Guid[]? evidence = null) =>
        await Success<TaskView>(await Send(actor, $"{Base}/{task.Id}/{action}", new TaskAction(task.Version, note, evidence)));
    private static byte[] Image()
    {
        using var mat = new Mat(12, 12, MatType.CV_8UC3, Scalar.White);
        Cv2.ImEncode(".png", mat, out var bytes); return bytes;
    }
    private static async Task<HttpResponseMessage> Upload(Actor actor, Guid task, byte[] bytes, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"{Base}/{task}/evidence") { Content = new ByteArrayContent(bytes) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await actor.Client.SendAsync(request);
    }

    [Fact]
    public async Task CompleteWorkflowPersistsPrivateEvidenceNotificationsReworkAndOwnerVerification()
    {
        var w = await Setup(); var task = await Success<TaskView>(await Send(w.Owner, Base, Input(w)));
        Assert.Equal("Assigned", task.Status); Assert.Equal(w.Staff.Id, task.CurrentResponsibleStaffUserId);
        var notification = await w.Staff.Client.GetFromJsonAsync<TaskPage<TaskNotificationView>>($"{Base}/notifications");
        var item = Assert.Single(notification!.Items, n => n.TaskId == task.Id);
        Assert.Equal(HttpStatusCode.NoContent, (await w.Staff.Client.PostAsync($"{Base}/notifications/{item.Id}/read", null)).StatusCode);
        task = await Action(w.Staff, task, "start");
        task = await Action(w.Staff, task, "blockers", "Synthetic blocker");
        task = await Action(w.Owner, task, "coordinate", "Synthetic coordination");
        task = await Action(w.Staff, task, "progress", "Synthetic progress");
        var missing = await Send(w.Staff, $"{Base}/{task.Id}/submit", new TaskAction(task.Version, "done"));
        Assert.Equal(HttpStatusCode.Conflict, missing.StatusCode);
        var key = Guid.NewGuid(); var bytes = Image();
        var uploads = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Upload(w.Staff, task.Id, bytes, key)));
        var images = new List<TaskEvidenceView>(); foreach (var response in uploads) images.Add(await Success<TaskEvidenceView>(response));
        Assert.Single(images.Select(x => x.Id).Distinct());
        var evidence = images[0]; task = (await w.Staff.Client.GetFromJsonAsync<TaskView>($"{Base}/{task.Id}"))!;
        var download = await w.Owner.Client.GetAsync($"{Base}/{task.Id}/evidence/{evidence.Id}");
        Assert.Equal(bytes, await download.Content.ReadAsByteArrayAsync());
        Assert.Equal("image/png", download.Content.Headers.ContentType!.MediaType);
        task = await Action(w.Staff, task, "submit", "Synthetic result", [evidence.Id]);
        Assert.Equal("PendingVerification", task.Status); Assert.Null(task.VerifiedAt);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Staff, $"{Base}/{task.Id}/verify", new TaskAction(task.Version))).StatusCode);
        task = await Action(w.Owner, task, "rework", "Synthetic rework reason");
        Assert.Equal("InProgress", task.Status);
        task = await Action(w.Staff, task, "submit", "Synthetic corrected result", [evidence.Id]);
        task = await Action(w.Owner, task, "verify");
        Assert.Equal("Completed", task.Status); Assert.Equal(w.Owner.Id, task.VerifiedByUserId);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, $"{Base}/{task.Id}/cancel", new TaskAction(task.Version, "late cancel"))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Single(await db.Set<OperationalTaskEvidence>().Where(x => x.TaskId == task.Id).ToArrayAsync());
        Assert.Equal(1, await db.SecurityAudit.CountAsync(x => x.TargetId == task.Id && x.Event == "Task_verify"));
        var history = await db.Set<OperationalTaskHistory>().Where(x => x.TaskId == task.Id).ToArrayAsync();
        Assert.Contains(history, h => h.Action == "rework" && h.Note == "Synthetic rework reason");
        Assert.Equal(1, await db.Set<OperationalTaskCommand>().CountAsync(x => x.TaskId == task.Id && x.Key == key));
        await TaskEvidenceCleanup.CleanupAsync(db, scope.ServiceProvider.GetRequiredService<IObjectStorage>(), DateTimeOffset.UtcNow.AddHours(2), default);
        Assert.Equal(bytes, await w.Owner.Client.GetByteArrayAsync($"{Base}/{task.Id}/evidence/{evidence.Id}"));
    }

    [Fact]
    public async Task DuplicateCreatesAndCompetingUpdatesAreTransactionalAndVersioned()
    {
        var w = await Setup(); var key = Guid.NewGuid(); var input = Input(w, false);
        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Send(w.Owner, Base, input, key)));
        var created = new List<TaskView>(); foreach (var response in responses) created.Add(await Success<TaskView>(response));
        var task = created[0]; Assert.Single(created.Select(x => x.Id).Distinct());
        Assert.All(created, x => Assert.Equal(task, x));
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Owner, Base, input with { Work = input.Work with { Title = "different" } }, key)).StatusCode);
        var update = new TaskUpdate(task.Version, input.Work with { Title = "updated" }, "Synthetic change");
        var writes = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Send(w.Owner, $"{Base}/{task.Id}", update, method: HttpMethod.Put)));
        Assert.Single(writes, x => x.StatusCode == HttpStatusCode.OK); Assert.Single(writes, x => x.StatusCode == HttpStatusCode.Conflict);
        task = (await w.Owner.Client.GetFromJsonAsync<TaskView>($"{Base}/{task.Id}"))!;
        var unchanged = await Action(w.Owner, task, "assign"); Assert.Equal(task.Version, unchanged.Version);
        var page = await w.Owner.Client.GetFromJsonAsync<TaskPage<TaskView>>($"{Base}?locationId={w.Location}&pageSize=1&priority=High");
        Assert.Equal(1, page!.TotalCount); Assert.Single(page.Items);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(x => x.LocationId == w.Location));
        Assert.Equal(1, await db.Set<OperationalTaskHistory>().CountAsync(x => x.TaskId == task.Id && x.Action == "created"));
        Assert.Equal(1, await db.Set<OperationalTaskHistory>().CountAsync(x => x.TaskId == task.Id && x.Action == "updated"));
        var history = await db.Set<OperationalTaskHistory>().FirstAsync(x => x.TaskId == task.Id);
        history.Note = "illegal rewrite";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ScopeIsRecheckedWithOldTokensAndSuccessorContinuesLocationWork()
    {
        var w = await Setup(); var task = await Success<TaskView>(await Send(w.Owner, Base, Input(w)));
        var stranger = await User(Roles.Staff); var next = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.Factory.CreateClient().GetAsync($"{Base}/{task.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync($"{Base}/{task.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"{Base}/{task.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(w.Staff, Base, Input(w))).StatusCode);
        task = await Action(w.Staff, task, "start");
        var evidence = await Success<TaskEvidenceView>(await Upload(w.Staff, task.Id, Image()));
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"{Base}/{task.Id}/evidence/{evidence.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"{Base}/{task.Id}/history")).StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var assignment = await db.StaffLocationAssignments.SingleAsync(x => x.LocationId == w.Location);
            db.Entry(assignment).Property(x => x.EndDate).CurrentValue = Today.AddDays(-1);
            await db.SaveChangesAsync();
            db.Add(new StaffLocationAssignment(w.Location, next.Id, w.Owner.Id, Today, Today.AddDays(5)));
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await w.Staff.Client.GetAsync($"{Base}/{task.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Staff.Client.GetAsync($"{Base}/{task.Id}/evidence/{evidence.Id}")).StatusCode);
        task = (await next.Client.GetFromJsonAsync<TaskView>($"{Base}/{task.Id}"))!;
        Assert.Equal(next.Id, task.CurrentResponsibleStaffUserId); Assert.Equal(w.Staff.Id, task.RecordedStaffUserId);
        task = await Action(next, task, "progress", "Synthetic successor progress");
        Assert.Equal(next.Id, task.RecordedStaffUserId);
        var history = (await next.Client.GetFromJsonAsync<TaskPage<TaskHistoryView>>($"{Base}/{task.Id}/history"))!;
        Assert.Contains(history.Items, x => x.Action == "responsibility_changed" && x.ResponsibleStaffUserId == next.Id);
        Assert.Contains(history.Items, x => x.Action == "start" && x.ActorId == w.Staff.Id);
    }

    [Fact]
    public async Task InvalidInputMissingStaffAndFailedUploadLeaveNoBusinessRowsAndCleanupIsDurable()
    {
        var unassigned = await Setup(false);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(unassigned.Owner, Base, Input(unassigned))).StatusCode);
        var w = await Setup();
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, Base, Input(w) with { Work = Input(w).Work with { DueAt = DateTimeOffset.UtcNow.AddDays(-1) } })).StatusCode);
        var malformed = new { locationId = w.Location, work = new { title = "x", requirements = "x", priority = "Normal", dueAt = "2026-10-31T10:00:00", evidenceRequired = true } };
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, Base, malformed)).StatusCode);
        var forged = new { locationId = w.Location, work = Input(w).Work, status = "Completed", assignedStaffUserId = Guid.NewGuid() };
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(w.Owner, Base, forged)).StatusCode);
        var task = await Success<TaskView>(await Send(w.Owner, Base, Input(w)));
        task = await Action(w.Staff, task, "start");
        Assert.Equal(HttpStatusCode.BadRequest, (await Upload(w.Staff, task.Id, [1, 2, 3])).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var inner = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var failing = new FailingStorage(inner);
        using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IObjectStorage>(failing)));
        using var client = host.CreateClient();
        var email = await db.Users.Where(x => x.Id == w.Staff.Id).Select(x => x.Email).SingleAsync();
        var session = await Success<LoginResult>(await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "Synthetic-Task!539" }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var failed = await Upload(new(client, w.Staff.Id), task.Id, Image());
        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.False(await db.Set<OperationalTaskEvidence>().AnyAsync(x => x.TaskId == task.Id));
        var intent = await db.Set<OperationalTaskFileUpload>().SingleAsync(x => x.TaskId == task.Id);
        Assert.Equal(task.Version, (await db.Set<OperationalTask>().SingleAsync(x => x.Id == task.Id)).Version);
        await TaskEvidenceCleanup.CleanupAsync(db, inner, DateTimeOffset.UtcNow.AddHours(2), default);
        Assert.False(await db.Set<OperationalTaskFileUpload>().AnyAsync(x => x.Id == intent.Id));
        Assert.Equal(HttpStatusCode.Conflict, (await Send(w.Staff, $"{Base}/{task.Id}/submit", new TaskAction(task.Version, "done"))).StatusCode);
    }
    [Fact]
    public async Task OverduePendingReviewPreservesStateAndCompetingOwnerDecisionsHaveOneWinner()
    {
        var w = await Setup(); var task = await Success<TaskView>(await Send(w.Owner, Base, Input(w, false)));
        task = await Action(w.Staff, task, "start");
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var row = await db.Set<OperationalTask>().SingleAsync(x => x.Id == task.Id);
            row.DueAt = DateTimeOffset.UtcNow.AddDays(-1); await db.SaveChangesAsync();
        }
        task = await Action(w.Staff, task, "submit", "Synthetic result without required photos");
        Assert.Equal("PendingVerification", task.Status); Assert.True(task.IsOverdue);
        var overdue = (await w.Owner.Client.GetFromJsonAsync<TaskPage<TaskView>>($"{Base}?locationId={w.Location}&isOverdue=true&status=PendingVerification"))!;
        Assert.Equal(task.Id, Assert.Single(overdue.Items).Id);
        var decisions = await Task.WhenAll(Send(w.Owner, $"{Base}/{task.Id}/verify", new TaskAction(task.Version)),
            Send(w.Owner, $"{Base}/{task.Id}/cancel", new TaskAction(task.Version, "Synthetic cancellation")));
        Assert.Single(decisions, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(decisions, r => r.StatusCode == HttpStatusCode.Conflict);
        task = (await w.Owner.Client.GetFromJsonAsync<TaskView>($"{Base}/{task.Id}"))!;
        Assert.False(task.IsOverdue);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope();
        var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Single(await finalDb.Set<OperationalTaskHistory>().Where(x => x.TaskId == task.Id && (x.Action == "verify" || x.Action == "cancel")).ToArrayAsync());
        var decision = await finalDb.Set<OperationalTaskHistory>().SingleAsync(x => x.TaskId == task.Id && (x.Action == "verify" || x.Action == "cancel"));
        Assert.True(decision.WasOverdue);
    }

    private sealed class FailingStorage(IObjectStorage inner) : IObjectStorage
    {
        public async Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken t)
        { await inner.PutAsync(key, content, length, contentType, t); throw new IOException("synthetic partial storage failure"); }
        public Task CopyToAsync(string key, Stream destination, CancellationToken t) => inner.CopyToAsync(key, destination, t);
        public Task DeleteAsync(string key, CancellationToken t) => inner.DeleteAsync(key, t);
    }
}
