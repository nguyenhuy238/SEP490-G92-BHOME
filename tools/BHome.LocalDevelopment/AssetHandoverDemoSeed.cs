using System.Security.Cryptography;
using System.Text;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenCvSharp;
using Minio;
using Minio.DataModel.Args;

namespace BHome.LocalDevelopment;

// Explicit disposable demo only. It creates synthetic preconditions and executes real contract
// signing/activation services in the labelled Development simulation; it is never API startup code.
public static class AssetHandoverDemoSeed
{
    public static Guid Id(int n) => Guid.Parse($"ad170000-0000-4000-8000-{n:000000000000}");
    private static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
    public static async Task RunAsync(IServiceProvider provider, string environment, string password)
    {
        var config = provider.GetRequiredService<IConfiguration>(); var target = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Database"));
        if (environment != "Development" || target.Host is not ("127.0.0.1" or "localhost") ||
            !System.Text.RegularExpressions.Regex.IsMatch(target.Database ?? "", "^bhome_compact24_[a-f0-9]{32}$"))
            throw new LocalTestAccountException("Handover demo requires Development and a disposable loopback bhome_compact24_<32 hex> database.");
        if (string.IsNullOrWhiteSpace(password) || !config.GetValue<bool>("ContractWorkflow:SimulatedSigningEnabled"))
            throw new LocalTestAccountException("Set BHOME_HANDOVER_DEMO_PASSWORD and enable Development simulated signing explicitly.");
        var endpoint = config["ObjectStorage:Endpoint"] ?? "";
        if (!Uri.TryCreate("http://" + endpoint, UriKind.Absolute, out var storageUri) || !storageUri.IsLoopback || config["ObjectStorage:Bucket"] != "handover-demo")
            throw new LocalTestAccountException("Handover demo requires isolated loopback object storage and bucket handover-demo.");
        using var minio = new MinioClient().WithEndpoint(endpoint).WithCredentials(config["ObjectStorage:AccessKey"], config["ObjectStorage:SecretKey"]).Build();
        if (!await minio.BucketExistsAsync(new BucketExistsArgs().WithBucket("handover-demo"))) await minio.MakeBucketAsync(new MakeBucketArgs().WithBucket("handover-demo"));
        await Compact24SampleSeed.RunAsync(provider, environment, password);
        await using var scope = provider.CreateAsyncScope(); var services = scope.ServiceProvider;
        var identity = services.GetRequiredService<Compact24DbContext>();
        await using var db = OfflineFixturePersistence.Open(services);
        var store = services.GetRequiredService<ISetupWorkspaceStore>();
        var actor = services.GetRequiredService<LifecycleSeedActor>(); var users = services.GetRequiredService<UserManager<ApplicationUser>>();
        foreach (var n in new[] { 1, 2, 3, 4 })
        {
            var account = await users.FindByIdAsync(Compact24SampleSeed.Id(n).ToString()) ?? throw new LocalTestAccountException("Synthetic account missing.");
            account.EmailConfirmed = true;
            identity.Entry(account).Property("full_name").CurrentValue = $"Tài khoản demo bàn giao {n}";
            account.PhoneNumber = $"+1555000100{n}";
            var result = await users.UpdateAsync(account);
            if (!result.Succeeded) throw new LocalTestAccountException("Cannot prepare synthetic account profile.");
        }
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var owner = Compact24SampleSeed.Id(1); var staff = Compact24SampleSeed.Id(2); var tenant = Compact24SampleSeed.Id(3);
        actor.UserId = owner; actor.Role = Roles.Owner;
        if (!await db.Locations.AnyAsync(l => l.Id == Id(10)))
        {
            void Add<T>(int n, T entity) where T : class { db.Entry(entity).Property("Id").CurrentValue = Id(n); db.Add(entity); }
            Add(10, new Location("[DEMO] Bàn giao tài sản") { Address = "Địa chỉ tổng hợp — dữ liệu demo" });
            Add(20, new Room { LocationId = Id(10), RoomNumber = "BG-101", Capacity = 3, Status = RoomStatus.Available });
            Add(30, new Resident { RoomId = Id(20), TenantUserId = tenant, OwnerUserId = owner, DisplayLabel = "Tenant bàn giao tổng hợp", VerificationStatus = IdentityVerificationStatus.Verified, ConfirmedByUserId = staff, ConfirmedAt = DateTimeOffset.UtcNow });
            db.Add(new StaffLocationAssignment(Id(10), staff, owner, today.AddYears(-1), today.AddYears(1)));
            foreach (var (n, category, code, rate) in new[] { (60, ChargeCategory.Rent, "RENT", 1000000m), (61, ChargeCategory.Electricity, "ELECTRICITY", 3500m), (62, ChargeCategory.Water, "WATER", 15000m) })
                Add(n, new BillingPolicy { LocationId = Id(10), ChargeCode = code, Category = category, Name = "Giá tổng hợp " + code, Rate = rate, Method = category == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered, EffectiveFrom = today.AddYears(-1) });
            await db.SaveChangesAsync();
            var names = new[] { "Ghế", "Bàn", "Giường", "Tủ", "Quạt", "Máy lạnh", "Đèn", "Rèm", "Kệ" };
            var items = names.Select((name, index) => new AssetTemplateItem(Id(100 + index), name, "Tài sản phòng", "BulkQuantity", index == 0 ? 4 : 1, "cái")).ToArray();
            await store.TransactionAsync(Id(10), async () =>
            {
                await store.SaveAsync(Id(50), Id(10), "AssetTemplate", "Published", new AssetTemplateWrite(Id(10), "Tài sản BG-101", items, Scoped: true, ScopeRoomId: Id(20)), 0, owner, default);
                await store.SaveAsync(Key($"asset-template-assignment:{Id(20)}"), Id(10), "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(Id(50)), 0, owner, default);
                await store.SaveAsync(Id(51), Id(10), "DesiredAssets", "PendingVerification", new DesiredAssets(Id(50), 1, Id(20), items, "PendingVerification"), 0, owner, default); return true;
            }, default);
            var review = await services.GetRequiredService<RoomInventoryReviewService>().GetAsync(Id(10), default); var room = review.Rooms.Single(r => r.RoomId == Id(20));
            await services.GetRequiredService<RoomInventoryReviewService>().ConfirmAsync(Id(10), new(Guid.NewGuid(),
                [new(room.RoomId, room.DesiredId, room.DesiredVersion, room.StateToken, room.Items.Select((item, index) => new RoomInventoryReviewInputItem(item.Id, index < 7, [])).ToArray())], true), default);
        }
        var contract = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.RoomId == Id(20) && c.Kind == ContractKind.Main);
        var service = services.GetRequiredService<ContractService>();
        var id = contract?.Id ?? (await service.CreateAsync(new(Id(20), owner, tenant, Id(30), [Id(30)], today, today.AddMonths(6), 1000000, 0,
            "[DEMO] Dữ liệu tổng hợp; ký mô phỏng Development, không phải chứng thư số và không phải giao dịch ngân hàng thực."), Guid.NewGuid(), default)).Id;
        if (contract?.Status != ContractStatus.Active && contract?.Status != ContractStatus.Terminated)
        {
            foreach (var (person, role) in new[] { (owner, Roles.Owner), (tenant, Roles.Tenant) })
            {
                actor.UserId = person; actor.Role = role; var current = await service.GetAsync(id, default);
                if (!current.Signatures.Any(s => s.SignerUserId == person && s.Status != "Failed"))
                    await service.RequestSigningAsync(id, new(Guid.Empty, Method: SigningMethods.Simulated, Consent: true), Guid.NewGuid(), default);
                await service.SyncSigningAsync(id, default);
            }
            actor.UserId = owner; actor.Role = Roles.Owner;
            if ((await service.GetAsync(id, default)).Status == "PendingActivation") await service.ActivateAsync(id, Guid.NewGuid(), default);
        }
        using var image = new Mat(120, 420, MatType.CV_8UC3, Scalar.White);
        Cv2.PutText(image, "BHOME SYNTHETIC HANDOVER", new Point(12, 55), HersheyFonts.HersheySimplex, 0.65, Scalar.Black, 1);
        var png = image.ImEncode(".png"); var storage = services.GetRequiredService<IObjectStorage>();
        foreach (var type in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            if (await db.Set<Meter>().AnyAsync(m => m.RoomId == Id(20) && m.UtilityType == type)) continue;
            var meter = new Meter { RoomId = Id(20), Code = "BG-101-" + type, UtilityType = type, InstalledOn = today.AddDays(-1) }; db.Add(meter); await db.SaveChangesAsync();
            var task = new OperationalTask { Kind = BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading, LocationId = Id(10), MeterId = meter.Id, ReadingDate = today, Purpose = ReadingPurpose.Initial, Status = MeterTaskStatus.Completed, CompletedAt = DateTimeOffset.UtcNow }; db.Add(task); await db.SaveChangesAsync();
            var evidence = new MeterEvidence { TaskId = task.Id, ObjectKey = $"handover-demo/meters/{Guid.NewGuid():N}.png", ContentType = "image/png", Length = png.Length, ImageHash = Convert.ToHexString(SHA256.HashData(png)), UploadedByUserId = staff, IsUploaded = true, IsLinked = true };
            using var bytes = new MemoryStream(png); await storage.PutAsync(evidence.ObjectKey, bytes, bytes.Length, "image/png", default);
            db.Add(evidence); await db.SaveChangesAsync(); db.Add(new MeterReading { TaskId = task.Id, MeterId = meter.Id, EvidenceId = evidence.Id, ConfirmedValue = 100, ConfirmedByUserId = staff, ConfirmedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        }
        var directory = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", "handover-demo"); Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Combine(directory, "synthetic-evidence.png"), png);
        await File.WriteAllTextAsync(Path.Combine(directory, "scenario.json"), System.Text.Json.JsonSerializer.Serialize(new
        {
            contractId = id,
            locationId = Id(10),
            roomId = Id(20),
            accounts = Compact24SampleSeed.AccountNames.Select(name => name + "@example.invalid"),
            evidenceFile = Path.Combine(directory, "synthetic-evidence.png")
        }));
        Console.WriteLine($"Handover demo ready: Contract {id}; Room BG-101; 7/9 inventory groups checked. Synthetic accounts use the locally supplied password; no password is printed.");
        actor.UserId = null; actor.Role = "";
    }
}
