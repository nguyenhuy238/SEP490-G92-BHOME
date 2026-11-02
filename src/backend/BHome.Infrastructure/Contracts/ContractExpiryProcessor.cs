using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractExpiryProcessor(BHomeDbContext db,TimeProvider clock):IBackgroundJobHandler,IContractExpiryRepository
{
    public const string JobName="contract-expiry";
    public string Name=>JobName;
    public async Task ExecuteAsync(JobExecution job,CancellationToken t)
    {
        var today=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(),"Asia/Ho_Chi_Minh").DateTime);
        var through=today.AddDays(30);Guid? after=null;
        while(true)
        {
            var batch=await db.Set<Contract>().AsNoTracking().Where(c=>c.Status==ContractStatus.Active&&c.EndDate<=through&&(after==null||c.Id.CompareTo(after.Value)>0))
                .OrderBy(c=>c.Id).Select(c=>new{c.Id,c.RoomId}).Take(100).ToArrayAsync(t);
            if(batch.Length==0)break;
            foreach(var item in batch)
            {
                await using var tx=await db.Database.BeginTransactionAsync(t);
                await db.Set<BHome.Domain.PropertyManagement.Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\"={item.RoomId} FOR UPDATE").AsNoTracking().SingleAsync(t);
                var c=await db.Set<Contract>().AsNoTracking().SingleAsync(c=>c.Id==item.Id,t);
                if(c.Status==ContractStatus.Active&&c.EndDate<=through)
                {
                    var stage=c.EndDate<today?"Expired":"Upcoming30";
                    foreach(var recipient in new[]{c.OwnerSignerId,c.TenantUserId}.Distinct())
                        await db.Database.ExecuteSqlInterpolatedAsync($"""
                            INSERT INTO "ContractExpiryNotices" ("Id","ContractId","RecipientId","EndDate","Stage","CreatedAt")
                            VALUES ({Guid.NewGuid()},{c.Id},{recipient},{c.EndDate},{stage},{clock.GetUtcNow()})
                            ON CONFLICT ("ContractId","EndDate","Stage","RecipientId") DO NOTHING
                            """,t);
                }
                await tx.CommitAsync(t);
            }
            after=batch[^1].Id;
        }
    }
    public async Task<IReadOnlyList<ContractExpiryNoticeView>> ListAsync(Guid actor,bool owner,CancellationToken t)
    {
        var today=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(),"Asia/Ho_Chi_Minh").DateTime);
        return await
        (from n in db.Set<ContractExpiryNotice>().AsNoTracking() join c in db.Set<Contract>() on n.ContractId equals c.Id
         where (owner?n.RecipientId==c.OwnerSignerId:n.RecipientId==actor&&c.TenantUserId==actor)&&c.Status==ContractStatus.Active&&c.EndDate==n.EndDate&&n.Stage==(c.EndDate<today?"Expired":"Upcoming30")
         orderby n.CreatedAt descending,n.Id
         select new ContractExpiryNoticeView(n.Id,n.ContractId,c.Room.RoomNumber,c.Room.Location.Name,n.EndDate,n.Stage,n.CreatedAt)).Take(100).ToArrayAsync(t);
    }
}
