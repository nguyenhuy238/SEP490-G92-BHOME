using System.Net;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Minio;
using Minio.DataModel.Args;
using Npgsql;
using OpenCvSharp;

namespace BHome.LocalDevelopment;

// Explicit fixture ownership: never targets the developer's bhome database.
public static class ContractDemoSeed
{
    public static Guid Id(int value) => Guid.Parse($"de000000-0000-4000-8000-{value:000000000000}");
    private static void Add<T>(BHomeDbContext db, int id, T entity) where T : class
    { db.Entry(entity).Property("Id").CurrentValue = Id(id); db.Add(entity); }
    public static void ValidateTarget(string? environment, string connection)
    {
        var target = new NpgsqlConnectionStringBuilder(connection);
        if (environment is not ("Development" or "Testing") ||
            !(target.Host == "localhost" || IPAddress.TryParse(target.Host, out var ip) && IPAddress.IsLoopback(ip)) ||
            target.Database != "bhome_contract_demo")
            throw new LocalTestAccountException("Seed chỉ được phép trên PostgreSQL loopback, database bhome_contract_demo, Development/Testing.");
    }

    public static async Task RunAsync(IServiceProvider services, string? environment, string password, CancellationToken t = default)
    {
        var config = services.GetRequiredService<IConfiguration>();
        ValidateTarget(environment, config.GetConnectionString("Database") ?? "");
        if (!config.GetValue<bool>("ContractWorkflow:SimulatedSigningEnabled") || config["ContractPdf:TemplateId"] != "main-contract-development-v1")
            throw new LocalTestAccountException("Seed yêu cầu cấu hình template Development và SIMULATED SIGNING.");
        var endpoint = config["ObjectStorage:Endpoint"] ?? "";
        if (!Uri.TryCreate("http://" + endpoint, UriKind.Absolute, out var storageUri) || !storageUri.IsLoopback || config["ObjectStorage:Bucket"] != "contract-demo")
            throw new LocalTestAccountException("Seed yêu cầu MinIO loopback và bucket contract-demo riêng.");
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await db.Database.MigrateAsync(t);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var accounts = new[] { (1, "owner.contract.demo", Roles.Owner), (2, "staff.contract.demo", Roles.Staff), (3, "tenant1.contract.demo", Roles.Tenant), (4, "tenant2.contract.demo", Roles.Tenant), (5, "tenant3.contract.demo", Roles.Tenant) };
        await using var tx = await db.Database.BeginTransactionAsync(t);
        foreach (var (number, name, role) in accounts)
        {
            var existing = await users.FindByNameAsync(name);
            if (existing is not null)
            {
                if (existing.Id != Id(number) || !existing.IsActive || !(await users.GetRolesAsync(existing)).SequenceEqual([role]))
                    throw new LocalTestAccountException("Trùng tên dữ liệu ngoài fixture; không thay đổi tài khoản hoặc quyền.");
                continue;
            }
            if (await db.Users.AnyAsync(u => u.Id == Id(number), t)) throw new LocalTestAccountException("Trùng ID ngoài fixture.");
            var user = new ApplicationUser { Id = Id(number), UserName = name, Email = name + "@example.invalid", IsActive = true, LockoutEnabled = true };
            var created = await users.CreateAsync(user, password);
            if (!created.Succeeded || !(await users.AddToRoleAsync(user, role)).Succeeded)
                throw new LocalTestAccountException("Không thể tạo tài khoản demo; kiểm tra chính sách mật khẩu local.");
        }
        if (!await db.Locations.AnyAsync(l => l.Id == Id(10), t))
        {
            if (await db.Locations.AnyAsync(l => l.Name == "BHOME CONTRACT DEMO", t)) throw new LocalTestAccountException("Trùng tên cơ sở ngoài fixture.");
            var chain = await db.Set<Chain>().SingleAsync(t);
            Add(db, 10, new Location("BHOME CONTRACT DEMO") { ChainId = chain.Id, Address = "ĐỊA CHỈ TỔNG HỢP - CHỈ THỬ NGHIỆM" });
            Add(db, 11, new RoomType { LocationId = Id(10), Name = "Phòng demo", DefaultCapacity = 3, AreaM2 = 25 });
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
            db.Add(new StaffLocationAssignment(Id(10), Id(2), Id(1), today.AddYears(-1), today.AddYears(1)));
            for (var n = 0; n < 3; n++)
            {
                Add(db, 20 + n, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = $"P10{n + 1}", Capacity = 3, Status = n == 2 ? RoomStatus.Unavailable : RoomStatus.Available });
                Add(db, 30 + n, new Asset { LocationId = Id(10), RoomId = Id(20 + n), Name = "Quạt tổng hợp", Category = "Thiết bị", Condition = "Mới - dữ liệu demo", Status = AssetStatus.Active });
                for (var utility = 0; utility < 2; utility++) Add(db, 40 + n * 2 + utility, new Meter { RoomId = Id(20 + n), Code = $"DEMO-P10{n + 1}-{(utility == 0 ? "E" : "W")}", UtilityType = (UtilityType)utility, Display = MeterDisplay.Digital, InstalledOn = today.AddDays(-1) });
            }
            for (var n = 0; n < 3; n++) Add(db, 50 + n, new Resident { RoomId = Id(n == 2 ? 21 : 20), DisplayLabel = $"Người ở tổng hợp {n + 1}", ResidentType = n == 1 ? ResidentType.CoOccupant : ResidentType.Representative, VerificationStatus = IdentityVerificationStatus.Verified, OwnerUserId = Id(2), TenantUserId = Id(3 + n), ConfirmedByUserId = Id(2), ConfirmedAt = DateTimeOffset.UtcNow });
            Add(db, 60, new BillingPolicy { LocationId = Id(10), RoomTypeId = Id(11), Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Giá thuê demo", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 3000000, EffectiveFrom = today.AddYears(-1) });
            await db.SaveChangesAsync(t);
        }
        // Separate UI smoke workspace leaves P101 available for a tester's first run.
        if (!await db.Set<Room>().AnyAsync(r => r.Id == Id(23), t))
        {
            Add(db, 23, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = "P104-UI", Capacity = 1, Status = RoomStatus.Available });
            Add(db, 53, new Resident { RoomId = Id(23), DisplayLabel = "Người ở UI tổng hợp", ResidentType = ResidentType.Representative, VerificationStatus = IdentityVerificationStatus.Verified, OwnerUserId = Id(2), TenantUserId = Id(4), ConfirmedByUserId = Id(2), ConfirmedAt = DateTimeOffset.UtcNow });
            Add(db, 33, new Asset { LocationId = Id(10), RoomId = Id(23), Name = "Quạt UI tổng hợp", Category = "Thiết bị", Condition = "Mới - dữ liệu demo", Status = AssetStatus.Active });
            for (var utility = 0; utility < 2; utility++) Add(db, 46 + utility, new Meter { RoomId = Id(23), Code = $"DEMO-P104-{(utility == 0 ? "E" : "W")}", UtilityType = (UtilityType)utility, InstalledOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1) });
            await db.SaveChangesAsync(t);
        }
        await tx.CommitAsync(t);
        await InvoiceDemoSeed.PrepareAsync(db, t);
        using var storage = new MinioClient().WithEndpoint(endpoint).WithCredentials(config["ObjectStorage:AccessKey"], config["ObjectStorage:SecretKey"]).Build();
        if (!await storage.BucketExistsAsync(new BucketExistsArgs().WithBucket("contract-demo"), t))
            await storage.MakeBucketAsync(new MakeBucketArgs().WithBucket("contract-demo"), t);
        var artifacts = System.IO.Path.Combine(Directory.GetCurrentDirectory(), ".tools", "contract-demo");
        Directory.CreateDirectory(artifacts);
        using (var synthetic = new Mat(240, 640, MatType.CV_8UC3, Scalar.White))
        {
            Cv2.PutText(synthetic, "BHOME SYNTHETIC DEMO", new Point(20, 70), HersheyFonts.HersheySimplex, 1, Scalar.Black, 2);
            Cv2.PutText(synthetic, "METER / ROOM EVIDENCE FIXTURE", new Point(20, 130), HersheyFonts.HersheySimplex, 0.7, Scalar.Black, 2);
            Cv2.PutText(synthetic, "100 - NOT A REAL PHOTO", new Point(20, 190), HersheyFonts.HersheySimplex, 0.8, Scalar.Black, 2);
            await File.WriteAllBytesAsync(System.IO.Path.Combine(artifacts, "synthetic-evidence.png"), synthetic.ImEncode(".png"), t);
        }
        Console.WriteLine("Đã seed/kiểm tra fixture hợp đồng. Tài khoản owner/staff/tenant1/tenant2/tenant3.contract.demo; mật khẩu giữ trong cấu hình local, không in ra log. Không reset dữ liệu.");
    }
}
