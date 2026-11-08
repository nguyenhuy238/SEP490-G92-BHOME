using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
namespace BHome.LocalDevelopment;

internal static class BillingAutomationDemoSeed
{
    public static Guid Id(int n) => Guid.Parse($"fa090000-0000-4000-8000-{n:000000000000}");
    private static void Add<T>(BHomePersistenceContext db, int n, T value) where T : class { db.Entry(value).Property("Id").CurrentValue = Id(n); db.Add(value); }
    private static void Guard(IServiceProvider sp)
    {
        var config = sp.GetRequiredService<IConfiguration>();
        ContractDemoSeed.ValidateTarget(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), config.GetConnectionString("Database") ?? "");
        if (config["ObjectStorage:Bucket"] != "contract-demo" || !Uri.TryCreate("http://" + config["ObjectStorage:Endpoint"], UriKind.Absolute, out var uri) || !uri.IsLoopback || !config.GetValue<bool>("ContractWorkflow:SimulatedSigningEnabled")) throw new LocalTestAccountException("Automation demo requires isolated loopback storage and simulated signing.");
    }
    public static async Task PrepareAsync(IServiceProvider services, CancellationToken t = default)
    {
        Guard(services); await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); if (!await db.IsSchemaReadyAsync(t)) throw new LocalTestAccountException("Prepare the reviewed Compact24 schema before seeding; automatic schema migration is disabled.");
        if (await db.Users.CountAsync(u => new[] { ContractDemoSeed.Id(1), ContractDemoSeed.Id(2), ContractDemoSeed.Id(3), ContractDemoSeed.Id(4), ContractDemoSeed.Id(5) }.Contains(u.Id), t) != 5) throw new LocalTestAccountException("Initialize the isolated contract demo accounts first.");
        var today = BillingAutomationDates.BusinessDate(DateTimeOffset.UtcNow); var period = new DateOnly(today.Year, today.Month, 1);
        await using var tx = await db.Database.BeginTransactionAsync(t); await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Id(10).ToString()},0))", t);
        var existing = await db.Locations.SingleOrDefaultAsync(l => l.Id == Id(10), t);
        if (existing is null)
        {
            if (await db.Locations.AnyAsync(l => l.Name == "BHOME AUTOMATION DEMO", t)) throw new LocalTestAccountException("Automation fixture name conflict.");
            Add(db, 10, new Location("BHOME AUTOMATION DEMO") { Address = "SYNTHETIC JOB09/10 ONLY" });
            db.Add(new StaffLocationAssignment(Id(10), ContractDemoSeed.Id(2), ContractDemoSeed.Id(1), today.AddYears(-1), today.AddYears(1)));
        }
        else if (existing.Name != "BHOME AUTOMATION DEMO") throw new LocalTestAccountException("Automation fixture ID conflict.");
        var names = new[] { "AUTO101-SHARED", "AUTO102-MISSING", "AUTO103-RETRY" };
        for (var room = 0; room < names.Length; room++)
        {
            var r = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == Id(20 + room), t);
            if (r is not null) { if (r.LocationId != Id(10) || r.RoomNumber != names[room]) throw new LocalTestAccountException("Automation room conflict."); continue; }
            Add(db, 20 + room, new Room { LocationId = Id(10), RoomNumber = names[room], Capacity = 3, Status = RoomStatus.Available });
            for (var person = 0; person < (room == 0 ? 3 : 1); person++) Add(db, 40 + room * 3 + person, new Resident { RoomId = Id(20 + room), TenantUserId = ContractDemoSeed.Id(3 + person), OwnerUserId = ContractDemoSeed.Id(1), DisplayLabel = $"Khách tổng hợp {(char)('A' + person)} ({names[room]})", ResidentType = ResidentType.Representative, VerificationStatus = IdentityVerificationStatus.Verified, ConfirmedByUserId = ContractDemoSeed.Id(2), ConfirmedAt = DateTimeOffset.UtcNow });
            for (var type = 0; type < (room == 1 ? 1 : 2); type++) Add(db, 60 + room * 2 + type, new Meter { RoomId = Id(20 + room), Code = $"SYN-AUTO-{room}-{type}", UtilityType = (UtilityType)type, Display = MeterDisplay.Digital, InstalledOn = period.AddMonths(-1) });
        }
        foreach (var (n, category, code, rate) in new[] { (80, ChargeCategory.Rent, "RENT", 3000000m), (81, ChargeCategory.Electricity, "ELECTRICITY", 3500m), (82, ChargeCategory.Water, "WATER", 15000m) })
            if (!await db.Set<BillingPolicy>().AnyAsync(p => p.Id == Id(n), t)) Add(db, n, new BillingPolicy { LocationId = Id(10), Category = category, ChargeCode = code, Name = "Giá tổng hợp tự động " + code, Method = category == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered, Rate = rate, EffectiveFrom = period.AddYears(-1) });
        await db.SaveChangesAsync(t); await tx.CommitAsync(t); Console.WriteLine("Prepared isolated automation fixtures; no existing demo namespace was reset.");
    }
    // A real PostgreSQL lock timeout proves the registered handler's durable failure/retry path.
    // No financial state or execution result is fabricated, and no global application clock changes.
    public static async Task RetryAsync(IServiceProvider services, CancellationToken t = default)
    {
        Guard(services); var config = services.GetRequiredService<IConfiguration>();
        await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var period = BillingAutomationDates.BusinessDate(DateTimeOffset.UtcNow); period = new(period.Year, period.Month, 1);
        var plan = await scope.ServiceProvider.GetRequiredService<IBillingAutomationSchedules>().ForPeriodAsync(Id(10), period, t) ?? throw new LocalTestAccountException("Configure the automation plan through the demo API first.");
        if (await db.Set<Invoice>().AnyAsync(i => i.RoomId == Id(22) && i.BillingPeriod == period, t)) { Console.WriteLine("Retry fixture already completed; preserved its existing history."); return; }
        if (!await db.Set<Contract>().AnyAsync(c => c.RoomId == Id(22) && c.Status == ContractStatus.Active, t)) throw new LocalTestAccountException("Activate the synthetic retry contract before running the fault scenario.");
        var handler = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(h => h.Name == "billing-draft"); var job = new JobExecution(Guid.NewGuid(), "synthetic-db-lock-retry", JsonSerializer.Serialize(new BillingJobInput(plan.Id, period)));
        await using (var connection = new NpgsqlConnection(config.GetConnectionString("Database")))
        {
            await connection.OpenAsync(t); await using var tx = await connection.BeginTransactionAsync(t); await using var command = new NpgsqlCommand("SELECT 1 FROM \"Rooms\" WHERE \"Id\"=@room FOR UPDATE", connection, tx); command.Parameters.AddWithValue("room", Id(22)); await command.ExecuteScalarAsync(t);
            db.Database.SetCommandTimeout(1); var failed = false; try { await handler.ExecuteAsync(job, t); } catch (Exception ex) when (ex is NpgsqlException or TimeoutException or DbUpdateException || ex is InvalidOperationException { InnerException: NpgsqlException }) { failed = true; }
            if (!failed) throw new LocalTestAccountException("Expected a real lock timeout; no demo failure was recorded."); await tx.RollbackAsync(t);
        }
        db.Database.SetCommandTimeout(30); await handler.ExecuteAsync(job, t);
        var e = await db.Set<BillingAutomationExecution>().AsNoTracking().SingleAsync(e => e.PlanId == plan.Id && e.Phase == "Draft" && e.BillingPeriod == period, t);
        if (!await db.Set<BillingAutomationAttempt>().AnyAsync(a => a.ExecutionId == e.Id && a.Status == "Failed", t) || !await db.Set<Invoice>().AnyAsync(i => i.RoomId == Id(22) && i.BillingPeriod == period, t)) throw new LocalTestAccountException("Retry evidence is incomplete.");
        Console.WriteLine("Real PostgreSQL timeout recorded; registered billing-draft handler retried and persisted one room invoice.");
    }
}
