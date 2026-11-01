using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.LocalDevelopment;

// Called only after ContractDemoSeed validates the isolated loopback Development/Testing target.
internal static class InvoiceDemoSeed
{
    private static Guid Id(int number) => ContractDemoSeed.Id(number);
    private static void Add<T>(BHomeDbContext db, int number, T value) where T : class
    { db.Entry(value).Property("Id").CurrentValue = Id(number); db.Add(value); }
    public static async Task PrepareAsync(BHomeDbContext db, CancellationToken t)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var period = new DateOnly(today.Year, today.Month, 1);
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Id(10).ToString()}, 0))", t);
        // Separate from existing contract/handover fixtures. Never reset them.
        for (var roomIndex = 0; roomIndex < 3; roomIndex++)
        {
            var roomNumber = 24 + roomIndex;
            var label = roomIndex == 0 ? "P105-BILL" : roomIndex == 1 ? "P106-DRAFT" : "P107-REVIEW";
            var existing = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == Id(roomNumber), t);
            if (existing is not null)
            {
                if (existing.LocationId != Id(10) || existing.RoomNumber != label)
                    throw new LocalTestAccountException("Trùng ID phòng ngoài fixture hóa đơn; không thay đổi dữ liệu.");
                continue;
            }
            Add(db, roomNumber, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = label, Capacity = 2, Status = RoomStatus.Available });
            for (var person = 0; person < 2; person++)
                Add(db, 80 + roomIndex * 2 + person, new Resident { RoomId = Id(roomNumber), TenantUserId = Id(3 + person), OwnerUserId = Id(1),
                    DisplayLabel = $"Người ở hóa đơn tổng hợp {roomIndex + 1}-{person + 1}", VerificationStatus = IdentityVerificationStatus.Verified,
                    ResidentType = person == 0 ? ResidentType.Representative : ResidentType.CoOccupant, ConfirmedByUserId = Id(2), ConfirmedAt = DateTimeOffset.UtcNow });
            for (var utility = 0; utility < 2; utility++)
                Add(db, 70 + roomIndex * 2 + utility, new Meter { RoomId = Id(roomNumber), Code = $"DEMO-BILL-{roomIndex}-{utility}",
                    UtilityType = (UtilityType)utility, Display = MeterDisplay.Digital, DecimalPlaces = 2, InstalledOn = period.AddMonths(-2) });
        }
        foreach (var (number, category, code, rate) in new[] { (90, ChargeCategory.Electricity, "ELECTRICITY", 3500m), (91, ChargeCategory.Water, "WATER", 15000m) })
        {
            if (await db.Set<BillingPolicy>().AnyAsync(p => p.Id == Id(number), t)) continue;
            if (await db.Set<BillingPolicy>().AnyAsync(p => p.LocationId == Id(10) && p.Category == category && p.RoomId == null && p.RoomTypeId == null, t))
                throw new LocalTestAccountException("Đã có biểu giá utility ngoài fixture; không thay thế hoặc tạo trùng.");
            Add(db, number, new BillingPolicy { LocationId = Id(10), Category = category, ChargeCode = code, Name = "Giá " + code + " tổng hợp demo",
                Method = ChargingMethod.Metered, Rate = rate, EffectiveFrom = period.AddYears(-1) });
        }
        await db.SaveChangesAsync(t); await transaction.CommitAsync(t);
    }
}
