using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Common;
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
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Development;

public sealed record DevelopmentOnboardingSeedInput(Guid LocationId, Guid RoomId = default, DateOnly? ExpectedBusinessDate = null);
public sealed record DevelopmentOnboardingSeedResult(Guid ContractId, Guid RoomId, string RoomNumber,
    string LocationName, string TenantEmail, string? TenantPassword, string TenantName,
    bool DevelopmentOnly = true);

// The explicitly approved demo shortcut does not change the normal contract workflow.
public sealed class DevelopmentOnboardingSeedService(
    BHomePersistenceContext db, ICurrentUser actor, UserManager<User> users,
    IIdentityProtection identities, IContractRepository contracts, IPropertyLifecycleChecks lifecycle,
    RoomInventoryReviewService inventory, TimeProvider clock,
    IHostEnvironment environment, IConfiguration configuration)
{
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

    private bool Available =>
        (environment.IsDevelopment() || environment.IsStaging() || environment.IsProduction()) &&
        (clock is DemoBusinessClock || Allowed(environment.EnvironmentName,
            configuration.GetValue<bool>("DevelopmentContractSeed:Enabled"), configuration.GetConnectionString("Database")));

    public async Task<DevelopmentOnboardingSeedResult> Create(
        DevelopmentOnboardingSeedInput input, string? idempotencyKey, CancellationToken t)
    {
        if (!Available || db is not Compact24DbContext || configuration.GetValue<bool?>("DevelopmentContractSeed:Enabled") == false)
            throw new ContractException(404, "development_seed_unavailable");
        if (actor.UserId is not { } ownerId || !actor.IsInRole(Roles.Owner) ||
            (!environment.IsDevelopment() && !string.IsNullOrWhiteSpace(configuration["DemoClock:OwnerUserId"]) &&
                (!Guid.TryParse(configuration["DemoClock:OwnerUserId"], out var configuredOwner) || ownerId != configuredOwner)))
            throw new ContractException(403, "contract_role_forbidden");
        if (input.LocationId == Guid.Empty || input.RoomId == Guid.Empty) throw ContractException.Invalid("invalid_room");
        var key = Guid.TryParse(idempotencyKey, out var parsed) && parsed != Guid.Empty
            ? parsed : throw ContractException.Invalid("idempotency_key_required");
        var fingerprint = $"{input.LocationId:N}:{input.RoomId:N}";
        var configuredPassword = configuration["DevelopmentContractSeed:TenantPassword"];

        return await contracts.InTransactionAsync(input.RoomId, async () =>
        {
            var room = await contracts.RoomAsync(input.RoomId, t) ?? throw ContractException.Missing();
            if (room.LocationId != input.LocationId || !room.Location.IsActive) throw ContractException.Missing();
            if (!await contracts.ActiveUserInRoleAsync(ownerId, Roles.Owner, t))
                throw new ContractException(403, "contract_role_forbidden");
            var previous = await contracts.OperationAsync(ownerId, key, "dev-onboarding-seed", t);
            if (previous is not null)
            {
                if (previous.Fingerprint != fingerprint) throw ContractException.Conflict("idempotency_key_reused");
                var existing = await contracts.FindAsync(previous.ResultId, t) ?? throw ContractException.Missing();
                var email = await db.Users.Where(u => u.Id == existing.TenantUserId).Select(u => u.Email).SingleAsync(t);
                var name = await db.Set<BHome.Domain.TenantContracts.Resident>().Where(r => r.Id == existing.RepresentativeResidentId)
                    .Select(r => r.DisplayLabel).SingleAsync(t);
                return new DevelopmentOnboardingSeedResult(existing.Id, room.Id, room.RoomNumber, room.Location.Name,
                    email!, null, name);
            }

            var now = clock.BusinessUtcNow();
            var today = DateOnly.FromDateTime(now.ToOffset(TimeSpan.FromHours(7)).DateTime);
            if (input.ExpectedBusinessDate is { } expected && today != expected)
                throw ContractException.Conflict("development_seed_business_date_changed");
            var endDate = today.AddMonths(12).AddDays(-1);
            // Re-read status and all overlapping live/draft obligations under the canonical
            // payment ledger, location advisory and room locks used by contract creation.
            if (room.Status != RoomStatus.Available || room.Capacity < 1 || room.RoomType is { IsActive: false } ||
                await db.Set<BHome.Domain.TenantContracts.Contract>().AnyAsync(c => c.RoomId == room.Id &&
                    (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal || c.Kind == BHome.Domain.TenantContracts.ContractKind.Holding || c.Kind == BHome.Domain.TenantContracts.ContractKind.Addendum) &&
                    (c.Status == ContractStatus.Active || c.Status == ContractStatus.Expired ||
                     (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning ||
                      c.Status == ContractStatus.PendingActivation) && c.StartDate <= endDate && c.EndDate >= today), t))
                throw ContractException.Conflict("room_not_available");
            var blockers = await lifecycle.RoomBlockersAsync(room.Id, t);
            if (blockers.Count > 0) throw ContractException.Conflict(blockers[0]);
            if (await contracts.HasUtilityProfileAsync(room.Id, today, endDate, t))
                throw ContractException.Conflict("contract_utility_profile_requires_review");
            var prices = await contracts.ResolvePricesAsync(room.Id, today, t);
            var rent = prices.Charges.SingleOrDefault(p => p.ChargeCode == "RENT");
            if (prices.MissingRequiredCharges.Count != 0 || rent is null ||
                rent.Category != ChargeCategory.Rent || rent.Method != ChargingMethod.FixedPerRoomPerMonth ||
                prices.Charges.Any(p => p.Rate < 0 || !PropertyRules.ValidCharge(p.Category, p.Method, p.ChargeCode)))
                throw ContractException.Conflict("development_seed_pricing_required");
            var meters = await db.Set<BHome.Domain.Billing.Meter>().Where(m => m.RoomId == room.Id && m.IsActive)
                .Select(m => new { m.UtilityType, m.InstalledOn }).ToArrayAsync(t);
            if (meters.Length != 2 || meters.Any(m => m.InstalledOn > today) ||
                meters.Count(m => m.UtilityType == UtilityType.Electricity) != 1 || meters.Count(m => m.UtilityType == UtilityType.Water) != 1)
                throw ContractException.Conflict("development_seed_meters_required");
            // Demo handover must exercise the actual room inventory. Resolve the same
            // canonical source used by EnsureMoveInTaskAsync under the Location lock;
            // never fabricate an asset or mark an item inspected for the Staff.
            var roomInventory = await inventory.PrepareForMoveInTaskAsync(room.Id, t);
            if (!roomInventory.Groups.Any(group => group.PhysicalAssets is { Length: > 0 }))
                throw ContractException.Conflict("development_seed_assets_required");

            var suffix = Guid.NewGuid().ToString("N")[..10];
            var emailAddress = $"bhome-synthetic-{suffix}@example.invalid";
            var nameLabel = $"Khách thuê TEST {suffix.ToUpperInvariant()}";
            var tenantPassword = string.IsNullOrEmpty(configuredPassword)
                ? "Bhome!9a-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(18)) : configuredPassword;
            var tenant = new User
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
                ConfirmedByUserId = ownerId,
                ConfirmedAt = now
            };
            var index = identities.CreateMatchIndex(identity.CitizenIdentityNumber, ownerId);
            resident.IdentityData = JsonSerializer.Serialize(identities.Encrypt(
                JsonSerializer.SerializeToUtf8Bytes(identity), new IdentityProtectionScope(ownerId, resident.Id)));
            resident.IdentityHmac = index.Digest;
            resident.HmacKeyVersion = index.KeyVersion;

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
                RentAmount = rent.Rate,
                // Demo contract explicitly has no deposit or initial payment obligation.
                // There is no simulated verification, signature, or payment record.
                RequiredDeposit = 0,
                IsDevelopmentDemo = true,
                InitialPaymentRequired = false,
                Terms = "HỢP ĐỒNG THỬ NGHIỆM — KHÔNG CÓ GIÁ TRỊ PHÁP LÝ. Dữ liệu giả lập để kiểm thử bàn giao và vận hành. Không yêu cầu tiền cọc hoặc thanh toán ban đầu.",
                ActivatedAt = now,
                ActivatedByUserId = ownerId,
                PriceLockedAt = now,
                PriceLockTrigger = "DevelopmentSyntheticFixture",
                Residents = [new ContractResident { ResidentId = resident.Id,
                    Role = ResidentType.Representative, ResidenceFrom = today }]
            };
            contract.Residents[0].ContractId = contract.Id;
            var charges = prices.Charges.Select(p => new HoldingPriceCharge(p.Id, p.ChargeCode, (int)p.Category,
                (int)p.Method, p.Rate, p.EffectiveFrom, p.EffectiveTo, p.Version)
            { Name = p.Name, PolicyLocationId = p.LocationId, PolicyRoomId = p.RoomId, PolicyRoomTypeId = p.RoomTypeId }).ToArray();
            contract.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(contract.RentAmount,
                contract.RequiredDeposit, today, endDate, default, "DevelopmentSyntheticFixture", now, charges)
            { SnapshotVersion = 1 });
            contract.SnapshotHashOrEmpty = ContractDocumentSnapshot.Hash(new ContractDocument(contract.Id, room.Id,
                ownerId, tenant.Id, resident.Id, [resident.Id], today, endDate, contract.RentAmount,
                contract.RequiredDeposit, null, 0, contract.Terms, "")
            { AgreedCharges = charges });
            room.Status = RoomStatus.Occupied;
            room.Version++;
            if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext native)
                await BHome.Infrastructure.Ocr.NativeCaptureWrites.ResidentAsync(native, resident, true, t);
            else db.Add(resident);
            // The repository generates the handover draft and deterministic initial
            // meter/inventory tasks in the same transaction using existing room assets.
            contracts.Add(contract);
            contracts.Add(new ContractOperation
            {
                ActorId = ownerId,
                Key = key,
                Operation = "dev-onboarding-seed",
                Fingerprint = fingerprint,
                ResultId = contract.Id,
                CreatedAt = now
            });
            contracts.Audit(ownerId, "DevelopmentContractFixtureCreated", contract.Id, now);
            return new DevelopmentOnboardingSeedResult(contract.Id, room.Id, room.RoomNumber, room.Location.Name,
                emailAddress, tenantPassword, nameLabel);
        }, t);
    }
}
