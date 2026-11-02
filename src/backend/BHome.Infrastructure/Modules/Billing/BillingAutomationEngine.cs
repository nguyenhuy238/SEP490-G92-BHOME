using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Billing;

internal sealed partial class BillingAutomationEngine(BHomeDbContext db,IBillingAutomationSchedules schedules,TimeProvider clock,IInvoiceRepository invoiceRepository,IPropertyRepository propertyRepository,IStaffLocationAccess staffAccess):IBillingAutomationEngine
{
    private DateOnly Today=>BillingAutomationDates.BusinessDate(clock.GetUtcNow());
    public async Task<IReadOnlyList<BillingQueueView>> QueueAsync(Guid location,DateOnly period,CancellationToken t)
    {
        var key=period.ToString("yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
        return await db.Database.SqlQuery<BillingQueueView>($"""
            SELECT j."Id",j."Name",j."State",j."Attempts",j."AvailableAt",j."LockedUntil",j."LastErrorCode"
            FROM "BackgroundJobs" j JOIN "BillingAutomationPlans" p ON j."PayloadJson"->>'PlanId'=p."Id"::text
            WHERE p."LocationId"={location} AND j."PayloadJson"->>'BillingPeriod'={key}
              AND j."Name" IN ('billing-meter','billing-draft','billing-final')
            ORDER BY j."AvailableAt" DESC LIMIT 30
            """).ToArrayAsync(t);
    }
    public async Task<IReadOnlyList<BillingAutomationAttempt>> AttemptsAsync(Guid location,DateOnly period,CancellationToken t)=>await (from a in db.Set<BillingAutomationAttempt>().AsNoTracking() join e in db.Set<BillingAutomationExecution>() on a.ExecutionId equals e.Id where e.LocationId==location&&e.BillingPeriod==period orderby a.StartedAt descending select a).Take(100).ToArrayAsync(t);
    internal static DateTimeOffset DueAt(DateOnly date)=>new(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(new TimeOnly(23,59,59)),TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")),TimeSpan.Zero);
    private Task<bool> ActiveRole(Guid actor,string role,CancellationToken t)=>(from u in db.Users join grant in db.UserRoles on u.Id equals grant.UserId join r in db.Roles on grant.RoleId equals r.Id where u.Id==actor&&u.IsActive&&r.Name==role select u.Id).AnyAsync(t);
    public async Task<IReadOnlyList<BillingAutomationExecution>> ExecutionsAsync(Guid location,DateOnly period,CancellationToken t)=>await db.Set<BillingAutomationExecution>().AsNoTracking().Where(e=>e.LocationId==location&&e.BillingPeriod==period).OrderByDescending(e=>e.LastStartedAt).Take(100).ToArrayAsync(t);
    private async Task<bool> Eligible(BillingAutomationPlan p,DateOnly period,string phase,CancellationToken t)
    {
        var selected=await schedules.ForPeriodAsync(p.LocationId,period,t);
        return selected?.Id==p.Id&&p.Enabled&&(phase!="Final"||p.AuthorizeAutomaticFinalization)&&await ActiveRole(p.AuthorizedByUserId,Roles.Owner,t)&&await db.Locations.AnyAsync(l=>l.Id==p.LocationId&&l.IsActive,t)
            &&Today>=ScheduledDate(p,period,phase);
    }
    internal static DateOnly ScheduledDate(BillingAutomationPlan p,DateOnly period,string phase)=>phase switch
    {"Meter"=>InvoiceMath.CalendarDate(period,p.MeterDay,0),"Draft"=>InvoiceMath.CalendarDate(period,BillingAutomationService.Calendar(p).DraftDay,BillingAutomationService.Calendar(p).DraftMonthOffset),"Final"=>InvoiceMath.CalendarDate(period,BillingAutomationService.Calendar(p).FinalDay,BillingAutomationService.Calendar(p).FinalMonthOffset),_=>throw new InvoiceException(400,"invalid_billing_job_phase")};
    public async Task<BillingAutomationExecution?> ExecuteAsync(BillingJobInput x,string phase,CancellationToken t)
    {
        BillingAutomationService.ValidatePeriod(x.BillingPeriod);
        var p=await db.Set<BillingAutomationPlan>().AsNoTracking().SingleOrDefaultAsync(p=>p.Id==x.PlanId,t)??throw new InvoiceException(404,"billing_automation_not_found");
        if(!await Eligible(p,x.BillingPeriod,phase,t))return null;
        BillingAutomationExecution e;var token=Guid.NewGuid();
        await using(var tx=await db.Database.BeginTransactionAsync(t))
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({p.Id+"/"+x.BillingPeriod+"/"+phase},0))",t);
            e=await db.Set<BillingAutomationExecution>().SingleOrDefaultAsync(e=>e.PlanId==p.Id&&e.BillingPeriod==x.BillingPeriod&&e.Phase==phase,t)??new(){PlanId=p.Id,LocationId=p.LocationId,BillingPeriod=x.BillingPeriod,Phase=phase};
            if(e.LockedUntil>clock.GetUtcNow())return e;
            if(e.Status=="Processing")db.Add(new BillingAutomationAttempt{ExecutionId=e.Id,Sequence=e.Attempts,Status="LeaseExpired",StartedAt=e.LastStartedAt,FinishedAt=clock.GetUtcNow()});
            if(e.Attempts==0)db.Add(e);e.Attempts++;e.Status="Processing";e.LastStartedAt=clock.GetUtcNow();e.LockedUntil=clock.GetUtcNow().AddMinutes(2);e.LockToken=token;e.LastErrorCode=null;
            await db.SaveChangesAsync(t);await tx.CommitAsync(t);
        }
        var sequence=e.Attempts;var started=e.LastStartedAt;var errors=new List<object>();var existing=0;
        try
        {
            Guid? after=null;var from=phase=="Meter"?InvoiceMath.CalendarDate(x.BillingPeriod,p.MeterDay,0):x.BillingPeriod;var end=phase=="Meter"?from:x.BillingPeriod.AddMonths(1).AddDays(-1);
            while(true)
            {
                var rooms=await db.Set<Room>().AsNoTracking().Where(r=>r.LocationId==p.LocationId&&r.Status==RoomStatus.Occupied&&(after==null||r.Id.CompareTo(after.Value)>0)&&
                    db.Set<Contract>().Any(c=>c.RoomId==r.Id&&c.ActivatedAt!=null&&(c.Status==ContractStatus.Active||c.Status==ContractStatus.Superseded||c.Status==ContractStatus.Terminated)&&c.StartDate<=end&&(c.ActualEndDate??c.EndDate)>=from))
                    .OrderBy(r=>r.Id).Select(r=>r.Id).Take(100).ToArrayAsync(t);
                if(rooms.Length==0)break;
                foreach(var room in rooms)
                {
                    if(phase=="Draft"){existing+=await GenerateDraft(p,x.BillingPeriod,room,errors,t);continue;}
                    if(phase=="Final"){existing+=await FinalizeDraft(p,x.BillingPeriod,room,errors,t);continue;}
                    db.ChangeTracker.Clear();await using var tx=await db.Database.BeginTransactionAsync(t);
                    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({p.LocationId.ToString()},0))",t);
                    var lockedRoom=await db.Set<Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\"={room} FOR UPDATE").SingleAsync(t);
                    if(lockedRoom.Status!=RoomStatus.Occupied){await tx.CommitAsync(t);continue;}
                    if(!await Eligible(p,x.BillingPeriod,phase,t)){errors.Add(new{roomId=room,code="automation_authorization_changed"});await tx.CommitAsync(t);break;}
                    existing+=await GenerateMeterTasks(p,x.BillingPeriod,room,errors,t);
                    await db.SaveChangesAsync(t);await tx.CommitAsync(t);
                }
                after=rooms[^1];
            }
            await Finish(errors.Count==0?"Completed":"PendingInputs",null);
        }
        catch(OperationCanceledException)when(t.IsCancellationRequested){throw;}
        catch(Exception ex){await Finish("Failed",ex.GetType().Name);throw;}
        return await db.Set<BillingAutomationExecution>().AsNoTracking().SingleAsync(r=>r.Id==e.Id,t);
        async Task Finish(string status,string? code)
        {
            db.ChangeTracker.Clear();await using var tx=await db.Database.BeginTransactionAsync(t);
            var current=await db.Set<BillingAutomationExecution>().SingleAsync(r=>r.Id==e.Id,t);
            if(current.LockToken!=token)return;
            current.Status=status;current.LastErrorCode=code;current.ExceptionsJson=JsonSerializer.Serialize(errors);current.ExistingCount=existing;
            current.CreatedCount=phase=="Meter"?await db.Set<OperationalTask>().CountAsync(task=>task.AutomationPlanId==p.Id&&task.BillingPeriod==x.BillingPeriod,t):phase=="Draft"?await db.Set<Invoice>().CountAsync(i=>i.AutomationPlanId==p.Id&&i.BillingPeriod==x.BillingPeriod,t):await db.Set<Invoice>().CountAsync(i=>i.AutomationFinalizationPlanId==p.Id&&i.BillingPeriod==x.BillingPeriod,t);
            current.FinishedAt=clock.GetUtcNow();current.LockedUntil=null;current.LockToken=null;
            db.Add(new BillingAutomationAttempt{ExecutionId=e.Id,Sequence=sequence,Status=status,StartedAt=started,FinishedAt=current.FinishedAt.Value,SummaryJson=JsonSerializer.Serialize(new{current.CreatedCount,current.ExistingCount,errors,errorCode=code})});
            await db.SaveChangesAsync(t);await tx.CommitAsync(t);
        }
    }
    private async Task<int> GenerateMeterTasks(BillingAutomationPlan plan,DateOnly period,Guid room,List<object> errors,CancellationToken t)
    {
        var readingDate=InvoiceMath.CalendarDate(period,plan.MeterDay,0);var due=DueAt(InvoiceMath.CalendarDate(period,plan.MeterDueDay,plan.MeterDueMonthOffset));var existing=0;
        var assignments=await db.StaffLocationAssignments.AsNoTracking().Where(a=>a.LocationId==plan.LocationId&&a.StartDate<=Today&&a.EndDate>=Today).Take(2).ToArrayAsync(t);
        var assignment=assignments.Length==1&&await ActiveRole(assignments[0].StaffUserId,Roles.Staff,t)?assignments[0]:null;
        foreach(var type in new[]{UtilityType.Electricity,UtilityType.Water})
        {
            var meters=await db.Set<Meter>().AsNoTracking().Where(m=>m.RoomId==room&&m.UtilityType==type&&m.IsActive&&m.InstalledOn<=readingDate).Take(2).ToArrayAsync(t);
            var previous=await db.Set<OperationalTask>().SingleOrDefaultAsync(task=>task.BillingRoomId==room&&task.BillingUtilityType==type&&task.BillingPeriod==period,t);
            if(previous is not null)
            {
                existing++;
                if(previous.Status==MeterTaskStatus.Cancelled)errors.Add(new{roomId=room,utilityType=type,code="cancelled_period_requires_review"});
                if(meters.Length!=1||previous.MeterId!=meters[0].Id)errors.Add(new{roomId=room,utilityType=type,code="meter_replacement_review_required"});
                if(previous.AutomationPlanId is not null&&previous.Status is not(MeterTaskStatus.Completed or MeterTaskStatus.Cancelled)&&
                    (previous.AssignedStaffUserId is not {} assignee||!await db.StaffLocationAssignments.AnyAsync(a=>a.LocationId==plan.LocationId&&a.StaffUserId==assignee&&a.StartDate<=Today&&a.EndDate>=Today,t)||!await ActiveRole(assignee,Roles.Staff,t)))errors.Add(new{roomId=room,utilityType=type,code="staff_assignment_required",taskId=previous.Id});
                continue;
            }
            if(meters.Length!=1){errors.Add(new{roomId=room,utilityType=type,code="active_meter_configuration_required"});continue;}
            var task=new OperationalTask{Kind=OperationalTaskKind.MeterReading,LocationId=plan.LocationId,MeterId=meters[0].Id,BillingRoomId=room,BillingUtilityType=type,AutomationPlanId=plan.Id,
                Purpose=ReadingPurpose.Periodic,BillingPeriod=period,ReadingDate=readingDate,DueAt=due,Title=type==UtilityType.Electricity?"Ghi chỉ số điện định kỳ":"Ghi chỉ số nước định kỳ",Requirements="Đối chiếu ảnh và xác nhận chỉ số thực tế trước khi lưu.",EvidenceRequired=true,
                AssignedStaffUserId=assignment?.StaffUserId,AssignmentId=assignment?.Id,AssignedAt=assignment is null?null:clock.GetUtcNow()};
            db.Add(task);var history=new OperationalTaskHistory{TaskId=task.Id,ActorId=plan.AuthorizedByUserId,Action="scheduled_meter_created",Note="JOB-09",TaskVersion=1,ResponsibleStaffUserId=assignment?.StaffUserId,OccurredAt=clock.GetUtcNow(),ChangesJson=JsonSerializer.Serialize(new{planId=plan.Id,period,type})};db.Add(history);
            if(assignment is not null)db.Add(new OperationalTaskNotification{TaskId=task.Id,RecipientUserId=assignment.StaffUserId,EventId=history.Id,Event="scheduled_meter_created"});
            else errors.Add(new{roomId=room,utilityType=type,code="staff_assignment_required",taskId=task.Id});
        }
        return existing;
    }
    public async Task AssignMeterAsync(Guid taskId,MeterAssignmentInput x,Guid actor,CancellationToken t)
    {
        db.ChangeTracker.Clear();await using var tx=await db.Database.BeginTransactionAsync(t);
        var task=await db.Set<OperationalTask>().FromSqlInterpolated($"SELECT * FROM \"OperationalTasks\" WHERE \"Id\"={taskId} FOR UPDATE").SingleOrDefaultAsync(t)??throw new InvoiceException(404,"meter_task_not_found");
        if(task.AutomationPlanId==null||task.Version!=x.ExpectedVersion||task.Status is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled)throw new InvoiceException(409,"meter_task_changed_or_closed");
        var assignment=await db.StaffLocationAssignments.SingleOrDefaultAsync(a=>a.LocationId==task.LocationId&&a.StaffUserId==x.StaffUserId&&a.StartDate<=Today&&a.EndDate>=Today,t);
        if(assignment is null||!await ActiveRole(x.StaffUserId,Roles.Staff,t))throw new InvoiceException(400,"staff_assignment_required");
        task.AssignedStaffUserId=x.StaffUserId;task.AssignmentId=assignment.Id;task.AssignedAt=clock.GetUtcNow();task.Version++;
        var history=new OperationalTaskHistory{TaskId=task.Id,ActorId=actor,Action="scheduled_meter_assigned",TaskVersion=task.Version,ResponsibleStaffUserId=x.StaffUserId,OccurredAt=clock.GetUtcNow()};db.Add(history);
        db.Add(new OperationalTaskNotification{TaskId=task.Id,RecipientUserId=x.StaffUserId,EventId=history.Id,Event="scheduled_meter_assigned"});
        await db.SaveChangesAsync(t);await tx.CommitAsync(t);
    }
}
