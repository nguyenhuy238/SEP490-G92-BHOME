using System.Net;
using System.Net.Http.Json;
using BHome.Application.Operations;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task EmploymentPeriodsPreserveHistoryAndSerializeConcurrentRenewal()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        using var tenant = await Client(w.Tenants[0]);
        var first = new EmploymentWrite("PERIOD-1", "FullTime", Today.AddMonths(-1), null, "Monthly", 5000000m, "Active");
        var response = await owner.PostAsJsonAsync("/api/v1/staff",
            new StaffCreate($"{Guid.NewGuid():N}@example.invalid", "Synthetic employment staff", null, null, first));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = (await response.Content.ReadFromJsonAsync<StaffView>())!;
        var route = $"/api/v1/staff/{created.UserId}";
        var employmentRoute = route + "/employments";
        var next = first with { ContractNumber = "PERIOD-2", StartDate = Today.AddDays(1), BaseRate = 6000000m };
        var renewal = new EmploymentPeriodCreate(created.AccountVersion, next, "Renewal");
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(employmentRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PostAsJsonAsync(employmentRoute, renewal)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/v1/staff/{w.Tenants[0].Id}/employments")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(employmentRoute, renewal)).StatusCode);

        var closed = first with { EndDate = Today, Status = "Ended" };
        var close = new StaffUpdate(created.AccountVersion, created.Email, created.FullName, created.Phone, true, closed, "End period");
        var closedResponse = await owner.PutAsJsonAsync(route, close);
        closedResponse.EnsureSuccessStatusCode();
        var updated = (await closedResponse.Content.ReadFromJsonAsync<StaffView>())!;
        Assert.True(updated.IsActive);
        Assert.Equal(created.Employment!.Id, updated.Employment!.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(employmentRoute,
            renewal with { AccountVersion = updated.AccountVersion, Employment = next with { StartDate = Today } })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(employmentRoute, renewal)).StatusCode);

        var fresh = renewal with { AccountVersion = updated.AccountVersion };
        var concurrent = await Task.WhenAll(owner.PostAsJsonAsync(employmentRoute, fresh), owner.PostAsJsonAsync(employmentRoute, fresh));
        Assert.Single(concurrent, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Single(concurrent, r => r.StatusCode == HttpStatusCode.Conflict);
        var current = (await concurrent.Single(r => r.StatusCode == HttpStatusCode.Created).Content.ReadFromJsonAsync<StaffView>())!;
        Assert.True(current.IsActive);
        Assert.NotEqual(updated.AccountVersion, current.AccountVersion);
        Assert.NotEqual(created.Employment.Id, current.Employment!.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route, close)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route,
            close with { AccountVersion = current.AccountVersion, Employment = next with { StartDate = Today } })).StatusCode);

        var periods = (await owner.GetFromJsonAsync<EmploymentPeriodView[]>(employmentRoute))!;
        Assert.Equal(2, periods.Length);
        Assert.Equal(current.Employment.Id, periods[0].Id);
        Assert.Equal("Renewal", Assert.Single(periods[0].History).Reason);
        Assert.Equal(6000000m, periods[0].BaseRate);
        Assert.Equal(created.Employment.Id, periods[1].Id);
        Assert.Equal("Ended", periods[1].Status);
        Assert.Equal(2, periods[1].History.Count);
        var change = periods[1].History[1];
        Assert.Equal(w.Owner.Id, change.ActorId);
        Assert.Equal("End period", change.Reason);
        Assert.Equal(first, change.Before);
        Assert.Equal(closed, change.After);
    }

    [CompactPostgresFact]
    public async Task StaffResponsibilitiesShowCurrentAndFutureAssignmentsAndOpenWorkBeforeDeactivation()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        var route = $"/api/v1/staff/{w.Staff.Id}";
        var employment = new EmploymentWrite("STAFF", "FullTime", Today.AddMonths(-1), Today, "Monthly", 5000000m, "Ended");
        var account = (await owner.GetFromJsonAsync<StaffView>(route))!;
        var update = new StaffUpdate(account.AccountVersion, account.Email, "Synthetic staff", account.Phone, true, employment, "Record employment");
        var response = await owner.PutAsJsonAsync(route, update);
        response.EnsureSuccessStatusCode();
        account = (await response.Content.ReadFromJsonAsync<StaffView>())!;
        Assert.True(account.IsActive);

        var future = Guid.NewGuid();
        var openTask = Guid.NewGuid();
        var closedTask = Guid.NewGuid();
        var meter = Guid.NewGuid();
        var meterTask = Guid.NewGuid();
        var closedMeterTask = Guid.NewGuid();
        var incident = Guid.NewGuid();
        var workOrder = Guid.NewGuid();
        var verifiedWorkOrder = Guid.NewGuid();
        var moveOut = w.Contracts[0];
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO locations(id,name,address,staff_assignments)
            VALUES ({future},'Synthetic future','Synthetic address',jsonb_build_array(jsonb_build_object(
              'id',{Guid.NewGuid()},'staffUserId',{w.Staff.Id},'actorId',{w.Owner.Id},'recordedAt',{DateTimeOffset.UtcNow},
              'startDate',{Today.AddDays(2)},'endDate',{Today.AddDays(4)})))
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,assigned_user_id,title,status)
            VALUES ({openTask},'GENERAL',{w.Location},{w.Staff.Id},'Synthetic open task','4'),
                   ({closedTask},'GENERAL',{w.Location},{w.Staff.Id},'Synthetic closed task','2')
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO meters(id,room_id,utility_type,meter_code,display_type,decimal_places,installed_on,is_active)
            VALUES ({meter},{w.Room},0,'Synthetic meter',0,0,{Today},true)
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,room_id,assigned_user_id,meter_id,title,status)
            VALUES ({meterTask},'METER_READ',{w.Location},{w.Room},{w.Staff.Id},{meter},'Synthetic meter reading','1'),
                   ({closedMeterTask},'METER_READ',{w.Location},{w.Room},{w.Staff.Id},{meter},'Synthetic closed reading','3')
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO incident_reports(id,location_id,room_id,reporter_user_id,severity,summary,description,status,reported_at)
            VALUES ({incident},{w.Location},{w.Room},{w.Tenants[0].Id},'NORMAL','Synthetic incident','Synthetic description','InProgress',{DateTimeOffset.UtcNow})
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,room_id,assigned_user_id,incident_report_id,title,status)
            VALUES ({workOrder},'WORK_ORDER',{w.Location},{w.Room},{w.Staff.Id},{incident},'Synthetic work order','PendingVerification'),
                   ({verifiedWorkOrder},'WORK_ORDER',{w.Location},{w.Room},{w.Staff.Id},{incident},'Synthetic verified work order','Verified')
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET move_out=jsonb_build_object('current',jsonb_build_object('inspectionStaffId',{w.Staff.Id},'status',1))
            WHERE id={moveOut}
            """);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route + "/responsibilities")).StatusCode);
        var summary = (await owner.GetFromJsonAsync<StaffResponsibilitiesView>(route + "/responsibilities"))!;
        Assert.False(summary.CanDeactivate);
        Assert.Contains(summary.Assignments, a => a.LocationId == w.Location);
        Assert.Contains(summary.Assignments, a => a.LocationId == future && a.StartDate == Today.AddDays(2));
        Assert.Equal(3, summary.Tasks.Count);
        Assert.Contains(summary.Tasks, t => t.Id == openTask && t.TaskType == "GENERAL");
        Assert.Contains(summary.Tasks, t => t.Id == meterTask && t.TaskType == "METER_READ");
        Assert.Contains(summary.Tasks, t => t.Id == workOrder && t.TaskType == "WORK_ORDER");
        Assert.Equal(moveOut, Assert.Single(summary.MoveOuts).ContractId);
        var deactivate = update with { AccountVersion = account.AccountVersion, IsActive = false, Reason = "Offboarding" };
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route, deactivate)).StatusCode);

        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE locations SET staff_assignments='[]' WHERE id IN ({w.Location},{future})");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE operational_tasks SET status='2' WHERE id IN ({openTask},{meterTask})");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE operational_tasks SET status='Verified' WHERE id={workOrder}");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET move_out='{{}}' WHERE id={moveOut}");
        summary = (await owner.GetFromJsonAsync<StaffResponsibilitiesView>(route + "/responsibilities"))!;
        Assert.True(summary.CanDeactivate);
        Assert.Empty(summary.Assignments);
        Assert.Empty(summary.Tasks);
        Assert.Empty(summary.MoveOuts);
        (await owner.PutAsJsonAsync(route, deactivate)).EnsureSuccessStatusCode();
        Assert.False((await owner.GetFromJsonAsync<StaffView>(route))!.IsActive);
    }
}
