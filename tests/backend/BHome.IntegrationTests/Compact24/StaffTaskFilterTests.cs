using System.Net;
using System.Net.Http.Json;
using BHome.Application.Operations;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
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
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
