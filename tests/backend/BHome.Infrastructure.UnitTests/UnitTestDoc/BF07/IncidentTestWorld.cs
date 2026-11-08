using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Jobs;
using BHome.Application.Storage;
using BHome.Domain.Common;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Modules.IncidentMaintenance;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.UnitTestDoc.BF07;

// Bộ dữ liệu giả dùng chung cho sheet "BF-07 Incident".
// Chỉ dựng ĐIỀU KIỆN TIỀN ĐỀ theo sheet (ai là Owner/Staff/Tenant, Staff được giao Location nào, Tenant thuê phòng nào,
// Asset nào). Kho dữ liệu là bản trong bộ nhớ theo chữ ký IIncidentRepository; nó KHÔNG chứa luật nghiệp vụ nào.
// Các trạng thái trung gian (Work Order Assigned / Pending Approval / ...) được tạo bằng chính các thao tác của hệ thống.
internal sealed class IncidentTestWorld
{
    public readonly Guid Owner = Guid.Parse("00000000-0000-0000-0000-000000000101");
    public readonly Guid StaffS1 = Guid.Parse("00000000-0000-0000-0000-000000000201");
    public readonly Guid StaffS2 = Guid.Parse("00000000-0000-0000-0000-000000000202");
    public readonly Guid Tenant = Guid.Parse("00000000-0000-0000-0000-000000000301");
    public readonly Guid OtherTenant = Guid.Parse("00000000-0000-0000-0000-000000000302");
    public readonly Guid TenantWithoutTenancy = Guid.Parse("00000000-0000-0000-0000-000000000303");
    public readonly Guid LocationX = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    public readonly Guid LocationY = Guid.Parse("00000000-0000-0000-0000-0000000000a2");
    public readonly Guid RoomA = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
    public readonly Guid RoomB = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
    public readonly Guid RoomC = Guid.Parse("00000000-0000-0000-0000-0000000000b3");
    public readonly Guid ContractA = Guid.Parse("00000000-0000-0000-0000-0000000000c1");
    public readonly Guid ContractC = Guid.Parse("00000000-0000-0000-0000-0000000000c3");

    public readonly FixedClock Clock = new(new DateTimeOffset(2026, 11, 7, 9, 0, 0, TimeSpan.FromHours(7)));
    public readonly InMemoryIncidentRepository Repository;
    public readonly FakeIncidentFiles Files = new();
    public readonly IBackgroundJobQueue Jobs = Substitute.For<IBackgroundJobQueue>();
    private readonly Dictionary<Guid, string> roles = new();

    public IncidentTestWorld()
    {
        Repository = new InMemoryIncidentRepository(Clock, Owner);
        roles[Owner] = Roles.Owner;
        roles[StaffS1] = Roles.Staff;
        roles[StaffS2] = Roles.Staff;
        roles[Tenant] = Roles.Tenant;
        roles[OtherTenant] = Roles.Tenant;
        roles[TenantWithoutTenancy] = Roles.Tenant;
        Repository.Roles = roles;
        Repository.Locations.UnionWith([LocationX, LocationY]);
        Repository.Rooms[RoomA] = new IncidentRoom(RoomA, LocationX);
        Repository.Rooms[RoomB] = new IncidentRoom(RoomB, LocationX);
        Repository.Rooms[RoomC] = new IncidentRoom(RoomC, LocationX);
        // Tenant thuê Room A; Tenant khác thuê Room C (cùng Location X).
        Repository.Tenancies.Add((Tenant, ContractA, RoomA, LocationX));
        Repository.Tenancies.Add((OtherTenant, ContractC, RoomC, LocationX));
        // Staff S1 đang được giao Location X (S2 chỉ được giao khi test cần).
        AssignStaff(StaffS1, LocationX);
    }

    public void AssignStaff(Guid staff, Guid location) => Repository.Assignments.Add((staff, location));

    public Asset AddAsset(Guid? roomId, AssetStatus status = AssetStatus.Active)
    {
        var asset = new Asset { LocationId = LocationX, RoomId = roomId, Name = "Vòi nước bồn rửa", Category = "Cấp thoát nước", Condition = "Tốt", Status = status };
        Repository.Assets[asset.Id] = asset;
        return asset;
    }

    public IncidentService As(Guid actor)
    {
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(actor);
        user.IsInRole(Arg.Any<string>()).Returns(call => roles.TryGetValue(actor, out var role) && role == call.Arg<string>());
        var staffLocations = Substitute.For<IStaffLocationAccess>();
        staffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call => Repository.Assignments.Contains((call.ArgAt<Guid>(0), call.ArgAt<Guid>(1))));
        var permissions = new PermissionAccess(user, new ResourceAccess(user, staffLocations));
        return new IncidentService(Repository, user, permissions, Files, Jobs, Clock);
    }

    // ---------- Ảnh dùng làm bằng chứng (ảnh PNG tổng hợp) ----------
    // Ảnh PNG 1x1 hợp lệ, thêm byte 0 phía sau cho đủ dung lượng cần thử.
    private static readonly byte[] TinyPng = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    public static byte[] Png(int size = 1024)
    {
        var bytes = new byte[Math.Max(size, TinyPng.Length)];
        TinyPng.CopyTo(bytes, 0);
        return bytes;
    }

    public const int FiveMegabytes = 5 * 1024 * 1024;

    // ---------- Các bước nghiệp vụ dùng để đưa dữ liệu tới điều kiện tiền đề ----------
    public async Task<Guid> SubmitAsync(Guid actor, IncidentSeverity severity, string description, Guid? roomId = null,
        Guid? locationId = null, Guid? assetId = null, int photos = 1)
    {
        var images = Enumerable.Range(0, photos).Select(_ => new IncidentImage(Png())).ToArray();
        var result = await As(actor).SubmitAsync(new IncidentSubmit(locationId ?? LocationX, roomId ?? RoomA, null, assetId, severity, description),
            images, Guid.NewGuid(), default);
        return result.IncidentId;
    }

    public IncidentReport Report(Guid id) => Repository.Reports.Single(r => r.Id == id);
    public MaintenanceWorkOrder WorkOrder(Guid id) => Repository.WorkOrders.Single(w => w.Id == id);

    public async Task<Guid> UploadAsync(Guid actor, Guid incidentId, Guid? workOrderId, IncidentEvidenceKind kind)
    {
        using var stream = new MemoryStream(Png());
        var result = await As(actor).UploadAsync(incidentId, workOrderId, kind, Guid.NewGuid(), stream, default);
        return result.ResourceId ?? throw new InvalidOperationException("Upload không trả về mã bằng chứng (ResourceId).");
    }

    // Owner phân loại báo cáo (loại/nhóm) - bước hệ thống yêu cầu trước khi tạo Work Order.
    public Task ClassifyAsync(Guid incidentId, string type = "Sửa chữa", string category = "Cấp thoát nước") =>
        As(Owner).ReviewAsync(incidentId, new IncidentReview(Report(incidentId).Version, type, category), Guid.NewGuid(), default);

    public async Task<Guid> AssignAsync(Guid incidentId, Guid staff, string expected = "Không còn rỉ")
    {
        if (Report(incidentId).Category is null) await ClassifyAsync(incidentId);
        var result = await As(Owner).AssignAsync(incidentId, new WorkOrderAssign(Report(incidentId).Version, staff, expected,
            Clock.GetUtcNow().AddDays(1).Date.AddHours(17)), Guid.NewGuid(), default);
        return result.WorkOrderId ?? throw new InvalidOperationException("Tạo Work Order không trả về WorkOrderId.");
    }

    public async Task ProposeAsync(Guid workOrderId, Guid staff, decimal? estimatedCost, string solution = "Thay gioăng")
    {
        var wo = WorkOrder(workOrderId);
        var evidence = await UploadAsync(staff, wo.IncidentId, workOrderId, IncidentEvidenceKind.Inspection);
        await As(staff).ProposeAsync(workOrderId, new RepairProposal(WorkOrder(workOrderId).Version, "Gioăng hỏng", solution, 60, estimatedCost, [evidence]),
            Guid.NewGuid(), default);
    }

    public Task DecidePlanAsync(Guid workOrderId, bool approve, string? reason = null) =>
        As(Owner).PlanAsync(workOrderId, new PlanDecision(WorkOrder(workOrderId).Version, approve, reason), Guid.NewGuid(), default);

    public Task StartAsync(Guid workOrderId, Guid staff) =>
        As(staff).ActAsync(workOrderId, "start", new WorkOrderAction(WorkOrder(workOrderId).Version), Guid.NewGuid(), default);

    public async Task SubmitResultAsync(Guid workOrderId, Guid staff, string result = "Đã thay gioăng, hết rỉ")
    {
        var evidence = await UploadAsync(staff, WorkOrder(workOrderId).IncidentId, workOrderId, IncidentEvidenceKind.Completion);
        await As(staff).ActAsync(workOrderId, "submit", new WorkOrderAction(WorkOrder(workOrderId).Version, result, [evidence]), Guid.NewGuid(), default);
    }

    public Task VerifyAsync(Guid workOrderId, decimal actualCost, string? reason = null, AssetStatus assetStatus = AssetStatus.Active) =>
        As(Owner).VerifyAsync(workOrderId, new MaintenanceVerification(WorkOrder(workOrderId).Version, actualCost, "Đạt", reason, "Tốt", assetStatus),
            Guid.NewGuid(), default);

    public Task CancelWorkOrderAsync(Guid workOrderId, string reason) =>
        As(Owner).CancelWorkOrderAsync(workOrderId, new IncidentDecision(WorkOrder(workOrderId).Version, reason), Guid.NewGuid(), default);

    // Work Order đã qua: đề xuất -> duyệt -> bắt đầu (In Progress).
    public async Task<Guid> WorkOrderInProgressAsync(Guid incidentId, Guid staff, decimal? estimatedCost = 200_000m)
    {
        var wo = await AssignAsync(incidentId, staff);
        await ProposeAsync(wo, staff, estimatedCost);
        await DecidePlanAsync(wo, approve: true);
        await StartAsync(wo, staff);
        return wo;
    }

    // Work Order đã qua: đề xuất -> duyệt -> bắt đầu -> gửi kết quả (Pending Verification).
    public async Task<Guid> WorkOrderPendingVerificationAsync(Guid incidentId, Guid staff, decimal? estimatedCost = 200_000m)
    {
        var wo = await WorkOrderInProgressAsync(incidentId, staff, estimatedCost);
        await SubmitResultAsync(wo, staff);
        return wo;
    }

    // ---------- Quan sát kết quả ----------
    // "X được thông báo": có thông báo trong hệ thống gửi tới X, hoặc job gửi thông báo có nhắc tới X.
    public bool Notified(Guid recipient) =>
        Repository.Notifications.Any(n => n.RecipientId == recipient) ||
        Jobs.ReceivedCalls().SelectMany(c => c.GetArguments()).OfType<JobSubmission>()
            .Any(j => j.PayloadJson.Contains(recipient.ToString(), StringComparison.OrdinalIgnoreCase));

    // Bỏ các thông báo phát sinh ở bước chuẩn bị, để chỉ quan sát thông báo của thao tác đang test.
    public void ResetNotifications()
    {
        Repository.Notifications.Clear();
        Jobs.ClearReceivedCalls();
    }

    public bool NotifiedHighPriority(Guid recipient) =>
        Repository.Notifications.Any(n => n.RecipientId == recipient && n.HighPriority);
}

internal sealed class FixedClock(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset now = start;
    public override DateTimeOffset GetUtcNow() => now.ToUniversalTime();
    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    public void Advance(TimeSpan by) => now = now.Add(by);
    public void Set(DateTimeOffset value) => now = value;
}

// Kiểm tra ảnh dùng bộ kiểm tra THẬT của hệ thống (IncidentFiles.Validate - định dạng, dung lượng);
// chỉ phần lưu file (PutAsync/CopyAsync) được thay bằng bản ghi nhận trong bộ nhớ.
internal sealed class FakeIncidentFiles : IIncidentFiles
{
    private readonly IncidentFiles real = new(null!, Substitute.For<IObjectStorage>(), TimeProvider.System);
    public readonly List<string> Stored = [];
    public string Validate(byte[] content) => real.Validate(content);
    public Task PutAsync(Guid locationId, string key, byte[] content, string contentType, CancellationToken token)
    {
        Stored.Add(key);
        return Task.CompletedTask;
    }
    public Task CopyAsync(string key, Stream output, CancellationToken token) => Task.CompletedTask;
}

// Kho dữ liệu trong bộ nhớ theo chữ ký IIncidentRepository: chỉ lưu và trả dữ liệu, không có luật nghiệp vụ.
internal sealed class InMemoryIncidentRepository(TimeProvider clock, Guid owner) : IIncidentRepository
{
    public Dictionary<Guid, string> Roles = new();
    public readonly HashSet<Guid> Locations = [];
    public readonly HashSet<(Guid Staff, Guid Location)> Assignments = [];
    public readonly Dictionary<Guid, IncidentRoom> Rooms = new();
    public readonly List<(Guid Tenant, Guid Contract, Guid Room, Guid Location)> Tenancies = [];
    public readonly Dictionary<Guid, Asset> Assets = new();

    public readonly List<IncidentReport> Reports = [];
    public readonly List<MaintenanceWorkOrder> WorkOrders = [];
    public readonly List<IncidentActivity> Activities = [];
    public readonly List<IncidentEvidence> Evidence = [];
    public readonly List<EmergencyAction> EmergencyActions = [];
    public readonly List<MaintenanceExpense> Expenses = [];
    public readonly List<MaintenanceHistory> Histories = [];
    public readonly List<IncidentNotification> Notifications = [];
    public readonly List<object> Others = [];
    private readonly List<AuditableEntity> pending = [];

    public async Task<T> TransactionAsync<T>(Guid locationId, Guid? roomId, Guid actorId, Guid key, Func<Task<T>> work, CancellationToken t)
    {
        var result = await work();
        await FlushAsync(t);
        return result;
    }

    public Task<bool> ActiveRoleAsync(Guid actor, string role, CancellationToken t) =>
        Task.FromResult(Roles.TryGetValue(actor, out var r) && r == role);
    public Task<bool> ActiveLocationAsync(Guid id, CancellationToken t) => Task.FromResult(Locations.Contains(id));
    public Task<bool> StaffAssignedAsync(Guid actor, Guid location, DateOnly today, CancellationToken t) =>
        Task.FromResult(Assignments.Contains((actor, location)));
    public Task<bool> StaffAvailableAsync(Guid location, DateOnly today, CancellationToken t) =>
        Task.FromResult(Assignments.Any(a => a.Location == location));
    public Task<IReadOnlyList<Guid>> RecipientsAsync(Guid location, DateOnly today, bool includeStaff, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<Guid>>(includeStaff
            ? [owner, .. Assignments.Where(a => a.Location == location).Select(a => a.Staff)]
            : [owner]);
    public Task<IncidentRoom?> RoomAsync(Guid id, CancellationToken t) => Task.FromResult(Rooms.GetValueOrDefault(id));
    public Task<IncidentTenancy?> TenancyAsync(Guid actor, Guid location, Guid? room, DateOnly date, CancellationToken t)
    {
        var match = Tenancies.Where(x => x.Tenant == actor && x.Location == location && (room is null || x.Room == room))
            .Select(x => new IncidentTenancy(x.Contract, x.Room)).FirstOrDefault();
        return Task.FromResult(match);
    }
    public Task<Guid?> ContractRoomAsync(Guid contract, CancellationToken t) =>
        Task.FromResult(Tenancies.Where(x => x.Contract == contract).Select(x => (Guid?)x.Room).FirstOrDefault());
    public Task<Asset?> AssetAsync(Guid id, CancellationToken t) => Task.FromResult(Assets.GetValueOrDefault(id));
    public Task<IncidentReport?> IncidentAsync(Guid id, CancellationToken t) => Task.FromResult(Reports.FirstOrDefault(r => r.Id == id));
    public Task<MaintenanceWorkOrder?> WorkOrderAsync(Guid id, CancellationToken t) => Task.FromResult(WorkOrders.FirstOrDefault(w => w.Id == id));
    public Task<IReadOnlyList<MaintenanceWorkOrder>> WorkOrdersAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<MaintenanceWorkOrder>>(WorkOrders.Where(w => w.IncidentId == incident).ToList());
    public Task<bool> OtherAssetWorkAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) =>
        Task.FromResult(WorkOrders.Any(w => w.AssetId == asset && w.Id != exceptWorkOrder &&
            w.Status is not (WorkOrderStatus.Verified or WorkOrderStatus.Cancelled)));
    public Task<bool> OtherAssetExecutionAsync(Guid asset, Guid? exceptWorkOrder, CancellationToken t) =>
        Task.FromResult(WorkOrders.Any(w => w.AssetId == asset && w.Id != exceptWorkOrder &&
            w.Status is WorkOrderStatus.InProgress or WorkOrderStatus.PendingVerification));
    public Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t) => Task.FromResult<IncidentCommand?>(null);
    public Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<IncidentEvidence>>(Evidence.Where(e => e.IncidentId == incident).ToList());
    public Task<IReadOnlyList<EmergencyAction>> EmergencyActionsAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<EmergencyAction>>(EmergencyActions.Where(e => e.IncidentId == incident).ToList());

    public Task<IncidentPage<IncidentView>> ListAsync(IncidentScope scope, IncidentQuery query, CancellationToken t)
    {
        var items = Reports.Select(r => IncidentProjection.Report(r, null)).ToList();
        return Task.FromResult(new IncidentPage<IncidentView>(items, 1, Math.Max(items.Count, 1), items.Count));
    }
    public Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t) =>
        Task.FromResult(new IncidentPage<IncidentReportingRoom>([], 1, 1, 0));
    public Task<IncidentPage<IncidentReportingAsset>> ReportingAssetsAsync(IncidentScope scope, IncidentLookupQuery query, CancellationToken t) =>
        Task.FromResult(new IncidentPage<IncidentReportingAsset>([], 1, 1, 0));
    public Task<IncidentPage<WorkOrderView>> ListWorkOrdersAsync(IncidentScope scope, IncidentQuery query, DateTimeOffset now, CancellationToken t)
    {
        var items = WorkOrders.Where(w => query.IncidentId is null || w.IncidentId == query.IncidentId)
            .Select(w => IncidentProjection.Work(w, now, true)).ToList();
        return Task.FromResult(new IncidentPage<WorkOrderView>(items, 1, Math.Max(items.Count, 1), items.Count));
    }
    public Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid incident, IncidentScope scope, int page, int size, CancellationToken t)
    {
        var items = Activities.Where(a => a.IncidentId == incident)
            .Select(a => new IncidentActivityView(a.Id, a.WorkOrderId, a.Action, a.Note, a.OccurredAt, a.ActorId, a.DataJson)).ToList();
        return Task.FromResult(new IncidentPage<IncidentActivityView>(items, 1, Math.Max(items.Count, 1), items.Count));
    }
    public Task<IncidentPage<MaintenanceHistoryView>> MaintenanceAsync(IncidentScope scope, IncidentQuery query, CancellationToken t)
    {
        var items = Histories.Select(h => new MaintenanceHistoryView(h.Id, h.ActivityId, "", h.IncidentId, h.WorkOrderId, h.RoomId, h.AssetId,
            h.ConditionBefore, h.ConditionAfter, h.StatusBefore, h.StatusAfter, h.ActualCost, h.VerifiedById, h.VerifiedAt)).ToList();
        return Task.FromResult(new IncidentPage<MaintenanceHistoryView>(items, 1, Math.Max(items.Count, 1), items.Count));
    }
    public Task<IReadOnlyList<ExpenseView>> ExpensesAsync(Guid incident, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<ExpenseView>>(Expenses.Where(e => e.IncidentId == incident)
            .Select(e => new ExpenseView(e.Id, e.IncidentId, e.WorkOrderId, e.EmergencyActionId, e.Category, e.Amount, e.ExpenseDate)).ToList());
    public Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(IncidentScope scope, int page, int size, CancellationToken t)
    {
        var items = Notifications.Where(n => n.RecipientId == scope.ActorId)
            .Select(n => new IncidentNotificationView(n.Id, n.IncidentId, n.Event, n.HighPriority, n.CreatedAt, n.ReadAt, n.DeliveryState)).ToList();
        return Task.FromResult(new IncidentPage<IncidentNotificationView>(items, 1, Math.Max(items.Count, 1), items.Count));
    }
    public Task<IncidentNotification?> NotificationAsync(Guid id, Guid actor, CancellationToken t) =>
        Task.FromResult(Notifications.FirstOrDefault(n => n.Id == id && n.RecipientId == actor));

    // Giống tầng lưu trữ: gán thời điểm tạo cho bản ghi mới khi lưu.
    public Task FlushAsync(CancellationToken t)
    {
        foreach (var entity in pending) entity.Stamp(clock.GetUtcNow(), isNew: true);
        pending.Clear();
        return Task.CompletedTask;
    }

    public void Add(object entity)
    {
        switch (entity)
        {
            case IncidentReport r: Reports.Add(r); break;
            case MaintenanceWorkOrder w: WorkOrders.Add(w); break;
            case IncidentActivity a: Activities.Add(a); break;
            case IncidentEvidence e: Evidence.Add(e); break;
            case EmergencyAction e: EmergencyActions.Add(e); break;
            case MaintenanceExpense e: Expenses.Add(e); break;
            case MaintenanceHistory h: Histories.Add(h); break;
            case IncidentNotification n: Notifications.Add(n); break;
            default: Others.Add(entity); break;
        }
        if (entity is AuditableEntity auditable && auditable.CreatedAt == default) pending.Add(auditable);
    }

    public void Audit(Guid actor, string action, Guid activityId, DateTimeOffset now) { }
}

internal static class Rejection
{
    // "Bị từ chối" = hệ thống từ chối thao tác bằng lỗi nghiệp vụ / lỗi phân quyền (không phải lỗi lập trình như NullReference).
    public static async Task<Exception> AssertRejectedAsync(Func<Task> action)
    {
        var error = await Record.ExceptionAsync(action);
        Assert.True(error is not null, "Mong đợi thao tác bị từ chối nhưng hệ thống chấp nhận.");
        Assert.True(error is IncidentException or UnauthorizedAccessException,
            $"Thao tác bị dừng bởi lỗi không phải lỗi nghiệp vụ/phân quyền: {error.GetType().Name}: {error.Message}");
        return error;
    }

    public static string CodeOf(Exception error) => error is IncidentException incident ? incident.Code : error.Message;

    // Lỗi phải chỉ ra đúng trường cần sửa (theo cột Expected Results: "... identified for correction").
    public static void AssertIdentifies(Exception error, params string[] fieldWords) =>
        Assert.True(fieldWords.Any(w => CodeOf(error).Contains(w, StringComparison.OrdinalIgnoreCase)),
            $"Lỗi '{CodeOf(error)}' không chỉ ra trường: {string.Join(" / ", fieldWords)}");
}
