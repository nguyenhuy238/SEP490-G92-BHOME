using System.Security.Cryptography;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpenCvSharp;

namespace BHome.LocalDevelopment;

// Explicit synthetic UI scenarios in the existing local Mobile workspace.
// Never manufactures signatures, bank verification, official identity or inspection evidence.
internal static class MobileContractOverviewSeed
{
    private static Guid Id(int n) => Guid.Parse($"bc050000-0000-4000-8000-{n:000000000000}");
    private static Guid Mobile(int n) => Guid.Parse($"b4040000-0000-4000-8000-{n:000000000000}");
    private static void Add<T>(BHomePersistenceContext db, int n, T entity) where T : class
    { db.Entry(entity).Property("Id").CurrentValue = Id(n); db.Add(entity); }

    public static async Task RunAsync(IServiceProvider provider, CancellationToken t = default)
    {
        var config = provider.GetRequiredService<IConfiguration>();
        LocalTestAccounts.ValidateTarget(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), config.GetConnectionString("Database") ?? "");
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync(t)) throw new LocalTestAccountException("Compact24 chưa sẵn sàng.");
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var now = DateTimeOffset.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"mobile-contract-overview-v1"},0))", t);
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == Mobile(10), t);
        if (location?.Name != "BHOME MOBILE TEST" || !await db.Set<RoomType>().AnyAsync(r => r.Id == Mobile(11) && r.LocationId == location.Id, t))
            throw new LocalTestAccountException("Cần bộ Mobile test gốc; không tự tạo hoặc thay cơ sở.");
        foreach (var (n, role) in new[] { (1, Roles.Owner), (2, Roles.Staff) })
        {
            var user = await users.FindByIdAsync(Mobile(n).ToString());
            if (user is null || user.UserName != role.ToLowerInvariant() + ".mobile.test" || !user.IsActive ||
                !(await users.GetRolesAsync(user)).SequenceEqual([role])) throw new LocalTestAccountException("Tài khoản Mobile test không khớp.");
        }
        var assignment = await db.StaffLocationAssignments.Where(a => a.LocationId == location.Id && a.StaffUserId == Mobile(2) && a.StartDate <= today && a.EndDate >= today)
            .OrderByDescending(a => a.StartDate).FirstOrDefaultAsync(t);
        if (assignment is null)
            throw new LocalTestAccountException("Staff test không có phân công hiệu lực; không tự thay quyền.");

        var states = new[] { ContractStatus.Draft, ContractStatus.PendingSigning, ContractStatus.PendingActivation,
            ContractStatus.Active, ContractStatus.Active, ContractStatus.Active, ContractStatus.Active,
            ContractStatus.Active, ContractStatus.Terminated, ContractStatus.Cancelled, ContractStatus.Superseded };
        var created = 0;
        for (var i = 0; i < states.Length; i++)
        {
            var roomName = $"CT{201 + i}";
            var existingRoom = await db.Set<Room>().SingleOrDefaultAsync(r => r.Id == Id(2000 + i), t);
            if (existingRoom is not null)
            {
                if (existingRoom.LocationId != location.Id || existingRoom.RoomNumber != roomName ||
                    !await db.Set<Contract>().AnyAsync(c => c.Id == Id(4000 + i) && c.RoomId == existingRoom.Id && c.IsDevelopmentDemo, t))
                    throw new LocalTestAccountException("Trùng ID ngoài fixture; không thay đổi dữ liệu.");
                continue; // Preserve every modification made through the app on subsequent runs.
            }
            if (await db.Set<Room>().AnyAsync(r => r.LocationId == location.Id && r.RoomNumber == roomName, t))
                throw new LocalTestAccountException("Trùng tên phòng ngoài fixture.");
            var username = $"tenant.contract.overview.{i + 1:00}";
            if (await users.FindByNameAsync(username) is not null || await db.Users.AnyAsync(u => u.Id == Id(1000 + i), t))
                throw new LocalTestAccountException("Trùng tài khoản ngoài fixture; không đổi mật khẩu/quyền.");
            var tenant = new ApplicationUser { Id = Id(1000 + i), UserName = username, Email = username + "@example.invalid", IsActive = true, LockoutEnabled = true };
            db.PrepareUserRole(tenant, Roles.Tenant);
            var result = await users.CreateAsync(tenant, "Fixture!9aA" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)));
            if (!result.Succeeded) throw new LocalTestAccountException("Không tạo được Tenant tổng hợp: " + string.Join(",", result.Errors.Select(e => e.Code)));
            var state = states[i];
            var active = state is ContractStatus.Active or ContractStatus.Superseded;
            Add(db, 2000 + i, new Room
            {
                LocationId = location.Id,
                RoomTypeId = Mobile(11),
                RoomNumber = roomName,
                Capacity = 1,
                Status = active ? RoomStatus.Occupied : RoomStatus.Available
            });
            Add(db, 3000 + i, new Resident
            {
                RoomId = Id(2000 + i),
                TenantUserId = tenant.Id,
                OwnerUserId = Mobile(1),
                DisplayLabel = $"Người thuê tổng hợp {roomName}",
                ResidentType = ResidentType.Representative,
                VerificationStatus = IdentityVerificationStatus.Pending
            });
            var start = state is ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Cancelled
                ? today.AddDays(7) : today.AddMonths(-3);
            var end = i == 4 ? today.AddDays(10) : i == 5 ? today.AddDays(30) : state == ContractStatus.Terminated ? today.AddDays(-15)
                : state == ContractStatus.Superseded ? today.AddDays(-1) : start.AddYears(1);
            var rent = 3000000 + i * 100000;
            Contract MakeContract(int number, ContractKind kind, ContractStatus status, DateOnly from, DateOnly to, Guid? previous = null)
            {
                var contract = new Contract
                {
                    RoomId = Id(2000 + i),
                    OwnerSignerId = Mobile(1),
                    TenantUserId = tenant.Id,
                    RepresentativeResidentId = Id(3000 + i),
                    Kind = kind,
                    Status = status,
                    StartDate = from,
                    EndDate = to,
                    MonthlyRent = rent,
                    RequiredDeposit = status == ContractStatus.PendingActivation ? rent : 0,
                    Terms = $"DỮ LIỆU MINH HỌA TEST {roomName} – không phải hợp đồng thật.\n1. Các bên: Owner và Tenant tổng hợp trong BHOME MOBILE TEST.\n2. Phòng thuê: {roomName}; tối đa 1 người.\n3. Thời hạn: {from:dd/MM/yyyy} – {to:dd/MM/yyyy}.\n4. Tiền thuê mẫu: {rent} VND/tháng; điện, nước theo biểu phí cơ sở.\n5. Bàn giao: ghi nhận hiện trạng, chìa khóa, tài sản và chỉ số xác nhận bằng luồng thật trên ứng dụng.\n6. Gia hạn/trả phòng: gửi yêu cầu, kiểm tra và chờ Owner xử lý theo quy trình.\nTrạng thái được seed để kiểm tra UI; không chứng minh đã ký, đã trả tiền hoặc đã xác minh danh tính.",
                    SnapshotHash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"mobile-contract-overview/{number}"))),
                    IsDevelopmentDemo = true,
                    PreviousContractId = previous,
                    ActivatedByUserId = status is ContractStatus.Active or ContractStatus.Superseded or ContractStatus.Terminated ? Mobile(1) : null,
                    ActivatedAt = status is ContractStatus.Active or ContractStatus.Superseded or ContractStatus.Terminated ? now.AddDays(-30) : null,
                    ActualEndDate = status == ContractStatus.Terminated ? to : null,
                    Residents = [new ContractResident { ContractId = Id(number), ResidentId = Id(3000 + i), Role = ResidentType.Representative,
                        ResidenceFrom = from, ResidenceTo = status is ContractStatus.Terminated or ContractStatus.Superseded ? to : null }]
                };
                Add(db, number, contract);
                db.SecurityAudit.Add(new SecurityAuditRecord
                {
                    Id = Id(8000 + number),
                    UserId = Mobile(1),
                    TargetType = "Contract",
                    TargetId = Id(number),
                    Event = "ContractOverviewFixtureCreated",
                    Succeeded = true,
                    OccurredAt = now
                });
                created++;
                return contract;
            }
            MakeContract(4000 + i, ContractKind.Main, state, start, end);
            if (i is 5 or 10) MakeContract(4500 + i, ContractKind.Renewal, i == 5 ? ContractStatus.Draft : ContractStatus.Active,
                end.AddDays(1), end.AddYears(1), Id(4000 + i));
            if (i is 6 or 7)
            {
                Add(db, 5000 + i, new ContractMoveOut
                {
                    ContractId = Id(4000 + i),
                    Status = i == 6 ? MoveOutStatus.Requested : MoveOutStatus.Approved,
                    ProposedDate = today.AddDays(7),
                    Reason = "Yêu cầu trả phòng tổng hợp để kiểm tra giao diện; không phải yêu cầu thật.",
                    RequestedByUserId = tenant.Id,
                    ApprovedByUserId = i == 7 ? Mobile(1) : null,
                    ApprovedAt = i == 7 ? now : null,
                    InspectionStaffId = i == 7 ? Mobile(2) : null,
                    InspectionScheduledAt = i == 7 ? new DateTimeOffset(today.AddDays(2).ToDateTime(new TimeOnly(3, 0)), TimeSpan.Zero) : null
                });
            }
            if (active)
                for (var utility = 0; utility < 2; utility++)
                {
                    Add(db, 6000 + i * 2 + utility, new Meter
                    {
                        RoomId = Id(2000 + i),
                        Code = $"OVERVIEW-{roomName}-{(utility == 0 ? "E" : "W")}",
                        UtilityType = (UtilityType)utility,
                        Display = MeterDisplay.Digital,
                        DecimalPlaces = 2,
                        InstalledOn = today.AddMonths(-4)
                    });
                    Add(db, 7000 + i * 2 + utility, new OperationalTask
                    {
                        Kind = OperationalTaskKind.MeterReading,
                        LocationId = location.Id,
                        MeterId = Id(6000 + i * 2 + utility),
                        AssignedStaffUserId = Mobile(2),
                        AssignmentId = assignment.Id,
                        AssignedAt = now,
                        Title = $"Ghi số ban đầu {roomName} (dữ liệu test)",
                        ReadingDate = today,
                        Purpose = ReadingPurpose.Initial,
                        Status = MeterTaskStatus.Assigned,
                        DueAt = now.AddDays(7)
                    });
                }
            await db.SaveChangesAsync(t);
        }
        var artifacts = Path.Combine(Directory.GetCurrentDirectory(), ".tools", "mobile-contract-overview");
        Directory.CreateDirectory(artifacts);
        foreach (var (name, value) in new[] { ("electricity", "100 kWh"), ("water", "10 m3"), ("room", "LAYOUT PLACEHOLDER") })
        {
            var imagePath = Path.Combine(artifacts, $"synthetic-{name}.png");
            if (File.Exists(imagePath)) continue;
            using var image = new Mat(360, 800, MatType.CV_8UC3, Scalar.White);
            Cv2.PutText(image, "SYNTHETIC TEST ONLY - CT204", new Point(24, 75), HersheyFonts.HersheySimplex, 1, Scalar.Black, 2);
            Cv2.PutText(image, name.ToUpperInvariant() + " " + value, new Point(24, 170), HersheyFonts.HersheySimplex, 1.2, Scalar.Black, 2);
            Cv2.PutText(image, "NOT A REAL PHOTO", new Point(24, 270), HersheyFonts.HersheySimplex, 1, Scalar.Black, 2);
            await File.WriteAllBytesAsync(imagePath, image.ImEncode(".png"), t);
        }
        await tx.CommitAsync(t);
        Console.WriteLine($"MOBILE_CONTRACT_OVERVIEW_READY: thêm {created} hợp đồng minh họa; giữ nguyên dữ liệu/tài khoản hiện có. Không tạo chữ ký, xác minh cọc hoặc bằng chứng giả.");
    }
}
