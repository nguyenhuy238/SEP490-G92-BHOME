using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.LocalDevelopment;

// Explicitly requested synthetic configuration for the existing local Staff test workspace.
// No users, identity confirmations, contracts, room state or existing prices are changed.
internal static class MainDraftSettingsSeed
{
    public static async Task RunAsync(IServiceProvider provider, IConfiguration configuration)
    {
        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Database") ?? "");
        if (Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") != "Development" ||
            target.Host is not ("localhost" or "127.0.0.1" or "::1") || target.Database != "bhome")
            throw new InvalidOperationException("Only loopback Development database bhome is supported.");

        await using var scope = provider.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync())
            throw new InvalidOperationException("Apply pending migrations before seeding.");
        var location = await db.Locations.SingleAsync(l => l.Name == "BHOME TEST - Cơ sở Staff" && l.IsActive);
        var manager = services.GetRequiredService<UserManager<ApplicationUser>>();
        var owner = await manager.FindByNameAsync("owner.dev") ?? throw new InvalidOperationException("Missing local Owner.");
        var staff = await manager.FindByNameAsync("staff.dev") ?? throw new InvalidOperationException("Missing local Staff.");
        if (!owner.IsActive || !staff.IsActive || !await manager.IsInRoleAsync(owner, Roles.Owner) || !await manager.IsInRoleAsync(staff, Roles.Staff))
            throw new InvalidOperationException("Invalid local test roles.");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        if (!await db.Set<StaffLocationAssignment>().AnyAsync(a => a.LocationId == location.Id && a.StaffUserId == staff.Id && a.StartDate <= today && a.EndDate >= today))
            throw new InvalidOperationException("Staff has no active assignment to this test location.");
        var actor = services.GetRequiredService<LifecycleSeedActor>();
        actor.UserId = owner.Id;
        actor.Role = Roles.Owner;
        var data = services.GetRequiredService<IMainDraftData>();
        var drafts = services.GetRequiredService<MainDraftService>();
        var properties = services.GetRequiredService<PropertyService>();
        var created = 0;
        var settings = await data.OwnerSettingsAsync(location.Id, default);
        if (settings is null)
        {
            await drafts.SetSettingsAsync(location.Id, new(owner.Id, today, null, 3000000m,
                "DỮ LIỆU TEST: thanh toán tiền thuê hàng tháng; chưa ghi nhận thanh toán hoặc thu cọc.",
                "HỢP ĐỒNG THỬ NGHIỆM — thông tin bên cho thuê là dữ liệu tổng hợp, không sử dụng để ký thực tế.",
                new LessorProfile("CHỦ NHÀ TEST BHOME", new(1980, 1, 1), "000000000001", new(2020, 1, 1),
                    "NƠI CẤP TỔNG HỢP - TEST", "ĐỊA CHỈ TỔNG HỢP BHOME - CHỈ THỬ NGHIỆM", "0000000000"), 0), default);
            created++;
        }

        var roomTypes = await db.Set<RoomType>().Where(x => x.LocationId == location.Id && x.IsActive).ToArrayAsync();
        foreach (var type in roomTypes)
        {
            if (type.Name is not ("TEST - Tiêu chuẩn" or "TEST - Gia đình")) continue;
            await AddPolicy(type.Id, ChargeCategory.Rent, "RENT", type.Name == "TEST - Gia đình" ? 4500000m : 3000000m);
        }
        await AddPolicy(null, ChargeCategory.Electricity, "ELECTRICITY", 3500m);
        await AddPolicy(null, ChargeCategory.Water, "WATER", 15000m);
        await AddPolicy(null, ChargeCategory.ServiceFee, "SERVICE", 100000m);

        // Read through the same resolver used by the mobile API, rather than asserting only inserted rows.
        foreach (var room in await db.Set<Room>().Where(r => r.LocationId == location.Id).ToArrayAsync())
        {
            var prices = await properties.ResolvePricesAsync(room.Id, today, default);
            if (prices.MissingRequiredCharges.Count != 0) throw new InvalidOperationException("Room still has missing prices.");
            Console.WriteLine($"{room.RoomNumber}: {string.Join(", ", prices.Charges.Select(p => $"{p.ChargeCode}={p.Rate:0.####}"))}");
        }
        if (await data.SettingsAsync(location.Id, today, default) is null)
            throw new InvalidOperationException("No effective contract settings today; existing configuration preserved.");
        actor.UserId = staff.Id;
        actor.Role = Roles.Staff;
        var representatives = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking()
            .Where(r => r.Room.LocationId == location.Id && r.ResidentType == BHome.Domain.TenantContracts.ResidentType.Representative &&
                r.VerificationStatus == BHome.Domain.TenantContracts.IdentityVerificationStatus.Verified)
            .Select(r => new { r.Id, r.RoomId }).ToArrayAsync();
        var readyProfiles = 0;
        foreach (var resident in representatives)
        {
            try
            {
                var preparation = await drafts.PrepareAsync(resident.RoomId, resident.Id, [resident.Id], today, default);
                if (preparation.Blockers.Count == 0) readyProfiles++;
                else Console.WriteLine($"Preparation blocked: {string.Join(",", preparation.Blockers)}");
            }
            catch (BHome.Application.Contracts.ContractException error)
            {
                Console.WriteLine($"Preparation blocked: {error.Code}");
            }
        }
        Console.WriteLine($"Verified representative profiles ready for preparation: {readyProfiles}/{representatives.Length}. No identity data changed.");
        Console.WriteLine($"Created {created} missing configuration records. Existing data preserved. Staff workspace ready for Draft preparation.");

        async Task AddPolicy(Guid? roomType, ChargeCategory category, string code, decimal rate)
        {
            if (await db.Set<BillingPolicy>().AnyAsync(p => p.LocationId == location.Id && p.RoomTypeId == roomType && p.RoomId == null && p.ChargeCode == code && (p.EffectiveTo == null || p.EffectiveTo >= today))) return;
            await properties.CreatePolicyAsync(new(location.Id, roomType, null, category, code,
                $"TEST BHOME - {code}", category is ChargeCategory.Electricity or ChargeCategory.Water ? ChargingMethod.Metered : ChargingMethod.FixedPerRoomPerMonth,
                rate, today, null, "Dữ liệu test cấu hình hợp đồng theo yêu cầu người dùng; không thay biểu phí đã có."), default);
            created++;
        }
    }
}
