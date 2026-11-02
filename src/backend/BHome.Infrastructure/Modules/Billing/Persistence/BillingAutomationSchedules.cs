using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Billing.Persistence;

internal sealed class BillingAutomationSchedules(BHomeDbContext db):IBillingAutomationSchedules
{
    public Task<BillingAutomationPlan?> ForPeriodAsync(Guid locationId,DateOnly period,CancellationToken t)=>db.Set<BillingAutomationPlan>().AsNoTracking()
        .Where(p=>p.LocationId==locationId&&p.EffectiveFrom<=period).OrderByDescending(p=>p.EffectiveFrom).ThenByDescending(p=>p.Version).FirstOrDefaultAsync(t);
    public async Task<IReadOnlyList<BillingAutomationPlan>> HistoryAsync(Guid locationId,CancellationToken t)=>await db.Set<BillingAutomationPlan>().AsNoTracking().Where(p=>p.LocationId==locationId).OrderByDescending(p=>p.Version).Take(100).ToArrayAsync(t);
    public async Task<BillingAutomationPlan> SaveAsync(BillingAutomationWrite x,Guid actor,DateTimeOffset now,CancellationToken t)
    {
        await using var tx=await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({x.LocationId.ToString()},0))",t);
        if(!await db.Locations.AnyAsync(l=>l.Id==x.LocationId&&l.IsActive,t))throw new InvoiceException(404,"billing_location_not_found");
        var version=await db.Set<BillingAutomationPlan>().Where(p=>p.LocationId==x.LocationId).Select(p=>(int?)p.Version).MaxAsync(t)??0;
        var schedule=await db.Set<BillingSchedule>().AsNoTracking().SingleOrDefaultAsync(s=>s.LocationId==x.LocationId,t)??throw new InvoiceException(409,"billing_schedule_required");
        if(version!=x.ExpectedVersion||schedule.Version!=x.ExpectedBillingScheduleVersion)throw new InvoiceException(409,"billing_automation_changed");
        var plan=new BillingAutomationPlan{LocationId=x.LocationId,Version=version+1,EffectiveFrom=x.EffectiveFrom,Enabled=x.Enabled,AuthorizeAutomaticFinalization=x.AuthorizeAutomaticFinalization,
            MeterDay=x.MeterDay,MeterDueDay=x.MeterDueDay,MeterDueMonthOffset=x.MeterDueMonthOffset,TimeZone=x.TimeZone,BillingScheduleVersion=schedule.Version,
            BillingSnapshot=JsonSerializer.Serialize(schedule),AuthorizedByUserId=actor,RecordedAt=now};
        db.Add(plan);db.SecurityAudit.Add(new(){UserId=actor,Event="BillingAutomationConfigured",TargetType="BillingAutomation",TargetId=plan.Id,Succeeded=true,OccurredAt=now});
        await db.SaveChangesAsync(t);await tx.CommitAsync(t);return plan;
    }
}
