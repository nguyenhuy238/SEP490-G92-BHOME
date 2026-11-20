using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace BHome.Infrastructure.Development;

public sealed record DevelopmentOnboardingSeedInput(Guid LocationId);
public sealed record DevelopmentOnboardingSeedResult(Guid ContractId, Guid RoomId, string RoomNumber,
    string LocationName, string TenantEmail, string TenantPassword, string TenantName,
    int InitialMeterTasks, bool DevelopmentOnly = true);

// Only called through the Development-only, Staff-scoped controller. No regular
// contract activation or production tenancy workflow uses this service.
public sealed class DevelopmentOnboardingSeedService(
    BHomePersistenceContext db, ICurrentUser actor, UserManager<ApplicationUser> users,
    IIdentityProtection identities, IContractHandoverRepository handover,
    ISetupWorkspaceStore inventory,
    IHostEnvironment environment, IConfiguration configuration)
{
    private static Guid SetupKey(string value) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));

    // Real persisted room assets + quantity metadata. Images are NOT fabricated:
    // Staff must inspect the room and upload genuine evidence before handover.
    public static readonly (string Name, string Category, string TrackingMode, int Quantity, string Unit)[] SampleInventory =
    [
        ("Giường ngủ", "Nội thất", "Serialized", 1, "cái"),
        ("Bàn học", "Nội thất", "Serialized", 1, "cái"),
        ("Ghế", "Nội thất", "BulkQuantity", 2, "cái"),
        ("Điều hòa", "Thiết bị", "Serialized", 1, "cái")
    ];

    private async Task SeedRoomAssetsAsync(Room room, Guid ownerId, string suffix, CancellationToken t)
    {
        // All records share the caller's PostgreSQL transaction and Location
        // advisory lock. The AssetTemplate/DesiredAssets/AssetVerification chain
        // is the real inventory read by IHandoverInventory.PrepareForContractAsync.
        var items = SampleInventory.Select(spec => new AssetTemplateItem(
            Guid.NewGuid(), spec.Name, spec.Category, spec.TrackingMode, spec.Quantity, spec.Unit)).ToArray();
        var template = await inventory.SaveAsync(Guid.NewGuid(), room.LocationId, "AssetTemplate",
            "Published", new AssetTemplateWrite(room.LocationId, $"Tài sản test {room.RoomNumber}",
                items, Scoped: true, ScopeRoomId: room.Id), 0, ownerId, t);
        await inventory.SaveAsync(SetupKey($"asset-template-assignment:{room.Id}"), room.LocationId,
            "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(template.Id), 0, ownerId, t);
        await inventory.SaveAsync(Guid.NewGuid(), room.LocationId, "DesiredAssets", "Verified",
            new DesiredAssets(template.Id, template.Version, room.Id, items, "Verified"), 0, ownerId, t);

        foreach (var item in items)
        {
            var asset = new Asset
            {
                LocationId = room.LocationId,
                RoomId = room.Id,
                Code = $"TEST-{suffix}-{item.Id:N}",
                Name = item.Name,
                Category = item.Category,
                Condition = "Hoạt động tốt",
                Status = AssetStatus.Active
            };
            await inventory.SaveAssetAsync(asset, ownerId, "Synthetic local onboarding inventory", t);
            await inventory.SaveAssetMetadataAsync(asset.Id,
                new AssetMetadata(item.TrackingMode, item.Quantity, null, null, null, item.Unit), t);
            await inventory.SaveAsync(Guid.NewGuid(), room.LocationId, "AssetVerification", "Verified",
                new
                {
                    roomId = room.Id,
                    templateId = template.Id,
                    itemId = item.Id,
                    assetId = asset.Id,
                    quantity = item.Quantity,
                    code = asset.Code,
                    condition = asset.Condition,
                    trackingMode = item.TrackingMode,
                    unit = item.Unit,
                    source = "DevelopmentSyntheticFixture",
                    evidenceIds = Array.Empty<Guid>(),
                    verifiedBy = ownerId
                }, 0, ownerId, t);
        }
    }
    public static bool Allowed(string environmentName, bool enabled, string? connectionString)
    {
        if (environmentName != "Development" || !enabled || string.IsNullOrWhiteSpace(connectionString)) return false;
        try
        {
            var target = new NpgsqlConnectionStringBuilder(connectionString);
            return target.Host is "localhost" or "127.0.0.1" or "::1" &&
                target.Database?.StartsWith("bhome_", StringComparison.OrdinalIgnoreCase) == true;
        }
        catch (ArgumentException) { return false; }
    }

    public async Task<DevelopmentOnboardingSeedResult> Create(
        DevelopmentOnboardingSeedInput input, string? idempotencyKey, CancellationToken t)
    {
        if (!Allowed(environment.EnvironmentName, configuration.GetValue<bool>("DevelopmentContractSeed:Enabled"),
            configuration.GetConnectionString("Database"))) throw new ContractException(404, "development_seed_unavailable");
        if (db is not Compact24DbContext) throw new ContractException(404, "development_seed_unavailable");
        var tenantPassword = configuration["DevelopmentContractSeed:TenantPassword"];
        if (string.IsNullOrEmpty(tenantPassword)) throw new ContractException(503, "development_seed_password_not_configured");
        if (input.LocationId == Guid.Empty) throw ContractException.Invalid("invalid_location");
        var staffId = actor.UserId;
        if (staffId is null || !actor.IsInRole(Roles.Staff)) throw new ContractException(403, "contract_role_forbidden");
        var key = Guid.TryParse(idempotencyKey, out var parsed) && parsed != Guid.Empty
            ? parsed : throw ContractException.Invalid("idempotency_key_required");
        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime);
        var selected = await db.Locations.SingleOrDefaultAsync(l => l.Id == input.LocationId && l.IsActive, t);
        if (selected is null || !await db.StaffLocationAssignments.AnyAsync(a => a.LocationId == input.LocationId &&
            a.StaffUserId == staffId && a.StartDate <= today && a.EndDate >= today, t)) throw ContractException.Missing();

        await using var tx = await db.Database.BeginTransactionAsync(t);
        // The same Location advisory key is used by property and contract workflows.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({input.LocationId.ToString()}, 0))", t);
        if (!await db.StaffLocationAssignments.AnyAsync(a => a.LocationId == input.LocationId &&
            a.StaffUserId == staffId && a.StartDate <= today && a.EndDate >= today, t)) throw ContractException.Missing();
        var previous = await db.Set<ContractOperation>().AsNoTracking().SingleOrDefaultAsync(o =>
            o.ActorId == staffId && o.Key == key && o.Operation == "dev-onboarding-seed", t);
        if (previous is not null)
        {
            if (previous.Fingerprint != input.LocationId.ToString("N"))
                throw ContractException.Conflict("idempotency_key_reused");
            var existing = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).ThenInclude(r => r.Location)
                .Include(c => c.Residents).AsSplitQuery().SingleAsync(c => c.Id == previous.ResultId, t);
            var email = await db.Users.Where(u => u.Id == existing.TenantUserId).Select(u => u.Email).SingleAsync(t);
            var name = await db.Set<Resident>().Where(r => r.Id == existing.RepresentativeResidentId)
                .Select(r => r.DisplayLabel).SingleAsync(t);
            var count = await db.Set<OperationalTask>().CountAsync(o => o.ContractId == existing.Id &&
                o.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading && o.Purpose == ReadingPurpose.Initial, t);
            await tx.CommitAsync(t);
            return new(existing.Id, existing.RoomId, existing.Room.RoomNumber, existing.Room.Location.Name,
                email!, tenantPassword, name, count);
        }

        var ownerId = await (from u in db.Users.AsNoTracking()
                             join membership in db.UserRoles on u.Id equals membership.UserId
                             join role in db.Roles on membership.RoleId equals role.Id
                             where u.IsActive && role.Name == Roles.Owner
                             select u.Id).FirstOrDefaultAsync(t);
        if (ownerId == Guid.Empty) throw ContractException.Conflict("owner_account_required");
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var emailAddress = $"bhome-synthetic-{suffix}@example.invalid";
        var nameLabel = $"Khách thuê TEST {suffix.ToUpperInvariant()}";
        var tenant = new ApplicationUser
        {
            UserName = emailAddress,
            Email = emailAddress,
            EmailConfirmed = true,
            LockoutEnabled = true,
            IsActive = true
        };
        db.PrepareUserRole(tenant, Roles.Tenant);
        var registered = await users.CreateAsync(tenant, tenantPassword);
        if (!registered.Succeeded) throw ContractException.Conflict("development_seed_account_creation_failed");
        if (!await users.IsInRoleAsync(tenant, Roles.Tenant) &&
            !(await users.AddToRoleAsync(tenant, Roles.Tenant)).Succeeded)
            throw ContractException.Conflict("development_seed_account_creation_failed");

        var room = new Room
        {
            LocationId = input.LocationId,
            RoomNumber = $"TEST-{suffix.ToUpperInvariant()}",
            Capacity = 1,
            Status = RoomStatus.Occupied
        };
        // Room type can be absent in older Compact24 test databases.
        room.Location = selected;
        var identity = new IdentityConfirmation(true, "999" + RandomNumberGenerator.GetInt32(1_000_000_000).ToString("D9"),
            nameLabel, new(2001, 1, 1), "Địa chỉ giả lập (không có thật)", "Khác", "Việt Nam",
            "Thông tin thử nghiệm", new DateOnly(2023, 1, 1), new DateOnly(2033, 1, 1));
        var resident = new Resident
        {
            RoomId = room.Id,
            OwnerUserId = ownerId,
            TenantUserId = tenant.Id,
            DisplayLabel = nameLabel,
            ResidentType = ResidentType.Representative,
            ContactEmail = emailAddress,
            VerificationStatus = IdentityVerificationStatus.Verified,
            ConfirmedByUserId = staffId,
            ConfirmedAt = now
        };
        var index = identities.CreateMatchIndex(identity.CitizenIdentityNumber, ownerId);
        resident.IdentityData = JsonSerializer.Serialize(identities.Encrypt(
            JsonSerializer.SerializeToUtf8Bytes(identity), new IdentityProtectionScope(ownerId, resident.Id)));
        resident.IdentityHmac = index.Digest;
        resident.HmacKeyVersion = index.KeyVersion;

        var endDate = today.AddMonths(12).AddDays(-1);
        var contract = new Contract
        {
            RoomId = room.Id,
            Room = room,
            RepresentativeResidentId = resident.Id,
            TenantUserId = tenant.Id,
            OwnerSignerId = ownerId,
            StartDate = today,
            EndDate = endDate,
            Kind = ContractKind.Main,
            Status = ContractStatus.Active,
            MonthlyRent = 3_000_000,
            RequiredDeposit = 0,
            IsDevelopmentDemo = true,
            InitialPaymentRequired = false,
            Terms = "HỢP ĐỒNG THỬ NGHIỆM LOCAL — KHÔNG CÓ GIÁ TRỊ PHÁP LÝ. Dữ liệu giả lập để kiểm thử nhận phòng và ghi chỉ số điện nước.",
            ActivatedAt = now,
            ActivatedByUserId = ownerId,
            PriceLockedAt = now,
            PriceLockTrigger = "DevelopmentSyntheticFixture",
            Residents = [new ContractResident { ResidentId = resident.Id,
                Role = ResidentType.Representative, ResidenceFrom = today }]
        };
        contract.Residents[0].ContractId = contract.Id;
        (string Code, ChargeCategory Category, ChargingMethod Method, decimal Rate, string Name)[] priceDetails =
        {
            new ("RENT", ChargeCategory.Rent, ChargingMethod.FixedPerRoomPerMonth, 3_000_000m, "Tiền thuê phòng"),
            new ("ELECTRICITY", ChargeCategory.Electricity, ChargingMethod.Metered, 3_500m, "Tiền điện"),
            new ("WATER", ChargeCategory.Water, ChargingMethod.Metered, 20_000m, "Tiền nước")
        };
        var prices = priceDetails.Select(p => new BillingPolicy
        {
            LocationId = input.LocationId,
            RoomId = room.Id,
            ChargeCode = p.Code,
            Category = p.Category,
            Method = p.Method,
            Rate = p.Rate,
            Name = p.Name,
            EffectiveFrom = today
        }).ToArray();
        var charges = prices.Select(p => new HoldingPriceCharge(p.Id, p.ChargeCode, (int)p.Category,
            (int)p.Method, p.Rate, p.EffectiveFrom, null, p.Version)
        { Name = p.Name }).ToArray();
        contract.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(contract.MonthlyRent,
            contract.RequiredDeposit, today, endDate, default, "DevelopmentSyntheticFixture", now, charges)
        { SnapshotVersion = 1 });
        contract.SnapshotHash = ContractDocumentSnapshot.Hash(new ContractDocument(contract.Id, room.Id,
            ownerId, tenant.Id, resident.Id, [resident.Id], today, endDate, contract.MonthlyRent,
            contract.RequiredDeposit, null, 0, contract.Terms, "")
        { AgreedCharges = charges });
        var meters = new[] { UtilityType.Electricity, UtilityType.Water }.Select(type => new Meter
        {
            RoomId = room.Id,
            Code = $"TEST-{type}-{suffix}",
            UtilityType = type,
            Display = MeterDisplay.Mechanical,
            InstalledOn = today,
            DecimalPlaces = 0
        }).ToArray();

        db.Add(room); db.Add(resident); db.AddRange(prices); db.AddRange(meters); db.Add(contract);
        db.Add(new ContractOperation
        {
            ActorId = staffId.Value,
            Key = key,
            Operation = "dev-onboarding-seed",
            Fingerprint = input.LocationId.ToString("N"),
            ResultId = contract.Id,
            CreatedAt = now
        });
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = staffId.Value,
            Event = "DevelopmentContractFixtureCreated",
            TargetType = "Contract",
            TargetId = contract.Id,
            Succeeded = true,
            OccurredAt = now
        });
        await db.SaveChangesAsync(t);
        await SeedRoomAssetsAsync(room, ownerId, suffix, t);
        // This is the same task factory used by real Owner activation, after the fixture is stored.
        await handover.EnsureMoveInTaskAsync(contract, ownerId, now, t);
        await db.SaveChangesAsync(t);
        await tx.CommitAsync(t);
        return new(contract.Id, room.Id, room.RoomNumber, selected.Name, emailAddress, tenantPassword,
            nameLabel, meters.Length);
    }
}
