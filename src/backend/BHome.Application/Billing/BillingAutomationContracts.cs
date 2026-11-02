using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
namespace BHome.Application.Billing;

public sealed record BillingAutomationWrite([property:JsonRequired]Guid LocationId,[property:JsonRequired]DateOnly EffectiveFrom,
    [property:JsonRequired]bool Enabled,[property:JsonRequired]bool AuthorizeAutomaticFinalization,
    [property:JsonRequired]int MeterDay,[property:JsonRequired]int MeterDueDay,[property:JsonRequired]int MeterDueMonthOffset,
    [property:JsonRequired]string TimeZone,[property:JsonRequired]int ExpectedVersion,[property:JsonRequired]int ExpectedBillingScheduleVersion);
public interface IBillingAutomationSchedules
{
    Task<BillingAutomationPlan?> ForPeriodAsync(Guid locationId,DateOnly period,CancellationToken t);
    Task<IReadOnlyList<BillingAutomationPlan>> HistoryAsync(Guid locationId,CancellationToken t);
    Task<BillingAutomationPlan> SaveAsync(BillingAutomationWrite input,Guid actor,DateTimeOffset now,CancellationToken t);
}
public sealed class BillingAutomationService(IBillingAutomationSchedules schedules,ICurrentUser user,PermissionAccess permissions,TimeProvider clock)
{
    private async Task<Guid> Owner(Guid location,CancellationToken t)
    {
        if(user.UserId is not {} actor)throw new InvoiceException(401,"authentication_required");
        if(!await permissions.CanAccessAsync(Permissions.Locations.Manage,new(location,null),t))throw new InvoiceException(403,"billing_automation_owner_required");
        return actor;
    }
    public async Task<BillingAutomationPlan?> GetAsync(Guid location,DateOnly period,CancellationToken t)
    {await Owner(location,t);ValidatePeriod(period);return await schedules.ForPeriodAsync(location,period,t);}
    public async Task<IReadOnlyList<BillingAutomationPlan>> HistoryAsync(Guid location,CancellationToken t)
    {await Owner(location,t);return await schedules.HistoryAsync(location,t);}
    public async Task<BillingAutomationPlan> SaveAsync(BillingAutomationWrite x,CancellationToken t)
    {
        var actor=await Owner(x.LocationId,t);ValidatePeriod(x.EffectiveFrom);
        if(x.LocationId==Guid.Empty||x.TimeZone!="Asia/Ho_Chi_Minh"||x.MeterDay is <1 or >31||x.MeterDueDay is <1 or >31||x.MeterDueMonthOffset is <0 or >2||x.ExpectedVersion<0||x.ExpectedBillingScheduleVersion<1||!x.Enabled&&x.AuthorizeAutomaticFinalization)
            throw new InvoiceException(400,"invalid_billing_automation");
        foreach(var period in new[]{new DateOnly(2027,2,1),new DateOnly(2028,2,1),new DateOnly(2026,12,1)})
            if(InvoiceMath.CalendarDate(period,x.MeterDay,0)>InvoiceMath.CalendarDate(period,x.MeterDueDay,x.MeterDueMonthOffset))throw new InvoiceException(400,"invalid_meter_calendar_order");
        return await schedules.SaveAsync(x,actor,clock.GetUtcNow(),t);
    }
    public static void ValidatePeriod(DateOnly period)
    {if(period.Day!=1||period.Year is <2000 or >9997)throw new InvoiceException(400,"invalid_invoice_period");}
    public static BillingSchedule Calendar(BillingAutomationPlan plan)=>JsonSerializer.Deserialize<BillingSchedule>(plan.BillingSnapshot)??throw new InvoiceException(409,"billing_automation_snapshot_invalid");
}
