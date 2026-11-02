using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
namespace BHome.Application.Billing;

public sealed record BillingJobInput(Guid PlanId,DateOnly BillingPeriod);
public sealed record BillingRunInput(Guid LocationId,DateOnly BillingPeriod,string Phase);
public sealed record MeterAssignmentInput(Guid StaffUserId,int ExpectedVersion);
public sealed record BillingAutomationRuntime(bool DeveloperActionsEnabled);
public sealed record BillingPhasePreview(string Phase,DateOnly ScheduledDate,bool Eligible);
public sealed record BillingAutomationPreview(bool DeveloperActionsEnabled,string TimeZone,DateOnly BusinessDate,IReadOnlyList<BillingPhasePreview> Phases);
public interface IBillingAutomationEngine
{
    Task<BillingAutomationExecution?> ExecuteAsync(BillingJobInput input,string phase,CancellationToken t);
    Task<IReadOnlyList<BillingAutomationExecution>> ExecutionsAsync(Guid locationId,DateOnly period,CancellationToken t);
    Task AssignMeterAsync(Guid taskId,MeterAssignmentInput input,Guid actor,CancellationToken t);
    Task<IReadOnlyList<BillingAutomationAttempt>> AttemptsAsync(Guid locationId,DateOnly period,CancellationToken t);
}
public sealed class BillingAutomationJobHandler(string name,string phase,IBillingAutomationEngine engine):IBackgroundJobHandler
{
    public string Name=>name;
    public async Task ExecuteAsync(JobExecution job,CancellationToken t)
    {await engine.ExecuteAsync(JsonSerializer.Deserialize<BillingJobInput>(job.PayloadJson)??throw new ArgumentException("invalid_billing_job"),phase,t);}
}
public sealed class BillingAutomationOperations(IBillingAutomationEngine engine,IBillingAutomationSchedules schedules,ICurrentUser user,PermissionAccess permissions,BillingAutomationRuntime runtime,TimeProvider clock)
{
    private async Task<Guid> Owner(Guid location,CancellationToken t)
    {
        if(user.UserId is not {} actor)throw new InvoiceException(401,"authentication_required");
        if(!await permissions.CanAccessAsync(Permissions.Locations.Manage,new(location,null),t))throw new InvoiceException(403,"billing_automation_owner_required");return actor;
    }
    public async Task<IReadOnlyList<BillingAutomationExecution>> ListAsync(Guid location,DateOnly period,CancellationToken t)
    {await Owner(location,t);BillingAutomationService.ValidatePeriod(period);return await engine.ExecutionsAsync(location,period,t);}
    public async Task<IReadOnlyList<BillingAutomationAttempt>> AttemptsAsync(Guid location,DateOnly period,CancellationToken t)
    {await Owner(location,t);BillingAutomationService.ValidatePeriod(period);return await engine.AttemptsAsync(location,period,t);}
    public async Task<BillingAutomationPreview> PreviewAsync(Guid location,DateOnly period,CancellationToken t)
    {
        await Owner(location,t);BillingAutomationService.ValidatePeriod(period);
        var p=await schedules.ForPeriodAsync(location,period,t);var today=BillingAutomationDates.BusinessDate(clock.GetUtcNow());
        if(p is null)return new(runtime.DeveloperActionsEnabled,"Asia/Ho_Chi_Minh",today,[]);
        var c=BillingAutomationService.Calendar(p);
        var phases=new[]{new BillingPhasePreview("Meter",InvoiceMath.CalendarDate(period,p.MeterDay,0),false),new("Draft",InvoiceMath.CalendarDate(period,c.DraftDay,c.DraftMonthOffset),false),new("Final",InvoiceMath.CalendarDate(period,c.FinalDay,c.FinalMonthOffset),false)};
        return new(runtime.DeveloperActionsEnabled,p.TimeZone,today,phases.Select(x=>x with{Eligible=p.Enabled&&today>=x.ScheduledDate&&(x.Phase!="Final"||p.AuthorizeAutomaticFinalization)}).ToArray());
    }
    public async Task<BillingAutomationExecution?> RunAsync(BillingRunInput x,CancellationToken t)
    {
        await Owner(x.LocationId,t);if(!runtime.DeveloperActionsEnabled)throw new InvoiceException(403,"developer_actions_disabled");BillingAutomationService.ValidatePeriod(x.BillingPeriod);
        if(x.Phase is not("Meter" or "Draft" or "Final"))throw new InvoiceException(400,"invalid_billing_job_phase");
        var plan=await schedules.ForPeriodAsync(x.LocationId,x.BillingPeriod,t)??throw new InvoiceException(409,"billing_automation_required");
        return await engine.ExecuteAsync(new(plan.Id,x.BillingPeriod),x.Phase,t);
    }
    public async Task AssignAsync(Guid taskId,MeterAssignmentInput x,CancellationToken t)
    {var actor=await Owner(Guid.Empty,t);await engine.AssignMeterAsync(taskId,x,actor,t);}
    public async Task<BillingRepresentativeSelection?> RepresentativeAsync(Guid room,DateOnly period,CancellationToken t)
    {await Owner(Guid.Empty,t);BillingAutomationService.ValidatePeriod(period);return await schedules.RepresentativeAsync(room,period,t);}
    public async Task<BillingRepresentativeSelection> SelectAsync(BillingRepresentativeInput x,CancellationToken t)
    {var actor=await Owner(Guid.Empty,t);BillingAutomationService.ValidatePeriod(x.BillingPeriod);if(x.RoomId==Guid.Empty||x.ContractId==Guid.Empty||x.ExpectedVersion<0)throw new InvoiceException(400,"invalid_billing_representative");return await schedules.SelectRepresentativeAsync(x,actor,clock.GetUtcNow(),t);}
}
