using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.LocalDevelopment;

// Explicit loopback-only synthetic fixtures. No provider callbacks or real bank settlement.
public static class MaintenanceDemoSeed
{
    public static Guid Id(int n) => Guid.Parse($"bf070000-0000-4000-8000-{n:000000000000}");
    private static Guid User(int n) => Compact24SampleSeed.Id(n);
    public static async Task RunAsync(IServiceProvider provider, string environment, string password)
    {
        var config = provider.GetRequiredService<IConfiguration>();
        Compact24SampleSeed.ValidateTarget(environment, config.GetConnectionString("Database") ?? "");
        if (string.IsNullOrWhiteSpace(password)) throw new LocalTestAccountException("Set BHOME_MAINTENANCE_DEMO_PASSWORD for synthetic demo accounts.");
        await Compact24SampleSeed.RunAsync(provider, environment, password);
        await using var scope = provider.CreateAsyncScope(); var services = scope.ServiceProvider;
        var db = services.GetRequiredService<BHomePersistenceContext>();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({Id(10).ToString()},0))");
            if (!await db.Locations.AnyAsync(l => l.Id == Id(10)))
            {
                Add(db, 10, new Location("[DEMO BF07] Cơ sở bảo trì tổng hợp") { Address = "Địa chỉ tổng hợp phục vụ demo" });
                Add(db, 20, new Room { LocationId = Id(10), RoomNumber = "BF07-101", Status = RoomStatus.Occupied, Capacity = 3 });
                Add(db, 21, new Room { LocationId = Id(10), RoomNumber = "BF07-102", Status = RoomStatus.Available, Capacity = 2 });
                Add(db, 30, new Asset { LocationId = Id(10), RoomId = Id(20), Name = "Quạt demo BF07", Category = "Thiết bị", Condition = "Cần kiểm tra" });
                Add(db, 31, new Asset { LocationId = Id(10), CommonArea = "Hành lang", Name = "Đèn demo BF07", Category = "Chiếu sáng", Condition = "Cần kiểm tra" });
                Add(db, 40, new Resident { RoomId = Id(20), OwnerUserId = User(1), TenantUserId = User(3), DisplayLabel = "Khách thuê tổng hợp BF07" });
                Add(db, 50, new Contract
                {
                    RoomId = Id(20),
                    TenantUserId = User(3),
                    OwnerSignerId = User(1),
                    RepresentativeResidentId = Id(40),
                    StartDate = today.AddMonths(-1),
                    EndDate = today.AddYears(1),
                    MonthlyRent = 1000000,
                    RequiredDeposit = 1000000,
                    Status = ContractStatus.Active,
                    ActivatedByUserId = User(1),
                    ActivatedAt = DateTimeOffset.UtcNow,
                    IsDevelopmentDemo = true,
                    Terms = "[DEMO BF07] Synthetic active tenancy fixture, no provider signing claim",
                    Residents = [new ContractResident { ResidentId = Id(40), Role = ResidentType.Representative, ResidenceFrom = today.AddMonths(-1) }]
                });
                db.Add(new StaffLocationAssignment(Id(10), User(2), User(1), today.AddYears(-1), today.AddYears(1)));
                await db.SaveChangesAsync();
                Add(db, 60, new DepositVerification
                {
                    ContractId = Id(50),
                    Amount = 1000000,
                    BankTransactionReference = "SYNTHETIC-BF07-DEPOSIT",
                    VerificationReason = "[DEMO] Isolated synthetic deposit fixture, no bank transfer",
                    VerifiedByUserId = User(1),
                    VerifiedAt = DateTimeOffset.UtcNow
                });
                await db.SaveChangesAsync();
            }
            else if (!await db.Locations.AnyAsync(l => l.Id == Id(10) && l.Name == "[DEMO BF07] Cơ sở bảo trì tổng hợp"))
                throw new LocalTestAccountException("Maintenance fixture ID collision.");

            // Keep the original BF07-101 fixture identity (Room ID 20) intact.
            // P.101 is a separate, occupied room with its own active tenancy.
            var originalRoom = await db.Set<Room>().SingleOrDefaultAsync(r => r.Id == Id(20));
            if (originalRoom is null || originalRoom.LocationId != Id(10))
                throw new LocalTestAccountException("BF07-101 maintenance fixture ID collision.");
            if (originalRoom.RoomNumber == "P.101") originalRoom.RoomNumber = "BF07-101"; // Repair the earlier incorrect demo seed.
            else if (originalRoom.RoomNumber != "BF07-101")
                throw new LocalTestAccountException("BF07-101 maintenance fixture room number changed unexpectedly.");

            var p101Room = await db.Set<Room>().SingleOrDefaultAsync(r => r.Id == Id(22));
            if (p101Room is null)
            {
                if (await db.Set<Room>().AnyAsync(r => r.LocationId == Id(10) && r.RoomNumber == "P.101"))
                    throw new LocalTestAccountException("P.101 maintenance fixture room number collision.");
                p101Room = new Room { LocationId = Id(10), RoomNumber = "P.101", Status = RoomStatus.Occupied, Capacity = 3 };
                Add(db, 22, p101Room);
            }
            else if (p101Room.LocationId != Id(10) || p101Room.RoomNumber != "P.101")
                throw new LocalTestAccountException("P.101 maintenance fixture ID collision.");
            else if (await db.Set<Room>().AnyAsync(r => r.LocationId == Id(10) && r.Id != Id(22) && r.RoomNumber == "P.101"))
                throw new LocalTestAccountException("P.101 maintenance fixture room number collision.");
            p101Room.Status = RoomStatus.Occupied;

            var p101Resident = await db.Set<Resident>().SingleOrDefaultAsync(r => r.Id == Id(41));
            if (p101Resident is null)
                Add(db, 41, new Resident
                {
                    RoomId = Id(22),
                    OwnerUserId = User(1),
                    TenantUserId = User(3),
                    DisplayLabel = "Khách thuê P.101 BF07",
                    ResidentType = ResidentType.Representative,
                    VerificationStatus = IdentityVerificationStatus.Verified
                });
            else if (p101Resident.RoomId != Id(22) || p101Resident.OwnerUserId != User(1) || p101Resident.TenantUserId != User(3))
                throw new LocalTestAccountException("P.101 maintenance fixture resident ID collision.");

            var p101Contract = await db.Set<Contract>().SingleOrDefaultAsync(c => c.Id == Id(51));
            if (p101Contract is null)
                Add(db, 51, new Contract
                {
                    RoomId = Id(22),
                    TenantUserId = User(3),
                    OwnerSignerId = User(1),
                    RepresentativeResidentId = Id(41),
                    Kind = ContractKind.Main,
                    Status = ContractStatus.Active,
                    StartDate = today.AddMonths(-1),
                    EndDate = today.AddYears(1),
                    MonthlyRent = 1000000,
                    RequiredDeposit = 1000000,
                    ActivatedByUserId = User(1),
                    ActivatedAt = DateTimeOffset.UtcNow,
                    IsDevelopmentDemo = true,
                    Terms = "[DEMO BF07] Synthetic active P.101 tenancy fixture, no provider signing claim",
                    Residents = [new ContractResident { ResidentId = Id(41), Role = ResidentType.Representative, ResidenceFrom = today.AddMonths(-1) }]
                });
            else if (p101Contract.RoomId != Id(22) || p101Contract.TenantUserId != User(3) ||
                p101Contract.RepresentativeResidentId != Id(41) || p101Contract.Status != ContractStatus.Active)
                throw new LocalTestAccountException("P.101 maintenance fixture contract ID collision.");

            var airConditioner = await db.Set<Asset>().SingleOrDefaultAsync(a => a.Id == Id(32));
            if (airConditioner is null)
                Add(db, 32, new Asset
                {
                    LocationId = Id(10),
                    RoomId = Id(22),
                    Name = "Điều hòa 1.5 HP",
                    Category = "Điện lạnh",
                    Condition = "Không làm lạnh",
                    Status = AssetStatus.NeedsRepair
                });
            else if (airConditioner.LocationId != Id(10) ||
                airConditioner.RoomId.HasValue && airConditioner.RoomId != Id(20) && airConditioner.RoomId != Id(22) ||
                airConditioner.Name != "Điều hòa 1.5 HP" || airConditioner.Category != "Điện lạnh")
                throw new LocalTestAccountException("P.101 air-conditioner fixture ID collision.");
            else airConditioner.RoomId = Id(22); // Move the earlier incorrect P.101 seed asset to its corrected room.
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        }
        var actor = services.GetRequiredService<LifecycleSeedActor>();
        var incidents = services.GetRequiredService<IncidentService>();
        actor.UserId = User(3); actor.Role = Roles.Tenant;
        var p101IncidentDescription = "Điều hòa phòng P.101 không làm lạnh";
        var p101Incident = await db.Set<IncidentReport>().SingleOrDefaultAsync(r => r.Description == p101IncidentDescription);
        if (p101Incident is null)
        {
            using var reportImage = new Mat(80, 480, MatType.CV_8UC3, Scalar.White);
            Cv2.PutText(reportImage, "SYNTHETIC P.101 AIR CONDITIONER", new Point(8, 46),
                HersheyFonts.HersheySimplex, .65, Scalar.Black);
            Cv2.ImEncode(".png", reportImage, out var reportImageBytes);
            await incidents.SubmitAsync(new(Id(10), Id(22), null, Id(32), IncidentSeverity.Normal, p101IncidentDescription),
                [new IncidentImage(reportImageBytes)], Id(116), default);
        }
        else
        {
            if (p101Incident.LocationId != Id(10) || p101Incident.ReporterId != User(3) ||
                p101Incident.ReporterRole != Roles.Tenant || p101Incident.Severity != IncidentSeverity.Normal ||
                p101Incident.Status != IncidentStatus.Submitted ||
                await db.Set<MaintenanceWorkOrder>().AnyAsync(w => w.IncidentId == p101Incident.Id))
                throw new LocalTestAccountException("P.101 maintenance incident fixture is no longer an untouched Tenant report.");
            p101Incident.RoomId = Id(22);
            p101Incident.CommonArea = null;
            p101Incident.AssetId = Id(32);
            p101Incident.ContractId = Id(51);
            await db.SaveChangesAsync();
        }
        foreach (var (number, label, severity) in new[]
        {
            (100, "[DEMO BF07 A] Thiết bị trong phòng hỏng, chưa xác định tài sản", IncidentSeverity.Normal),
            (101, "[DEMO BF07 B] Vỡ đường nước gây ngập phòng, cần cô lập khu vực", IncidentSeverity.Emergency),
            (102, "[DEMO BF07 E] Cần kiểm tra thiết bị và đề xuất tài sản liên quan", IncidentSeverity.Normal),
            (103, "[DEMO BF07 I] Hỏng thiết bị cần sửa chữa và xác minh lại", IncidentSeverity.Normal)
        })
            if (!await db.Set<IncidentReport>().AnyAsync(r => r.Description == label))
                await incidents.SubmitAsync(new(Id(10), Id(20), null, null, severity, label), [], Id(number), default);
        actor.UserId = User(1); actor.Role = Roles.Owner;
        await Proactive(110, "[DEMO BF07 C] Bảo trì phòng trống", Id(21), null);
        await Proactive(111, "[DEMO BF07 C] Kiểm tra đèn hành lang", null, "Hành lang");
        await Proactive(112, "[DEMO BF07 D] Điều chỉnh thiết bị không dùng vật tư", Id(20), null);
        var vendor = await Proactive(113, "[DEMO BF07 F] Sửa chữa cần đơn vị bên ngoài", Id(20), null);
        var invoice = await Proactive(114, "[DEMO BF07 G] Sửa thiết bị, Owner xem xét bồi thường qua hóa đơn", Id(20), null);
        var deposit = await Proactive(115, "[DEMO BF07 H] Sửa thiết bị, Owner xem xét khấu trừ cọc khi trả phòng", Id(20), null);
        await Prepare(vendor, 113, false, "Đơn vị sửa chữa tổng hợp BF07");
        await Prepare(invoice, 114, true, null); await Prepare(deposit, 115, true, null);
        foreach (var (workId, number, method) in new[] { (invoice, 114, "Invoice"), (deposit, 115, "Deposit") })
        {
            actor.UserId = User(1); actor.Role = Roles.Owner;
            var service = services.GetRequiredService<CompensationService>();
            if (await service.GetAsync(workId, default) is not null) continue;
            if ((await incidents.WorkOrderAsync(workId, default)).Status != "Verified") continue;
            var evidence = await incidents.WorkEvidenceAsync(workId, default);
            await service.CreateAsync(workId, new(Id(50), 50000, method, method == "Invoice" ? today.AddDays(7) : null,
                "[DEMO BF07] Owner xác nhận trách nhiệm theo bằng chứng tổng hợp", [evidence.Single(e => e.Kind == "Completion").Id]), Id(number + 500), default);
        }
        Console.WriteLine("BF07_DEMO_READY synthetic Location=" + Id(10) + "; accounts=owner.sample,staff.sample,tenant.sample@example.invalid; real provider settlement not executed.");

        async Task<Guid> Proactive(int number, string description, Guid? room, string? area)
        {
            var existing = await db.Set<MaintenanceWorkOrder>().AsNoTracking().SingleOrDefaultAsync(w => w.Description == description);
            if (existing is not null) return existing.Id;
            return (await incidents.CreateProactiveAsync(new(Id(10), room, area, null, description,
                "Kiểm tra an toàn và hoàn tất công việc demo", DateTimeOffset.UtcNow.AddDays(7)), Id(number), default)).WorkOrderId!.Value;
        }
        async Task Prepare(Guid workId, int number, bool complete, string? vendorName)
        {
            actor.UserId = User(2); actor.Role = Roles.Staff;
            var work = await incidents.WorkOrderAsync(workId, default);
            if (work.Status == "Assigned") await incidents.ProposeAsync(workId,
                new(work.Version, "[DEMO] Đã kiểm tra thiết bị tổng hợp", "[DEMO] Sửa theo phương án được Owner duyệt", 30, 100000, []), Id(number + 100), default);
            actor.UserId = User(1); actor.Role = Roles.Owner;
            work = await incidents.WorkOrderAsync(workId, default);
            if (work.Status == "PendingApproval" && !work.PlanApproved)
                await incidents.PlanAsync(workId, new(work.Version, true, "[DEMO] Duyệt phương án tổng hợp", vendorName), Id(number + 200), default);
            if (!complete) return;
            actor.UserId = User(2); actor.Role = Roles.Staff;
            work = await incidents.WorkOrderAsync(workId, default);
            if (work.CanStart) await incidents.ActAsync(workId, "start", new(work.Version), Id(number + 300), default);
            work = await incidents.WorkOrderAsync(workId, default);
            if (work.Status == "InProgress")
            {
                using var image = new Mat(32, 320, MatType.CV_8UC3, Scalar.White);
                Cv2.PutText(image, "SYNTHETIC BF07 DEMO", new Point(5, 24), HersheyFonts.HersheySimplex, .6, Scalar.Black);
                Cv2.ImEncode(".png", image, out var bytes); using var stream = new MemoryStream(bytes);
                var photo = await incidents.UploadWorkEvidenceAsync(workId, IncidentEvidenceKind.Completion, Id(number + 400), stream, default);
                await incidents.ActAsync(workId, "submit", new(work.Version, "[DEMO] Hoàn tất, ảnh tổng hợp", [photo.ResourceId!.Value]), Id(number + 450), default);
            }
            actor.UserId = User(1); actor.Role = Roles.Owner;
            work = await incidents.WorkOrderAsync(workId, default);
            if (work.Status == "PendingVerification") await incidents.VerifyAsync(workId,
                new(work.Version, 100000, "[DEMO] Xác minh kết quả tổng hợp", null, null), Id(number + 475), default);
        }
    }
    private static void Add<T>(BHomePersistenceContext db, int n, T entity) where T : class
    {
        db.Entry(entity).Property("Id").CurrentValue = Id(n); db.Add(entity);
    }
}
