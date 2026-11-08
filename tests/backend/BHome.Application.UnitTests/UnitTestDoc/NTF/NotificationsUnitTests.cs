using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Integrations;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace BHome.Application.UnitTests.UnitTestDoc.NTF;

// Unit test cho sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx (13 test case).
// Kết quả mong đợi của MỌI test lấy nguyên văn từ sheet (căn cứ SRS v1.3: FE-07 §7.4.1, Entity Notification,
// API-02, GBR-14, GBR-18, JOB-04, UC-35, NFR 2.2/2.3/2.4/2.5).
// Code KHÔNG được đọc; chỉ dùng danh mục chữ ký (tên class / hàm / tham số) để biết cách gọi:
//   viewNotifications     -> NotificationService.ListAsync(NotificationQuery)
//   markNotificationRead  -> NotificationService.ReadAsync(id) + TargetAsync(id)
//   dispatchNotification  -> NotificationDeliveryService.DeliverAsync(id)
//   sendNotification, sendOperationalNotice -> không có hàm tương ứng ở tầng unit (xem từng test).
// Kho thông báo (INotificationRepository), kho gửi (INotificationDeliveryStore) và Notification Service bên ngoài
// (INotificationProvider) được giả lập bằng NSubstitute. Kho giả chỉ mô phỏng DỮ LIỆU theo SRS
// ("mỗi thông báo thuộc đúng 1 người nhận"), không mô phỏng quyết định nghiệp vụ.
public sealed class NotificationsUnitTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 7, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid Tenant1 = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Tenant2 = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
    private static readonly Guid OtherUser = Guid.Parse("00000000-0000-0000-0000-0000000000c9");
    private static readonly Guid Inv204 = Guid.Parse("00000000-0000-0000-0000-000000000204");
    private static readonly Guid Contract7 = Guid.Parse("00000000-0000-0000-0000-000000000307");
    private static readonly Guid N1 = Guid.Parse("00000000-0000-0000-0000-0000000000e1");
    private static readonly Guid N2 = Guid.Parse("00000000-0000-0000-0000-0000000000e2");
    private static readonly Guid N3 = Guid.Parse("00000000-0000-0000-0000-0000000000e3");

    private const string NotFound = "Chưa tìm thấy chức năng {0} trong hệ thống (danh mục chữ ký)";

    // ---------- dữ liệu thông báo giả lập (mỗi thông báo thuộc 1 người nhận - Entity Notification) ----------
    private sealed class StoredNotification(Guid id, Guid recipient, string category, string title, string relatedType, Guid relatedId)
    {
        public Guid Id { get; } = id;
        public Guid Recipient { get; } = recipient;
        public string Category { get; } = category;
        public string Title { get; } = title;
        public string RelatedType { get; } = relatedType;
        public Guid RelatedId { get; } = relatedId;
        public DateTimeOffset CreatedAt { get; } = Now.AddHours(-1);
        public DateTimeOffset? ReadAt { get; set; }

        public NotificationView View() =>
            new(Id, Category, Title, Title, RelatedType, RelatedId, CreatedAt, ReadAt, "Delivered");
    }

    private readonly List<StoredNotification> inbox = [];
    private readonly INotificationRepository repository = Substitute.For<INotificationRepository>();
    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly TimeProvider clock = Substitute.For<TimeProvider>();

    public NotificationsUnitTests()
    {
        clock.GetUtcNow().Returns(Now);

        repository.ListAsync(Arg.Any<NotificationScope>(), Arg.Any<NotificationQuery>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var scope = call.Arg<NotificationScope>();
                var query = call.Arg<NotificationQuery>();
                var items = inbox.Where(n => n.Recipient == scope.Actor)
                    .Where(n => query.Category is null || n.Category == query.Category)
                    .Select(n => n.View()).ToArray();
                return new PagedResult<NotificationView>(items, query.Page, query.PageSize, items.Length);
            });
        repository.ReadAsync(Arg.Any<NotificationScope>(), Arg.Any<Guid?>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var scope = call.Arg<NotificationScope>();
                var id = call.Arg<Guid?>();
                foreach (var n in inbox.Where(n => n.Recipient == scope.Actor && (id is null || n.Id == id)))
                    n.ReadAt ??= call.Arg<DateTimeOffset>();
                return Task.CompletedTask;
            });
        repository.TargetAsync(Arg.Any<NotificationScope>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var scope = call.Arg<NotificationScope>();
                var n = inbox.SingleOrDefault(x => x.Id == call.Arg<Guid>() && x.Recipient == scope.Actor);
                return n is null ? null : new NotificationTarget(n.RelatedType, n.RelatedId);
            });
        repository.UnreadAsync(Arg.Any<NotificationScope>(), Arg.Any<CancellationToken>())
            .Returns(call => inbox.Count(n => n.Recipient == call.Arg<NotificationScope>().Actor && n.ReadAt is null));
    }

    private void LoggedInAsTenant(Guid id)
    {
        user.UserId.Returns(id);
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == Roles.Tenant);
    }

    private NotificationService Service()
    {
        var resources = new ResourceAccess(user, Substitute.For<IStaffLocationAccess>());
        return new NotificationService(repository, user, new PermissionAccess(user, resources), clock);
    }

    private static NotificationQuery Query(string? category = null) => new() { Page = 1, PageSize = 20, Category = category };

    // =====================================================================================
    // sendNotification
    // Danh mục chữ ký không có hàm nào nhận (sự kiện, danh sách người nhận, loại) để tạo thông báo.
    // Chỉ có NotificationEventPublisher (Infrastructure, internal) tự quét DB qua PublishPendingAsync(),
    // cần DB thật -> phải kiểm tra bằng integration test. Ở tầng unit các case dưới đây báo Fail.
    // =====================================================================================

    // UTC01 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Users tenant1 and owner1 exist; Invoice INV-204 of tenant1 finalized
    // Đầu vào : event=Invoice finalized (INV-204); recipients=[tenant1, owner1]; type=Invoice
    // Mong đợi: Return: one Unread in-app notification per recipient (2 in total), type Invoice, linked to INV-204; external push delivery requested through the Notification Service; Exception: N/A; Log Message: N/A
    // Căn cứ  : Entity Notification (one recipient, Unread/Read, related object); FE-07 7.4.1; UC-21 NF 10; API-02
    [Fact(DisplayName = "NTF UTC01 - Hoa don INV-204 chot: moi nguoi nhan 1 thong bao Unread + yeu cau push")]
    public void UTC01_InvoiceFinalizedCreatesOneNotificationPerRecipient() =>
        Assert.Fail(string.Format(NotFound, "sendNotification") + " - không có hàm nhận sự kiện + người nhận; NotificationEventPublisher cần DB thật (integration test).");

    // UTC02 (Abnormal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: tenant1 already has a notification for the finalization of INV-204
    // Đầu vào : event=Invoice finalized (INV-204) processed again by a retry; recipients=[tenant1]
    // Mong đợi: Return: no duplicate notification; tenant1 still has exactly one notification for this event; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-18; NFR 2.2 Idempotency; JOB-04
    [Fact(DisplayName = "NTF UTC02 - Xu ly lai su kien (retry): khong tao thong bao trung")]
    public void UTC02_RetryDoesNotDuplicate() =>
        Assert.Fail(string.Format(NotFound, "sendNotification") + " - không có hàm nhận sự kiện + người nhận; NotificationEventPublisher cần DB thật (integration test).");

    // UTC03 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Operational Emergency report submitted for Location L1; Staff S1 assigned to L1
    // Đầu vào : event=Emergency incident at L1; severity=Operational Emergency
    // Mong đợi: Return: high-priority in-app and push notifications created immediately for the Owner and S1; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-27 NF 1-3; GBR-11; UC-26 Post (MSG13 shown to reporter)
    [Fact(DisplayName = "NTF UTC03 - Su co khan cap: thong bao uu tien cao cho Owner va S1")]
    public void UTC03_EmergencyNotifiesOwnerAndAssignedStaff() =>
        Assert.Fail(string.Format(NotFound, "sendNotification") + " - không có hàm nhận sự kiện + người nhận; NotificationEventPublisher cần DB thật (integration test).");

    // UTC04 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant T1 has a verified identity record including CCCD 079204001234
    // Đầu vào : event=Tenant onboarding update for T1; recipients=[T1]
    // Mong đợi: Return: notification created; title, content and push payload contain no CCCD number or other sensitive identity data; Exception: N/A; Log Message: N/A
    // Căn cứ  : API-02 Security; NFR 2.5 Privacy; NFR 2.3 Sensitive Identity Data
    [Fact(DisplayName = "NTF UTC04 - Thong bao onboarding khong chua so CCCD")]
    public void UTC04_NotificationHasNoIdentityNumber() =>
        Assert.Fail(string.Format(NotFound, "sendNotification") + " - không có hàm nhận sự kiện + người nhận; NotificationEventPublisher cần DB thật (integration test).");

    // =====================================================================================
    // sendOperationalNotice (UC-35) - danh mục chữ ký không có hàm gửi thông báo vận hành theo Location.
    // =====================================================================================

    // UTC05 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner logged in; Tenants exist in Locations L1 and L2
    // Đầu vào : sender=Owner; target=all Locations; title="Fire drill on 2026-11-20"
    // Mong đợi: Return: Unread in-app notification created for every targeted Tenant in L1 and L2; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-35; FE-07 7.4.1 (Owner chain-wide or targeted notices); Permission Matrix Notifications (Owner Full)
    [Fact(DisplayName = "NTF UTC05 - Owner gui thong bao toan chuoi: moi Tenant L1, L2 nhan")]
    public void UTC05_OwnerNoticeToAllLocations() => Assert.Fail(string.Format(NotFound, "sendOperationalNotice"));

    // UTC06 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff S1 logged in and assigned to L1; Tenants T1, T2 in L1; Tenant T3 in L2
    // Đầu vào : sender=S1; target=Location L1; title="Water outage 8:00-10:00"
    // Mong đợi: Return: Unread in-app notification created for T1 and T2; T3 does not receive it; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-35; FE-07 7.4.1; GBR-14; Permission Matrix Notifications (Staff assigned Location scope)
    [Fact(DisplayName = "NTF UTC06 - Staff gui thong bao L1: chi T1, T2 nhan, T3 khong")]
    public void UTC06_StaffNoticeToAssignedLocation() => Assert.Fail(string.Format(NotFound, "sendOperationalNotice"));

    // UTC07 (Abnormal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff S1 logged in and assigned to L1 only
    // Đầu vào : sender=S1; target=Location L2; title="Water outage 8:00-10:00"
    // Mong đợi: Return: notice rejected; no notification created; Exception: N/A; Log Message: "This Location is outside your assigned scope."
    // Căn cứ  : GBR-14; FE-07 7.4.1; GBR-02; MSG04
    [Fact(DisplayName = "NTF UTC07 - Staff gui thong bao Location khong duoc giao: bi tu choi")]
    public void UTC07_StaffNoticeOutsideScope() => Assert.Fail(string.Format(NotFound, "sendOperationalNotice"));

    // =====================================================================================
    // dispatchNotification -> NotificationDeliveryService.DeliverAsync(id)
    // =====================================================================================

    private readonly INotificationDeliveryStore deliveryStore = Substitute.For<INotificationDeliveryStore>();
    private readonly INotificationProvider provider = Substitute.For<INotificationProvider>();

    // Điều kiện "configured retry policy": chính sách gửi lại được cấu hình (giá trị cấu hình, không phải kết quả mong đợi).
    private static NotificationDeliveryOptions RetryPolicy() => new()
    {
        Enabled = true,
        MaxAttempts = 5,
        InitialRetrySeconds = 30,
        MaximumRetrySeconds = 3600,
        RequestTimeoutSeconds = 10,
        LeaseSeconds = 60
    };

    private NotificationDeliveryService Delivery()
    {
        deliveryStore.ClaimAsync(N1, Arg.Any<DateTimeOffset>(), Arg.Any<NotificationDeliveryOptions>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(new DeliveryClaim(N1, Guid.NewGuid(), 1, Now, Tenant1, "Invoice", "Invoice INV-204 finalized", "Invoice INV-204 is ready"));
        provider.IsConfigured.Returns(true); // Notification Service đã được cấu hình (UTC09: cấu hình nhưng đang lỗi kết nối)
        return new NotificationDeliveryService(deliveryStore, provider, Substitute.For<IBackgroundJobQueue>(), RetryPolicy(), clock);
    }

    // UTC08 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Unread in-app notification N1 created for tenant1; Notification Service available
    // Đầu vào : notification=N1; channel=push
    // Mong đợi: Return: push notification delivered through the Notification Service; in-app notification N1 remains available; Exception: N/A; Log Message: N/A
    // Căn cứ  : API-02 Purpose; Actor Notification Service
    // Ghi chú : "N1 remains available" - kho gửi không có thao tác xoá; kiểm tra thêm ở tầng unit là lần gửi được ghi nhận không lỗi.
    [Fact(DisplayName = "NTF UTC08 - Notification Service san sang: push duoc gui, N1 van con")]
    public async Task UTC08_PushDeliveredThroughNotificationService()
    {
        provider.DeliverAsync(Arg.Any<NotificationDelivery>(), Arg.Any<CancellationToken>()).Returns("push-ref-001");

        await Delivery().DeliverAsync(N1, CancellationToken.None);

        await provider.Received(1).DeliverAsync(Arg.Any<NotificationDelivery>(), Arg.Any<CancellationToken>());
        await deliveryStore.Received(1).CompleteAsync(Arg.Any<DeliveryClaim>(),
            Arg.Is<DeliveryCompletion>(c => c.ErrorCode == null), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    // UTC09 (Abnormal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice INV-204 finalized and in-app notification N1 created for tenant1; Notification Service unavailable
    // Đầu vào : notification=N1; channel=push
    // Mong đợi: Return: external delivery fails and is retried later according to the configured retry policy; in-app notification N1 remains available; INV-204 stays Finalized (business transaction not rolled back); Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-14; JOB-04; API-02 Required Behavior/Fallback; NFR 2.4 Notification Reliability
    // Ghi chú : "INV-204 stays Finalized" - dịch vụ gửi không phụ thuộc hoá đơn nên không thể đảo giao dịch; phần này cần integration test.
    [Fact(DisplayName = "NTF UTC09 - Notification Service loi: gui that bai, hen gui lai theo chinh sach, khong nem loi")]
    public async Task UTC09_DeliveryFailureIsRetriedLater()
    {
        provider.DeliverAsync(Arg.Any<NotificationDelivery>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new IntegrationUnavailableException("notification"));

        var error = await Record.ExceptionAsync(() => Delivery().DeliverAsync(N1, CancellationToken.None));

        Assert.Null(error);
        await deliveryStore.Received(1).CompleteAsync(Arg.Any<DeliveryClaim>(),
            Arg.Is<DeliveryCompletion>(c => c.NextAt != null && c.NextAt > Now && c.NextAt <= Now.AddSeconds(RetryPolicy().MaximumRetrySeconds)),
            Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    // =====================================================================================
    // viewNotifications -> NotificationService.ListAsync(NotificationQuery)
    // Ghi chú: việc lọc trong DB do repository thật thực hiện (cần integration test); ở đây kiểm tra dịch vụ
    // trả đúng thông báo của người đang đăng nhập với đủ các trường SRS yêu cầu.
    // =====================================================================================

    // UTC10 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: tenant1 has notifications N1, N2; tenant2 has N3
    // Đầu vào : user=tenant1; open Notifications
    // Mong đợi: Return: N1 and N2 listed with title, type, created time and read status; N3 not shown; Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-07 7.4.1; Permission Matrix Notifications (Tenant receive own); NFR 2.3 Tenant Isolation
    [Fact(DisplayName = "NTF UTC10 - tenant1 xem thong bao: thay N1, N2 du truong; khong thay N3")]
    public async Task UTC10_TenantSeesOnlyOwnNotifications()
    {
        inbox.Add(new StoredNotification(N1, Tenant1, "Invoice", "Invoice INV-204 finalized", "Invoice", Inv204));
        inbox.Add(new StoredNotification(N2, Tenant1, "Contract", "Contract expiring", "Contract", Contract7));
        inbox.Add(new StoredNotification(N3, Tenant2, "Invoice", "Invoice INV-205 finalized", "Invoice", Guid.NewGuid()));
        LoggedInAsTenant(Tenant1);

        var page = await Service().ListAsync(Query(), CancellationToken.None);

        Assert.Equal([N1, N2], page.Items.Select(n => n.Id).Order().ToArray());
        Assert.DoesNotContain(page.Items, n => n.Id == N3);
        Assert.All(page.Items, n =>
        {
            Assert.False(string.IsNullOrWhiteSpace(n.Title));
            Assert.False(string.IsNullOrWhiteSpace(n.Category));
            Assert.NotEqual(default, n.CreatedAt);
            Assert.Null(n.ReadAt); // read status = Unread
        });
        await repository.Received().ListAsync(Arg.Is<NotificationScope>(s => s.Actor == Tenant1 && s.Tenant && !s.Owner),
            Arg.Any<NotificationQuery>(), Arg.Any<CancellationToken>());
    }

    // UTC11 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: tenant1 has notifications of types Invoice and Contract
    // Đầu vào : user=tenant1; filter=Invoice
    // Mong đợi: Return: only Invoice-type notifications listed; Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-07 7.4.1 Notification Filter
    [Fact(DisplayName = "NTF UTC11 - Loc theo loai Invoice: chi hien thong bao Invoice")]
    public async Task UTC11_FilterByInvoiceType()
    {
        inbox.Add(new StoredNotification(N1, Tenant1, "Invoice", "Invoice INV-204 finalized", "Invoice", Inv204));
        inbox.Add(new StoredNotification(N2, Tenant1, "Contract", "Contract expiring", "Contract", Contract7));
        LoggedInAsTenant(Tenant1);

        var page = await Service().ListAsync(Query("Invoice"), CancellationToken.None);

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, n => Assert.Equal("Invoice", n.Category));
    }

    // =====================================================================================
    // markNotificationRead -> NotificationService.ReadAsync(id) + TargetAsync(id)
    // =====================================================================================

    // UTC12 (Normal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Notification N1 of tenant1 Unread, related to Invoice INV-204
    // Đầu vào : user=tenant1; select N1
    // Mong đợi: Return: N1 status=Read with read time recorded; related Invoice INV-204 opened; Exception: N/A; Log Message: N/A
    // Căn cứ  : Entity Notification (Unread/Read, read time); FE-07 7.4.1 Read Status, Related Object
    [Fact(DisplayName = "NTF UTC12 - Chon N1: N1 thanh Read co thoi diem doc, mo hoa don INV-204")]
    public async Task UTC12_SelectingMarksReadAndOpensInvoice()
    {
        var n1 = new StoredNotification(N1, Tenant1, "Invoice", "Invoice INV-204 finalized", "Invoice", Inv204);
        inbox.Add(n1);
        LoggedInAsTenant(Tenant1);
        var service = Service();

        await service.ReadAsync(N1, CancellationToken.None);
        var target = await service.TargetAsync(N1, CancellationToken.None);

        Assert.Equal(Now, n1.ReadAt);
        Assert.Equal("Invoice", target.ObjectType);
        Assert.Equal(Inv204, target.ObjectId);
    }

    // UTC13 (Abnormal) - sheet "Notifications", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Notification N1 of tenant1 Unread
    // Đầu vào : notification=N1; user=<other user> (not the recipient)
    // Mong đợi: Return: action rejected; N1 remains Unread; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Entity Notification (linked to one recipient); Permission Matrix Notifications; NFR 2.3 Tenant Isolation; MSG03
    // Ghi chú : "action rejected" được kiểm tra bằng việc thao tác bị từ chối (ném lỗi từ chối của module).
    //           Log Message không quan sát được ở tầng unit (lỗi chỉ mang mã; câu thông báo do API trả về).
    [Fact(DisplayName = "NTF UTC13 - Nguoi khac danh dau doc N1: bi tu choi, N1 van Unread")]
    public async Task UTC13_OtherUserCannotMarkRead()
    {
        var n1 = new StoredNotification(N1, Tenant1, "Invoice", "Invoice INV-204 finalized", "Invoice", Inv204);
        inbox.Add(n1);
        LoggedInAsTenant(OtherUser);

        var error = await Record.ExceptionAsync(() => Service().ReadAsync(N1, CancellationToken.None));

        Assert.Null(n1.ReadAt);
        Assert.NotNull(error); // action rejected
    }
}
