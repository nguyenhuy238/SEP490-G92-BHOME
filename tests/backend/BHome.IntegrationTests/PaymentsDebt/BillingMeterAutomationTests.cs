using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private async Task<(Workspace W,BillingAutomationPlan Plan,Guid[] Meters)> MeterWorkspace(bool withStaff=true,bool water=true)
    {
        var w=await Setup();using var owner=await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules",Calendar(w))).EnsureSuccessStatusCode();
        var response=await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w) with {MeterDay=1,MeterDueDay=10});response.EnsureSuccessStatusCode();var plan=(await response.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        if(withStaff)db.Add(new StaffLocationAssignment(w.Location,w.Staff,w.Owner,CurrentPeriod().AddYears(-1),CurrentPeriod().AddYears(1)));
        var meters=(water?new[]{UtilityType.Electricity,UtilityType.Water}:new[]{UtilityType.Electricity}).Select(type=>new Meter{RoomId=w.Room,Code="SYN-JOB-"+type,UtilityType=type,InstalledOn=CurrentPeriod().AddMonths(-1)}).ToArray();db.AddRange(meters);await db.SaveChangesAsync();return(w,plan,meters.Select(m=>m.Id).ToArray());
    }
    private async Task<BillingAutomationExecution?> RunMeter(Workspace w)
    {
        using var owner=await Client(w.Owner);var r=await owner.PostAsJsonAsync("/api/v1/billing-automation/run-now",new BillingRunInput(w.Location,CurrentPeriod(),"Meter"));r.EnsureSuccessStatusCode();return r.StatusCode==HttpStatusCode.NoContent?null:await r.Content.ReadFromJsonAsync<BillingAutomationExecution>();
    }
    private async Task<ConfirmedReading> ConfirmSyntheticTask(Workspace w,Guid taskId,decimal value)
    {
        using var staff=await Client(w.Staff);using var image=new Mat(120,300,MatType.CV_8UC3,Scalar.White);Cv2.PutText(image,"SYNTHETIC JOB READING",new(5,60),HersheyFonts.HersheySimplex,.5,Scalar.Black,1);
        using var content=new ByteArrayContent(image.ImEncode(".png"));content.Headers.ContentType=new("image/png");var upload=await staff.PutAsync($"/api/v1/capture/meter-tasks/{taskId}/evidence",content);upload.EnsureSuccessStatusCode();var evidence=(await upload.Content.ReadFromJsonAsync<IdResult>())!;
        Assert.Equal(HttpStatusCode.BadRequest,(await staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{taskId}/confirm",new MeterConfirmation(false,value,evidence.Id))).StatusCode);
        var confirmed=await staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{taskId}/confirm",new MeterConfirmation(true,value,evidence.Id));confirmed.EnsureSuccessStatusCode();return(await confirmed.Content.ReadFromJsonAsync<ConfirmedReading>())!;
    }
    [Fact]
    public async Task MeterTaskFiltersApplyBeforeLimitAndKeepStaffScope()
    {
        var(w,p,_)=await MeterWorkspace();await RunMeter(w);using var staff=await Client(w.Staff);using var owner=await Client(w.Owner);
        var day=CurrentPeriod().AddDays(9);
        var path=$"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={w.Room}&dueDate={day:yyyy-MM-dd}&status=0";
        var tasks=(await staff.GetFromJsonAsync<MeterTaskSummary[]>(path))!;Assert.Equal(2,tasks.Length);Assert.All(tasks,x=>Assert.Equal(p.Id,x.AutomationPlanId));
        Assert.Empty((await staff.GetFromJsonAsync<MeterTaskSummary[]>(path.Replace("status=0","status=2")))!);
        Assert.Empty((await staff.GetFromJsonAsync<MeterTaskSummary[]>(path.Replace(w.Location.ToString(),Guid.NewGuid().ToString())))!);
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.GetAsync("/api/v1/capture/meter-tasks?page=0")).StatusCode);
    }
    [Fact]
    public async Task MeterJobAndManualRequestsShareRoomTypePeriodKeyAndHumanConfirmation()
    {
        var(w,p,meters)=await MeterWorkspace();
        async Task Handler(){await using var s=fixture.Factory.Services.CreateAsyncScope();await s.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h=>h.Name=="billing-meter").ExecuteAsync(new(Guid.NewGuid(),"synthetic",System.Text.Json.JsonSerializer.Serialize(new BillingJobInput(p.Id,CurrentPeriod()))),default);}
        await Task.WhenAll(Handler(),Handler());var result=(await RunMeter(w))!;Assert.Equal("Completed",result.Status);Assert.Equal(2,result.CreatedCount);
        using var owner=await Client(w.Owner);using var staff=await Client(w.Staff);var tasks=(await staff.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!.Where(t=>t.AutomationPlanId==p.Id).ToArray();Assert.Equal(2,tasks.Length);
        Assert.All(tasks,t=>{Assert.Equal(w.Staff,t.AssignedStaffUserId);Assert.Equal(w.Room,t.RoomId);Assert.Equal(w.Location,t.LocationId);Assert.Equal(TimeSpan.Zero,t.DueAt!.Value.Offset);Assert.Equal(16,t.DueAt.Value.Hour);});
        Assert.Equal(HttpStatusCode.Conflict,(await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks",new MeterTaskInput(meters[0],ReadingPurpose.Periodic,CurrentPeriod(),CurrentPeriod()))).StatusCode);
        var foreign=await Setup();using var foreignStaff=await Client(foreign.Staff);Assert.Equal(HttpStatusCode.NotFound,(await foreignStaff.GetAsync($"/api/v1/capture/meter-tasks/{tasks[0].Id}")).StatusCode);
        foreach(var task in tasks)
        {
            var initial=await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks",new MeterTaskInput(task.MeterId,ReadingPurpose.Initial,CurrentPeriod().AddDays(-1),null));initial.EnsureSuccessStatusCode();
            await ConfirmSyntheticTask(w,(await initial.Content.ReadFromJsonAsync<IdResult>())!.Id,100);
            var reading=await ConfirmSyntheticTask(w,task.Id,110);Assert.Equal(10,reading.Consumption);
        }
        await RunMeter(w);await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();Assert.Equal(2,await db.Set<OperationalTask>().CountAsync(t=>t.AutomationPlanId==p.Id));Assert.Equal(2,await db.Set<MeterReading>().CountAsync(r=>tasks.Select(t=>t.Id).Contains(r.TaskId)));
    }
    [Fact]
    public async Task MeterJobPreservesUnassignedWorkAndReportsMissingMetersUntilOwnerAssigns()
    {
        var(w,p,_)=await MeterWorkspace(false,false);var result=(await RunMeter(w))!;Assert.Equal("PendingInputs",result.Status);Assert.Contains("staff_assignment_required",result.ExceptionsJson);Assert.Contains("active_meter_configuration_required",result.ExceptionsJson);
        Guid taskId;await using(var s=fixture.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<BHomeDbContext>();var task=await db.Set<OperationalTask>().SingleAsync(t=>t.AutomationPlanId==p.Id);Assert.Null(task.AssignedStaffUserId);taskId=task.Id;db.Add(new StaffLocationAssignment(w.Location,w.Staff,w.Owner,CurrentPeriod().AddYears(-1),CurrentPeriod().AddYears(1)));await db.SaveChangesAsync();}
        using var staff=await Client(w.Staff);using var owner=await Client(w.Owner);Assert.Equal(HttpStatusCode.NotFound,(await staff.GetAsync($"/api/v1/capture/meter-tasks/{taskId}")).StatusCode);
        (await owner.PostAsJsonAsync($"/api/v1/billing-automation/meter-tasks/{taskId}/assignment",new MeterAssignmentInput(w.Staff,1))).EnsureSuccessStatusCode();Assert.Equal(HttpStatusCode.OK,(await staff.GetAsync($"/api/v1/capture/meter-tasks/{taskId}")).StatusCode);
        var repeated=(await RunMeter(w))!;Assert.Equal(1,repeated.CreatedCount);Assert.DoesNotContain("staff_assignment_required",repeated.ExceptionsJson);
    }
    [Fact]
    public async Task MeterReplacementDoesNotDuplicatePeriodTasksAndFutureScheduleDoesNotRunEarly()
    {
        var(w,p,meters)=await MeterWorkspace();await RunMeter(w);
        Guid replacement;await using(var scope=fixture.Factory.Services.CreateAsyncScope())
        {var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();await db.Set<Meter>().Where(m=>m.Id==meters[0]).ExecuteUpdateAsync(s=>s.SetProperty(m=>m.IsActive,false));var meter=new Meter{RoomId=w.Room,Code="SYN-REPLACEMENT",UtilityType=UtilityType.Electricity,InstalledOn=CurrentPeriod()};db.Add(meter);await db.SaveChangesAsync();replacement=meter.Id;}
        var result=(await RunMeter(w))!;Assert.Contains("meter_replacement_review_required",result.ExceptionsJson);Assert.Equal(2,result.CreatedCount);
        using var owner=await Client(w.Owner);Assert.Equal(HttpStatusCode.Conflict,(await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks",new MeterTaskInput(replacement,ReadingPurpose.Periodic,CurrentPeriod(),CurrentPeriod()))).StatusCode);
        var next=await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w) with {ExpectedVersion=1,EffectiveFrom=CurrentPeriod().AddMonths(1)});next.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent,(await owner.PostAsJsonAsync("/api/v1/billing-automation/run-now",new BillingRunInput(w.Location,CurrentPeriod().AddMonths(1),"Meter"))).StatusCode);
    }
}
