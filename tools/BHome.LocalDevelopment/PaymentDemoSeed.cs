using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.LocalDevelopment;

internal static class PaymentDemoSeed
{
    public static Guid Id(int number) => Guid.Parse($"fa250000-0000-4000-8000-{number:000000000000}");
    private static Guid User(int number) => ContractDemoSeed.Id(number);
    private static void Add<T>(BHomePersistenceContext db, int number, T entity) where T : class
    { db.Entry(entity).Property("Id").CurrentValue = Id(number); db.Add(entity); }
    public static async Task PrepareAsync(BHomePersistenceContext db, CancellationToken t)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var period = new DateOnly(today.Year, today.Month, 1);
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Id(10).ToString()}, 0))", t);
        var location = await db.Locations.AsNoTracking().SingleOrDefaultAsync(l => l.Id == Id(10), t);
        if (location is null)
        {
            if (await db.Locations.AnyAsync(l => l.Name == "BHOME PAYMENT DEMO", t)) throw new LocalTestAccountException("Trùng tên cơ sở ngoài fixture payment; không thay đổi dữ liệu.");
            Add(db, 10, new Location("BHOME PAYMENT DEMO") { ChainId = await db.Set<Chain>().Select(c => c.Id).SingleAsync(t), Address = "ĐỊA CHỈ TỔNG HỢP - PAYMENT TEST ONLY" });
            Add(db, 11, new RoomType { LocationId = Id(10), Name = "Phòng payment tổng hợp", DefaultCapacity = 3 });
            db.Add(new StaffLocationAssignment(Id(10), User(2), User(1), today.AddYears(-1), today.AddYears(1)));
        }
        else if (location.Name != "BHOME PAYMENT DEMO") throw new LocalTestAccountException("Trùng ID fixture payment.");
        for (var room = 0; room < 4; room++)
        {
            var number = 20 + room; var label = room == 0 ? "PAY101-PAID" : room == 1 ? "PAY102-UNPAID" : room == 2 ? "PAY103-OVERDUE" : "PAY104-UI";
            var existing = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == Id(number), t);
            if (existing is not null) { if (existing.LocationId != Id(10) || existing.RoomNumber != label) throw new LocalTestAccountException("Trùng ID phòng payment ngoài fixture."); continue; }
            Add(db, number, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = label, Capacity = 3, Status = RoomStatus.Available });
            for (var person = 0; person < 3; person++) Add(db, 40 + room * 3 + person, new Resident
            {
                RoomId = Id(number),
                TenantUserId = User(3 + person),
                OwnerUserId = User(1),
                DisplayLabel = $"Người trả tổng hợp {(char)('A' + person)} ({label})",
                ResidentType = ResidentType.Representative,
                VerificationStatus = IdentityVerificationStatus.Verified,
                ConfirmedByUserId = User(2),
                ConfirmedAt = DateTimeOffset.UtcNow
            });
            for (var utility = 0; utility < 2; utility++) Add(db, 60 + room * 2 + utility, new Meter
            {
                RoomId = Id(number),
                Code = $"SYN-PAY-{room}-{utility}",
                UtilityType = (UtilityType)utility,
                Display = MeterDisplay.Digital,
                DecimalPlaces = 2,
                InstalledOn = period.AddMonths(-4)
            });
        }
        foreach (var (number, category, code, rate) in new[] { (80, ChargeCategory.Rent, "RENT", 3000000m), (81, ChargeCategory.Electricity, "ELECTRICITY", 3500m), (82, ChargeCategory.Water, "WATER", 15000m) })
            if (!await db.Set<BillingPolicy>().AnyAsync(p => p.Id == Id(number), t)) Add(db, number, new BillingPolicy
            {
                LocationId = Id(10),
                Category = category,
                ChargeCode = code,
                Name = "Giá tổng hợp payment " + code,
                Method = category == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered,
                Rate = rate,
                EffectiveFrom = period.AddYears(-1)
            });
        await db.SaveChangesAsync(t); await tx.CommitAsync(t);
    }
}
