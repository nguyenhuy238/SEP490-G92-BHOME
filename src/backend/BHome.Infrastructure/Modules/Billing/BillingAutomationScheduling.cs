using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Billing;
internal sealed class BillingAutomationScheduling(BHomeDbContext db,IBillingAutomationSchedules schedules,IBackgroundJobQueue queue,TimeProvider clock):IJobScheduleContributor
{
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        var now=clock.GetUtcNow();var local=TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now,"Asia/Ho_Chi_Minh");var today=DateOnly.FromDateTime(local.DateTime);var month=new DateOnly(today.Year,today.Month,1);Guid? after=null;
        while(true)
        {
            var locations=await db.Set<BillingAutomationPlan>().Where(p=>after==null||p.LocationId.CompareTo(after.Value)>0).Select(p=>p.LocationId).Distinct().OrderBy(id=>id).Take(100).ToArrayAsync(t);
            if(locations.Length==0)return;
            foreach(var location in locations)
            foreach(var period in new[]{month,month.AddMonths(-1),month.AddMonths(-2)})
            {
                var plan=await schedules.ForPeriodAsync(location,period,t);
                if(plan?.Enabled!=true||today<InvoiceMath.CalendarDate(period,plan.MeterDay,0))continue;
                var execution=await db.Set<BillingAutomationExecution>().AsNoTracking().SingleOrDefaultAsync(e=>e.PlanId==plan.Id&&e.BillingPeriod==period&&e.Phase=="Meter",t);
                if(execution?.Status=="Completed"||execution is{Status:"Failed",Attempts:>=4})continue;
                await queue.EnqueueAsync(new("billing-meter",$"{plan.Id:N}/{period:yyyyMM}/Meter/{now:yyyyMMddHHmm}",JsonSerializer.Serialize(new BillingJobInput(plan.Id,period))),t);
            }
            after=locations[^1];
        }
    }
}
