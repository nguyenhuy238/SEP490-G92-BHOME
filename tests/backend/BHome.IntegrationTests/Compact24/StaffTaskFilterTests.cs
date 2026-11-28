using System.Net;
using System.Net.Http.Json;
using BHome.Application.Operations;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task StaffHomeListsOnlyTheTwoNewestActionableTasksInSelectedLocation()
    {
        var selected = await Seed();
        var other = await Seed();
        using var staff = await Client(selected.Staff);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var now = DateTimeOffset.UtcNow;

        async Task<Guid> AddTask(Guid location, MeterTaskStatus status, int dueInHours)
        {
            var task = new OperationalTask
            {
                RequiredLocationId = location,
                Kind = OperationalTaskKind.AdHoc,
                TaskTitle = "Synthetic priority task",
                MeterStatus = status,
                DueAt = now.AddHours(dueInHours)
            };
            db.Add(task);
            await db.SaveChangesAsync();
            return task.Id;
        }

        await AddTask(selected.Location, MeterTaskStatus.Assigned, -2);
        var second = await AddTask(selected.Location, MeterTaskStatus.InProgress, -1);
        var newest = await AddTask(selected.Location, MeterTaskStatus.Assigned, 1);
        await AddTask(selected.Location, MeterTaskStatus.PendingVerification, 2);
        await AddTask(other.Location, MeterTaskStatus.Assigned, 3);

        var page = await staff.GetFromJsonAsync<TaskPage<TaskView>>(
            $"/api/v1/operational-tasks?locationId={selected.Location}&latestActionable=true&pageSize=2");

        Assert.Equal(3, page!.TotalCount);
        Assert.Equal(new[] { newest, second }, page.Items.Select(task => task.Id));
    }

    [CompactPostgresFact]
    public async Task OwnerTaskTargetsPersistAndRejectAssetsOutsideSelectedPosition()
    {
        var first = await Seed();
        var other = await Seed();
        using var owner = await Client(first.Owner);
        using var staff = await Client(first.Staff);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var roomAsset = new Asset { LocationId = first.Location, RoomId = first.Room, Name = "Synthetic bed", Category = "Furniture", Condition = "Good" };
        var commonAsset = new Asset { LocationId = first.Location, CommonArea = "Synthetic hallway", Name = "Synthetic lamp", Category = "Equipment", Condition = "Good" };
        db.AddRange(roomAsset, commonAsset);
        await db.SaveChangesAsync();
        const string route = "/api/v1/operational-tasks";
        var work = new TaskWrite("Synthetic target", "Inspect", OperationalTaskPriority.Normal, DateTimeOffset.UtcNow.AddDays(1), false);
        async Task<HttpResponseMessage> Send(HttpMethod method, string path, object body)
        {
            using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            return await owner.SendAsync(request);
        }
        var areas = await owner.GetFromJsonAsync<string[]>($"{route}/targets/common-areas?locationId={first.Location}");
        Assert.Contains("Synthetic hallway", areas!);
        var assets = await owner.GetFromJsonAsync<TaskPage<TaskTargetOption>>($"{route}/targets/assets?locationId={first.Location}&roomId={first.Room}");
        Assert.Equal(roomAsset.Id, Assert.Single(assets!.Items).Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"{route}/targets/common-areas?locationId={first.Location}")).StatusCode);
        using var invalid = await Send(HttpMethod.Post, route, new TaskCreate(first.Location, work with { Target = new(other.Room, roomAsset.Id) }));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var invalidPosition = await Send(HttpMethod.Post, route, new TaskCreate(first.Location, work with { Target = new(first.Room, commonAsset.Id) }));
        Assert.Equal(HttpStatusCode.BadRequest, invalidPosition.StatusCode);
        using var created = await Send(HttpMethod.Post, route, new TaskCreate(first.Location, work with { Target = new(first.Room, roomAsset.Id) }));
        created.EnsureSuccessStatusCode();
        var task = (await created.Content.ReadFromJsonAsync<TaskView>())!;
        Assert.Equal(roomAsset.Id, task.Target!.AssetId);
        Assert.Equal(first.Staff.Id, task.CurrentResponsibleStaffUserId);
        var persisted = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == task.Id);
        Assert.Equal(roomAsset.Id, persisted.TargetAssetId);
        Assert.Equal(first.Room, persisted.TargetRoomId);
        var staffView = await staff.GetFromJsonAsync<TaskView>($"{route}/{task.Id}");
        Assert.Equal(task.Target, staffView!.Target);
        using var edited = await Send(HttpMethod.Put, $"{route}/{task.Id}", new TaskUpdate(task.Version, work, "Legacy client edit"));
        edited.EnsureSuccessStatusCode();
        task = (await edited.Content.ReadFromJsonAsync<TaskView>())!;
        Assert.Equal(roomAsset.Id, task.Target!.AssetId);
        using var relocated = await Send(HttpMethod.Put, $"{route}/{task.Id}", new TaskUpdate(task.Version, work with { Target = new(AssetId: commonAsset.Id, CommonArea: "Synthetic hallway") }, "Move inspection target"));
        relocated.EnsureSuccessStatusCode();
        task = (await relocated.Content.ReadFromJsonAsync<TaskView>())!;
        Assert.Equal(commonAsset.Id, task.Target!.AssetId);
        Assert.Equal("Synthetic hallway", task.Target.CommonArea);
        Assert.Null(task.Target.RoomId);
    }

    [CompactPostgresFact]
    public async Task OwnerTaskFiltersDistinguishRecordedAssigneeAndCurrentResponsibilityBeforePaging()
    {
        var first = await Seed();
        var successor = await Seed();
        using var owner = await Client(first.Owner);
        using var staff = await Client(first.Staff);
        using var tenant = await Client(first.Tenants[0]);
        var expiredLocation = Guid.NewGuid();
        var inactiveLocation = Guid.NewGuid();
        var wrongRoleLocation = Guid.NewGuid();
        var historicalTask = Guid.NewGuid();
        var currentTask = Guid.NewGuid();
        var expiredTask = Guid.NewGuid();
        var inactiveTask = Guid.NewGuid();
        var wrongRoleTask = Guid.NewGuid();
        var otherStaffTask = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO locations(id,name,address,is_active,staff_assignments) VALUES
            ({expiredLocation},'Synthetic expired','Synthetic address',true,jsonb_build_array(jsonb_build_object(
              'id',{Guid.NewGuid()},'staffUserId',{first.Staff.Id},'actorId',{first.Owner.Id},'recordedAt',{now},
              'startDate',{Today.AddDays(-2)},'endDate',{Today.AddDays(-1)}))),
            ({inactiveLocation},'Synthetic inactive','Synthetic address',false,jsonb_build_array(jsonb_build_object(
              'id',{Guid.NewGuid()},'staffUserId',{first.Staff.Id},'actorId',{first.Owner.Id},'recordedAt',{now},
              'startDate',{Today},'endDate',{Today}))),
            ({wrongRoleLocation},'Synthetic invalid role','Synthetic address',true,jsonb_build_array(jsonb_build_object(
              'id',{Guid.NewGuid()},'staffUserId',{first.Tenants[0].Id},'actorId',{first.Owner.Id},'recordedAt',{now},
              'startDate',{Today},'endDate',{Today})))
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,assigned_user_id,title,description,priority,status,due_at) VALUES
            ({historicalTask},'GENERAL',{successor.Location},{first.Staff.Id},'Historical task','Synthetic requirements','0','2',{now.AddHours(1)}),
            ({currentTask},'GENERAL',{first.Location},{first.Staff.Id},'Current task','Synthetic requirements','0','0',{now.AddHours(2)}),
            ({expiredTask},'GENERAL',{expiredLocation},{first.Staff.Id},'Expired responsibility','Synthetic requirements','0','0',{now.AddHours(3)}),
            ({inactiveTask},'GENERAL',{inactiveLocation},{first.Staff.Id},'Inactive location','Synthetic requirements','0','0',{now.AddHours(4)}),
            ({wrongRoleTask},'GENERAL',{wrongRoleLocation},{first.Staff.Id},'Wrong role','Synthetic requirements','0','0',{now.AddHours(5)}),
            ({otherStaffTask},'GENERAL',{successor.Location},{successor.Staff.Id},'Other staff','Synthetic requirements','0','0',{now.AddHours(6)})
            """);

        var route = "/api/v1/operational-tasks";
        var recorded = $"recordedStaffUserId={first.Staff.Id}";
        async Task<TaskPage<TaskView>> List(string query) =>
            (await owner.GetFromJsonAsync<TaskPage<TaskView>>($"{route}?{query}"))!;
        var all = await List(recorded);
        Assert.Equal(5, all.TotalCount);
        Assert.DoesNotContain(all.Items, t => t.Id == otherStaffTask);
        var available = await List(recorded + "&hasResponsibility=true&pageSize=1");
        Assert.Equal(2, available.TotalCount);
        var historical = Assert.Single(available.Items);
        Assert.Equal(historicalTask, historical.Id);
        Assert.Equal(first.Staff.Id, historical.RecordedStaffUserId);
        Assert.Equal(successor.Staff.Id, historical.CurrentResponsibleStaffUserId);
        Assert.True(historical.ResponsibilityAvailable);
        Assert.Equal(currentTask, Assert.Single((await List(recorded + "&hasResponsibility=true&pageSize=1&page=2")).Items).Id);

        var unavailable = await List(recorded + "&hasResponsibility=false");
        Assert.Equal(3, unavailable.TotalCount);
        Assert.Equal(new[] { expiredTask, inactiveTask, wrongRoleTask }, unavailable.Items.Select(t => t.Id));
        Assert.All(unavailable.Items, t =>
        {
            Assert.False(t.ResponsibilityAvailable);
            Assert.Null(t.CurrentResponsibleStaffUserId);
        });
        var combined = await List(recorded + $"&staffUserId={successor.Staff.Id}&hasResponsibility=true&status=Completed");
        Assert.Equal(historicalTask, Assert.Single(combined.Items).Id);
        Assert.Equal(0, (await List(recorded + $"&staffUserId={successor.Staff.Id}&hasResponsibility=false")).TotalCount);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync($"{route}?{recorded}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync($"{route}?hasResponsibility=false")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync($"{route}?hasResponsibility=true")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"{route}?{recorded}")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task RecurringTasksUseVietnamAssignmentDateAndDeduplicateSource()
    {
        var w = await Seed();
        var assignedLocation = Guid.NewGuid();
        var unassignedLocation = Guid.NewGuid();
        var oldAssignment = Guid.NewGuid();
        var newAssignment = Guid.NewGuid();
        // 00:00 in Vietnam is still the previous UTC day.
        var now = new DateTimeOffset(2035, 1, 1, 17, 0, 0, TimeSpan.Zero);
        var today = new DateOnly(2035, 1, 2);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var repository = scope.ServiceProvider.GetRequiredService<IOperationsRepository>();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO locations(id,name,address,staff_assignments) VALUES
            ({assignedLocation},'Synthetic recurring assigned','Synthetic address',jsonb_build_array(
              jsonb_build_object('id',{oldAssignment},'staffUserId',{w.Staff.Id},'actorId',{w.Owner.Id},'recordedAt',{now},
                'startDate',{today.AddDays(-1)},'endDate',{today.AddDays(-1)}),
              jsonb_build_object('id',{newAssignment},'staffUserId',{w.Staff.Id},'actorId',{w.Owner.Id},'recordedAt',{now},
                'startDate',{today},'endDate',{today}))),
            ({unassignedLocation},'Synthetic recurring unassigned','Synthetic address','[]')
            """);
        var input = new RecurringTaskTemplateWrite(assignedLocation, "Synthetic recurring", "Synthetic requirements",
            "Normal", false, 1, now, 24, true, ScheduleType: "Daily");
        var assigned = await repository.SaveTemplateAsync(w.Owner.Id, null, input, now, default);
        var unassigned = await repository.SaveTemplateAsync(w.Owner.Id, null, input with { LocationId = unassignedLocation }, now, default);
        await repository.GenerateDueRecurringTasksAsync(now, default);

        var assignedSource = $"recurring:{assigned.Id:N}:{now.UtcTicks}";
        var unassignedSource = $"recurring:{unassigned.Id:N}:{now.UtcTicks}";
        var assignedId = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM operational_tasks WHERE source_key={assignedSource}").SingleAsync();
        var unassignedId = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM operational_tasks WHERE source_key={unassignedSource}").SingleAsync();
        var task = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == assignedId);
        Assert.Equal(newAssignment, task.AssignmentId);
        Assert.Equal(w.Staff.Id, task.AssignedStaffUserId);
        var unresolved = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == unassignedId);
        Assert.Null(unresolved.AssignmentId);
        Assert.Null(unresolved.AssignedStaffUserId);

        // Explicitly replay the same scheduled occurrence; source-key uniqueness must suppress duplicates.
        var latest = Assert.Single(await repository.TemplatesAsync(assignedLocation, default));
        await repository.SaveTemplateAsync(w.Owner.Id, assigned.Id, input with { Version = latest.Version }, now, default);
        await repository.GenerateDueRecurringTasksAsync(now, default);
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM operational_tasks WHERE source_key={assignedSource}").SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications WHERE recipient_user_id={w.Staff.Id} AND related_entity_id={assignedId} AND notification_type='TASK_ASSIGNED'").SingleAsync());
    }
}
