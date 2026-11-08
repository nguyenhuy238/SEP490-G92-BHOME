using System.Globalization;
using System.Text.RegularExpressions;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF08;

// Bộ dữ liệu và phụ thuộc giả dùng chung cho sheet "BF-08 Finance Reporting".
// Chỉ dựng dữ liệu theo Điều kiện (Pre-conditions) của sheet; không chứa logic nghiệp vụ của hệ thống.
internal static class Bf08
{
    public static readonly Guid Owner1 = Guid.Parse("00000000-0000-0000-0000-0000000008a1");
    public static readonly Guid Staff1 = Guid.Parse("00000000-0000-0000-0000-0000000008b1");
    public static readonly Guid L1 = Guid.Parse("00000000-0000-0000-0000-0000000008c1");
    public static readonly Guid Room1 = Guid.Parse("00000000-0000-0000-0000-0000000008d1");
    public static readonly Guid Asset1 = Guid.Parse("00000000-0000-0000-0000-0000000008e1");
    public static readonly DateTimeOffset Now = new(2026, 11, 7, 9, 0, 0, TimeSpan.FromHours(7));

    // Tháng báo cáo 2026-11 (reportingPeriod=Month 2026-11).
    public static ReportFilter Month202611(Guid? location = null) => new(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30), location);

    public static ICurrentUser User(Guid id, string role)
    {
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(id);
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
        return user;
    }

    public static ICurrentUser OwnerUser() => User(Owner1, Roles.Owner);
    public static ICurrentUser StaffUser() => User(Staff1, Roles.Staff);

    public static TimeProvider Clock()
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(Now);
        clock.LocalTimeZone.Returns(TimeZoneInfo.Utc);
        return clock;
    }

    // Id của thực thể không gán trực tiếp được (setter không public) nên gán qua reflection khi dựng dữ liệu test.
    public static T SetId<T>(T entity, Guid id) where T : BHome.Domain.Common.AuditableEntity
    {
        typeof(BHome.Domain.Common.AuditableEntity).GetProperty(nameof(BHome.Domain.Common.AuditableEntity.Id))!.SetValue(entity, id);
        return entity;
    }

    // Số tiền hiển thị là chuỗi; chỉ đổi về số để so sánh giá trị (không phụ thuộc định dạng hiển thị).
    public static decimal Money(string? text)
    {
        Assert.False(string.IsNullOrWhiteSpace(text), "Giá trị tiền đang trống");
        var digits = Regex.Replace(text!, @"[^0-9\-\.]", "");
        return decimal.Parse(digits, NumberStyles.Number, CultureInfo.InvariantCulture);
    }
}

// Kho dữ liệu sự cố trong bộ nhớ: thực thi đúng các chữ ký của IIncidentRepository, ghi lại mọi thực thể được thêm.
internal sealed class InMemoryIncidentRepository : IIncidentRepository
{
    public Dictionary<Guid, IncidentReport> Incidents { get; } = [];
    public Dictionary<Guid, MaintenanceWorkOrder> WorkOrderStore { get; } = [];
    public Dictionary<Guid, Asset> Assets { get; } = [];
    public List<IncidentEvidence> Evidence { get; } = [];
    public List<object> Added { get; } = [];
    public Guid OwnerId { get; init; }

    public IEnumerable<MaintenanceExpense> MaintenanceExpenses =>
        Added.OfType<MaintenanceExpense>();

    public Task<T> TransactionAsync<T>(Guid locationId, Guid? roomId, Guid actorId, Guid key, Func<Task<T>> work, CancellationToken t) => work();
    public Task<bool> ActiveRoleAsync(Guid actor, string role, CancellationToken t) => Task.FromResult(actor == OwnerId && role == Roles.Owner);
    public Task<bool> ActiveLocationAsync(Guid id, CancellationToken t) => Task.FromResult(true);
    public Task<bool> StaffAssignedAsync(Guid actor, Guid location, DateOnly today, CancellationToken t) => Task.FromResult(false);
    public Task<bool> StaffAvailableAsync(Guid location, DateOnly today, CancellationToken t) => Task.FromResult(true);
    public Task<IReadOnlyList<Guid>> RecipientsAsync(Guid location, DateOnly today, bool includeStaff, CancellationToken t) => Task.FromResult<IReadOnlyList<Guid>>([OwnerId]);
    public Task<IncidentRoom?> RoomAsync(Guid id, CancellationToken t) => Task.FromResult<IncidentRoom?>(new IncidentRoom(id, Bf08.L1));
    public Task<IncidentTenancy?> TenancyAsync(Guid actor, Guid location, Guid? room, DateOnly date, CancellationToken t) => Task.FromResult<IncidentTenancy?>(null);
    public Task<Guid?> ContractRoomAsync(Guid contract, CancellationToken t) => Task.FromResult<Guid?>(null);
    public Task<Asset?> AssetAsync(Guid id, CancellationToken t) => Task.FromResult(Assets.GetValueOrDefault(id));
    public Task<IncidentReport?> IncidentAsync(Guid id, CancellationToken t) => Task.FromResult(Incidents.GetValueOrDefault(id));
    public Task<MaintenanceWorkOrder?> WorkOrderAsync(Guid id, CancellationToken t) => Task.FromResult(WorkOrderStore.GetValueOrDefault(id));
    public Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<MaintenanceWorkOrder>>(WorkOrderStore.Values.Where(w => w.IncidentId == incident).ToList());
    public Task<bool> OtherAssetWorkAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) => Task.FromResult(false);
    public Task<bool> OtherAssetExecutionAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) => Task.FromResult(false);
    public Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t) => Task.FromResult<IncidentCommand?>(null);
    public Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<IncidentEvidence>>(Evidence.Where(e => e.IncidentId == incident).ToList());
    public Task<IReadOnlyList<EmergencyAction>> EmergencyActionsAsync(Guid incident, CancellationToken t) => Task.FromResult<IReadOnlyList<EmergencyAction>>([]);
    public Task<IncidentPage<IncidentView>> ListAsync(IncidentScope scope, IncidentQuery query, CancellationToken t) => Task.FromResult(new IncidentPage<IncidentView>([], 1, 20, 0));
    public Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t) => Task.FromResult(new IncidentPage<IncidentReportingRoom>([], 1, 20, 0));
    public Task<IncidentPage<IncidentReportingAsset>> ReportingAssetsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t) => Task.FromResult(new IncidentPage<IncidentReportingAsset>([], 1, 20, 0));
    public Task<IncidentPage<WorkOrderView>> ListWorkOrdersAsync(IncidentScope scope, IncidentQuery query, DateTimeOffset now, CancellationToken t) => Task.FromResult(new IncidentPage<WorkOrderView>([], 1, 20, 0));
    public Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid incident, IncidentScope scope, int page, int size, CancellationToken t) => Task.FromResult(new IncidentPage<IncidentActivityView>([], 1, 20, 0));
    public Task<IncidentPage<MaintenanceHistoryView>> MaintenanceAsync(IncidentScope scope, IncidentQuery query, CancellationToken t) => Task.FromResult(new IncidentPage<MaintenanceHistoryView>([], 1, 20, 0));
    public Task<IReadOnlyList<BHome.Application.IncidentMaintenance.ExpenseView>> ExpensesAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<BHome.Application.IncidentMaintenance.ExpenseView>>(MaintenanceExpenses.Where(e => e.IncidentId == incident)
            .Select(e => new BHome.Application.IncidentMaintenance.ExpenseView(e.Id, e.IncidentId, e.WorkOrderId, e.EmergencyActionId, e.Category, e.Amount, e.ExpenseDate)).ToList());
    public Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(IncidentScope scope, int page, int size, CancellationToken t) => Task.FromResult(new IncidentPage<IncidentNotificationView>([], 1, 20, 0));
    public Task<IncidentNotification?> NotificationAsync(Guid id, Guid actor, CancellationToken t) => Task.FromResult<IncidentNotification?>(null);
    public Task FlushAsync(CancellationToken t) => Task.CompletedTask;
    public void Add(object entity) => Added.Add(entity);
    public void Audit(Guid actor, string action, Guid activityId, DateTimeOffset now) { }
}
