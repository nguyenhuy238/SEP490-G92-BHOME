using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Common;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.Notifications;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Modules.Billing;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private async Task<(Workspace W, BillingAutomationPlan Plan, Guid[] Meters)> MeterWorkspace(bool withStaff = true, bool water = true)
    {
        var w = await Setup(); using var owner = await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules", Calendar(w))).EnsureSuccessStatusCode();
        var response = await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with { MeterDay = 1, MeterDueDay = 10 }); response.EnsureSuccessStatusCode(); var plan = (await response.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        if (withStaff) db.Add(new StaffLocationAssignment(w.Location, w.Staff, w.Owner, CurrentPeriod().AddYears(-1), CurrentPeriod().AddYears(1)));
        var meters = (water ? new[] { UtilityType.Electricity, UtilityType.Water } : new[] { UtilityType.Electricity }).Select(type => new Meter { RoomId = w.Room, Code = "SYN-JOB-" + type, UtilityType = type, InstalledOn = CurrentPeriod().AddMonths(-1) }).ToArray(); db.AddRange(meters); await db.SaveChangesAsync(); return (w, plan, meters.Select(m => m.Id).ToArray());
    }
    private async Task<BillingAutomationExecution?> RunMeter(Workspace w)
    {
        using var owner = await Client(w.Owner); var r = await owner.PostAsJsonAsync("/api/v1/billing-automation/run-now", new BillingRunInput(w.Location, CurrentPeriod(), "Meter")); r.EnsureSuccessStatusCode(); return r.StatusCode == HttpStatusCode.NoContent ? null : await r.Content.ReadFromJsonAsync<BillingAutomationExecution>();
    }
    private async Task<ConfirmedReading> ConfirmSyntheticTask(Workspace w, Guid taskId, decimal value)
    {
        using var staff = await Client(w.Staff); using var image = new Mat(120, 300, MatType.CV_8UC3, Scalar.White); Cv2.PutText(image, "SYNTHETIC JOB READING", new(5, 60), HersheyFonts.HersheySimplex, .5, Scalar.Black, 1);
        using var content = new ByteArrayContent(image.ImEncode(".png")); content.Headers.ContentType = new("image/png"); var upload = await staff.PutAsync($"/api/v1/capture/meter-tasks/{taskId}/evidence", content); upload.EnsureSuccessStatusCode(); var evidence = (await upload.Content.ReadFromJsonAsync<IdResult>())!;
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{taskId}/confirm", new MeterConfirmation(false, value, evidence.Id))).StatusCode);
        var confirmed = await staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{taskId}/confirm", new MeterConfirmation(true, value, evidence.Id)); confirmed.EnsureSuccessStatusCode(); return (await confirmed.Content.ReadFromJsonAsync<ConfirmedReading>())!;
    }
    [Fact]
    public async Task MeterTaskFiltersApplyBeforeLimitAndKeepStaffScope()
    {
        var (w, p, _) = await MeterWorkspace(); await RunMeter(w); using var staff = await Client(w.Staff); using var owner = await Client(w.Owner);
        var day = CurrentPeriod().AddDays(9);
        var path = $"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={w.Room}&dueDate={day:yyyy-MM-dd}&status=0";
        var tasks = (await staff.GetFromJsonAsync<MeterTaskSummary[]>(path))!; Assert.Equal(2, tasks.Length); Assert.All(tasks, x => Assert.Equal(p.Id, x.AutomationPlanId));
        Assert.Empty((await staff.GetFromJsonAsync<MeterTaskSummary[]>(path.Replace("status=0", "status=2")))!);
        Assert.Empty((await staff.GetFromJsonAsync<MeterTaskSummary[]>(path.Replace(w.Location.ToString(), Guid.NewGuid().ToString())))!);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/v1/capture/meter-tasks?page=0")).StatusCode);
    }
    internal async Task MeterListSurvivesMonthChangeWithLegacyTasksWithoutDeadline()
    {
        var (w, p, meters) = await MeterWorkspace();
        using var owner = await Client(w.Owner);
        var manual = await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(meters[0], ReadingPurpose.Periodic, CurrentPeriod(), CurrentPeriod()));
        manual.EnsureSuccessStatusCode();
        var manualId = (await manual.Content.ReadFromJsonAsync<IdResult>())!.Id;
        await RunMeter(w);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<BHomePersistenceContext>();
        var clock = new DemoBusinessClock(TimeProvider.System);
        var next = CurrentPeriod().AddMonths(1);
        Assert.NotNull(clock.ChangeTime(new DateTimeOffset(next.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)), 0));
        var repository = ActivatorUtilities.CreateInstance<BHome.Infrastructure.Ocr.CaptureRepository>(services,
            new BHome.Infrastructure.Ocr.CaptureScope(db, new User(w.Staff, BHome.Domain.IdentityAccess.Roles.Staff), clock), clock);
        var tasks = await repository.TasksAsync(default, new MeterTaskQuery { LocationId = w.Location });
        var old = Assert.Single(tasks, task => task.Id == manualId);
        Assert.Null(old.DueAt);
        Assert.False(old.IsOverdue);
        Assert.True(Assert.Single(tasks, task => task.AutomationPlanId == p.Id).IsOverdue);
        Assert.False((await repository.TaskAsync(manualId, default)).IsOverdue);
    }
    [Fact]
    public async Task MeterJobAndManualRequestsShareRoomTypePeriodKeyAndHumanConfirmation()
    {
        var (w, p, meters) = await MeterWorkspace();
        async Task Handler() { await using var s = fixture.Factory.Services.CreateAsyncScope(); await s.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "billing-meter").ExecuteAsync(new(Guid.NewGuid(), "synthetic", System.Text.Json.JsonSerializer.Serialize(new BillingJobInput(p.Id, CurrentPeriod()))), default); }
        await Task.WhenAll(Handler(), Handler()); var result = (await RunMeter(w))!; Assert.Equal("Completed", result.Status); Assert.Equal(2, result.CreatedCount);
        using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); var tasks = (await staff.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!.Where(t => t.AutomationPlanId == p.Id).ToArray(); Assert.Equal(2, tasks.Length);
        Assert.All(tasks, t => { Assert.Equal(w.Staff, t.AssignedStaffUserId); Assert.Equal(w.Room, t.RoomId); Assert.Equal(w.Location, t.LocationId); Assert.Equal(TimeSpan.Zero, t.DueAt!.Value.Offset); Assert.Equal(16, t.DueAt.Value.Hour); });
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(meters[0], ReadingPurpose.Periodic, CurrentPeriod(), CurrentPeriod()))).StatusCode);
        var foreign = await Setup(); using var foreignStaff = await Client(foreign.Staff); Assert.Equal(HttpStatusCode.NotFound, (await foreignStaff.GetAsync($"/api/v1/capture/meter-tasks/{tasks[0].Id}")).StatusCode);
        foreach (var task in tasks)
        {
            var initial = await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(task.MeterId, ReadingPurpose.Initial, CurrentPeriod().AddDays(-1), null)); initial.EnsureSuccessStatusCode();
            await ConfirmSyntheticTask(w, (await initial.Content.ReadFromJsonAsync<IdResult>())!.Id, 100);
            var reading = await ConfirmSyntheticTask(w, task.Id, 110); Assert.Equal(10, reading.Consumption);
        }
        await RunMeter(w); await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); Assert.Equal(2, await db.Set<OperationalTask>().CountAsync(t => t.AutomationPlanId == p.Id)); Assert.Equal(2, await db.Set<MeterReading>().CountAsync(r => tasks.Select(t => t.Id).Contains(r.TaskId)));
    }
    [Fact]
    public async Task MeterJobPreservesUnassignedWorkAndReportsMissingMetersUntilOwnerAssigns()
    {
        var (w, p, _) = await MeterWorkspace(false, false); var result = (await RunMeter(w))!; Assert.Equal("PendingInputs", result.Status); Assert.Contains("staff_assignment_required", result.ExceptionsJson); Assert.Contains("active_meter_configuration_required", result.ExceptionsJson);
        Guid taskId; await using (var s = fixture.Factory.Services.CreateAsyncScope()) { var db = s.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var task = await db.Set<OperationalTask>().SingleAsync(t => t.AutomationPlanId == p.Id); Assert.Null(task.AssignedStaffUserId); taskId = task.Id; db.Add(new StaffLocationAssignment(w.Location, w.Staff, w.Owner, CurrentPeriod().AddYears(-1), CurrentPeriod().AddYears(1))); await db.SaveChangesAsync(); }
        using var staff = await Client(w.Staff); using var owner = await Client(w.Owner); Assert.Equal(HttpStatusCode.NotFound, (await staff.GetAsync($"/api/v1/capture/meter-tasks/{taskId}")).StatusCode);
        (await owner.PostAsJsonAsync($"/api/v1/billing-automation/meter-tasks/{taskId}/assignment", new MeterAssignmentInput(w.Staff, 1))).EnsureSuccessStatusCode(); Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync($"/api/v1/capture/meter-tasks/{taskId}")).StatusCode);
        var repeated = (await RunMeter(w))!; Assert.Equal(1, repeated.CreatedCount); Assert.DoesNotContain("staff_assignment_required", repeated.ExceptionsJson);
    }
    [Fact]
    public async Task MeterJobIncludesVacantRoomsAndReportsMissingMetersWithoutDuplicating()
    {
        var (w, p, _) = await MeterWorkspace();
        Guid vacantId, incompleteId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var vacant = new Room { LocationId = w.Location, RoomNumber = "SYN-VACANT", Capacity = 2, Status = RoomStatus.Available };
            var incomplete = new Room { LocationId = w.Location, RoomNumber = "SYN-MISSING-METER", Capacity = 2, Status = RoomStatus.Available };
            vacantId = vacant.Id; incompleteId = incomplete.Id;
            db.AddRange(vacant, incomplete);
            db.AddRange(new Meter { RoomId = vacantId, Code = "SYN-VACANT-E", UtilityType = UtilityType.Electricity, InstalledOn = CurrentPeriod().AddMonths(-1) },
                new Meter { RoomId = vacantId, Code = "SYN-VACANT-W", UtilityType = UtilityType.Water, InstalledOn = CurrentPeriod().AddMonths(-1) },
                new Meter { RoomId = incompleteId, Code = "SYN-MISSING-W", UtilityType = UtilityType.Water, InstalledOn = CurrentPeriod().AddMonths(-1) });
            await db.SaveChangesAsync();
        }
        var result = (await RunMeter(w))!;
        Assert.Equal("PendingInputs", result.Status); Assert.Equal(5, result.CreatedCount);
        Assert.Contains("active_meter_configuration_required", result.ExceptionsJson); Assert.Contains(incompleteId.ToString(), result.ExceptionsJson);
        await RunMeter(w);
        await using var check = fixture.Factory.Services.CreateAsyncScope();
        var tasks = await check.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Set<OperationalTask>().Where(t => t.AutomationPlanId == p.Id).ToArrayAsync();
        Assert.Equal(5, tasks.Length); Assert.Equal(2, tasks.Count(t => t.BillingRoomId == vacantId)); Assert.Single(tasks, t => t.BillingRoomId == incompleteId);
        Assert.All(tasks, t => Assert.Equal(w.Staff, t.AssignedStaffUserId));
    }
    internal async Task PeriodicMeterOverdueNoticesUseBusinessTimeAndDistinctRooms()
    {
        var (w, p, _) = await MeterWorkspace();
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var vacant = new Room { LocationId = w.Location, RoomNumber = "SYN-VACANT", Capacity = 2, Status = RoomStatus.Available };
        db.Add(vacant);
        db.AddRange(new Meter { RoomId = vacant.Id, Code = "SYN-VACANT-E", UtilityType = UtilityType.Electricity, InstalledOn = CurrentPeriod().AddMonths(-1) },
            new Meter { RoomId = vacant.Id, Code = "SYN-VACANT-W", UtilityType = UtilityType.Water, InstalledOn = CurrentPeriod().AddMonths(-1) });
        await db.SaveChangesAsync();
        await RunMeter(w);
        var tasks = await db.Set<OperationalTask>().AsNoTracking().Where(t => t.AutomationPlanId == p.Id).ToArrayAsync();
        Assert.Equal(4, tasks.Length);
        var due = tasks.First().DueAt!.Value;
        var clock = new DemoBusinessClock(TimeProvider.System);
        var notifier = new BillingMeterOverdueNotifier(db, clock, scope.ServiceProvider.GetRequiredService<CompactNotificationWriter>());
        var notices = db.Set<UserNotification>().AsNoTracking().Where(n => n.LocationId == w.Location && n.EventType == "PERIODIC_METER_OVERDUE");
        Assert.NotNull(clock.ChangeTime(due.AddMinutes(-5), 0));
        await notifier.NotifyAsync(default);
        Assert.Empty(await notices.ToArrayAsync());
        Assert.NotNull(clock.ChangeTime(due.AddMinutes(5), 1));
        await notifier.NotifyAsync(default); await notifier.NotifyAsync(default);
        var rows = await notices.ToArrayAsync();
        var staff = Assert.Single(rows, n => n.RecipientUserId == w.Staff);
        var owner = Assert.Single(rows, n => n.RecipientUserId == w.Owner);
        Assert.Contains("2 phòng", staff.Summary); Assert.Contains("SYN-VACANT", staff.Summary);
        Assert.Contains("Nhân viên:", owner.Summary); Assert.Contains("2 phòng", owner.Summary);
        Assert.Contains("EMAIL", staff.Channels); Assert.Contains("IN_APP", staff.Channels);
        Assert.Equal(new[] { "IN_APP" }, owner.Channels);
        Assert.DoesNotContain(rows, n => w.Tenants.Contains(n.RecipientUserId));
        using var staffClient = await Client(w.Staff);
        var target = (await staffClient.GetFromJsonAsync<NotificationTarget>($"/api/v1/notifications/{staff.Id}/target"))!;
        Assert.Equal("MeterPeriod", target.ObjectType);
        Assert.Equal(w.Location, target.LocationId);
        Assert.Equal(CurrentPeriod(), target.BillingPeriod);
        using var tenantClient = await Client(w.Tenants[0]);
        Assert.Equal(HttpStatusCode.NotFound, (await tenantClient.GetAsync($"/api/v1/notifications/{staff.Id}/target")).StatusCode);
    }
    internal async Task PeriodicSchedulerQueuesWorkOnBusinessDateWithoutDemoOptIn()
    {
        var (w, p, _) = await MeterWorkspace();
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<BHomePersistenceContext>();
        var clock = new DemoBusinessClock(TimeProvider.System);
        var scheduler = new BillingAutomationScheduling(db, services.GetRequiredService<IBillingAutomationSchedules>(),
            services.GetRequiredService<IBackgroundJobQueue>(), clock, new BillingAutomationRuntime(false, true),
            new BillingMeterOverdueNotifier(db, clock));
        var start = new DateTimeOffset(CurrentPeriod().ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7));
        Assert.NotNull(clock.ChangeTime(start.AddMinutes(-1), 0));
        await scheduler.EnqueueDueAsync(default);
        var engine = services.GetRequiredService<IBillingAutomationEngine>();
        Assert.Empty(await engine.QueueAsync(w.Location, CurrentPeriod(), default));
        Assert.NotNull(clock.ChangeTime(start.AddMinutes(1), 1));
        await scheduler.EnqueueDueAsync(default);
        var queued = Assert.Single(await engine.QueueAsync(w.Location, CurrentPeriod(), default), j => j.Name == "billing-meter");
        Assert.Equal("Pending", queued.State);
        var lease = Guid.NewGuid();
        var persistence = services.GetRequiredService<BHome.Infrastructure.Jobs.IJobPersistence>();
        var job = await persistence.ClaimAsync(["billing-meter"], DateTimeOffset.UtcNow, lease, 4, default);
        Assert.NotNull(job);
        await new BillingAutomationJobHandler("billing-meter", "Meter", engine).ExecuteAsync(new(job.Id, job.IdempotencyKey, job.PayloadJson), default);
        await persistence.CompleteAsync(job.Id, lease, default);
        await scheduler.EnqueueDueAsync(default);
        Assert.Equal(2, await db.Set<OperationalTask>().CountAsync(t => t.AutomationPlanId == p.Id));
        Assert.Single(await engine.QueueAsync(w.Location, CurrentPeriod(), default), j => j.Name == "billing-meter");
    }
    [Fact]
    public async Task MeterReplacementDoesNotDuplicatePeriodTasksAndFutureScheduleDoesNotRunEarly()
    {
        var (w, p, meters) = await MeterWorkspace(); await RunMeter(w);
        Guid replacement; await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        { var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); (await db.Set<Meter>().SingleAsync(m => m.Id == meters[0])).IsActive = false; await db.SaveChangesAsync(); var meter = new Meter { RoomId = w.Room, Code = "SYN-REPLACEMENT", UtilityType = UtilityType.Electricity, InstalledOn = CurrentPeriod() }; db.Add(meter); await db.SaveChangesAsync(); replacement = meter.Id; }
        var result = (await RunMeter(w))!; Assert.Contains("meter_replacement_review_required", result.ExceptionsJson); Assert.Equal(2, result.CreatedCount);
        using var owner = await Client(w.Owner); Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new MeterTaskInput(replacement, ReadingPurpose.Periodic, CurrentPeriod(), CurrentPeriod()))).StatusCode);
        var next = await owner.PutAsJsonAsync("/api/v1/billing-automation", Plan(w) with { ExpectedVersion = 1, EffectiveFrom = CurrentPeriod().AddMonths(1) }); next.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsJsonAsync("/api/v1/billing-automation/run-now", new BillingRunInput(w.Location, CurrentPeriod().AddMonths(1), "Meter"))).StatusCode);
    }
    [Fact]
    public async Task ManualInitialAndPeriodicMeterButtonsCannotCreateDuplicatesOnConcurrentClicks()
    {
        var (w, _, meters) = await MeterWorkspace(water: false);
        using var first = await Client(w.Owner); using var second = await Client(w.Owner);
        foreach (var purpose in new[] { ReadingPurpose.Initial, ReadingPurpose.Periodic })
        {
            var input = new MeterTaskInput(meters[0], purpose, CurrentPeriod(),
                purpose == ReadingPurpose.Periodic ? CurrentPeriod() : null);
            var calls = await Task.WhenAll(
                first.PostAsJsonAsync("/api/v1/capture/meter-tasks", input),
                second.PostAsJsonAsync("/api/v1/capture/meter-tasks", input));
            Assert.Single(calls, response => response.StatusCode == HttpStatusCode.OK);
            Assert.Single(calls, response => response.StatusCode == HttpStatusCode.Conflict);
        }
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(task => task.MeterId == meters[0] && task.Purpose == ReadingPurpose.Initial));
        Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(task => task.MeterId == meters[0] && task.Purpose == ReadingPurpose.Periodic && task.BillingPeriod == CurrentPeriod()));
    }
}
