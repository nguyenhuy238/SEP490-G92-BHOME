using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.AspNetCore.Identity;
using System.Security.Cryptography;

namespace BHome.LocalDevelopment;

// BF-05 / UC-20 / JOB-09 / GBR-18: synthetic eligibility fixtures, no periodic tasks.
internal static class Job09Seed
{
    public static Guid Id(int n) => Guid.Parse($"fa090013-0000-4000-8000-{n:000000000000}");
    public static async Task RunAsync(IServiceProvider services, string mode)
    {
        var config = services.GetRequiredService<IConfiguration>();
        E2eMeterWorkflowSeed.ValidateDevelopmentTarget(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), config.GetConnectionString("Database") ?? "");
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync()) throw new LocalTestAccountException("Schema is not ready; no migrations applied.");
        var plans = await db.Set<BillingAutomationPlan>().AsNoTracking().Where(p => p.Enabled).Select(p => new { p.LocationId, p.Version, p.AuthorizeAutomaticFinalization }).ToArrayAsync();
        Console.WriteLine("Enabled automation plan versions: " + System.Text.Json.JsonSerializer.Serialize(plans));
        var fixtureTasks = await db.Set<OperationalTask>().AsNoTracking().Where(x => x.LocationId == Id(10)).Select(x => new { x.Id, x.Status, x.Purpose, x.MeterId }).ToArrayAsync();
        Console.WriteLine("JOB09_TASKS " + System.Text.Json.JsonSerializer.Serialize(fixtureTasks));
        if (mode == "--inspect")
        {
            var assignments = await (from a in db.StaffLocationAssignments.AsNoTracking()
                join u in db.Users on a.StaffUserId equals u.Id
                where a.LocationId == Id(10)
                select new { a.LocationId, a.StaffUserId, u.UserName, u.IsActive, a.StartDate, a.EndDate }).ToArrayAsync();
            Console.WriteLine("JOB09_STAFF " + System.Text.Json.JsonSerializer.Serialize(assignments));
            var room = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == Id(20));
            var contract = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == Id(40));
            var meterIds = await db.Set<Meter>().Where(m => m.RoomId == Id(20)).Select(m => m.Id).ToArrayAsync();
            var readings = await db.Set<MeterReading>().CountAsync(r => meterIds.Contains(r.MeterId));
            var fixtureTenant = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == Id(2));
            Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { room = room?.RoomNumber, occupancy = room?.Status.ToString(), contract = contract?.Status.ToString(), contractTenantMatches = contract?.TenantUserId == fixtureTenant?.Id && fixtureTenant != null, tenant = fixtureTenant?.UserName, meters = meterIds.Length, readings, tasks = fixtureTasks.Length }));
            return;
        }
        var owner = await db.Users.SingleAsync(u => u.IsActive && EF.Property<string[]>(u, "roles").Contains(Roles.Owner));
        var now = DateTimeOffset.UtcNow;
        var today = BillingAutomationDates.BusinessDate(now);
        var period = new DateOnly(today.Year, today.Month, 1);
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Id(10).ToString()},0))");
        if (await db.Locations.AnyAsync(l => l.Id == Id(10)))
        {
            if (!await db.Locations.AnyAsync(l => l.Id == Id(10) && l.Name == "BHOME JOB09 TEST")) throw new LocalTestAccountException("Fixture ID conflict.");
            Console.WriteLine("JOB09 fixture already exists; all existing records preserved.");
            return;
        }
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var credentials = new List<object>();
        async Task<ApplicationUser> Account(int n, string name, string role, string fullName)
        {
            if (await db.Users.AnyAsync(u => u.Id == Id(n) || u.UserName == name)) throw new LocalTestAccountException("Dedicated fixture account conflict; no existing credentials changed.");
            var password = "Aa1!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            var user = new ApplicationUser { Id = Id(n), UserName = name, Email = name, EmailConfirmed = true, IsActive = true, LockoutEnabled = true };
            db.Entry(user).Property("full_name").CurrentValue = fullName;
            db.PrepareUserRole(user, role);
            var result = await users.CreateAsync(user, password);
            if (!result.Succeeded) throw new LocalTestAccountException("Fixture account creation failed: " + string.Join(",", result.Errors.Select(e => e.Code)));
            credentials.Add(new { userName = name, password, role });
            return user;
        }
        var staff = await Account(1, "staff.job09@example.invalid", Roles.Staff, "Staff JOB09 TEST");
        var tenant = await Account(2, "tenant.job09@example.invalid", Roles.Tenant, "Tenant JOB09 TEST");
        var chain = await db.Set<Chain>().Select(c => (Guid?)c.Id).FirstOrDefaultAsync();
        void Add<T>(int n, T row) where T : class { db.Entry(row).Property("Id").CurrentValue = Id(n); db.Add(row); }
        Add(10, new Location("BHOME JOB09 TEST") { ChainId = chain, Address = "SYNTHETIC JOB09 TEST ONLY" });
        Add(11, new RoomType { LocationId = Id(10), Name = "JOB09 TEST", DefaultCapacity = 1 });
        Add(12, new StaffLocationAssignment(Id(10), staff.Id, owner.Id, period.AddMonths(-1), period.AddYears(1)));
        Add(13, new BillingSchedule { LocationId = Id(10), RentSource = BillingRentSource.RepresentativeContract, DraftDay = 28, FinalDay = 28, DueDay = 28, DueMonthOffset = 1 });
        for (var i = 0; i < 1; i++)
        {
            Add(20 + i, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = $"J09-{101 + i}", Capacity = 1, Status = i == 2 ? RoomStatus.Available : RoomStatus.Occupied });
            for (var utility = 0; utility < (i == 1 ? 1 : 2); utility++)
                Add(60 + i * 2 + utility, new Meter { RoomId = Id(20 + i), Code = $"JOB09-{101 + i}-{utility}", UtilityType = (UtilityType)utility, Display = MeterDisplay.Digital, InstalledOn = period.AddMonths(-1), IsActive = true });
            if (i == 2) continue;
            Add(30 + i, new Resident { RoomId = Id(20 + i), TenantUserId = i == 0 ? tenant.Id : null, OwnerUserId = owner.Id, DisplayLabel = $"SYNTHETIC JOB09 TENANT {i + 1}", ResidentType = ResidentType.Representative, VerificationStatus = IdentityVerificationStatus.Verified, ConfirmedByUserId = staff.Id, ConfirmedAt = now });
            Add(40 + i, new Contract { RoomId = Id(20 + i), OwnerSignerId = owner.Id, TenantUserId = i == 0 ? tenant.Id : null, RepresentativeResidentId = Id(30 + i), Kind = ContractKind.Main, Status = ContractStatus.Active, StartDate = period, EndDate = period.AddYears(1).AddDays(-1), MonthlyRent = 3000000m, Terms = "SYNTHETIC JOB09 ELIGIBILITY FIXTURE ONLY; no real signing/payment", SnapshotHash = new string('0', 64), IsDevelopmentDemo = true, ActivatedByUserId = owner.Id, ActivatedAt = now, Residents = [new ContractResident { ContractId = Id(40 + i), ResidentId = Id(30 + i), Role = ResidentType.Representative, ResidenceFrom = period }] });
        }
        await db.SaveChangesAsync();
        var credentialPath = Path.GetFullPath(".tools/job09/credentials.json");
        Directory.CreateDirectory(Path.GetDirectoryName(credentialPath)!);
        if (File.Exists(credentialPath)) throw new LocalTestAccountException("Private credential file already exists; preserve it before creating new accounts.");
        await File.WriteAllTextAsync(credentialPath, System.Text.Json.JsonSerializer.Serialize(credentials, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        await tx.CommitAsync();
        Console.WriteLine($"JOB09_READY location={Id(10)} period={period:yyyy-MM-dd}; J09-101=Occupied; dedicated Staff/Tenant; 2 meters; Active synthetic contract. No tasks, readings, automation or invoices created. Credentials: {credentialPath}");
    }
}
