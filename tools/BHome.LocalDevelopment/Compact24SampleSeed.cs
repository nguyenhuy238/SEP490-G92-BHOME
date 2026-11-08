using System.Net;
using System.Security.Cryptography;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.Notifications;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.LocalDevelopment;

// Explicit synthetic fixtures, never API startup defaults or approved financial policy.
public static class Compact24SampleSeed
{
    public static Guid Id(int number) => Guid.Parse($"c2400000-0000-4000-8000-{number:000000000000}");
    public static readonly string[] AccountNames = ["owner.sample", "staff.sample", "tenant.sample", "tenant.other.sample"];

    public static void ValidateTarget(string? environment, string connection)
    {
        var target = new NpgsqlConnectionStringBuilder(connection);
        if (environment != "Development" ||
            !(string.Equals(target.Host, "localhost", StringComparison.OrdinalIgnoreCase) || IPAddress.TryParse(target.Host, out var ip) && IPAddress.IsLoopback(ip)) ||
            !(target.Database == "bhome" || System.Text.RegularExpressions.Regex.IsMatch(target.Database ?? "", "^bhome_compact24_[a-f0-9]{32}$")))
            throw new LocalTestAccountException("Sample seed requires Development, loopback PostgreSQL, bhome or an isolated Compact24 test database.");
    }

    public static async Task<bool> RunAsync(IServiceProvider services, string? environment, string? password = null,
        bool setSamplePasswords = false, CancellationToken token = default)
    {
        ValidateTarget(environment, services.GetRequiredService<IConfiguration>().GetConnectionString("Database") ?? "");
        return await SeedAsync(services, password, setSamplePasswords, token);
    }

    public static void ValidateSharedTarget(string? environment, string? branch, string connection)
    {
        var target = new NpgsqlConnectionStringBuilder(connection);
        if (environment != "Development" || branch != "development" || target.Database != "neondb" ||
            target.Host != "ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech" ||
            target.SslMode != SslMode.VerifyFull || target.ChannelBinding != ChannelBinding.Require)
            throw new LocalTestAccountException("Shared seed requires the explicitly selected verified Neon development pooled endpoint with TLS verification and channel binding.");
    }

    public static Task<bool> RunSharedDevelopmentAsync(IServiceProvider services, string? environment, string? branch,
        string password, CancellationToken token = default)
    {
        ValidateSharedTarget(environment, branch, services.GetRequiredService<IConfiguration>().GetConnectionString("Database") ?? "");
        if (string.IsNullOrWhiteSpace(password)) throw new LocalTestAccountException("Provide the synthetic account password through local secrets.");
        return SeedAsync(services, password, false, token);
    }

    private static async Task<bool> SeedAsync(IServiceProvider services, string? password, bool setSamplePasswords, CancellationToken token)
    {
        if (setSamplePasswords && string.IsNullOrWhiteSpace(password))
            throw new LocalTestAccountException("Enter a password explicitly before updating sample accounts.");
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        if (!await db.IsSchemaReadyAsync(token)) throw new LocalTestAccountException("Compact24 schema is not ready.");
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('compact24-development-sample-v1',0))", token);
        // The reviewed Compact24 chain adapter supports one Owner container. A fixture
        // must not introduce another Owner or take over an existing person's account.
        if (await db.Users.AnyAsync(u => u.Id != Id(1) && EF.Property<string[]>(u, "roles").Contains(Roles.Owner), token))
            throw new LocalTestAccountException("Sample seed cannot add a second Owner. Use a fresh local Compact24 workspace; existing Owner data is preserved.");
        var roleNames = new[] { Roles.Owner, Roles.Staff, Roles.Tenant, Roles.Tenant };
        for (var n = 0; n < AccountNames.Length; n++)
        {
            var account = await users.FindByNameAsync(AccountNames[n]);
            if (account is not null && (account.Id != Id(n + 1) || !account.IsActive ||
                !(await users.GetRolesAsync(account)).SequenceEqual([roleNames[n]])))
                throw new LocalTestAccountException("Sample name belongs to another account or its role/state changed; nothing was overwritten.");
            if (account is null)
            {
                account = new ApplicationUser { Id = Id(n + 1), UserName = AccountNames[n], Email = AccountNames[n] + "@example.invalid", IsActive = true, LockoutEnabled = true };
                db.PrepareUserRole(account, roleNames[n]);
                Check(await users.CreateAsync(account, password ?? ("Sample!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32)))));
            }
            else if (setSamplePasswords)
            {
                // Identity validates/hashes the password and rotates the security stamp, revoking sessions.
                var resetToken = await users.GeneratePasswordResetTokenAsync(account);
                Check(await users.ResetPasswordAsync(account, resetToken, password!));
            }
        }
        var marker = "Compact24SampleSeed:v1";
        var exists = await db.SecurityAudit.AnyAsync(a => a.Event == marker && a.TargetId == Id(10), token);
        if (!exists)
        {
            var chain = await db.Set<Chain>().SingleOrDefaultAsync(token);
            if (chain is null) { chain = new Chain { Name = "BHOME" }; Add(db, 9, chain); }
            var now = DateTimeOffset.UtcNow;
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
            for (var site = 0; site < 2; site++)
            {
                var locationId = Id(10 + site);
                Add(db, 10 + site, new Location($"BHOME SAMPLE {site + 1}") { ChainId = chain.Id, Address = $"Địa chỉ tổng hợp số {site + 1} — chỉ dùng phát triển" });
                Add(db, 20 + site, new RoomType { LocationId = locationId, Name = "Phòng mẫu", DefaultCapacity = 2, AreaM2 = 24, Amenities = ["Wifi", "Khu giặt chung"] });
                // Only the first Location is assigned: the second exercises Staff isolation.
                if (site == 0) Add(db, 30, new StaffLocationAssignment(locationId, Id(2), Id(1), today.AddYears(-1), today.AddYears(1)));
                for (var room = 0; room < 3; room++)
                {
                    var index = site * 3 + room;
                    var roomId = Id(40 + index);
                    Add(db, 40 + index, new Room { LocationId = locationId, RoomTypeId = Id(20 + site), RoomNumber = $"S{site + 1}0{room + 1}", Floor = "1", Capacity = 2, Status = room == 2 ? RoomStatus.Unavailable : RoomStatus.Available });
                    Add(db, 50 + index, new Asset { LocationId = locationId, RoomId = roomId, Code = $"SAMPLE-FAN-{index + 1}", Name = "Quạt mẫu", Category = "Thiết bị", Condition = "Dữ liệu tổng hợp", Status = AssetStatus.Active });
                    for (var utility = 0; utility < 2; utility++) Add(db, 60 + index * 2 + utility, new Meter { RoomId = roomId, Code = $"SAMPLE-{index + 1}-{utility}", UtilityType = (UtilityType)utility, Display = MeterDisplay.Digital, DecimalPlaces = utility, InstalledOn = today.AddDays(-1) });
                }
                var categories = new[] { ChargeCategory.Rent, ChargeCategory.Electricity, ChargeCategory.Water, ChargeCategory.ServiceFee };
                var codes = new[] { "RENT", "ELECTRICITY", "WATER", "WIFI" };
                var amounts = new decimal[] { 3000000, 3500, 15000, 100000 };
                for (var charge = 0; charge < 4; charge++) Add(db, 80 + site * 4 + charge, new BillingPolicy
                { LocationId = locationId, Category = categories[charge], ChargeCode = codes[charge], Name = $"Giá mẫu {codes[charge]} — cần Owner xem lại", Method = charge is 1 or 2 ? ChargingMethod.Metered : ChargingMethod.FixedPerRoomPerMonth, Rate = amounts[charge], EffectiveFrom = today.AddDays(-1) });
                // Scheduling/finalization automation is deliberately not enabled by a data fixture.
            }
            for (var person = 0; person < 3; person++) Add(db, 100 + person, new Resident
            { RoomId = Id(person == 2 ? 43 : 40), OwnerUserId = Id(2), TenantUserId = person == 0 ? Id(3) : person == 2 ? Id(4) : null, DisplayLabel = $"Người ở mẫu {person + 1}", ResidentType = person == 1 ? ResidentType.CoOccupant : ResidentType.Representative, VerificationStatus = IdentityVerificationStatus.Pending });
            for (var task = 0; task < 4; task++)
            {
                var meterTask = task < 2;
                Add(db, 110 + task, new OperationalTask
                { LocationId = Id(10), Kind = meterTask ? OperationalTaskKind.MeterReading : OperationalTaskKind.AdHoc, Title = meterTask ? $"Ghi chỉ số ban đầu mẫu {task + 1}" : $"Kiểm tra phòng mẫu {task - 1}", Requirements = "Dữ liệu mẫu; nhập kết quả và xác nhận thực tế trước khi hoàn tất.", AssignedStaffUserId = Id(2), AssignmentId = Id(30), AssignedAt = now, DueAt = now.AddDays(3), MeterId = meterTask ? Id(60 + task) : null, Purpose = ReadingPurpose.Initial, ReadingDate = today, Status = MeterTaskStatus.Assigned });
                Add(db, 120 + task, new OperationalTaskHistory { TaskId = Id(110 + task), ActorId = Id(1), ResponsibleStaffUserId = Id(2), Action = "created", Note = "Khởi tạo dữ liệu mẫu local", OccurredAt = now, TaskVersion = 1 });
            }
            Add(db, 130, new UserNotification { RecipientUserId = Id(2), AudienceRole = Roles.Staff, LocationId = Id(10), Category = "Task", Title = "Công việc mẫu", Summary = "Kiểm tra công việc được giao tại cơ sở mẫu.", RelatedObjectType = "OperationalTask", RelatedObjectId = Id(112), EventKey = marker + ":staff", CreatedAt = now });
            db.SecurityAudit.Add(new SecurityAuditRecord { UserId = Id(1), Event = marker, TargetType = "Location", TargetId = Id(10), Succeeded = true, OccurredAt = now });
            await db.SaveChangesAsync(token);
        }
        await transaction.CommitAsync(token);
        return !exists;
    }

    private static void Add<T>(Compact24DbContext db, int id, T value) where T : class
    { db.Entry(value).Property("Id").CurrentValue = Id(id); db.Add(value); }

    private static void Check(IdentityResult result)
    { if (!result.Succeeded) throw new LocalTestAccountException("Sample account rejected: " + string.Join(',', result.Errors.Select(e => e.Code))); }
}
