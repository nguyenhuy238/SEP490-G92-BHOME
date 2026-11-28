using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
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

// Explicit, opt-in local test fixture. Never runs during API startup.
// All Location/Room/Resident/Staff data are new and labelled synthetic.
internal static class StaffInventoryActiveSeed
{
    private const string LocationName = "[DEMO] Kiểm kê Staff - 3 hợp đồng";
    private const string ConfirmPhrase = "CREATE-THREE-SYNTHETIC-ACTIVE-CONTRACTS";
    private const string CredentialsDirectory = ".tools/staff-inventory-active";
    private const string Terms = "[DEMO] Hợp đồng kiểm kê tài sản tổng hợp. Ký mô phỏng Development; không có giao dịch hoặc chữ ký pháp lý thật.";
    private static readonly string[] UserNames =
    [
        "staff.inventory.active.demo",
        "tenant.inventory.active.1.demo",
        "tenant.inventory.active.2.demo",
        "tenant.inventory.active.3.demo"
    ];

    private static Guid Id(int number) => Guid.Parse($"5a1f0000-0000-4000-8000-{number:000000000000}");
    private static Guid Key(string operation) => new(SHA256.HashData(Encoding.UTF8.GetBytes("staff-inventory-active-v1/" + operation)).AsSpan(0, 16));
    // SetupWorkspaceService uses the raw key; a fixture-specific prefix hides the assignment from inventory resolution.
    private static Guid AssignmentKey(Guid roomId) => new(SHA256.HashData(
        Encoding.UTF8.GetBytes($"asset-template-assignment:{roomId}")).AsSpan(0, 16));
    private static DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    internal static void ValidateTarget(IConfiguration configuration, string? environment, string mode)
    {
        if (mode is not ("--inspect" or "--apply") || environment != "Development")
            throw new LocalTestAccountException("Chỉ cho phép --inspect/--apply trong Development.");
        var value = configuration.GetConnectionString("Database") ?? "";
        var target = new NpgsqlConnectionStringBuilder(value);
        if (!string.Equals(target.Host, "localhost", StringComparison.OrdinalIgnoreCase) &&
            !(IPAddress.TryParse(target.Host, out var ip) && IPAddress.IsLoopback(ip)) ||
            target.Port != 5434 || target.Database != "bhome")
            throw new LocalTestAccountException("Fixture chỉ sử dụng PostgreSQL loopback, port 5434, database bhome.");
        if (mode == "--apply" && Environment.GetEnvironmentVariable("BHOME_STAFF_INVENTORY_SEED_CONFIRM") != ConfirmPhrase)
            throw new LocalTestAccountException($"Để ghi dữ liệu, đặt BHOME_STAFF_INVENTORY_SEED_CONFIRM={ConfirmPhrase} và dùng --apply.");
    }

    private static void Add<T>(BHomePersistenceContext db, int number, T entity) where T : class
    {
        db.Entry(entity).Property("Id").CurrentValue = Id(number);
        db.Add(entity);
    }

    private static string CredentialsPath => Path.Combine(Directory.GetCurrentDirectory(), CredentialsDirectory, "credentials.json");

    private static async Task<Dictionary<string, string>> CredentialsAsync(CancellationToken t)
    {
        var path = CredentialsPath;
        if (File.Exists(path))
        {
            var saved = JsonSerializer.Deserialize<Dictionary<string, string>>(await File.ReadAllTextAsync(path, t))
                ?? throw new LocalTestAccountException("Private credentials file is invalid.");
            if (saved.Count != UserNames.Length || UserNames.Any(name => !saved.TryGetValue(name, out var password) || password.Length < 12))
                throw new LocalTestAccountException("Private credentials file has an unexpected shape.");
            return saved;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!); // .tools/ is gitignored.
        var credentials = UserNames.ToDictionary(name => name,
            _ => "Demo!aA9" + Convert.ToHexString(RandomNumberGenerator.GetBytes(24)));
        // CreateNew avoids overwriting a tester's original credentials on replay.
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await JsonSerializer.SerializeAsync(file, credentials, cancellationToken: t);
        return credentials;
    }

    private static async Task<(Guid Owner, bool Complete, bool Existing)> InspectAsync(
        BHomePersistenceContext db, UserManager<User> users, CancellationToken t)
    {
        if (!await db.IsSchemaReadyAsync(t))
            throw new LocalTestAccountException("Compact24 schema chưa sẵn sàng; không tạo fixture.");
        var owners = await db.Users.AsNoTracking()
            .Where(user => user.IsActive && EF.Property<string[]>(user, "roles").Contains(Roles.Owner))
            .Select(user => user.Id).ToArrayAsync(t);
        if (owners.Length != 1)
            throw new LocalTestAccountException("Cần đúng một Owner đang hoạt động. Không sửa tài khoản Owner.");
        var location = await db.Locations.AsNoTracking().SingleOrDefaultAsync(location => location.Id == Id(10), t);
        if (location is null)
        {
            if (await db.Locations.AnyAsync(l => l.Name == LocationName, t) ||
                await db.Set<Room>().AnyAsync(r => new[] { Id(20), Id(21), Id(22) }.Contains(r.Id), t) ||
                await db.Set<Resident>().AnyAsync(r => new[] { Id(30), Id(31), Id(32) }.Contains(r.Id), t) ||
                await db.Set<BillingPolicy>().AnyAsync(p => new[] { Id(60), Id(61), Id(62) }.Contains(p.Id), t) ||
                await db.Users.AnyAsync(u => new[] { Id(2), Id(3), Id(4), Id(5) }.Contains(u.Id), t))
                throw new LocalTestAccountException("Fixture ID/tên bị chiếm; không chạm dữ liệu có sẵn.");
            foreach (var name in UserNames)
                if (await users.FindByNameAsync(name) is not null)
                    throw new LocalTestAccountException("Tên tài khoản tổng hợp đã tồn tại nhưng Location fixture chưa có; cần kiểm tra thủ công.");
            Console.WriteLine("STAFF_INVENTORY_INSPECT: chưa có fixture; 3 phòng và 4 tài khoản tổng hợp có thể được tạo.");
            return (owners[0], false, false);
        }
        if (location.Name != LocationName || !location.IsActive)
            throw new LocalTestAccountException("Location fixture bị đổi tên/trạng thái hoặc trùng ID; không ghi đè.");
        var staff = await users.FindByIdAsync(Id(2).ToString());
        if (staff is null || staff.UserName != UserNames[0] || !staff.IsActive ||
            !(await users.GetRolesAsync(staff)).SequenceEqual([Roles.Staff]))
            throw new LocalTestAccountException("Tài khoản Staff fixture đã thay đổi; không ghi đè.");
        for (var i = 0; i < 3; i++)
        {
            var tenant = await users.FindByIdAsync(Id(3 + i).ToString());
            if (tenant is null || tenant.UserName != UserNames[i + 1] || !tenant.IsActive ||
                !(await users.GetRolesAsync(tenant)).SequenceEqual([Roles.Tenant]))
                throw new LocalTestAccountException("Tài khoản Tenant fixture đã thay đổi; không ghi đè.");
            var room = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == Id(20 + i), t);
            if (room is null || room.LocationId != Id(10) || room.RoomNumber != $"KI-10{i + 1}")
                throw new LocalTestAccountException("Phòng fixture đã thay đổi; không ghi đè.");
            var resident = await db.Set<Resident>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == Id(30 + i), t);
            if (resident is null || resident.RoomId != room.Id || resident.TenantUserId != Id(3 + i))
                throw new LocalTestAccountException("Người thuê fixture đã thay đổi; không ghi đè.");
        }
        var contracts = await db.Set<Contract>().AsNoTracking()
            .Where(c => new[] { Id(20), Id(21), Id(22) }.Contains(c.RoomId)).ToArrayAsync(t);
        var tasks = await db.Set<OperationalTask>().AsNoTracking()
            .Where(task => task.Kind == OperationalTaskKind.MoveInInventory && task.RequiredLocationId == Id(10)).ToArrayAsync(t);
        var complete = contracts.Length == 3 && tasks.Length == 3 &&
            Enumerable.Range(0, 3).All(i => contracts.Count(c => c.RoomId == Id(20 + i) &&
                c.Kind == ContractKind.Main && c.Status == ContractStatus.Active &&
                c.TenantUserId == Id(3 + i) && c.IsDevelopmentDemo) == 1) &&
            contracts.All(c => tasks.Count(task => task.ContractId == c.Id && task.TargetRoomId == c.RoomId &&
                task.AssignedStaffUserId == Id(2) && !string.IsNullOrWhiteSpace(task.MoveInInventoryJson)) == 1);
        Console.WriteLine($"STAFF_INVENTORY_INSPECT: fixture hiện có; contracts={contracts.Length}, active={contracts.Count(c => c.Status == ContractStatus.Active)}, inventoryTasks={tasks.Length}, complete={complete}.");
        return (owners[0], complete, true);
    }

    internal static async Task RunAsync(IServiceProvider provider, string mode, CancellationToken t = default)
    {
        var config = provider.GetRequiredService<IConfiguration>();
        ValidateTarget(config, Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), mode);
        if (mode == "--apply" && (!config.GetValue<bool>("ContractWorkflow:SimulatedSigningEnabled") ||
            config["ContractPdf:TemplateId"] != "main-contract-development-v1" ||
            config.GetValue<bool>("Email:Enabled") || config.GetValue<bool>("NotificationChannels:Enabled") ||
            config.GetValue<bool>("NotificationChannels:AutomationEnabled") || config.GetValue<bool>("Sms:Enabled") ||
            config.GetValue<bool>("Jobs:Enabled")))
            throw new LocalTestAccountException("Fixture yêu cầu signing mô phỏng, PDF Development và vô hiệu hóa email/SMS/jobs trong tiến trình seed.");
        if (mode == "--apply")
        {
            var endpoint = config["ObjectStorage:Endpoint"] ?? "";
            if (!Uri.TryCreate("http://" + endpoint, UriKind.Absolute, out var uri) ||
                !uri.IsLoopback || string.IsNullOrWhiteSpace(config["ObjectStorage:Bucket"]))
                throw new LocalTestAccountException("Fixture yêu cầu MinIO loopback có bucket cấu hình.");
        }
        await using var scope = provider.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var identity = sp.GetRequiredService<BHome.Infrastructure.Persistence.Compact24.Compact24DbContext>();
        await using var db = OfflineFixturePersistence.Open(sp, identity);
        var users = sp.GetRequiredService<UserManager<User>>();
        var (owner, complete, existing) = await InspectAsync(db, users, t);
        if (mode == "--inspect") return;
        if (complete)
        {
            Console.WriteLine("STAFF_INVENTORY_ALREADY_READY: 3 hợp đồng Active và 3 tác vụ kiểm kê đã có. Không sửa dữ liệu.");
            return;
        }
        var today = Today;
        var now = DateTimeOffset.UtcNow;
        if (!existing)
        {
            var credentials = await CredentialsAsync(t);
            await using (var tx = await OfflineFixturePersistence.BeginAsync(db, identity, t))
            {
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('staff-inventory-active-v1',0))", t);
                // Recheck the name under the lock, before the first write.
                if (await db.Locations.AnyAsync(l => l.Id == Id(10) || l.Name == LocationName, t))
                    throw new LocalTestAccountException("Fixture được tạo đồng thời; không ghi đè.");
                for (var i = 0; i < UserNames.Length; i++)
                {
                    var role = i == 0 ? Roles.Staff : Roles.Tenant;
                    var account = new User
                    {
                        Id = Id(i + 2),
                        UserName = UserNames[i],
                        Email = UserNames[i] + "@example.invalid",
                        IsActive = true,
                        LockoutEnabled = true,
                        EmailConfirmed = true
                    };
                    identity.PrepareUserRole(account, role);
                    var result = await users.CreateAsync(account, credentials[UserNames[i]]);
                    if (!result.Succeeded)
                        throw new LocalTestAccountException("Không thể tạo tài khoản tổng hợp: " + string.Join(",", result.Errors.Select(e => e.Code)));
                }
                var chain = await db.Set<Chain>().SingleOrDefaultAsync(t)
                    ?? throw new LocalTestAccountException("Chưa có Chain; từ chối tạo dữ liệu chain thực.");
                Add(db, 10, new Location(LocationName)
                {
                    ChainId = chain.Id,
                    Address = "[DEMO] Dữ liệu tổng hợp phục vụ kiểm kê Staff; không phải địa chỉ thật"
                });
                db.Add(new StaffLocationAssignment(Id(10), Id(2), owner, today.AddDays(-1), today.AddYears(1)));
                for (var i = 0; i < 3; i++)
                {
                    Add(db, 20 + i, new Room
                    {
                        LocationId = Id(10),
                        RoomNumber = $"KI-10{i + 1}",
                        Capacity = 1,
                        Floor = "1",
                        Status = RoomStatus.Available
                    });
                    Add(db, 30 + i, new Resident
                    {
                        RoomId = Id(20 + i),
                        OwnerUserId = owner,
                        TenantUserId = Id(3 + i),
                        DisplayLabel = $"[DEMO] Người thuê kiểm kê {i + 1}",
                        ResidentType = ResidentType.Representative,
                        VerificationStatus = IdentityVerificationStatus.Verified,
                        ConfirmedByUserId = Id(2),
                        ConfirmedAt = now
                    });
                }
                foreach (var (number, category, code, rate) in new[]
                {
                (60, ChargeCategory.Rent, "RENT", 3_000_000m),
                (61, ChargeCategory.Electricity, "ELECTRICITY", 3_500m),
                (62, ChargeCategory.Water, "WATER", 15_000m)
            })
                    Add(db, number, new BillingPolicy
                    {
                        LocationId = Id(10),
                        ChargeCode = code,
                        Category = category,
                        Name = "[DEMO] " + code,
                        Rate = rate,
                        Method = category == ChargeCategory.Rent
                            ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered,
                        EffectiveFrom = today.AddDays(-1)
                    });
                await db.SaveChangesAsync(t);
                await tx.CommitAsync(t);
            }
        }

        var store = sp.GetRequiredService<ISetupWorkspaceStore>();
        var actor = sp.GetRequiredService<LifecycleSeedActor>();
        try
        {
            actor.UserId = owner; actor.Role = Roles.Owner;
            await store.TransactionAsync(Id(10), async () =>
            {
                for (var i = 0; i < 3; i++)
                {
                    var roomId = Id(20 + i);
                    var templateId = Id(100 + i);
                    var items = new[]
                    {
                        new AssetTemplateItem(Id(200 + i * 10), "Giường đơn", "Nội thất", "BulkQuantity", 1, "cái"),
                        new AssetTemplateItem(Id(201 + i * 10), "Tủ quần áo", "Nội thất", "BulkQuantity", 1, "cái"),
                        new AssetTemplateItem(Id(202 + i * 10), "Quạt treo tường", "Thiết bị", "BulkQuantity", 1, "cái")
                    };
                    var template = await store.GetAsync(templateId, "AssetTemplate", t);
                    if (template is null)
                        await store.SaveAsync(templateId, Id(10), "AssetTemplate", "Published",
                            new AssetTemplateWrite(Id(10), $"[DEMO] Tài sản KI-10{i + 1}", items, Scoped: true, ScopeRoomId: roomId),
                            0, owner, t);
                    else if (template.LocationId != Id(10) || template.Version != 1 ||
                        template.Status != "Published" ||
                        !template.Data.TryGetProperty("scopeRoomId", out var scopeRoom) || scopeRoom.GetGuid() != roomId ||
                        !template.Data.TryGetProperty("items", out var configured) || configured.GetArrayLength() != items.Length)
                        throw new LocalTestAccountException("AssetTemplate fixture đã thay đổi; từ chối sửa tài sản người dùng.");

                    var desired = await store.GetAsync(Id(110 + i), "DesiredAssets", t);
                    if (desired is null)
                        await store.SaveAsync(Id(110 + i), Id(10), "DesiredAssets", "PendingVerification",
                            new DesiredAssets(templateId, 1, roomId, items, "PendingVerification"), 0, owner, t);
                    else if (desired.LocationId != Id(10) || desired.Version != 1 ||
                        desired.Data.GetProperty("templateId").GetGuid() != templateId ||
                        desired.Data.GetProperty("roomId").GetGuid() != roomId ||
                        desired.Data.GetProperty("templateVersion").GetInt32() != 1 ||
                        desired.Data.GetProperty("items").GetArrayLength() != items.Length)
                        throw new LocalTestAccountException("DesiredAssets fixture đã thay đổi; từ chối sửa tài sản người dùng.");

                    // This is the key used by RoomInventoryReviewService. Older buggy fixture
                    // assignments with a different key remain inert and are never deleted.
                    var assignment = await store.GetAsync(AssignmentKey(roomId), "AssetTemplateAssignment", t);
                    if (assignment is null)
                        await store.SaveAsync(AssignmentKey(roomId), Id(10), "AssetTemplateAssignment",
                            "Assigned", new AssetTemplateAssignment(templateId), 0, owner, t);
                    else if (assignment.LocationId != Id(10) || assignment.Status != "Assigned" ||
                        assignment.Data.GetProperty("templateId").GetGuid() != templateId)
                        throw new LocalTestAccountException("AssetTemplateAssignment fixture đã thay đổi; từ chối sửa tài sản người dùng.");
                }
                return true;
            }, t);
            var review = sp.GetRequiredService<RoomInventoryReviewService>();
            var snapshot = await review.GetAsync(Id(10), t);
            var selected = snapshot.Rooms.OrderBy(r => r.RoomId).ToArray();
            if (selected.Length != 3 || selected.Any(r => r.Items.Count != 3))
                throw new LocalTestAccountException("Cấu hình kiểm kê không tạo đúng 3 phòng x 3 tài sản: " +
                    string.Join(",", selected.Select(r => $"{r.RoomNumber}={r.Items.Count}:{r.BlockedReason}")));
            if (selected.All(room => room.State == "Matched" && room.Items.All(item => item.Checked)))
            {
                Console.WriteLine("STAFF_INVENTORY_ASSETS_READY: 3 phòng đã kiểm kê đầy đủ; giữ nguyên các tài sản.");
            }
            else
            {
                if (selected.Any(room => room.State != "NotChecked" || room.Items.Any(item => item.Checked) ||
                    room.UnlinkedAssetCount != 0))
                    throw new LocalTestAccountException("Kiểm kê fixture đã được chỉnh sửa/dở dang; không tự ghi đè tài sản.");
                await review.ConfirmAsync(Id(10), new RoomInventoryReviewConfirm(Key("owner-confirm"),
                    selected.Select(room => new RoomInventoryReviewInputRoom(room.RoomId, room.DesiredId,
                        room.DesiredVersion, room.StateToken,
                        room.Items.Select(item => new RoomInventoryReviewInputItem(item.Id, true, [])).ToArray())).ToArray(),
                    true), t);
            }

            var contracts = sp.GetRequiredService<ContractService>();
            for (var i = 0; i < 3; i++)
            {
                var existingContracts = await db.Set<Contract>().AsNoTracking()
                    .Where(c => c.RoomId == Id(20 + i)).ToArrayAsync(t);
                if (existingContracts.Length > 1)
                    throw new LocalTestAccountException("Phòng fixture có nhiều hợp đồng; không tạo thêm.");
                var currentContract = existingContracts.SingleOrDefault();
                if (currentContract is not null &&
                    (currentContract.Kind != ContractKind.Main || currentContract.OwnerSignerId != owner ||
                     currentContract.TenantUserId != Id(3 + i) || currentContract.RepresentativeResidentId != Id(30 + i) ||
                     currentContract.Terms != Terms || !currentContract.IsDevelopmentDemo ||
                     currentContract.RequiredDeposit != 0 || currentContract.RentAmount != 3_000_000 ||
                     currentContract.StartDate > today || currentContract.StartDate < today.AddDays(-31) ||
                     currentContract.EndDate < today ||
                     currentContract.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or
                         ContractStatus.PendingActivation or ContractStatus.Active)))
                    throw new LocalTestAccountException("Hợp đồng fixture có thay đổi ngoài kịch bản; không ghi đè.");
                var contractId = currentContract?.Id ??
                    (await contracts.CreateAsync(new(Id(20 + i), owner, Id(3 + i), Id(30 + i),
                        [Id(30 + i)], today, today.AddMonths(6), 3_000_000, 0, Terms),
                        Key($"create-contract-{i}"), t)).Id;
                if (currentContract?.Status == ContractStatus.Active) continue;
                foreach (var (signer, role) in new[] { (owner, Roles.Owner), (Id(3 + i), Roles.Tenant) })
                {
                    actor.UserId = signer; actor.Role = role;
                    var current = await contracts.GetAsync(contractId, t);
                    var signature = current.Signatures.SingleOrDefault(s => s.SignerUserId == signer && s.Status != "Failed");
                    if (signature is null)
                    {
                        if (current.Status is not ("Draft" or "PendingSigning"))
                            throw new LocalTestAccountException("Hợp đồng đang ở trạng thái thiếu chữ ký không thể tiếp tục.");
                        await contracts.RequestSigningAsync(contractId,
                            new(Guid.Empty, Method: SigningMethods.Simulated, Consent: true),
                            Key($"sign-contract-{i}-{role}"), t);
                        current = await contracts.GetAsync(contractId, t);
                        signature = current.Signatures.Single(s => s.SignerUserId == signer && s.Status != "Failed");
                    }
                    if (signature.Status == "Pending") await contracts.SyncSigningAsync(contractId, t);
                    else if (signature.Status != "Simulated")
                        throw new LocalTestAccountException("Chữ ký fixture có trạng thái ngoài kịch bản; không tự thay đổi.");
                }
                actor.UserId = owner; actor.Role = Roles.Owner;
                var readiness = await contracts.ReadinessAsync(contractId, t);
                if (!readiness.Ready)
                    throw new LocalTestAccountException("Hợp đồng demo chưa thể kích hoạt: " + string.Join(",", readiness.Blockers));
                await contracts.ActivateAsync(contractId, Key($"activate-contract-{i}"), t);
            }
        }
        finally { actor.UserId = null; actor.Role = ""; }

        var (_, verified, _) = await InspectAsync(db, users, t);
        if (!verified) throw new LocalTestAccountException("Dữ liệu tạo xong nhưng hậu kiểm chưa đạt; cần kiểm tra thủ công.");
        Console.WriteLine($"STAFF_INVENTORY_READY: 3 Main Active, 3 việc kiểm kê Staff (KI-101/102/103). Credentials chỉ lưu riêng tại {CredentialsPath}.");
    }
}
