using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.Notifications;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using OpenCvSharp;

namespace BHome.LocalDevelopment;

// Additive UI fixtures, not proof of real identity, signatures, bank transfers or government registration.
internal static partial class TenantMobileDemoSeed
{
    private const string Email = "tenant.sample@example.invalid";
    private const string LocationName = "[TEST] BHOME Tenant Sample";
    private const string Marker = "tenant-mobile-demo-v1";
    internal static Guid Id(int n) => Guid.Parse($"bd110000-0000-4000-8000-{n:000000000000}");
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    public static async Task RunAsync(IServiceProvider provider, string email, string mode)
    {
        var config = provider.GetRequiredService<IConfiguration>();
        var target = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Database"));
        if (Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") != "Development" ||
            Environment.GetEnvironmentVariable("BHOME_DATABASE_BRANCH") != "development" ||
            target.Host != "ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech" ||
            target.Database != "neondb" || target.SslMode < SslMode.Require || email != Email)
            throw new LocalTestAccountException("Use only the verified Neon development branch and the requested synthetic Tenant account.");
        await using var scope = provider.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync()) throw new LocalTestAccountException("Compact24 schema not ready; no writes.");
        var users = sp.GetRequiredService<UserManager<ApplicationUser>>();
        var tenant = await users.FindByEmailAsync(email);
        if (tenant is null || !tenant.IsActive || !(await users.GetRolesAsync(tenant)).SequenceEqual([Roles.Tenant]))
            throw new LocalTestAccountException("Active sample Tenant not found; credentials and roles will not be changed.");
        var passwordHash = tenant.PasswordHash; var stamp = tenant.SecurityStamp;
        var existing = await db.Set<Contract>().Where(c => c.TenantUserId == tenant.Id).ToListAsync();
        Console.WriteLine($"TENANT_FOUND {Email}; contracts={existing.Count}; active={existing.Count(c => c.Status == ContractStatus.Active)}; demo={existing.Count(c => c.IsDevelopmentDemo)}");
        if (mode == "--inspect") return;
        if (mode == "--seed")
        {
            var owner = await db.Users.SingleAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner) && u.IsActive);
            var staff = await users.FindByEmailAsync("staff.sample@example.invalid");
            if (staff is null || !staff.IsActive || !await users.IsInRoleAsync(staff, Roles.Staff))
                throw new LocalTestAccountException("Existing sample Staff is required; seed never grants roles.");
            if (existing.Any(c => c.Status == ContractStatus.Active && c.Id != Id(40)))
                throw new LocalTestAccountException("Tenant already has a different active tenancy; no demo tenancy will be added.");
            await SeedCoreAsync(sp, db, tenant.Id, owner.Id, staff.Id);
            await SeedWorkflowsAsync(sp, db, tenant.Id, owner.Id);
        }
        await db.Entry(tenant).ReloadAsync();
        if (tenant.PasswordHash != passwordHash || tenant.SecurityStamp != stamp || !(await users.GetRolesAsync(tenant)).SequenceEqual([Roles.Tenant]))
            throw new LocalTestAccountException("Credential/role preservation check failed.");
        await VerifyApiAsync(sp, db, tenant);
    }

    private static async Task EnsureAsync<T>(BHomePersistenceContext db, int n, T entity) where T : class
    {
        if (await db.Set<T>().AnyAsync(row => EF.Property<Guid>(row, "Id") == Id(n))) return;
        db.Entry(entity).Property("Id").CurrentValue = Id(n); db.Add(entity);
    }
    private static byte[] TestImage(string label)
    {
        using var image = new Mat(360, 640, MatType.CV_8UC3, new Scalar(245, 247, 251));
        Cv2.PutText(image, "BHOME SYNTHETIC TEST ONLY", new Point(24, 65), HersheyFonts.HersheySimplex, .8, new Scalar(50, 50, 180), 2);
        Cv2.PutText(image, label, new Point(24, 150), HersheyFonts.HersheySimplex, .7, new Scalar(50, 50, 50), 2);
        Cv2.PutText(image, "NOT AN ID / BANK / GOVERNMENT RECORD", new Point(24, 280), HersheyFonts.HersheySimplex, .55, new Scalar(50, 50, 50), 1);
        Cv2.ImEncode(".png", image, out var bytes); return bytes;
    }

    private static async Task SeedCoreAsync(IServiceProvider sp, BHomePersistenceContext db, Guid tenant, Guid owner, Guid staff)
    {
        var now = DateTimeOffset.UtcNow; var today = Today;
        var period = new DateOnly(today.Year, today.Month, 1); var start = period.AddMonths(-5);
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == Id(10));
        if (location is not null && location.Name != LocationName) throw new LocalTestAccountException("Location fixture ID collision.");
        var contracts = await db.Set<Contract>().Where(c => new[] { Id(40), Id(41), Id(42) }.Contains(c.Id)).ToListAsync();
        if (contracts.Any(c => c.TenantUserId != tenant || !c.IsDevelopmentDemo || !c.Terms.StartsWith("[TEST]")))
            throw new LocalTestAccountException("Contract fixture ID collision; no existing records overwritten.");
        var chain = await db.Set<Chain>().SingleAsync();
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Marker},0))");
        await EnsureAsync(db, 10, new Location(LocationName) { ChainId = chain.Id, Address = "Địa chỉ tổng hợp để test Tenant, không phải địa chỉ thật" });
        await EnsureAsync(db, 11, new RoomType { LocationId = Id(10), Name = "[TEST] Phòng Tenant", DefaultCapacity = 3, AreaM2 = 25 });
        await EnsureAsync(db, 12, new StaffLocationAssignment(Id(10), staff, owner, today.AddYears(-2), today.AddYears(2)));
        for (var i = 0; i < 3; i++)
        {
            await EnsureAsync(db, 20 + i, new Room
            {
                LocationId = Id(10),
                RoomTypeId = Id(11),
                RoomNumber = $"TEST-T10{i + 1}",
                Capacity = 3,
                Floor = "1",
                Status = i == 0 ? RoomStatus.Occupied : RoomStatus.Available
            });
            await EnsureAsync(db, 30 + i, new Resident
            {
                RoomId = Id(20 + i),
                TenantUserId = tenant,
                OwnerUserId = owner,
                DisplayLabel = "[TEST] Khách thuê mẫu",
                ResidentType = ResidentType.Representative,
                VerificationStatus = IdentityVerificationStatus.Pending
            });
            var from = i == 1 ? start.AddYears(-1) : i == 2 ? today.AddDays(26) : start;
            var to = i == 1 ? start.AddDays(-1) : i == 2 ? today.AddYears(1) : today.AddDays(25);
            var contract = new Contract
            {
                RoomId = Id(20 + i),
                OwnerSignerId = owner,
                TenantUserId = tenant,
                RepresentativeResidentId = Id(30 + i),
                Kind = ContractKind.Main,
                Status = i == 1 ? ContractStatus.Terminated : i == 2 ? ContractStatus.PendingSigning : ContractStatus.Active,
                StartDate = from,
                EndDate = to,
                MonthlyRent = 3_000_000,
                RequiredDeposit = 0,
                IsDevelopmentDemo = true,
                Terms = "[TEST] Hợp đồng tổng hợp kiểm tra UI Tenant. Không phải hợp đồng thật; không chứng minh chữ ký, xác minh danh tính, giao dịch ngân hàng. Phòng 3.000.000 VND; điện 3.500 VND/kWh, nước 15.000 VND/m3, Internet 100.000 VND/tháng. Không chuyển tiền theo dữ liệu mẫu.",
                ActivatedByUserId = i == 2 ? null : owner,
                ActivatedAt = i == 2 ? null : now,
                ActualEndDate = i == 1 ? to : null,
                Residents = [new ContractResident { ContractId = Id(40 + i), ResidentId = Id(30 + i), Role = ResidentType.Representative, ResidenceFrom = from, ResidenceTo = i == 1 ? to : null }]
            };
            contract.SnapshotHash = ContractDocumentSnapshot.Hash(new(Id(40 + i), contract.RoomId, owner, tenant, contract.RepresentativeResidentId,
                [contract.RepresentativeResidentId], from, to, contract.MonthlyRent, 0, null, 0, contract.Terms, ""));
            await EnsureAsync(db, 40 + i, contract);
        }
        await EnsureAsync(db, 45, new Asset { LocationId = Id(10), RoomId = Id(20), Name = "[TEST] Máy lạnh", Category = "Thiết bị", Condition = "Tốt — mẫu", Status = AssetStatus.Active });
        await EnsureAsync(db, 46, new Asset { LocationId = Id(10), RoomId = Id(20), Name = "[TEST] Vòi nước", Category = "Thiết bị", Condition = "Cần kiểm tra — mẫu", Status = AssetStatus.Active });
        for (var utility = 0; utility < 2; utility++)
            await EnsureAsync(db, 50 + utility, new Meter
            {
                RoomId = Id(20),
                Code = "TEST-T101-" + (utility == 0 ? "ELEC" : "WATER"),
                UtilityType = (UtilityType)utility,
                Display = MeterDisplay.Digital,
                InstalledOn = start,
                DecimalPlaces = 0
            });
        await db.SaveChangesAsync();
        var storage = sp.GetRequiredService<IObjectStorage>();
        for (var i = 0; i < 6; i++) for (var utility = 0; utility < 2; utility++)
            {
                var n = 100 + i * 10 + utility;
                var date = i == 5 ? start : period.AddMonths(-i).AddDays(4);
                var value = utility == 0 ? 1000 + (5 - i) * 100 : 100 + (5 - i) * 10;
                var image = TestImage((utility == 0 ? "ELECTRICITY " : "WATER ") + value);
                var key = $"tenant-demo/{tenant:N}/meters/{n}.png";
                if (await db.Set<MeterReading>().AnyAsync(r => r.Id == Id(n + 200)))
                {
                    if (!await ObjectMatchesAsync(storage, key, image))
                    {
                        using var repair = new MemoryStream(image); await storage.PutAsync(key, repair, image.Length, "image/png", default);
                        if (!await ObjectMatchesAsync(storage, key, image)) throw new LocalTestAccountException("Synthetic meter object upload failed integrity verification.");
                    }
                    continue;
                }
                using var content = new MemoryStream(image); await storage.PutAsync(key, content, image.Length, "image/png", default);
                await EnsureAsync(db, n, new OperationalTask
                {
                    Kind = OperationalTaskKind.MeterReading,
                    LocationId = Id(10),
                    MeterId = Id(50 + utility),
                    ContractId = Id(40),
                    AssignedStaffUserId = staff,
                    AssignmentId = Id(12),
                    AssignedAt = now,
                    Title = "[TEST] Chỉ số điện nước Tenant",
                    Purpose = i == 5 ? ReadingPurpose.Initial : ReadingPurpose.Periodic,
                    ReadingDate = date,
                    BillingPeriod = i == 5 ? null : period.AddMonths(-i),
                    Status = MeterTaskStatus.Completed,
                    CompletedAt = now
                });
                await EnsureAsync(db, n + 100, new MeterEvidence
                {
                    TaskId = Id(n),
                    UploadedByUserId = staff,
                    ObjectKey = key,
                    ImageHash = Convert.ToHexString(SHA256.HashData(image)),
                    ContentType = "image/png",
                    Length = image.Length,
                    IsUploaded = true,
                    IsLinked = true,
                    CleanupAfter = now.AddYears(1)
                });
                await EnsureAsync(db, n + 200, new MeterReading
                {
                    TaskId = Id(n),
                    MeterId = Id(50 + utility),
                    EvidenceId = Id(n + 100),
                    PreviousValue = i == 5 ? null : value - (utility == 0 ? 100 : 10),
                    ConfirmedValue = value,
                    Consumption = i == 5 ? null : utility == 0 ? 100 : 10,
                    ConfirmedAt = now,
                    ConfirmedByUserId = staff,
                    Status = MeterReadingStatus.Confirmed
                });
            }
        await db.SaveChangesAsync();
        for (var i = 0; i < 5; i++)
        {
            var p = period.AddMonths(-i); var invoiceId = Id(400 + i);
            var invoice = new Invoice
            {
                RoomId = Id(20),
                LocationId = Id(10),
                RoomNumber = "TEST-T101",
                LocationName = LocationName,
                BillingPeriod = p,
                RepresentativeContractId = Id(40),
                RepresentativeTenantUserId = tenant,
                Status = InvoiceStatus.Draft,
                Total = 3_600_000,
                CreatedByUserId = owner,
                ScheduledFinalDate = p.AddDays(5),
                DueDate = i == 0 ? today.AddDays(7) : p.AddDays(19),
                ScheduleSnapshot = JsonSerializer.Serialize(new { syntheticFixture = Marker, noRealPayment = true }),
                Recipients = [new InvoiceRecipient { InvoiceId = invoiceId, TenantUserId = tenant }]
            };
            var charges = new[] { (ChargeCategory.Rent, "RENT", "Tiền phòng", 3_000_000m, 1m), (ChargeCategory.Electricity, "ELECTRICITY", "Điện", 3_500m, 100m),
                (ChargeCategory.Water, "WATER", "Nước", 15_000m, 10m), (ChargeCategory.ServiceFee, "INTERNET", "Internet", 100_000m, 1m) };
            invoice.Lines = charges.Select((x, j) => new InvoiceLine
            {
                Id = Id(500 + i * 10 + j),
                InvoiceId = invoiceId,
                Category = x.Item1,
                ChargeCode = x.Item2,
                Name = "[TEST] " + x.Item3,
                RateDate = p,
                Rate = x.Item4,
                Quantity = x.Item5,
                Amount = x.Item4 * x.Item5,
                OccupiedDays = DateTime.DaysInMonth(p.Year, p.Month),
                PeriodDays = DateTime.DaysInMonth(p.Year, p.Month),
                MeterReadingId = j is 1 or 2 ? Id(300 + i * 10 + j - 1) : null,
                PreviousReading = j == 1 ? 1000 + (4 - i) * 100 : j == 2 ? 100 + (4 - i) * 10 : null,
                ConfirmedReading = j == 1 ? 1000 + (5 - i) * 100 : j == 2 ? 100 + (5 - i) * 10 : null
            }).ToList();
            await EnsureAsync(db, 400 + i, invoice);
        }
        await db.SaveChangesAsync();
        foreach (var invoice in await db.Set<Invoice>().Where(i => new[] { Id(400), Id(401), Id(402), Id(403) }.Contains(i.Id)).ToListAsync())
            if (invoice.Status == InvoiceStatus.Draft) { invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = owner; invoice.FinalizedAt = now; invoice.Version++; }
        var electricityEvidence = await db.Set<MeterEvidence>().SingleAsync(e => e.Id == Id(250));
        var waterEvidence = await db.Set<MeterEvidence>().SingleAsync(e => e.Id == Id(251));
        var handover = new HandoverSnapshot(start, "TEST-T101", "[TEST] Phòng mẫu cần đối chiếu", "[TEST] 2 chìa khóa", "[TEST] Biên bản nháp, chưa nghiệm thu thực tế.",
            [new(Id(45), "[TEST] Máy lạnh", "Tốt", "Chưa đối chiếu"), new(Id(46), "[TEST] Vòi nước", "Cần kiểm tra", "Chưa đối chiếu")],
            new(Id(350), "TEST-T101-ELEC", 0, start, 1000, Id(250), electricityEvidence.ObjectKey, electricityEvidence.ImageHash),
            new(Id(351), "TEST-T101-WATER", 1, start, 100, Id(251), waterEvidence.ObjectKey, waterEvidence.ImageHash), []);
        var existingHandover = await db.Set<ContractHandover>().SingleOrDefaultAsync(h => h.Id == Id(600));
        // Repair only this seed's unmodified draft from an interrupted initial seed, never a user-edited handover.
        if (existingHandover is { Version: 1, Status: ContractHandoverStatus.Draft, TenantConfirmedAt: null, StaffConfirmedAt: null })
        {
            var snapshot = JsonSerializer.Deserialize<HandoverSnapshot>(existingHandover.Snapshot);
            if (snapshot is not null && snapshot.Notes == handover.Notes && snapshot.Electricity.EvidenceHash == "" && snapshot.Water.EvidenceHash == "")
                existingHandover.Snapshot = JsonSerializer.Serialize(handover);
        }
        await EnsureAsync(db, 600, new ContractHandover
        {
            ContractId = Id(40),
            Status = ContractHandoverStatus.Draft,
            Version = 1,
            Snapshot = JsonSerializer.Serialize(handover),
            ElectricityReadingId = Id(350),
            WaterReadingId = Id(351)
        });
        var currentContract = await db.Set<Contract>().SingleAsync(c => c.Id == Id(40));
        await EnsureAsync(db, 610, new ContractExpiryNotice
        {
            ContractId = currentContract.Id,
            RecipientId = tenant,
            EndDate = currentContract.EndDate,
            Stage = "Upcoming30",
            CreatedAt = now
        });
        for (var i = 0; i < 26; i++)
            await EnsureAsync(db, 700 + i, new UserNotification
            {
                RecipientUserId = tenant,
                AudienceRole = Roles.Tenant,
                LocationId = Id(10),
                Category = i % 2 == 0 ? "Invoice" : "Contract",
                Title = $"[TEST] Cập nhật Tenant {i + 1:00}",
                Summary = "Dữ liệu tổng hợp kiểm tra UI, không chuyển tiền. Không gửi email/push.",
                RelatedObjectType = i % 2 == 0 ? "Invoice" : "Contract",
                RelatedObjectId = i % 2 == 0 ? Id(400 + i % 4) : Id(40),
                EventKey = Marker + ":" + i,
                CreatedAt = now.AddHours(-i * 3),
                ReadAt = i % 3 == 0 ? now.AddMinutes(-i) : null,
                DeliveryState = "Unconfigured"
            });
        await db.SaveChangesAsync(); await tx.CommitAsync();
        Console.WriteLine("CORE_READY: 1 demo Location, 3 rooms/contracts (Active/Terminated/PendingSigning), 5 invoices (4 Final/1 Draft), 12 readings with PNG objects, Draft handover, 26 notifications.");
    }

    private static async Task<bool> ObjectMatchesAsync(IObjectStorage storage, string key, byte[] expected)
    {
        try
        {
            using var copy = new MemoryStream(); await storage.CopyToAsync(key, copy, default);
            return copy.ToArray().AsSpan().SequenceEqual(expected);
        }
        catch (Minio.Exceptions.ObjectNotFoundException) { return false; }
    }
}
