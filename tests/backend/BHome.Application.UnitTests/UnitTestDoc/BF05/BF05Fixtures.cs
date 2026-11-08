using System.Linq.Expressions;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF05;

// Dữ liệu và bản giả dùng chung cho sheet "BF-05 Meter Invoice".
// Chỉ dựng dữ liệu theo Điều kiện của sheet; các hàm được gọi lấy từ danh mục chữ ký (không đọc thân hàm).
internal static class Bf05Data
{
    public static readonly DateOnly Period = new(2026, 11, 1);
    public static readonly Guid OwnerId = Guid.Parse("00000000-0000-0000-0000-000000000101");
    public static readonly Guid StaffId = Guid.Parse("00000000-0000-0000-0000-000000000102");
    public static readonly Guid TenantId = Guid.Parse("00000000-0000-0000-0000-000000000103");
    public static readonly Guid LocationId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");

    public const string Rent = "RENT";
    public const string Elec = "ELEC";
    public const string Water = "WATER";
    public const string Internet = "INTERNET";
    public const string Cleaning = "CLEANING";

    // Giờ Việt Nam 10:00 của ngày chạy (03:00 UTC) để ngày nghiệp vụ không bị lệch.
    public static DateTimeOffset At(int year, int month, int day) => new(year, month, day, 3, 0, 0, TimeSpan.Zero);

    // L1: Draft Invoice date=25, Finalization date=28, Due Date ngày 05 tháng sau (= 2026-12-05 cho kỳ 2026-11).
    public static BillingSchedule Schedule() => Bf05Ids.New(new BillingSchedule
    {
        LocationId = LocationId,
        RateDate = BillingRateDate.PeriodStart,
        RentSource = BillingRentSource.RoomPolicy,
        PartialMonth = PartialMonthRule.FullMonth,
        Rounding = VndRounding.AwayFromZero,
        DraftDay = 25,
        DraftMonthOffset = 0,
        FinalDay = 28,
        FinalMonthOffset = 0,
        DueDay = 5,
        DueMonthOffset = 1,
        Version = 1
    });

    // Chính sách giá cấu hình (UTC15): rent 3,500,000; ELEC 3,500/kWh; WATER 18,000/m3; internet 100,000; cleaning 100,000.
    public static List<BillingPolicy> Policies(Guid roomId) =>
    [
        Policy(ChargeCategory.Rent, Rent, "Rent", ChargingMethod.FixedPerRoomPerMonth, 3_500_000m),
        Policy(ChargeCategory.Electricity, Elec, "Electricity", ChargingMethod.Metered, 3_500m),
        Policy(ChargeCategory.Water, Water, "Water", ChargingMethod.Metered, 18_000m),
        Policy(ChargeCategory.ServiceFee, Internet, "Internet", ChargingMethod.FixedPerRoomPerMonth, 100_000m),
        Policy(ChargeCategory.ServiceFee, Cleaning, "Cleaning", ChargingMethod.FixedPerRoomPerMonth, 100_000m)
    ];

    private static BillingPolicy Policy(ChargeCategory category, string code, string name, ChargingMethod method, decimal rate) => Bf05Ids.New(new BillingPolicy
    {
        LocationId = LocationId,
        Category = category,
        ChargeCode = code,
        Name = name,
        Method = method,
        Rate = rate,
        EffectiveFrom = new DateOnly(2026, 1, 1),
        Version = 1
    });

    public static MeterReading Reading(decimal previous, decimal confirmed) => Bf05Ids.New(new MeterReading
    {
        TaskId = Guid.NewGuid(),
        MeterId = Guid.NewGuid(),
        EvidenceId = Guid.NewGuid(),
        PreviousValue = previous,
        ConfirmedValue = confirmed,
        Consumption = confirmed - previous,
        Status = MeterReadingStatus.Confirmed,
        ConfirmedByUserId = StaffId,
        ConfirmedAt = At(2026, 11, 24)
    });
}

// Một phòng đang có hợp đồng Active cả tháng 2026-11, kèm chỉ số đã được Staff xác nhận.
internal sealed class Bf05Room
{
    public Room Room { get; }
    public Contract Contract { get; }
    public Dictionary<UtilityType, MeterReading?> Readings { get; } = new();
    public List<BillingPolicy> Policies { get; private set; } = [];

    public Bf05Room(string number)
    {
        var location = Bf05Ids.Set(new Location("L1") { IsActive = true }, Bf05Data.LocationId);
        Room = Bf05Ids.New(new Room { LocationId = location.Id, Location = location, RoomNumber = number, Capacity = 2, Status = RoomStatus.Occupied, Version = 1 });
        Contract = Bf05Ids.New(new Contract
        {
            RoomId = Room.Id,
            Room = Room,
            OwnerSignerId = Bf05Data.OwnerId,
            TenantUserId = Bf05Data.TenantId,
            Status = ContractStatus.Active,
            StartDate = new DateOnly(2026, 11, 1),
            EndDate = new DateOnly(2027, 10, 31),
            MonthlyRent = 3_500_000m
        });
        Policies = Bf05Data.Policies(Room.Id); // chính sách giá cố định (cùng Id) cho mọi lần tính
    }
}

// Bản giả IInvoiceRepository lưu dữ liệu trong bộ nhớ.
internal sealed class FakeInvoiceRepository : IInvoiceRepository
{
    public BillingSchedule Schedule { get; set; } = Bf05Data.Schedule();
    public Dictionary<Guid, Bf05Room> Rooms { get; } = new();
    public List<object> Added { get; } = [];
    public List<Invoice> Invoices => Added.OfType<Invoice>().ToList();

    public void AddRoom(Bf05Room room) => Rooms[room.Room.Id] = room;

    public Task<BillingSchedule?> ScheduleAsync(Guid locationId, CancellationToken t) => Task.FromResult<BillingSchedule?>(Schedule);
    public Task<T> WithRoomLockAsync<T>(Guid roomId, Func<Task<T>> action, CancellationToken t) => action();
    public Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> action, CancellationToken t) => action();
    public Task<Room?> RoomAsync(Guid roomId, CancellationToken t) => Task.FromResult<Room?>(Rooms[roomId].Room);
    public Task<Invoice?> FindAsync(Guid id, InvoiceScope scope, CancellationToken t) => Task.FromResult<Invoice?>(Invoices.Single(i => i.Id == id));
    public Task<Invoice?> ForPeriodAsync(Guid roomId, DateOnly period, CancellationToken t) =>
        Task.FromResult(Invoices.FirstOrDefault(i => i.RoomId == roomId && i.BillingPeriod == period));
    public Task<PagedResult<Invoice>> ListAsync(InvoiceScope scope, int page, int pageSize, Guid? roomId, CancellationToken t) =>
        throw new NotSupportedException("Không dùng trong sheet BF-05.");
    public Task<IReadOnlyList<BillingOccupancy>> OccupanciesAsync(Guid roomId, DateOnly from, DateOnly to, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<BillingOccupancy>>([new BillingOccupancy(Rooms[roomId].Contract, [Bf05Data.TenantId])]);
    public Task<BillingReading?> ReadingAsync(Guid roomId, UtilityType type, DateOnly period, CancellationToken t) =>
        Task.FromResult(Rooms[roomId].Readings.TryGetValue(type, out var r) && r is not null ? new BillingReading(r, new DateOnly(2026, 11, 24)) : null);
    public Task RecordPolicyUsageAsync(Guid[] ids, DateTimeOffset at, CancellationToken t) => Task.CompletedTask;
    public Task<IReadOnlyList<InvoiceAdjustmentDecision>> DraftCorrectionsAsync(Guid invoiceId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<InvoiceAdjustmentDecision>>([]);
    public Task<bool> HasPendingAdjustmentsAsync(Guid invoiceId, CancellationToken t) => Task.FromResult(false);
    public void Add(object entity) => Added.Add(entity);
    public void Audit(Guid actor, string action, Guid invoiceId, DateTimeOffset at) { }
    public void RemoveLines(Invoice invoice) => invoice.Lines.Clear();
}

// Bản giả IPropertyRepository: chỉ trả về phòng, cơ sở và chính sách giá đã cấu hình.
internal sealed class FakePropertyRepository(FakeInvoiceRepository invoices) : IPropertyRepository
{
    private IEnumerable<object> Entities() => invoices.Rooms.Values.SelectMany(r => new object[] { r.Room, r.Room.Location });

    public Task<T?> FindAsync<T>(Guid id, CancellationToken token) where T : BHome.Domain.Common.AuditableEntity =>
        Task.FromResult(Entities().OfType<T>().FirstOrDefault(e => e.Id == id));
    public Task<bool> AnyAsync<T>(Expression<Func<T, bool>> predicate, CancellationToken token) where T : class =>
        Task.FromResult(Entities().OfType<T>().Any(predicate.Compile()));
    public Task<PagedResult<TDto>> ListAsync<T, TDto>(Expression<Func<T, bool>> predicate, Expression<Func<T, TDto>> projection,
        PropertyQuery query, Guid? staffId, DateOnly today, CancellationToken token) where T : BHome.Domain.Common.AuditableEntity =>
        throw new NotSupportedException("Không dùng trong sheet BF-05.");
    public Task<IReadOnlyList<BillingPolicy>> ApplicablePoliciesAsync(Room room, DateOnly date, CancellationToken token) =>
        Task.FromResult<IReadOnlyList<BillingPolicy>>(invoices.Rooms[room.Id].Policies);
    public Task<Guid?> LegacySystemChainIdAsync(CancellationToken token) => Task.FromResult<Guid?>(null);
    public Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> operation, CancellationToken token) => operation();
    public Task<bool> HasResidentsAsync(Guid roomId, CancellationToken token) => Task.FromResult(true);
    public Task<RoomObligations> ObligationsAsync(Guid locationId, Guid? roomId, DateOnly today, CancellationToken token) => Task.FromResult(default(RoomObligations)!);
    public void Add<T>(T entity) where T : class { }
    public void Audit(PropertyChange change) { }
}

// AuditableEntity.Id không có setter public: gán Id cố định cho dữ liệu test bằng reflection.
internal static class Bf05Ids
{
    public static T New<T>(T entity) where T : BHome.Domain.Common.AuditableEntity => Set(entity, Guid.NewGuid());
    public static T Set<T>(T entity, Guid id) where T : BHome.Domain.Common.AuditableEntity
    {
        typeof(BHome.Domain.Common.AuditableEntity).GetProperty(nameof(BHome.Domain.Common.AuditableEntity.Id))!.SetValue(entity, id);
        return entity;
    }
}

internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
}

internal static class Bf05Users
{
    public static ICurrentUser As(Guid id, string role)
    {
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(id);
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
        return user;
    }

    public static PermissionAccess Permissions(ICurrentUser user, bool staffAssigned = true)
    {
        var staff = Substitute.For<IStaffLocationAccess>();
        staff.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(staffAssigned);
        return new PermissionAccess(user, new ResourceAccess(user, staff));
    }
}

// Dựng InvoiceService với Owner đăng nhập và đồng hồ cố định.
internal sealed class Bf05Billing
{
    public FakeInvoiceRepository Repository { get; } = new();
    public FixedClock Clock { get; } = new(Bf05Data.At(2026, 11, 25));

    // Lịch tự động hóa đơn của L1 (JOB-10): Owner đã cấu hình và cho phép tự động chốt hóa đơn.
    public BillingAutomationPlan Plan { get; } = new()
    {
        Id = Guid.NewGuid(),
        LocationId = Bf05Data.LocationId,
        Version = 1,
        EffectiveFrom = new DateOnly(2026, 1, 1),
        Enabled = true,
        AuthorizeAutomaticFinalization = true,
        MeterDay = 24,
        MeterDueDay = 24,
        MeterDueMonthOffset = 0,
        TimeZone = "Asia/Ho_Chi_Minh",
        BillingScheduleVersion = 1,
        AuthorizedByUserId = Bf05Data.OwnerId,
        RecordedAt = Bf05Data.At(2026, 1, 1)
    };

    // Lịch tự động lưu kèm ảnh chụp lịch hóa đơn của L1 (ngày 25 / 28 / hạn ngày 05 tháng sau).
    public Bf05Billing() => Plan.BillingSnapshot = System.Text.Json.JsonSerializer.Serialize(Repository.Schedule);

    public InvoiceService Service()
    {
        var owner = Bf05Users.As(Bf05Data.OwnerId, Roles.Owner);
        var properties = new PropertyService(new FakePropertyRepository(Repository), owner, Bf05Users.Permissions(owner), Clock);
        var automation = Substitute.For<IBillingAutomationSchedules>();
        automation.ForPeriodAsync(Bf05Data.LocationId, Arg.Any<DateOnly>(), Arg.Any<CancellationToken>()).Returns(Plan);
        automation.AuthorizedAsync(Arg.Any<BillingAutomationPlan>(), Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<bool>(), Arg.Any<CancellationToken>()).Returns(true);
        return new InvoiceService(Repository, properties, owner, Clock, automation);
    }

    // Phòng có hợp đồng Active, chỉ số ELEC 132 kWh và WATER 6 m3 đã xác nhận (trừ khi bị ghi đè).
    public Bf05Room Room(string number, decimal elecUsage = 132m, decimal waterUsage = 6m)
    {
        var room = new Bf05Room(number);
        room.Readings[UtilityType.Electricity] = Bf05Data.Reading(1_250m, 1_250m + elecUsage);
        room.Readings[UtilityType.Water] = Bf05Data.Reading(100m, 100m + waterUsage);
        Repository.AddRoom(room);
        return room;
    }

    public Task<InvoiceView> Generate(Bf05Room room) =>
        Service().GenerateAsync(new DraftInvoiceInput(room.Room.Id, Bf05Data.Period, room.Contract.Id), default, Plan.Id);

    // Mô phỏng một lượt xử lý chốt hóa đơn của JOB-10 (tự động, theo lịch Owner đã cho phép):
    // làm mới bản Draft từ dữ liệu đã xác nhận mới nhất rồi chốt. Hàm chốt trả 409 draft_refresh_and_review_required
    // nếu Draft chưa được làm mới sau khi dữ liệu thay đổi, nên bước làm mới là một phần của lượt xử lý.
    // Nếu bị từ chối thì báo rõ mã lỗi để người test đọc được lý do.
    public async Task<InvoiceView> Finalize(Guid id, int version)
    {
        try { return await FinalizationRun(id, version); }
        catch (InvoiceException ex) { Assert.Fail($"Chốt hóa đơn bị từ chối: InvoiceException status={ex.Status}, code={ex.Code}"); throw; }
    }

    // Thử chốt hóa đơn còn thiếu dữ liệu: trả về null nếu bị từ chối bằng lỗi nghiệp vụ.
    public async Task<InvoiceView?> TryFinalize(Guid id, int version)
    {
        try { return await FinalizationRun(id, version); }
        catch (InvoiceException) { return null; }
    }

    private async Task<InvoiceView> FinalizationRun(Guid id, int version)
    {
        var refreshed = await Service().RefreshAsync(id, version, default, Plan.Id);
        return await Service().FinalizeAsync(refreshed.Id, refreshed.Version, default, Plan.Id);
    }

    public static InvoiceLineView Line(InvoiceView view, string code) => Assert.Single(view.Lines, l => l.ChargeCode == code);

    public static bool MissingContains(IEnumerable<string> missing, string keyword) =>
        missing.Any(m => m.Contains(keyword, StringComparison.OrdinalIgnoreCase));
}
