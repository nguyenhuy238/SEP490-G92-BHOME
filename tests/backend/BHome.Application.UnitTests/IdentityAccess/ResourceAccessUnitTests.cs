using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.IdentityAccess;

// Unit test cho chức năng checkResourceAccess - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx.
// Kết quả mong đợi của MỌI test lấy từ sheet (căn cứ SRS v1.3):
//   GBR-01 3 role cố định; GBR-02 Owner toàn chuỗi, Staff theo Location được giao, Tenant dữ liệu của mình
//   DBR-01 Staff chỉ thao tác trong Location đang được giao; UC-09 A3 gỡ phân công
//   NFR §2.3 Authentication / Authorization / Tenant Isolation; Permission Matrix §4.4
// Code chỉ dùng để biết cách gọi hàm: ResourceAccess.CanAccessAsync(ResourceScope(locationId, tenantUserId), allowedRoles).
// Ghi chú:
//   - "resource owner=U-0101" trong sheet: hệ thống chỉ có 1 Owner (1 chuỗi), hàm không nhận tham số này nên không truyền.
//   - Log Message (MSG03/MSG04) do tầng API trả về; hàm ở tầng này chỉ trả true/false nên test chỉ kiểm tra Return.
// Người dùng hiện tại (ICurrentUser) và dữ liệu phân công Staff-Location (IStaffLocationAccess) giả lập bằng NSubstitute.
public sealed class ResourceAccessUnitTests
{
    private static readonly Guid OwnerU0101 = Guid.Parse("00000000-0000-0000-0000-000000000101");
    private static readonly Guid StaffU0102 = Guid.Parse("00000000-0000-0000-0000-000000000102");
    private static readonly Guid TenantU0103 = Guid.Parse("00000000-0000-0000-0000-000000000103");
    private static readonly Guid TenantU0104 = Guid.Parse("00000000-0000-0000-0000-000000000104");
    private static readonly Guid LocationTB = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid LocationQ7 = Guid.Parse("00000000-0000-0000-0000-0000000000a7");

    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly IStaffLocationAccess staffLocations = Substitute.For<IStaffLocationAccess>();

    private ResourceAccess Access() => new(user, staffLocations);

    private void LoggedIn(Guid userId, string role)
    {
        user.UserId.Returns(userId);
        user.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
    }

    private void NoUserLoggedIn()
    {
        user.UserId.Returns((Guid?)null);
        user.IsInRole(Arg.Any<string>()).Returns(false);
    }

    // Phân công hiện tại: chỉ những cặp (Staff, Location) được liệt kê là đang được giao.
    private void AssignedLocations(Guid staffId, params Guid[] locations) =>
        staffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call => call.ArgAt<Guid>(0) == staffId && locations.Contains(call.ArgAt<Guid>(1)));

    // UTC01 (Normal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner U-0101 logged in
    // Đầu vào : resource owner=U-0101; location=L-TB; allowedRoles=["Owner"]
    // Mong đợi: Return: true; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-02 (Owner has chain-wide authority); SRS §2.3 Access Control; Permission Matrix §4.4 Location/Room = Full
    [Fact(DisplayName = "ResourceAccess UTC01 - Owner truy cap Location L-TB: true")]
    public async Task UTC01_OwnerAccessesLocation()
    {
        LoggedIn(OwnerU0101, Roles.Owner);

        Assert.True(await Access().CanAccessAsync(new ResourceScope(LocationTB, null), [Roles.Owner]));
    }

    // UTC02 (Normal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner U-0101 logged in; Location L-Q7 belongs to the managed Chain; no Staff assignment involved
    // Đầu vào : resource owner=U-0101; location=L-Q7; allowedRoles=["Owner"]
    // Mong đợi: Return: true (Owner is not limited by Location assignment); Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-02; SRS §2.3 (Owner has chain-wide management authority); Actor Owner §4.1
    [Fact(DisplayName = "ResourceAccess UTC02 - Owner khong bi gioi han boi phan cong Location: true")]
    public async Task UTC02_OwnerNotLimitedByAssignment()
    {
        LoggedIn(OwnerU0101, Roles.Owner);
        AssignedLocations(StaffU0102); // không có phân công nào cho L-Q7

        Assert.True(await Access().CanAccessAsync(new ResourceScope(LocationQ7, null), [Roles.Owner]));
    }

    // UTC03 (Normal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff U-0102 currently assigned to Location L-TB of Owner U-0101
    // Đầu vào : resource owner=U-0101; location=L-TB; allowedRoles=["Staff"]
    // Mong đợi: Return: true; Exception: N/A; Log Message: N/A
    // Căn cứ  : DBR-01; GBR-02; UC-09; NFR §2.3 Authorization (server enforces Staff Location assignments)
    [Fact(DisplayName = "ResourceAccess UTC03 - Staff duoc giao L-TB truy cap L-TB: true")]
    public async Task UTC03_StaffAccessesAssignedLocation()
    {
        LoggedIn(StaffU0102, Roles.Staff);
        AssignedLocations(StaffU0102, LocationTB);

        Assert.True(await Access().CanAccessAsync(new ResourceScope(LocationTB, null), [Roles.Staff]));
    }

    // UTC04 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff U-0102 logged in; not assigned to Location L-Q7
    // Đầu vào : resource owner=U-0101; location=L-Q7; allowedRoles=["Staff"]
    // Mong đợi: Return: false; Exception: N/A; Log Message: "This Location is outside your assigned scope."
    // Căn cứ  : DBR-01; GBR-02; SRS §2.3 (Staff access restricted to assigned Locations); MSG04
    [Fact(DisplayName = "ResourceAccess UTC04 - Staff truy cap Location khong duoc giao (L-Q7): false")]
    public async Task UTC04_StaffOutsideAssignedLocation()
    {
        LoggedIn(StaffU0102, Roles.Staff);
        AssignedLocations(StaffU0102, LocationTB);

        Assert.False(await Access().CanAccessAsync(new ResourceScope(LocationQ7, null), [Roles.Staff]));
    }

    // UTC05 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff U-0102 was assigned to L-TB; Owner has removed this assignment (UC-09 A3)
    // Đầu vào : resource owner=U-0101; location=L-TB; allowedRoles=["Staff"]
    // Mong đợi: Return: false; Exception: N/A; Log Message: "This Location is outside your assigned scope."
    // Căn cứ  : DBR-01 (Locations currently assigned); UC-09 A3; MSG04
    [Fact(DisplayName = "ResourceAccess UTC05 - Staff bi go phan cong L-TB: false")]
    public async Task UTC05_StaffAssignmentRemoved()
    {
        LoggedIn(StaffU0102, Roles.Staff);
        AssignedLocations(StaffU0102, LocationTB);
        Assert.True(await Access().CanAccessAsync(new ResourceScope(LocationTB, null), [Roles.Staff]));

        AssignedLocations(StaffU0102); // Owner gỡ phân công L-TB

        Assert.False(await Access().CanAccessAsync(new ResourceScope(LocationTB, null), [Roles.Staff]));
    }

    // UTC06 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff U-0102 currently assigned to Location L-TB
    // Đầu vào : resource owner=U-0101; location=L-TB; action=Owner-only (e.g. activate Contract); allowedRoles=["Owner"]
    // Mong đợi: Return: false (Location assignment does not grant Owner decisions); Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : GBR-03 (Owner final decision on Contract activation); Permission Matrix §4.4 Contract; GBR-01; MSG03
    [Fact(DisplayName = "ResourceAccess UTC06 - Staff duoc giao L-TB lam thao tac chi Owner: false")]
    public async Task UTC06_StaffCannotDoOwnerOnlyAction()
    {
        LoggedIn(StaffU0102, Roles.Staff);
        AssignedLocations(StaffU0102, LocationTB);

        Assert.False(await Access().CanAccessAsync(new ResourceScope(LocationTB, null), [Roles.Owner]));
    }

    // UTC07 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff U-0102 logged in; assigned to L-TB
    // Đầu vào : resource owner=U-0101; resource=Finance / What-if data (chain level, no Location); allowedRoles=["Owner"]
    // Mong đợi: Return: false; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Permission Matrix §4.4 Finance/What-if: Staff = No; GBR-02; MSG03
    [Fact(DisplayName = "ResourceAccess UTC07 - Staff xem du lieu Finance/What-if cap chuoi: false")]
    public async Task UTC07_StaffCannotAccessChainFinance()
    {
        LoggedIn(StaffU0102, Roles.Staff);
        AssignedLocations(StaffU0102, LocationTB);

        Assert.False(await Access().CanAccessAsync(new ResourceScope(null, null), [Roles.Owner]));
    }

    // UTC08 (Normal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant U-0103 logged in
    // Đầu vào : resource owner=U-0101; location=L-TB; tenant=U-0103; allowedRoles=["Tenant"]
    // Mong đợi: Return: true; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-02 (Tenant accesses own tenancy data); NFR §2.3 Tenant Isolation; SRS §2.3
    [Fact(DisplayName = "ResourceAccess UTC08 - Tenant xem du lieu thue cua chinh minh: true")]
    public async Task UTC08_TenantAccessesOwnData()
    {
        LoggedIn(TenantU0103, Roles.Tenant);

        Assert.True(await Access().CanAccessAsync(new ResourceScope(LocationTB, TenantU0103), [Roles.Tenant]));
    }

    // UTC09 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant U-0103 logged in
    // Đầu vào : resource owner=U-0101; location=L-TB; tenant=U-0104; allowedRoles=["Tenant"]
    // Mong đợi: Return: false (another Tenant's data); Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : NFR §2.3 Tenant Isolation; GBR-02; MSG03
    [Fact(DisplayName = "ResourceAccess UTC09 - Tenant xem du lieu cua Tenant khac: false")]
    public async Task UTC09_TenantCannotAccessOtherTenant()
    {
        LoggedIn(TenantU0103, Roles.Tenant);

        Assert.False(await Access().CanAccessAsync(new ResourceScope(LocationTB, TenantU0104), [Roles.Tenant]));
    }

    // UTC10 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant U-0103 logged in; Invoice belongs to U-0103
    // Đầu vào : resource owner=U-0101; location=L-TB; tenant=U-0103; action=approve Invoice Adjustment; allowedRoles=["Owner"]
    // Mong đợi: Return: false (own tenancy data does not grant Owner-only actions); Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Permission Matrix §4.4 Invoice Adjustment (Owner approve/reject; Tenant request/view own); GBR-01; MSG03
    [Fact(DisplayName = "ResourceAccess UTC10 - Tenant tu duyet dieu chinh hoa don cua minh: false")]
    public async Task UTC10_TenantCannotApproveOwnAdjustment()
    {
        LoggedIn(TenantU0103, Roles.Tenant);

        Assert.False(await Access().CanAccessAsync(new ResourceScope(LocationTB, TenantU0103), [Roles.Owner]));
    }

    // UTC11 (Abnormal) - sheet "ResourceAccess", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: No user logged in
    // Đầu vào : resource owner=U-0101; location=L-TB; tenant=U-0103; allowedRoles=all 3 roles
    // Mong đợi: Return: false; Exception: N/A; Log Message: N/A
    // Căn cứ  : NFR §2.3 Authentication; GBR-01 (Guest is non-RBAC)
    [Fact(DisplayName = "ResourceAccess UTC11 - Chua dang nhap: false du cho phep ca 3 role")]
    public async Task UTC11_NoUserLoggedIn()
    {
        NoUserLoggedIn();

        Assert.False(await Access().CanAccessAsync(new ResourceScope(LocationTB, TenantU0103), [Roles.Owner, Roles.Staff, Roles.Tenant]));
    }
}
