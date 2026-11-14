using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.Notifications;
using BHome.Domain.PaymentsDebt;
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
using OpenCvSharp;

namespace BHome.LocalDevelopment;

public static class E2eMeterWorkflowSeed
{
    public const string Namespace = "BHOME_E2E_METER_202611";
    public const string RoomNumber = "E2E-METER-01";
    public const string TenantUserName = "bhome.e2e.meter.tenant";
    public const string TenantEmail = "bhome.e2e.meter.tenant@example.com";
    public const string TenantDisplayName = "BHOME E2E Meter Tenant";
    public const string ElectricityMeterCode = "E2E-METER-01-ELEC";
    public const string WaterMeterCode = "E2E-METER-01-WATER";

    public static readonly DateOnly OctoberPeriod = new(2026, 10, 1);
    public static readonly DateOnly OctoberReadingDate = new(2026, 10, 25);
    public static readonly DateOnly NovemberPeriod = new(2026, 11, 1);
    public static readonly DateOnly NovemberReadingDate = new(2026, 11, 9);

    public const decimal OctElectricityConfirmed = 1200m;
    public const decimal OctWaterConfirmed = 350m;
    public const decimal ExpectedNovElectricityConfirmed = 1350m;
    public const decimal ExpectedNovWaterConfirmed = 365m;

    public static Guid Id(int n) => Guid.Parse($"e2e20261-1100-4000-8000-{n:000000000000}");

    public static void ValidateDevelopmentTarget(string? environment, string connectionString)
    {
        if (environment is not ("Development" or "Testing"))
            throw new LocalTestAccountException($"Môi trường '{environment}' không phải Development/Testing. Dừng ngay để bảo vệ an toàn dữ liệu.");

        var csb = new NpgsqlConnectionStringBuilder(connectionString);
        var host = csb.Host ?? "";
        var database = csb.Database ?? "";
        var user = csb.Username ?? "";

        if (host.Contains("prod", StringComparison.OrdinalIgnoreCase) ||
            database.Contains("prod", StringComparison.OrdinalIgnoreCase) ||
            user.Contains("prod", StringComparison.OrdinalIgnoreCase))
            throw new LocalTestAccountException("Phát hiện dấu hiệu Production trong cấu hình kết nối. Dừng ngay lập tức.");

        var isApprovedNeonDev =
            host == "ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech" &&
            database == "neondb" &&
            user.StartsWith("bhome_dev", StringComparison.Ordinal) &&
            csb.SslMode == SslMode.VerifyFull;

        var isLocalDev =
            (host is "127.0.0.1" or "localhost" or "::1") &&
            (database is "bhome" or "bhome_contract_demo");

        if (!isApprovedNeonDev && !isLocalDev)
            throw new LocalTestAccountException($"Database target ({host}/{database}) không nằm trong danh sách Development/Testing được phê duyệt.");
    }

    public static async Task RunAsync(IServiceProvider provider, string? environment, string password, string mode = "--seed", CancellationToken t = default)
    {
        var config = provider.GetRequiredService<IConfiguration>();
        var connectionString = config.GetConnectionString("Database") ?? "";
        ValidateDevelopmentTarget(environment, connectionString);

        var csb = new NpgsqlConnectionStringBuilder(connectionString);
        Console.WriteLine("=== PHASE 1: DATABASE SAFETY & ENVIRONMENT VERIFICATION ===");
        Console.WriteLine($"Environment      : {environment}");
        Console.WriteLine($"Database Host    : {csb.Host}");
        Console.WriteLine($"Database Name    : {csb.Database}");
        Console.WriteLine($"Database User    : {csb.Username}");
        Console.WriteLine($"SSL Mode         : {csb.SslMode}");
        Console.WriteLine($"Channel Binding  : {csb.ChannelBinding}");
        Console.WriteLine($"Application Name : {csb.ApplicationName}");
        Console.WriteLine($"Schema Version   : {Compact24Schema.Version}");
        Console.WriteLine($"Dataset Prefix   : {Namespace}");

        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync(t))
            throw new LocalTestAccountException("Schema Compact24 chưa sẵn sàng hoặc không tương thích.");

        Console.WriteLine("Schema Check     : READY (Compact24 24-table verified)");

        if (string.Equals(mode, "--dry-run", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(mode, "--inspect", StringComparison.OrdinalIgnoreCase))
        {
            await InspectAndVerifyAsync(scope.ServiceProvider, db, dryRunOnly: true, t);
            return;
        }

        if (string.Equals(mode, "--verify", StringComparison.OrdinalIgnoreCase))
        {
            await InspectAndVerifyAsync(scope.ServiceProvider, db, dryRunOnly: false, t);
            return;
        }

        if (string.Equals(mode, "--cleanup", StringComparison.OrdinalIgnoreCase))
        {
            await CleanupPendingTasksAsync(db, t);
            return;
        }

        var isLocalDev =
            (csb.Host is "127.0.0.1" or "localhost" or "::1") &&
            (csb.Database is "bhome" or "bhome_contract_demo");

        var ownerId = Compact24SampleSeed.Id(1);
        var staffId = Compact24SampleSeed.Id(2);
        var locationId = Compact24SampleSeed.Id(10);
        var roomTypeId = Compact24SampleSeed.Id(20);
        var assignmentId = Compact24SampleSeed.Id(30);

        if (!await db.Locations.AnyAsync(l => l.Id == locationId, t))
        {
            if (isLocalDev)
                await Compact24SampleSeed.RunAsync(provider, environment, password, false, t);
            else
                await Compact24SampleSeed.RunSharedDevelopmentAsync(provider, environment, "development", password, t);
        }

        var owner = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner), t)
            ?? throw new LocalTestAccountException("Không tìm thấy tài khoản Owner trong database.");
        ownerId = owner.Id;

        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var storage = scope.ServiceProvider.GetService<IObjectStorage>();

        var tenantUserId = Id(1);
        var roomId = Id(10);
        var residentId = Id(20);
        var contractId = Id(30);
        var elecMeterId = Id(40);
        var waterMeterId = Id(41);
        var octElecTaskId = Id(50);
        var octWaterTaskId = Id(51);
        var octElecEvidenceId = Id(60);
        var octWaterEvidenceId = Id(61);
        var octElecReadingId = Id(70);
        var octWaterReadingId = Id(71);
        var novElecTaskId = Id(80);
        var novWaterTaskId = Id(81);
        var scheduleId = Id(90);
        var bankAccountId = Id(91);

        var octAssignedAt = new DateTimeOffset(2026, 10, 25, 1, 0, 0, TimeSpan.Zero);
        var octElecConfirmedAt = new DateTimeOffset(2026, 10, 25, 2, 0, 0, TimeSpan.Zero);
        var octWaterConfirmedAt = new DateTimeOffset(2026, 10, 25, 2, 5, 0, TimeSpan.Zero);
        var octDueAt = new DateTimeOffset(2026, 10, 28, 16, 59, 59, TimeSpan.Zero);
        var contractActivatedAt = new DateTimeOffset(2026, 10, 1, 2, 0, 0, TimeSpan.Zero);
        var now = DateTimeOffset.UtcNow;
        now = now.AddTicks(-(now.Ticks % 10));

        // Prepare synthetic PNG evidence bytes for October 2026 readings
        var octElecPng = CreateSyntheticMeterImage("E2E-METER-01 ELEC 2026-10", "1200 kWh");
        var octWaterPng = CreateSyntheticMeterImage("E2E-METER-01 WATER 2026-10", "350 m3");
        var octElecObjectKey = "meter-evidence/bhome-e2e-meter-202610-elec.png";
        var octWaterObjectKey = "meter-evidence/bhome-e2e-meter-202610-water.png";

        if (storage is not null)
        {
            try
            {
                await using var elecStream = new MemoryStream(octElecPng, writable: false);
                await storage.PutAsync(octElecObjectKey, elecStream, octElecPng.Length, "image/png", t);
                await using var waterStream = new MemoryStream(octWaterPng, writable: false);
                await storage.PutAsync(octWaterObjectKey, waterStream, octWaterPng.Length, "image/png", t);
                Console.WriteLine("MinIO Storage    : Đã tải ảnh bằng chứng đồng hồ kỳ 10/2026 lên bucket private.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"MinIO Storage    : Bỏ qua upload MinIO ({ex.GetType().Name}); giữ metadata bằng chứng trong DB.");
            }
        }

        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Namespace}, 0))", t);

        // 1. Verify Location & Staff Assignment
        var location = await db.Locations.AsNoTracking().SingleOrDefaultAsync(l => l.Id == locationId && l.IsActive, t)
            ?? throw new LocalTestAccountException("Không tìm thấy cơ sở BHOME SAMPLE 1 đang hoạt động.");
        var assignment = await db.StaffLocationAssignments.AsNoTracking()
            .SingleOrDefaultAsync(a => a.Id == assignmentId && a.LocationId == locationId && a.StaffUserId == staffId, t)
            ?? throw new LocalTestAccountException("Không tìm thấy phân công Staff cho cơ sở BHOME SAMPLE 1.");

        // 2. Create or Reuse Dedicated Tenant Account
        var tenantUser = await users.FindByNameAsync(TenantUserName);
        if (tenantUser is null)
        {
            if (await db.Users.AnyAsync(u => u.Id == tenantUserId, t))
                throw new LocalTestAccountException("Trùng UUID tài khoản Tenant E2E.");
            tenantUser = new ApplicationUser
            {
                Id = tenantUserId,
                UserName = TenantUserName,
                Email = TenantEmail,
                EmailConfirmed = true,
                PhoneNumber = "0909202611",
                PhoneNumberConfirmed = true,
                IsActive = true,
                LockoutEnabled = true
            };
            db.Entry(tenantUser).Property("full_name").CurrentValue = TenantDisplayName;
            db.PrepareUserRole(tenantUser, Roles.Tenant);
            var created = await users.CreateAsync(tenantUser, password);
            if (!created.Succeeded)
                throw new LocalTestAccountException("Không thể tạo tài khoản Tenant E2E: " + string.Join(", ", created.Errors.Select(e => e.Code)));
            if (!await users.IsInRoleAsync(tenantUser, Roles.Tenant))
            {
                var roleAdded = await users.AddToRoleAsync(tenantUser, Roles.Tenant);
                if (!roleAdded.Succeeded)
                    throw new LocalTestAccountException("Không thể gán quyền Tenant cho tài khoản E2E.");
            }
            Console.WriteLine($"Tenant Account   : CREATED ({TenantUserName} / {tenantUser.Id})");
        }
        else
        {
            tenantUserId = tenantUser.Id;
            var needsUpdate = false;
            if (!string.Equals(tenantUser.Email, TenantEmail, StringComparison.OrdinalIgnoreCase))
            {
                tenantUser.Email = TenantEmail;
                tenantUser.NormalizedEmail = TenantEmail.ToUpperInvariant();
                tenantUser.EmailConfirmed = true;
                needsUpdate = true;
            }
            var currentFullName = db.Entry(tenantUser).Property<string>("full_name").CurrentValue;
            if (currentFullName != TenantDisplayName)
            {
                db.Entry(tenantUser).Property("full_name").CurrentValue = TenantDisplayName;
                needsUpdate = true;
            }
            if (needsUpdate) await users.UpdateAsync(tenantUser);
            Console.WriteLine($"Tenant Account   : REUSED ({TenantUserName} / {tenantUserId})");
        }

        // 3. Ensure BillingSchedule on Location
        var schedule = await db.Set<BillingSchedule>().AsNoTracking().SingleOrDefaultAsync(s => s.LocationId == locationId, t);
        if (schedule is null)
        {
            var newSchedule = new BillingSchedule
            {
                LocationId = locationId,
                RateDate = BillingRateDate.PeriodStart,
                RentSource = BillingRentSource.RepresentativeContract,
                PartialMonth = PartialMonthRule.FullMonth,
                Rounding = VndRounding.AwayFromZero,
                DraftDay = 1,
                DraftMonthOffset = 0,
                FinalDay = 5,
                FinalMonthOffset = 0,
                DueDay = 20,
                DueMonthOffset = 0,
                Version = 1
            };
            db.Entry(newSchedule).Property("Id").CurrentValue = scheduleId;
            db.Add(newSchedule);
            await db.SaveChangesAsync(t);
            Console.WriteLine($"BillingSchedule  : CREATED (DraftDay=1, FinalDay=5, DueDay=20, RentSource=RepresentativeContract)");
        }
        else
        {
            Console.WriteLine($"BillingSchedule  : REUSED (DraftDay={schedule.DraftDay}/{schedule.DraftMonthOffset}, FinalDay={schedule.FinalDay}/{schedule.FinalMonthOffset}, DueDay={schedule.DueDay}/{schedule.DueMonthOffset}, RentSource={schedule.RentSource})");
        }

        // 4. Ensure ReceivingBankAccount on Location for VietQR generation
        var bankAccount = await db.Set<ReceivingBankAccount>().AsNoTracking()
            .Where(a => a.LocationId == locationId)
            .OrderByDescending(a => a.Version)
            .FirstOrDefaultAsync(t);
        if (bankAccount is null)
        {
            var newAccount = new ReceivingBankAccount
            {
                LocationId = locationId,
                BankIdentifier = "970436",
                AccountNumber = "102938475612",
                AccountHolder = "BHOME SAMPLE 1 DEMO",
                Enabled = true,
                IsDevelopmentDemo = true,
                Version = 1,
                ConfirmedByUserId = ownerId,
                ConfirmedAt = contractActivatedAt
            };
            db.Entry(newAccount).Property("Id").CurrentValue = bankAccountId;
            db.Add(newAccount);
            await db.SaveChangesAsync(t);
            Console.WriteLine("ReceivingBank    : CREATED (BIN=970436, Acc=102938475612, Holder='BHOME SAMPLE 1 DEMO', Enabled=true)");
        }
        else
        {
            Console.WriteLine($"ReceivingBank    : REUSED (BIN={bankAccount.BankIdentifier}, Acc={bankAccount.AccountNumber}, Enabled={bankAccount.Enabled})");
        }

        // 5. Create or Reuse Dedicated Test Room E2E-METER-01
        var room = await db.Set<Room>().SingleOrDefaultAsync(r => r.LocationId == locationId && r.RoomNumber == RoomNumber, t);
        if (room is null)
        {
            room = new Room
            {
                LocationId = locationId,
                RoomTypeId = roomTypeId,
                RoomNumber = RoomNumber,
                Floor = "Tầng 2",
                Capacity = 2,
                Status = RoomStatus.Occupied
            };
            db.Entry(room).Property("Id").CurrentValue = roomId;
            db.Add(room);
            await db.SaveChangesAsync(t);
            Console.WriteLine($"Test Room        : CREATED ({RoomNumber} / {roomId})");
        }
        else
        {
            roomId = room.Id;
            if (room.Status != RoomStatus.Occupied)
            {
                room.Status = RoomStatus.Occupied;
                room.Version++;
                await db.SaveChangesAsync(t);
            }
            Console.WriteLine($"Test Room        : REUSED ({RoomNumber} / {roomId})");
        }

        // 5b. Ensure Room-Scoped BillingPolicies Effective from 2026-09-01 (covers Oct & Nov 2026)
        var roomPolicies = new (int IdOffset, ChargeCategory Category, string Code, string Name, ChargingMethod Method, decimal Rate)[]
        {
            (92, ChargeCategory.Rent, "RENT", "Tiền thuê phòng E2E-METER-01", ChargingMethod.FixedPerRoomPerMonth, 3_500_000m),
            (93, ChargeCategory.Electricity, "ELECTRICITY", "Đơn giá điện E2E-METER-01", ChargingMethod.Metered, 3_500m),
            (94, ChargeCategory.Water, "WATER", "Đơn giá nước E2E-METER-01", ChargingMethod.Metered, 15_000m),
            (95, ChargeCategory.ServiceFee, "WIFI", "Phí dịch vụ/Internet E2E-METER-01", ChargingMethod.FixedPerRoomPerMonth, 100_000m)
        };
        foreach (var rp in roomPolicies)
        {
            var existingPolicy = await db.Set<BillingPolicy>().AsNoTracking()
                .FirstOrDefaultAsync(p => p.LocationId == locationId && p.RoomId == roomId && p.ChargeCode == rp.Code, t);
            if (existingPolicy is null)
            {
                var policy = new BillingPolicy
                {
                    LocationId = locationId,
                    RoomId = roomId,
                    Category = rp.Category,
                    ChargeCode = rp.Code,
                    Name = rp.Name,
                    Method = rp.Method,
                    Rate = rp.Rate,
                    EffectiveFrom = new DateOnly(2026, 9, 1)
                };
                db.Entry(policy).Property("Id").CurrentValue = Id(rp.IdOffset);
                db.Add(policy);
                Console.WriteLine($"Room Policy      : CREATED ({rp.Code} = {rp.Rate:N0} VND, EffectiveFrom=2026-09-01)");
            }
            else
            {
                Console.WriteLine($"Room Policy      : REUSED ({existingPolicy.ChargeCode} = {existingPolicy.Rate:N0} VND, EffectiveFrom={existingPolicy.EffectiveFrom})");
            }
        }
        await db.SaveChangesAsync(t);

        // 6. Create or Reuse Electricity & Water Meters for Room E2E-METER-01
        var elecMeter = await db.Set<Meter>().SingleOrDefaultAsync(m => m.RoomId == roomId && m.UtilityType == UtilityType.Electricity && m.IsActive, t);
        if (elecMeter is null)
        {
            elecMeter = new Meter
            {
                RoomId = roomId,
                Code = ElectricityMeterCode,
                UtilityType = UtilityType.Electricity,
                Display = MeterDisplay.Digital,
                DecimalPlaces = 0,
                InstalledOn = new DateOnly(2026, 9, 1),
                IsActive = true
            };
            db.Entry(elecMeter).Property("Id").CurrentValue = elecMeterId;
            db.Add(elecMeter);
            await db.SaveChangesAsync(t);
            Console.WriteLine($"Electricity Meter: CREATED ({ElectricityMeterCode} / {elecMeterId})");
        }
        else
        {
            elecMeterId = elecMeter.Id;
            Console.WriteLine($"Electricity Meter: REUSED ({elecMeter.Code} / {elecMeterId})");
        }

        var waterMeter = await db.Set<Meter>().SingleOrDefaultAsync(m => m.RoomId == roomId && m.UtilityType == UtilityType.Water && m.IsActive, t);
        if (waterMeter is null)
        {
            waterMeter = new Meter
            {
                RoomId = roomId,
                Code = WaterMeterCode,
                UtilityType = UtilityType.Water,
                Display = MeterDisplay.Digital,
                DecimalPlaces = 0,
                InstalledOn = new DateOnly(2026, 9, 1),
                IsActive = true
            };
            db.Entry(waterMeter).Property("Id").CurrentValue = waterMeterId;
            db.Add(waterMeter);
            await db.SaveChangesAsync(t);
            Console.WriteLine($"Water Meter      : CREATED ({WaterMeterCode} / {waterMeterId})");
        }
        else
        {
            waterMeterId = waterMeter.Id;
            Console.WriteLine($"Water Meter      : REUSED ({waterMeter.Code} / {waterMeterId})");
        }

        // 7. Create or Reuse Verified Representative Resident
        var resident = await db.Set<Resident>().SingleOrDefaultAsync(r => r.RoomId == roomId && r.TenantUserId == tenantUserId, t);
        if (resident is null)
        {
            resident = new Resident
            {
                RoomId = roomId,
                TenantUserId = tenantUserId,
                OwnerUserId = ownerId,
                DisplayLabel = TenantDisplayName,
                ResidentType = ResidentType.Representative,
                VerificationStatus = IdentityVerificationStatus.Verified,
                ConfirmedByUserId = staffId,
                ConfirmedAt = contractActivatedAt
            };
            db.Entry(resident).Property("Id").CurrentValue = residentId;
            db.Add(resident);
            await db.SaveChangesAsync(t);
            Console.WriteLine($"Resident         : CREATED ({TenantDisplayName} / {residentId})");
        }
        else
        {
            residentId = resident.Id;
            Console.WriteLine($"Resident         : REUSED ({resident.DisplayLabel} / {residentId})");
        }

        // 8. Create or Reuse Active Main Tenancy Contract
        var contract = await db.Set<Contract>().Include(c => c.Residents)
            .SingleOrDefaultAsync(c => c.RoomId == roomId && c.Kind == ContractKind.Main && c.Status == ContractStatus.Active, t);
        if (contract is null)
        {
            contract = new Contract
            {
                RoomId = roomId,
                OwnerSignerId = ownerId,
                TenantUserId = tenantUserId,
                RepresentativeResidentId = residentId,
                Kind = ContractKind.Main,
                Status = ContractStatus.Active,
                StartDate = new DateOnly(2026, 10, 1),
                EndDate = new DateOnly(2027, 9, 30),
                MonthlyRent = 3_500_000m,
                RequiredDeposit = 3_500_000m,
                AppliedHoldingDeposit = 0m,
                Terms = $"{Namespace}: Hợp đồng thuê chính thức phục vụ kiểm thử E2E ghi chỉ số điện nước -> hóa đơn -> VietQR.",
                SnapshotHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Namespace + ":MAIN_CONTRACT"))).ToLowerInvariant(),
                IsDevelopmentDemo = true,
                ActivatedByUserId = ownerId,
                ActivatedAt = contractActivatedAt,
                Residents =
                [
                    new ContractResident
                    {
                        ContractId = contractId,
                        ResidentId = residentId,
                        Role = ResidentType.Representative,
                        ResidenceFrom = new DateOnly(2026, 10, 1)
                    }
                ]
            };
            db.Entry(contract).Property("Id").CurrentValue = contractId;
            db.Add(contract);
            await db.SaveChangesAsync(t);
            Console.WriteLine($"Main Contract    : CREATED ({contractId}, Active 2026-10-01 -> 2027-09-30, Rent=3,500,000 VND)");
        }
        else
        {
            contractId = contract.Id;
            Console.WriteLine($"Main Contract    : REUSED ({contractId}, Status={contract.Status}, Start={contract.StartDate}, End={contract.EndDate})");
        }

        // 9. Ensure BillingRepresentativeSelection for Room E2E-METER-01 in Nov 2026
        if (!await db.Set<BillingRepresentativeSelection>().AnyAsync(s => s.RoomId == roomId && s.BillingPeriod == NovemberPeriod, t))
        {
            var repSelection = new BillingRepresentativeSelection
            {
                RoomId = roomId,
                BillingPeriod = NovemberPeriod,
                ContractId = contractId,
                Version = 1,
                SelectedByUserId = ownerId,
                SelectedAt = contractActivatedAt
            };
            db.Entry(repSelection).Property("Id").CurrentValue = Id(35);
            db.Add(repSelection);
            await db.SaveChangesAsync(t);
        }

        // 10. Seed Previous Confirmed Meter Readings (October 2026: 1200 kWh & 350 m3)
        await EnsureOctoberConfirmedReadingAsync(
            db,
            locationId: locationId,
            roomId: roomId,
            meterId: elecMeterId,
            utilityType: UtilityType.Electricity,
            taskId: octElecTaskId,
            evidenceId: octElecEvidenceId,
            readingId: octElecReadingId,
            staffId: staffId,
            assignmentId: assignmentId,
            previousValue: 1100m,
            confirmedValue: OctElectricityConfirmed,
            assignedAt: octAssignedAt,
            confirmedAt: octElecConfirmedAt,
            dueAt: octDueAt,
            objectKey: octElecObjectKey,
            pngBytes: octElecPng,
            title: "Ghi chỉ số điện định kỳ E2E-METER-01 (10/2026)",
            t: t);

        await EnsureOctoberConfirmedReadingAsync(
            db,
            locationId: locationId,
            roomId: roomId,
            meterId: waterMeterId,
            utilityType: UtilityType.Water,
            taskId: octWaterTaskId,
            evidenceId: octWaterEvidenceId,
            readingId: octWaterReadingId,
            staffId: staffId,
            assignmentId: assignmentId,
            previousValue: 340m,
            confirmedValue: OctWaterConfirmed,
            assignedAt: octAssignedAt,
            confirmedAt: octWaterConfirmedAt,
            dueAt: octDueAt,
            objectKey: octWaterObjectKey,
            pngBytes: octWaterPng,
            title: "Ghi chỉ số nước định kỳ E2E-METER-01 (10/2026)",
            t: t);

        // 11. Seed Current Pending Meter-Reading Tasks for November 2026 (2026-11-01)
        // Do NOT pre-complete these tasks so the user can record 1350 kWh and 365 m3 from Mobile.
        await EnsureNovemberPendingTaskAsync(
            db,
            locationId: locationId,
            roomId: roomId,
            meterId: elecMeterId,
            utilityType: UtilityType.Electricity,
            taskId: novElecTaskId,
            staffId: staffId,
            assignmentId: assignmentId,
            assignedAt: now,
            dueAt: now.AddDays(5),
            title: "Ghi chỉ số điện định kỳ E2E-METER-01 (11/2026)",
            requirements: $"{Namespace}: Ghi chỉ số điện định kỳ kỳ 11/2026 cho phòng {RoomNumber} (chỉ số kỳ trước: 1200 kWh).",
            t: t);

        await EnsureNovemberPendingTaskAsync(
            db,
            locationId: locationId,
            roomId: roomId,
            meterId: waterMeterId,
            utilityType: UtilityType.Water,
            taskId: novWaterTaskId,
            staffId: staffId,
            assignmentId: assignmentId,
            assignedAt: now,
            dueAt: now.AddDays(5),
            title: "Ghi chỉ số nước định kỳ E2E-METER-01 (11/2026)",
            requirements: $"{Namespace}: Ghi chỉ số nước định kỳ kỳ 11/2026 cho phòng {RoomNumber} (chỉ số kỳ trước: 350 m3).",
            t: t);

        await tx.CommitAsync(t);
        Console.WriteLine("=== SEEDING COMPLETED SUCCESSFULLY ===");

        await InspectAndVerifyAsync(scope.ServiceProvider, db, dryRunOnly: false, t);
    }

    private static async Task EnsureOctoberConfirmedReadingAsync(
        BHomePersistenceContext db,
        Guid locationId,
        Guid roomId,
        Guid meterId,
        UtilityType utilityType,
        Guid taskId,
        Guid evidenceId,
        Guid readingId,
        Guid staffId,
        Guid assignmentId,
        decimal previousValue,
        decimal confirmedValue,
        DateTimeOffset assignedAt,
        DateTimeOffset confirmedAt,
        DateTimeOffset dueAt,
        string objectKey,
        byte[] pngBytes,
        string title,
        CancellationToken t)
    {
        var existingReading = await db.Set<MeterReading>().AsNoTracking()
            .Where(r => r.MeterId == meterId)
            .Join(db.Set<OperationalTask>(), r => r.TaskId, task => task.Id, (r, task) => new { Reading = r, Task = task })
            .FirstOrDefaultAsync(x => x.Task.BillingPeriod == OctoberPeriod && x.Task.Purpose == ReadingPurpose.Periodic, t);

        if (existingReading is not null)
        {
            Console.WriteLine($"Oct {utilityType,-11}: REUSED (TaskId={existingReading.Task.Id}, ReadingId={existingReading.Reading.Id}, ConfirmedValue={existingReading.Reading.ConfirmedValue})");
            return;
        }

        var octTask = await db.Set<OperationalTask>().SingleOrDefaultAsync(
            x => x.MeterId == meterId && x.BillingPeriod == OctoberPeriod && x.Purpose == ReadingPurpose.Periodic, t);
        if (octTask is null)
        {
            octTask = new OperationalTask
            {
                Kind = OperationalTaskKind.MeterReading,
                LocationId = locationId,
                MeterId = meterId,
                BillingRoomId = roomId,
                BillingUtilityType = utilityType,
                Purpose = ReadingPurpose.Periodic,
                BillingPeriod = OctoberPeriod,
                ReadingDate = OctoberReadingDate,
                Status = MeterTaskStatus.Completed,
                AssignedStaffUserId = staffId,
                AssignmentId = assignmentId,
                AssignedAt = assignedAt,
                CompletedAt = confirmedAt,
                DueAt = dueAt,
                Title = title,
                Requirements = $"{Namespace}: Chỉ số chốt kỳ 10/2026 làm mốc cho kỳ 11/2026.",
                EvidenceRequired = true,
                OcrProposedValue = confirmedValue,
                OcrImageHash = Convert.ToHexString(SHA256.HashData(pngBytes))
            };
            db.Entry(octTask).Property("Id").CurrentValue = taskId;
            db.Add(octTask);
        }
        else
        {
            taskId = octTask.Id;
            octTask.Status = MeterTaskStatus.Completed;
            octTask.CompletedAt = confirmedAt;
        }

        var evidence = new MeterEvidence
        {
            TaskId = taskId,
            UploadedByUserId = staffId,
            ImageHash = Convert.ToHexString(SHA256.HashData(pngBytes)),
            ContentType = "image/png",
            Length = pngBytes.Length,
            ObjectKey = objectKey,
            IsUploaded = true,
            IsLinked = true,
            CleanupAfter = confirmedAt.AddDays(365)
        };
        db.Entry(evidence).Property("Id").CurrentValue = evidenceId;
        db.Add(evidence);

        // Save OperationalTask + MeterEvidence first so operational_tasks.evidence is populated before inserting meter_readings
        await db.SaveChangesAsync(t);

        var reading = new MeterReading
        {
            TaskId = taskId,
            MeterId = meterId,
            EvidenceId = evidenceId,
            PreviousValue = previousValue,
            ConfirmedValue = confirmedValue,
            OcrProposedValue = confirmedValue,
            Consumption = confirmedValue - previousValue,
            Status = MeterReadingStatus.Confirmed,
            ConfirmedByUserId = staffId,
            ConfirmedAt = confirmedAt
        };
        db.Entry(reading).Property("Id").CurrentValue = readingId;
        db.Add(reading);

        // Mark October reading notification publication as already processed so November testing starts with clean notifications
        var pubKey = "meter-confirmed:" + readingId;
        if (!await db.Set<NotificationPublication>().AnyAsync(p => p.EventKey == pubKey, t))
        {
            db.Add(new NotificationPublication
            {
                EventKey = pubKey,
                PublishedAt = confirmedAt,
                RecipientCount = 1
            });
        }

        await db.SaveChangesAsync(t);
        Console.WriteLine($"Oct {utilityType,-11}: CREATED (TaskId={taskId}, ReadingId={readingId}, ConfirmedValue={confirmedValue})");
    }

    private static async Task EnsureNovemberPendingTaskAsync(
        BHomePersistenceContext db,
        Guid locationId,
        Guid roomId,
        Guid meterId,
        UtilityType utilityType,
        Guid taskId,
        Guid staffId,
        Guid assignmentId,
        DateTimeOffset assignedAt,
        DateTimeOffset dueAt,
        string title,
        string requirements,
        CancellationToken t)
    {
        var existingTask = await db.Set<OperationalTask>()
            .FirstOrDefaultAsync(x => x.MeterId == meterId && x.BillingPeriod == NovemberPeriod && x.Purpose == ReadingPurpose.Periodic && x.Status != MeterTaskStatus.Cancelled, t);

        if (existingTask is not null)
        {
            Console.WriteLine($"Nov {utilityType,-11}: REUSED (TaskId={existingTask.Id}, Status={existingTask.Status}, ReadingDate={existingTask.ReadingDate})");
            return;
        }

        var novTask = new OperationalTask
        {
            Kind = OperationalTaskKind.MeterReading,
            LocationId = locationId,
            MeterId = meterId,
            BillingRoomId = roomId,
            BillingUtilityType = utilityType,
            Purpose = ReadingPurpose.Periodic,
            BillingPeriod = NovemberPeriod,
            ReadingDate = NovemberReadingDate,
            Status = MeterTaskStatus.Assigned,
            AssignedStaffUserId = staffId,
            AssignmentId = assignmentId,
            AssignedAt = assignedAt,
            DueAt = dueAt,
            Title = title,
            Requirements = requirements,
            EvidenceRequired = true
        };
        db.Entry(novTask).Property("Id").CurrentValue = taskId;
        db.Add(novTask);
        await db.SaveChangesAsync(t);
        Console.WriteLine($"Nov {utilityType,-11}: CREATED (TaskId={taskId}, Status=Assigned, BillingPeriod={NovemberPeriod}, ReadingDate={NovemberReadingDate})");
    }

    private static async Task CleanupPendingTasksAsync(BHomePersistenceContext db, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var pendingNovTasks = await db.Set<OperationalTask>()
            .Where(x => (x.Id == Id(80) || x.Id == Id(81)) && x.Status == MeterTaskStatus.Assigned)
            .ToListAsync(t);
        foreach (var task in pendingNovTasks)
        {
            task.Status = MeterTaskStatus.Cancelled;
            task.Version++;
        }
        await db.SaveChangesAsync(t);
        await tx.CommitAsync(t);
        Console.WriteLine($"Đã hủy {pendingNovTasks.Count} công việc ghi chỉ số kỳ 11/2026 đang chờ trong bộ dữ liệu {Namespace}.");
    }

    private static async Task InspectAndVerifyAsync(IServiceProvider scopedProvider, BHomePersistenceContext db, bool dryRunOnly, CancellationToken t)
    {
        Console.WriteLine();
        Console.WriteLine($"=== {(dryRunOnly ? "PHASE 2: READ-ONLY DATABASE INSPECTION (DRY RUN)" : "PHASE 12: VERIFICATION QUERIES & E2E STATE")} ===");

        var totalUsers = await db.Users.CountAsync(t);
        var totalLocations = await db.Locations.CountAsync(t);
        var totalRooms = await db.Set<Room>().CountAsync(t);
        var totalContracts = await db.Set<Contract>().CountAsync(t);
        var totalMeters = await db.Set<Meter>().CountAsync(t);
        var totalReadings = await db.Set<MeterReading>().CountAsync(t);
        var totalTasks = await db.Set<OperationalTask>().CountAsync(t);
        var totalInvoices = await db.Set<Invoice>().CountAsync(t);

        Console.WriteLine($"Table Counts     : users={totalUsers}, locations={totalLocations}, rooms={totalRooms}, contracts={totalContracts}, meters={totalMeters}, meter_readings={totalReadings}, operational_tasks={totalTasks}, invoices={totalInvoices}");

        var owner = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner), t);
        var staff = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserName == "staff.sample", t);
        var tenant = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserName == TenantUserName, t);
        var location = await db.Locations.AsNoTracking().SingleOrDefaultAsync(l => l.Id == Compact24SampleSeed.Id(10), t);

        Console.WriteLine($"Owner Account    : {(owner is null ? "MISSING" : $"{owner.UserName} ({owner.Id}) Active={owner.IsActive}")}");
        Console.WriteLine($"Staff Account    : {(staff is null ? "MISSING" : $"{staff.UserName} ({staff.Id}) Active={staff.IsActive}")}");
        Console.WriteLine($"Tenant Account   : {(tenant is null ? "NOT CREATED YET" : $"{tenant.UserName} ({tenant.Id}) Email={tenant.Email} Active={tenant.IsActive}")}");
        Console.WriteLine($"Location         : {(location is null ? "MISSING" : $"{location.Name} ({location.Id}) Active={location.IsActive}")}");

        if (location is not null)
        {
            var assignments = await db.StaffLocationAssignments.AsNoTracking().Where(a => a.LocationId == location.Id).ToListAsync(t);
            foreach (var a in assignments)
                Console.WriteLine($"Staff Assignment : Id={a.Id}, StaffUserId={a.StaffUserId}, Effective={a.StartDate}..{a.EndDate}");

            var policies = await db.Set<BillingPolicy>().AsNoTracking().Where(p => p.LocationId == location.Id).OrderBy(p => p.ChargeCode).ToListAsync(t);
            foreach (var p in policies)
                Console.WriteLine($"Billing Policy   : Code={p.ChargeCode}, Category={p.Category}, Method={p.Method}, Rate={p.Rate:N0} VND, EffectiveFrom={p.EffectiveFrom}");

            var schedule = await db.Set<BillingSchedule>().AsNoTracking().SingleOrDefaultAsync(s => s.LocationId == location.Id, t);
            Console.WriteLine($"Billing Schedule : {(schedule is null ? "NOT CONFIGURED" : $"Draft={schedule.DraftDay}(+{schedule.DraftMonthOffset}m), Final={schedule.FinalDay}(+{schedule.FinalMonthOffset}m), Due={schedule.DueDay}(+{schedule.DueMonthOffset}m), RentSource={schedule.RentSource}")}");

            var bank = await db.Set<ReceivingBankAccount>().AsNoTracking().Where(b => b.LocationId == location.Id).OrderByDescending(b => b.Version).FirstOrDefaultAsync(t);
            Console.WriteLine($"Receiving Bank   : {(bank is null ? "NOT CONFIGURED" : $"BIN={bank.BankIdentifier}, Account={bank.AccountNumber}, Holder={bank.AccountHolder}, Enabled={bank.Enabled}, Demo={bank.IsDevelopmentDemo}")}");
        }

        var room = await db.Set<Room>().AsNoTracking().SingleOrDefaultAsync(r => r.RoomNumber == RoomNumber, t);
        Console.WriteLine($"Test Room        : {(room is null ? "NOT CREATED YET" : $"{room.RoomNumber} ({room.Id}) Status={room.Status} Capacity={room.Capacity}")}");

        if (room is not null)
        {
            var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents)
                .SingleOrDefaultAsync(c => c.RoomId == room.Id && c.Kind == ContractKind.Main && c.Status == ContractStatus.Active, t);
            Console.WriteLine($"Main Contract    : {(contract is null ? "MISSING" : $"Id={contract.Id}, Status={contract.Status}, Start={contract.StartDate}, End={contract.EndDate}, Rent={contract.MonthlyRent:N0} VND, TenantUserId={contract.TenantUserId}, Residents={contract.Residents.Count}")}");

            var meters = await db.Set<Meter>().AsNoTracking().Where(m => m.RoomId == room.Id).OrderBy(m => m.UtilityType).ToListAsync(t);
            foreach (var m in meters)
            {
                Console.WriteLine($"Meter            : {m.UtilityType,-11} Code={m.Code} ({m.Id}) Active={m.IsActive} DecimalPlaces={m.DecimalPlaces} InstalledOn={m.InstalledOn}");
                var readings = await db.Set<MeterReading>().AsNoTracking().Where(r => r.MeterId == m.Id).OrderBy(r => r.ConfirmedAt).ToListAsync(t);
                foreach (var r in readings)
                    Console.WriteLine($"  -> Reading     : Id={r.Id}, TaskId={r.TaskId}, Prev={r.PreviousValue}, Confirmed={r.ConfirmedValue}, Consumption={r.Consumption}, Status={r.Status}, ConfirmedAt={r.ConfirmedAt:O}");
            }

            var tasks = await db.Set<OperationalTask>().AsNoTracking()
                .Where(x => x.Kind == OperationalTaskKind.MeterReading && meters.Select(m => (Guid?)m.Id).Contains(x.MeterId))
                .OrderBy(x => x.ReadingDate).ThenBy(x => x.BillingUtilityType)
                .ToListAsync(t);
            foreach (var task in tasks)
            {
                var prevConfirmed = task.Status == MeterTaskStatus.Completed
                    ? await db.Set<MeterReading>().AsNoTracking().Where(r => r.TaskId == task.Id).Select(r => r.PreviousValue).FirstOrDefaultAsync(t)
                    : await db.Set<MeterReading>().AsNoTracking()
                        .Where(r => r.MeterId == task.MeterId && db.Set<OperationalTask>().Any(prev => prev.Id == r.TaskId && prev.ReadingDate < task.ReadingDate))
                        .OrderByDescending(r => r.ConfirmedAt).Select(r => (decimal?)r.ConfirmedValue).FirstOrDefaultAsync(t);
                Console.WriteLine($"Meter Task       : Id={task.Id}, Utility={task.BillingUtilityType}, Period={task.BillingPeriod}, ReadingDate={task.ReadingDate}, Status={task.Status}, AssignedStaff={task.AssignedStaffUserId}, PrevConfirmed={prevConfirmed}");
            }
        }
    }

    private static byte[] CreateSyntheticMeterImage(string header, string valueText)
    {
        using var mat = new Mat(240, 640, MatType.CV_8UC3, Scalar.White);
        Cv2.PutText(mat, "BHOME E2E SYNTHETIC METER", new Point(20, 65), HersheyFonts.HersheySimplex, 0.9, Scalar.Black, 2);
        Cv2.PutText(mat, header, new Point(20, 125), HersheyFonts.HersheySimplex, 0.8, Scalar.Black, 2);
        Cv2.PutText(mat, valueText, new Point(20, 190), HersheyFonts.HersheySimplex, 1.1, Scalar.Black, 2);
        return mat.ImEncode(".png");
    }
}
