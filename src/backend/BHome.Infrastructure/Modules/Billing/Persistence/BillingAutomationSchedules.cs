using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Billing.Persistence;

internal sealed class BillingAutomationSchedules(BHomeDbContext db):IBillingAutomationSchedules
{
    public async Task<bool> AuthorizedAsync(BillingAutomationPlan plan,Guid actor,DateOnly period,bool finalization,CancellationToken t)=>
        plan.Enabled&&plan.AuthorizedByUserId==actor&&(!finalization||plan.AuthorizeAutomaticFinalization)&&(await ForPeriodAsync(plan.LocationId,period,t))?.Id==plan.Id&&
        await(from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id==actor&&u.IsActive&&r.Name==Roles.Owner select u.Id).AnyAsync(t);
    public Task<BillingRepresentativeSelection?> RepresentativeAsync(Guid room,DateOnly period,CancellationToken t)=>db.Set<BillingRepresentativeSelection>().AsNoTracking().Where(r=>r.RoomId==room&&r.BillingPeriod==period).OrderByDescending(r=>r.Version).FirstOrDefaultAsync(t);
    public async Task<BillingRepresentativeSelection> SelectRepresentativeAsync(BillingRepresentativeInput x,Guid actor,DateTimeOffset now,CancellationToken t)
    {
        await using var tx=await db.Database.BeginTransactionAsync(t);var location=await db.Set<Room>().Where(r=>r.Id==x.RoomId).Select(r=>(Guid?)r.LocationId).SingleOrDefaultAsync(t)??throw new InvoiceException(404,"room_not_found");
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))",t);
        await db.Set<Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\"={x.RoomId} FOR UPDATE").SingleAsync(t);
        if(await db.Set<Invoice>().AnyAsync(i=>i.RoomId==x.RoomId&&i.BillingPeriod==x.BillingPeriod,t))throw new InvoiceException(409,"invoice_period_already_exists");
        var old=await RepresentativeAsync(x.RoomId,x.BillingPeriod,t);if((old?.Version??0)!=x.ExpectedVersion)throw new InvoiceException(409,"billing_representative_changed");
        var end=x.BillingPeriod.AddMonths(1).AddDays(-1);
        if(!await db.Set<Contract>().AnyAsync(c=>c.Id==x.ContractId&&c.RoomId==x.RoomId&&c.ActivatedAt!=null&&(c.Status==ContractStatus.Active||c.Status==ContractStatus.Terminated||c.Status==ContractStatus.Superseded)&&c.StartDate<=end&&(c.ActualEndDate??c.EndDate)>=x.BillingPeriod,t))throw new InvoiceException(400,"representative_contract_not_eligible");
        var row=new BillingRepresentativeSelection{RoomId=x.RoomId,BillingPeriod=x.BillingPeriod,ContractId=x.ContractId,Version=x.ExpectedVersion+1,SelectedByUserId=actor,SelectedAt=now};db.Add(row);
        db.SecurityAudit.Add(new(){UserId=actor,Event="BillingRepresentativeSelected",TargetType="BillingAutomation",TargetId=row.Id,Succeeded=true,OccurredAt=now});await db.SaveChangesAsync(t);await tx.CommitAsync(t);return row;
    }
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
