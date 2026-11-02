using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.LocalDevelopment;

internal sealed class LifecycleSeedActor:ICurrentUser
{
    public Guid? UserId{get;set;}
    public string Role{get;set;}="";
    public bool IsInRole(string role)=>role==Role;
}
internal static class ContractLifecycleDemoSeed
{
    public static Guid Id(int n)=>Guid.Parse($"fa400000-0000-4000-8000-{n:000000000000}");
    private static Guid User(int n)=>ContractDemoSeed.Id(n);
    private static void Add<T>(BHomeDbContext db,int n,T entity)where T:class{db.Entry(entity).Property("Id").CurrentValue=Id(n);db.Add(entity);}
    public static async Task PrepareAsync(BHomeDbContext db,CancellationToken t)
    {
        var today=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow,"Asia/Ho_Chi_Minh").DateTime);var period=new DateOnly(today.Year,today.Month,1);
        await using var tx=await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Id(10).ToString()},0))",t);
        var location=await db.Locations.AsNoTracking().SingleOrDefaultAsync(l=>l.Id==Id(10),t);
        if(location is null)
        {
            if(await db.Locations.AnyAsync(l=>l.Name=="BHOME LIFECYCLE DEMO",t))throw new LocalTestAccountException("Trùng tên fixture lifecycle.");
            Add(db,10,new Location("BHOME LIFECYCLE DEMO"){ChainId=await db.Set<Chain>().Select(c=>c.Id).SingleAsync(t),Address="ĐỊA CHỈ TỔNG HỢP - BH40 TEST ONLY"});
            Add(db,11,new RoomType{LocationId=Id(10),Name="Phòng lifecycle tổng hợp",DefaultCapacity=3});
            db.Add(new StaffLocationAssignment(Id(10),User(2),User(1),today.AddYears(-1),today.AddYears(1)));
        }
        else if(location.Name!="BHOME LIFECYCLE DEMO")throw new LocalTestAccountException("Trùng ID fixture lifecycle.");
        var names=new[]{"LC101-RENEW-PENDING","LC102-RENEW-ACTIVE","LC103-SHARED","LC104-PENDING","LC105-LAST","LC106-UI"};
        for(var room=0;room<names.Length;room++)
        {
            var existing=await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r=>r.Id==Id(20+room),t);
            if(existing is not null){if(existing.LocationId!=Id(10)||existing.RoomNumber!=names[room])throw new LocalTestAccountException("Trùng ID phòng lifecycle.");continue;}
            Add(db,20+room,new Room{LocationId=Id(10),RoomTypeId=Id(11),RoomNumber=names[room],Capacity=3,Status=RoomStatus.Available});
            for(var person=0;person<3;person++)Add(db,40+room*3+person,new Resident{RoomId=Id(20+room),TenantUserId=User(3+person),OwnerUserId=User(1),DisplayLabel=$"Khách tổng hợp {(char)('A'+person)} ({names[room]})",ResidentType=ResidentType.Representative,VerificationStatus=IdentityVerificationStatus.Verified,ConfirmedByUserId=User(2),ConfirmedAt=DateTimeOffset.UtcNow});
            Add(db,100+room,new Asset{LocationId=Id(10),RoomId=Id(20+room),Name="Quạt lifecycle tổng hợp",Category="Thiết bị",Condition="Tốt - tổng hợp",Status=AssetStatus.Active});
            for(var utility=0;utility<2;utility++)Add(db,60+room*2+utility,new Meter{RoomId=Id(20+room),Code=$"SYN-LC-{room}-{utility}",UtilityType=(UtilityType)utility,Display=MeterDisplay.Digital,DecimalPlaces=2,InstalledOn=period.AddMonths(-2)});
        }
        foreach(var(n,category,code,rate)in new[]{(80,ChargeCategory.Rent,"RENT",3000000m),(81,ChargeCategory.Electricity,"ELECTRICITY",3500m),(82,ChargeCategory.Water,"WATER",15000m)})
            if(!await db.Set<BillingPolicy>().AnyAsync(p=>p.Id==Id(n),t))Add(db,n,new BillingPolicy{LocationId=Id(10),Category=category,ChargeCode=code,Name="Giá tổng hợp lifecycle "+code,Method=category==ChargeCategory.Rent?ChargingMethod.FixedPerRoomPerMonth:ChargingMethod.Metered,Rate=rate,EffectiveFrom=period.AddYears(-1)});
        await db.SaveChangesAsync(t);await tx.CommitAsync(t);
    }
    // Only the isolated seed uses a historical clock. It executes normal signing/activation services.
    // No process-wide clock override, status shortcut, or change to the running API.
    public static async Task HistoricalParentAsync(IServiceProvider services,CancellationToken t)
    {
        await using var scope=services.CreateAsyncScope();var sp=scope.ServiceProvider;var db=sp.GetRequiredService<BHomeDbContext>();
        var actor=sp.GetRequiredService<LifecycleSeedActor>();actor.UserId=User(1);actor.Role="Owner";
        var existing=await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c=>c.RoomId==Id(21)&&c.Kind==ContractKind.Main,t);
        if(existing?.Status is ContractStatus.Active or ContractStatus.Superseded)return;
        var today=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow,"Asia/Ho_Chi_Minh").DateTime);
        var end=existing?.EndDate??today.AddDays(-1);var clock=new HistoricalClock(new DateTimeOffset(end.ToDateTime(new TimeOnly(6,0)),TimeSpan.Zero));
        var service=ActivatorUtilities.CreateInstance<ContractService>(sp,clock);
        var id=existing?.Id??(await service.CreateAsync(new(Id(21),User(1),User(3),Id(43),[Id(43)],new DateOnly(end.Year,end.Month,1).AddMonths(-1),end,3000000,0,"SYNTHETIC HISTORICAL PRECONDITION; LOCAL CLOCK; SIMULATED SIGNING ONLY"),Guid.NewGuid(),t)).Id;
        foreach(var(user,role)in new[]{(User(1),"Owner"),(User(3),"Tenant")})
        {
            actor.UserId=user;actor.Role=role;var c=await service.GetAsync(id,t);
            if(!c.Signatures.Any(s=>s.SignerUserId==user&&s.Status!="Failed"))await service.RequestSigningAsync(id,new(Guid.Empty),Guid.NewGuid(),t);
            await service.SyncSigningAsync(id,t);
        }
        actor.UserId=User(1);actor.Role="Owner";await service.ActivateAsync(id,Guid.NewGuid(),t);actor.UserId=null;actor.Role="";
    }
    private sealed class HistoricalClock(DateTimeOffset value):TimeProvider{public override DateTimeOffset GetUtcNow()=>value;}
}
