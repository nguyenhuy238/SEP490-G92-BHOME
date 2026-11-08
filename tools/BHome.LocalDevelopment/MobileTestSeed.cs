using System.Text.Json;
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

namespace BHome.LocalDevelopment;

// Explicit synthetic UI fixtures, never a production onboarding/payment workflow.
internal static class MobileTestSeed
{
    internal static Guid Id(int n) => Guid.Parse($"b4040000-0000-4000-8000-{n:000000000000}");
    public static async Task RunAsync(IServiceProvider provider, string password)
    {
        var config = provider.GetRequiredService<IConfiguration>();
        LocalTestAccounts.ValidateTarget(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"),
            config.GetConnectionString("Database") ?? "");
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        if (!await db.IsSchemaReadyAsync()) throw new LocalTestAccountException("Compact24 chưa sẵn sàng.");
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var now = DateTimeOffset.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"mobile-test-fixture-v1"}, 0))");
        foreach (var (n, role) in new[] { (1, Roles.Owner), (2, Roles.Staff), (3, Roles.Tenant) })
        {
            var name = role.ToLowerInvariant() + ".mobile.test";
            var existing = await users.FindByNameAsync(name);
            if (existing is not null)
            {
                if (existing.Id != Id(n) || !existing.IsActive ||
                    !(await users.GetRolesAsync(existing)).SequenceEqual([role]) || !await users.CheckPasswordAsync(existing, password))
                    throw new LocalTestAccountException("Tài khoản fixture đã có nhưng không khớp; không đổi mật khẩu/quyền.");
                continue;
            }
            if (await db.Users.AnyAsync(u => u.Id == Id(n))) throw new LocalTestAccountException("Trùng ID tài khoản fixture.");
            var user = new ApplicationUser { Id = Id(n), UserName = name, Email = name + "@example.invalid", IsActive = true, LockoutEnabled = true };
            db.PrepareUserRole(user, role);
            var result = await users.CreateAsync(user, password);
            if (!result.Succeeded) throw new LocalTestAccountException("Không tạo được tài khoản fixture: " + string.Join(",", result.Errors.Select(e => e.Code)));
        }
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == Id(10));
        if (location is not null)
        {
            if (location.Name != "BHOME MOBILE TEST") throw new LocalTestAccountException("Trùng ID cơ sở fixture.");
            Console.WriteLine("MOBILE_TEST_ALREADY_READY: không reset tài khoản hoặc dữ liệu đã thao tác.");
            await tx.CommitAsync();
            return;
        }
        if (await db.Locations.AnyAsync(l => l.Name == "BHOME MOBILE TEST")) throw new LocalTestAccountException("Trùng tên cơ sở fixture.");
        if (!await db.Set<Chain>().AnyAsync())
        {
            db.Add(new Chain { Name = "BHOME" });
            await db.SaveChangesAsync();
        }
        void Add<T>(int n, T entity) where T : class
        { db.Entry(entity).Property("Id").CurrentValue = Id(n); db.Add(entity); }
        Add(10, new Location("BHOME MOBILE TEST") { ChainId = await db.Set<Chain>().Select(c => c.Id).SingleAsync(), Address = "Dữ liệu tổng hợp để test Mobile, không phải địa chỉ thật" });
        Add(11, new RoomType { LocationId = Id(10), Name = "Phòng test Mobile", DefaultCapacity = 2, AreaM2 = 25 });
        Add(12, new StaffLocationAssignment(Id(10), Id(2), Id(1), today.AddYears(-1), today.AddYears(1)));
        Add(20, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = "M101", Capacity = 2, Status = RoomStatus.Occupied });
        Add(21, new Room { LocationId = Id(10), RoomTypeId = Id(11), RoomNumber = "M102", Capacity = 2, Status = RoomStatus.Available });
        Add(30, new Resident { RoomId = Id(20), TenantUserId = Id(3), OwnerUserId = Id(1), DisplayLabel = "Khách thuê tổng hợp Mobile", ResidentType = ResidentType.Representative, VerificationStatus = IdentityVerificationStatus.Pending });
        var contract = new Contract
        {
            RoomId = Id(20), OwnerSignerId = Id(1), TenantUserId = Id(3), RepresentativeResidentId = Id(30),
            Kind = ContractKind.Main, Status = ContractStatus.Active, StartDate = today.AddMonths(-3), EndDate = today.AddMonths(9),
            MonthlyRent = 3000000, RequiredDeposit = 0, Terms = "SYNTHETIC UI FIXTURE: không phải hợp đồng/ký/giao dịch thật.",
            SnapshotHash = new string('0', 64), IsDevelopmentDemo = true, ActivatedByUserId = Id(1), ActivatedAt = now,
            Residents = [new ContractResident { ContractId = Id(40), ResidentId = Id(30), Role = ResidentType.Representative, ResidenceFrom = today.AddMonths(-3) }]
        };
        Add(40, contract);
        for (var utility = 0; utility < 2; utility++)
        {
            Add(50 + utility, new Meter { RoomId = Id(20), Code = "MOBILE-TEST-" + (utility == 0 ? "ELEC" : "WATER"), UtilityType = (UtilityType)utility, Display = MeterDisplay.Digital, InstalledOn = today.AddMonths(-4) });
            Add(60 + utility, new OperationalTask { Kind = OperationalTaskKind.MeterReading, LocationId = Id(10), MeterId = Id(50 + utility), AssignedStaffUserId = Id(2), AssignmentId = Id(12), AssignedAt = now, Title = "Ghi số " + (utility == 0 ? "điện" : "nước") + " M101 (test)", ReadingDate = today, Purpose = ReadingPurpose.Initial, Status = MeterTaskStatus.Assigned, DueAt = now.AddHours(6) });
        }
        for (var i = 0; i < 3; i++)
        {
            var task = new OperationalTask { Kind = OperationalTaskKind.AdHoc, LocationId = Id(10), Title = new[] { "Kiểm tra phòng M102 (test)", "Kiểm tra khu vực chung (test)", "Xác minh vệ sinh (test)" }[i], Requirements = "Dữ liệu tổng hợp. Có thể thao tác để test; không liên quan công việc thật.", AssignedStaffUserId = Id(2), AssignmentId = Id(12), AssignedAt = now, Status = i == 2 ? MeterTaskStatus.PendingVerification : MeterTaskStatus.Assigned, DueAt = i == 1 ? now.AddDays(-1) : now.AddHours(4), EvidenceRequired = false, Result = i == 2 ? "Kết quả mẫu chờ Owner xác minh" : null };
            Add(70 + i, task);
            Add(80 + i, new OperationalTaskHistory { TaskId = Id(70 + i), ActorId = Id(1), Action = "created", Note = "Synthetic mobile test fixture", ResponsibleStaffUserId = Id(2), OccurredAt = now, TaskVersion = 1 });
        }
        // Synthetic invoices exercise read/adjustment UI, not meter calculation or bank settlement.
        var invoices = new List<Invoice>();
        for (var i = 0; i < 3; i++)
        {
            var period = new DateOnly(today.Year, today.Month, 1).AddMonths(-i);
            var invoice = new Invoice { RoomId = Id(20), LocationId = Id(10), RoomNumber = "M101", LocationName = "BHOME MOBILE TEST", BillingPeriod = period, RepresentativeContractId = Id(40), RepresentativeTenantUserId = Id(3), Status = InvoiceStatus.Draft, Total = 3450000, CreatedByUserId = Id(1), ScheduledFinalDate = period, DueDate = i == 0 ? today.AddDays(7) : today.AddDays(-10 * i), ScheduleSnapshot = JsonSerializer.Serialize(new { syntheticFixture = true }), Recipients = [new InvoiceRecipient { InvoiceId = Id(100 + i), TenantUserId = Id(3) }] };
            invoice.Lines = [new InvoiceLine { InvoiceId = Id(100 + i), Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Tiền phòng mẫu (không thu tiền)", RateDate = period, Rate = 3000000, Quantity = 1, OccupiedDays = DateTime.DaysInMonth(period.Year, period.Month), PeriodDays = DateTime.DaysInMonth(period.Year, period.Month), Amount = 3000000 }, new InvoiceLine { InvoiceId = Id(100 + i), Category = ChargeCategory.Electricity, ChargeCode = "ELECTRICITY", Name = "Điện mẫu", RateDate = period, Rate = 3500, Quantity = 100, Amount = 350000, PreviousReading = 1000, ConfirmedReading = 1100 }, new InvoiceLine { InvoiceId = Id(100 + i), Category = ChargeCategory.Water, ChargeCode = "WATER", Name = "Nước mẫu", RateDate = period, Rate = 10000, Quantity = 10, Amount = 100000, PreviousReading = 100, ConfirmedReading = 110 }];
            Add(100 + i, invoice); invoices.Add(invoice);
        }
        foreach (var (n, category, code, rate) in new[] { (110, ChargeCategory.Rent, "RENT", 3000000m), (111, ChargeCategory.Electricity, "ELECTRICITY", 3500m), (112, ChargeCategory.Water, "WATER", 10000m) })
            Add(n, new BillingPolicy { LocationId = Id(10), Category = category, ChargeCode = code, Name = "Biểu phí tổng hợp " + code, Method = category == ChargeCategory.Rent ? ChargingMethod.FixedPerRoomPerMonth : ChargingMethod.Metered, Rate = rate, EffectiveFrom = today.AddYears(-1) });
        foreach (var (n, role, objectType, objectId) in new[] { (1, Roles.Owner, "OperationalTask", Id(72)), (2, Roles.Staff, "OperationalTask", Id(70)), (3, Roles.Tenant, "Invoice", Id(100)) })
            db.Add(new UserNotification { Id = Id(120 + n), RecipientUserId = Id(n), AudienceRole = role, LocationId = Id(10), Category = n == 3 ? "Invoice" : "Task", Title = "Dữ liệu test Mobile đã sẵn sàng", Summary = "Thông báo tổng hợp trong ứng dụng, không gửi push/email.", RelatedObjectType = objectType, RelatedObjectId = objectId, EventKey = "mobile-test-v1-" + n, CreatedAt = now, DeliveryState = "Unconfigured" });
        await db.SaveChangesAsync();
        // Preserve the DB requirement to insert Draft and its lines before finalizing.
        foreach (var invoice in invoices.Take(2)) { invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = Id(1); invoice.FinalizedAt = now; invoice.Version++; }
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        Console.WriteLine("MOBILE_TEST_CREATED: 3 accounts, 1 location, 2 rooms, 1 synthetic active contract, 2 meters/tasks, 3 operational tasks, 3 invoices (2 Final unpaid + 1 Draft), 3 inbox notifications. No real bank account, transfer, signature or identity evidence seeded.");
    }
}
