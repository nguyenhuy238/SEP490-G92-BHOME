using System.Linq.Expressions;
using System.Reflection;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Common;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF01;

// Kho dữ liệu giả trong bộ nhớ cho IPropertyRepository (chỉ dựng theo chữ ký interface, không theo code thật).
// - Add: lưu entity, gán Id nếu entity chưa có (mô phỏng DB sinh khóa).
// - AnyAsync / FindAsync / ListAsync: chạy trên danh sách trong bộ nhớ.
// - ApplicablePoliciesAsync: theo đúng tên hợp đồng "policy áp dụng cho phòng tại ngày" -> lọc theo Location/Room và
//   khoảng hiệu lực chứa ngày. Việc chọn version theo ngày ở hệ thống thật nằm ở repository (tầng DB),
//   nên unit test của resolveBillingPolicy KHÔNG kiểm chứng được logic chọn version thật.
internal sealed class InMemoryPropertyRepository : IPropertyRepository
{
    public List<object> Items { get; } = [];
    public List<PropertyChange> Changes { get; } = [];
    public Guid? ChainId { get; set; }
    public HashSet<Guid> RoomsWithResidents { get; } = [];
    public Dictionary<Guid, RoomObligations> RoomObligationsByRoom { get; } = [];
    public Dictionary<Guid, RoomObligations> LocationObligations { get; } = [];

    public IEnumerable<T> All<T>() => Items.OfType<T>();

    public T Seed<T>(T entity) where T : class
    {
        Add(entity);
        return entity;
    }

    public Task<T?> FindAsync<T>(Guid id, CancellationToken token) where T : AuditableEntity =>
        Task.FromResult(Items.OfType<T>().FirstOrDefault(x => x.Id == id));

    public Task<bool> AnyAsync<T>(Expression<Func<T, bool>> predicate, CancellationToken token) where T : class =>
        Task.FromResult(Items.OfType<T>().AsQueryable().Any(predicate));

    public Task<PagedResult<TDto>> ListAsync<T, TDto>(Expression<Func<T, bool>> predicate, Expression<Func<T, TDto>> projection,
        PropertyQuery query, Guid? staffId, DateOnly today, CancellationToken token) where T : AuditableEntity
    {
        var rows = Items.OfType<T>().AsQueryable().Where(predicate).Select(projection).ToList();
        return Task.FromResult(new PagedResult<TDto>(rows, 1, Math.Max(rows.Count, 1), rows.Count));
    }

    public Task<IReadOnlyList<BillingPolicy>> ApplicablePoliciesAsync(Room room, DateOnly date, CancellationToken token)
    {
        IReadOnlyList<BillingPolicy> rows = Items.OfType<BillingPolicy>()
            .Where(p => p.LocationId == room.LocationId && (p.RoomId is null || p.RoomId == room.Id)
                && (p.RoomTypeId is null || p.RoomTypeId == room.RoomTypeId)
                && p.EffectiveFrom <= date && (p.EffectiveTo is null || p.EffectiveTo >= date))
            .ToList();
        return Task.FromResult(rows);
    }

    public Task<Guid?> LegacySystemChainIdAsync(CancellationToken token) => Task.FromResult(ChainId);

    public Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> operation, CancellationToken token) => operation();

    public Task<bool> HasResidentsAsync(Guid roomId, CancellationToken token) => Task.FromResult(RoomsWithResidents.Contains(roomId));

    public Task<RoomObligations> ObligationsAsync(Guid locationId, Guid? roomId, DateOnly today, CancellationToken token)
    {
        if (roomId is { } r && RoomObligationsByRoom.TryGetValue(r, out var roomValue)) return Task.FromResult(roomValue);
        if (roomId is null && LocationObligations.TryGetValue(locationId, out var locationValue)) return Task.FromResult(locationValue);
        return Task.FromResult(new RoomObligations(false, false, false, false));
    }

    public void Add<T>(T entity) where T : class
    {
        if (entity is AuditableEntity e && e.Id == Guid.Empty) Ids.Set(e, Guid.NewGuid());
        if (!Items.Contains(entity)) Items.Add(entity);
    }

    public void Audit(PropertyChange change) => Changes.Add(change);
}

internal static class Ids
{
    private static readonly PropertyInfo IdProperty = typeof(AuditableEntity).GetProperty(nameof(AuditableEntity.Id))!;

    public static T With<T>(this T entity, Guid id) where T : AuditableEntity
    {
        Set(entity, id);
        return entity;
    }

    public static void Set(AuditableEntity entity, Guid id) => IdProperty.SetValue(entity, id);
}

// Người dùng đăng nhập + phân công Location của Staff, giả lập bằng NSubstitute.
internal sealed class Actor
{
    public ICurrentUser User { get; } = Substitute.For<ICurrentUser>();
    public IStaffLocationAccess StaffLocations { get; } = Substitute.For<IStaffLocationAccess>();

    public static Actor Owner() => new Actor().As(Guid.NewGuid(), Roles.Owner);

    public static Actor Staff(params Guid[] assignedLocations)
    {
        var actor = new Actor().As(Guid.NewGuid(), Roles.Staff);
        actor.StaffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call => assignedLocations.Contains(call.ArgAt<Guid>(1)));
        return actor;
    }

    private Actor As(Guid id, string role)
    {
        User.UserId.Returns(id);
        User.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
        return this;
    }
}

internal static class ChargeCodes
{
    // Sheet không quy định mã phí; chọn một mã hợp lệ cho loại phí/cách tính (chỉ là dữ liệu chuẩn bị).
    public static string For(ChargeCategory category, ChargingMethod method)
    {
        string[] candidates = category switch
        {
            ChargeCategory.Electricity => ["ELECTRICITY", "ELEC", "DIEN", "electricity"],
            ChargeCategory.Water => ["WATER", "NUOC", "water"],
            ChargeCategory.Rent => ["RENT", "rent"],
            _ => ["SERVICE_FEE", "SERVICE", "SVC", "service_fee", "service"]
        };
        return candidates.FirstOrDefault(c => PropertyRules.ValidCharge(category, method, c)) ?? candidates[0];
    }
}
