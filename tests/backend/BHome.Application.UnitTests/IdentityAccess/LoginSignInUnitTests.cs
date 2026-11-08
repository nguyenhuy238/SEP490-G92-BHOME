using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.IdentityAccess;

// Unit test cho chức năng signIn (UC-01 Sign In).
// Kết quả mong đợi của MỌI test chỉ lấy từ SRS v1.3 (Report 3, bản Drive cập nhật 31/10/2026):
//   S1  FE-02 §2.1.1: Login Identifier = "Registered email address or phone number used to sign in."
//   S2  FE-02 §2.1.1 + MSG17: thông báo chung "Incorrect login information or account unavailable."
//   S3  UC-01 + GBR-01: chỉ 3 role cố định Owner / Staff / Tenant; vào chức năng theo role
//   S6  MSG02: "This field is required."
//   S8  GBR-13: hành động bảo mật nhạy cảm phải được ghi audit
// Code chỉ được dùng để biết cách gọi hàm; phụ thuộc bên ngoài được giả lập bằng NSubstitute.
public sealed class LoginSignInUnitTests
{
    private const string Password = "Valid@Pass2026";
    private const string OwnerEmail = "owner.dev@example.invalid";
    private const string StaffEmail = "staff.dev@example.invalid";
    private const string TenantEmail = "tenant.dev@example.invalid";

    private readonly ICredentialVerifier credentials = Substitute.For<ICredentialVerifier>();
    private readonly IAuthenticationSessions sessions = Substitute.For<IAuthenticationSessions>();
    private readonly ISecurityAudit audit = Substitute.For<ISecurityAudit>();

    private LoginService Service() => new(credentials, sessions, audit);

    private void AccountExists(string identifier, Guid userId, params string[] roles)
    {
        credentials.VerifyAsync(identifier, Password, Arg.Any<CancellationToken>()).Returns(new VerifiedIdentity(userId, roles, "STAMP"));
        sessions.CreateAsync(Arg.Any<VerifiedIdentity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>()).Returns(call =>
        {
            var identity = call.Arg<VerifiedIdentity>();
            return new LoginResult(identity.UserId, identity.Roles, "access-token", DateTimeOffset.UtcNow.AddMinutes(30), Guid.NewGuid(), "refresh-token", DateTimeOffset.UtcNow.AddDays(7));
        });
    }

    private async Task AssertNotSignedIn(LoginResult? result)
    {
        Assert.Null(result);
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
    }

    // UTC01 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff account active; role Staff
    // Đầu vào : loginIdentifier="staff.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: signed in; access granted with role Staff; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 Sign In; UC-01; GBR-01
    [Fact(DisplayName = "UTC01 - Staff dang nhap bang email dang ky: thanh cong, role Staff")]
    public async Task UTC01_StaffSignsInWithEmail()
    {
        var userId = Guid.NewGuid();
        AccountExists(StaffEmail, userId, Roles.Staff);

        var result = await Service().LoginAsync(StaffEmail, Password);

        Assert.NotNull(result);
        Assert.Equal(userId, result.UserId);
        Assert.Equal([Roles.Staff], result.Roles);
    }

    // UTC02 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner account active; role Owner
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: signed in; access granted with role Owner; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 Sign In; UC-01; GBR-01
    [Fact(DisplayName = "UTC02 - Owner dang nhap bang email dang ky: thanh cong, role Owner")]
    public async Task UTC02_OwnerSignsInWithEmail()
    {
        var userId = Guid.NewGuid();
        AccountExists(OwnerEmail, userId, Roles.Owner);

        var result = await Service().LoginAsync(OwnerEmail, Password);

        Assert.NotNull(result);
        Assert.Equal(userId, result.UserId);
        Assert.Equal([Roles.Owner], result.Roles);
    }

    // UTC03 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant account active; role Tenant
    // Đầu vào : loginIdentifier="tenant.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: signed in; access granted with role Tenant; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 Sign In; UC-01; GBR-01
    [Fact(DisplayName = "UTC03 - Tenant dang nhap bang email dang ky: thanh cong, role Tenant")]
    public async Task UTC03_TenantSignsInWithEmail()
    {
        var userId = Guid.NewGuid();
        AccountExists(TenantEmail, userId, Roles.Tenant);

        var result = await Service().LoginAsync(TenantEmail, Password);

        Assert.NotNull(result);
        Assert.Equal([Roles.Tenant], result.Roles);
    }

    // UTC04 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff account active; registered phone number 0912345678
    // Đầu vào : loginIdentifier="0912345678"; password=<correct password>
    // Mong đợi: Return: signed in with the registered phone number; access granted with role Staff; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1: Login Identifier = registered email address or phone number
    [Fact(DisplayName = "UTC04 - Dang nhap bang so dien thoai da dang ky (SRS 2.1.1): thanh cong")]
    public async Task UTC04_StaffSignsInWithPhoneNumber()
    {
        const string phone = "0912345678";
        var userId = Guid.NewGuid();
        AccountExists(phone, userId, Roles.Staff);

        var result = await Service().LoginAsync(phone, Password);

        Assert.NotNull(result);
        Assert.Equal(userId, result.UserId);
    }

    // UTC05 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: N/A
    // Đầu vào : loginIdentifier=null; password=<correct password>
    // Mong đợi: Return: not signed in; credentials not checked; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : SRS §2.1.1; MSG02
    [Fact(DisplayName = "UTC05 - Thieu dinh danh dang nhap: khong dang nhap, khong kiem tra")]
    public async Task UTC05_MissingIdentifier()
    {
        await AssertNotSignedIn(await Service().LoginAsync(null, Password));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
    }

    // UTC06 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: N/A
    // Đầu vào : loginIdentifier="   " (3 spaces); password=<correct password>
    // Mong đợi: Return: not signed in; credentials not checked; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : SRS §2.1.1; MSG02
    [Fact(DisplayName = "UTC06 - Dinh danh chi co khoang trang: khong dang nhap, khong kiem tra")]
    public async Task UTC06_BlankIdentifier()
    {
        await AssertNotSignedIn(await Service().LoginAsync("   ", Password));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
    }

    // UTC07 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: N/A
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=""
    // Mong đợi: Return: not signed in; credentials not checked; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : SRS §2.1.1; MSG02
    [Fact(DisplayName = "UTC07 - Thieu mat khau: khong dang nhap, khong kiem tra")]
    public async Task UTC07_MissingPassword()
    {
        await AssertNotSignedIn(await Service().LoginAsync(OwnerEmail, ""));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
    }

    // UTC08 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner account active
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=<wrong password>
    // Mong đợi: Return: not signed in; failed sign-in recorded in the audit log; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §2.1.1; MSG17; GBR-13
    [Fact(DisplayName = "UTC08 - Sai mat khau: khong dang nhap, ghi audit")]
    public async Task UTC08_WrongPassword()
    {
        credentials.VerifyAsync(OwnerEmail, "Wrong@Pass2026", Arg.Any<CancellationToken>()).Returns((VerifiedIdentity?)null);

        await AssertNotSignedIn(await Service().LoginAsync(OwnerEmail, "Wrong@Pass2026"));

        await audit.Received(1).LoginFailedAsync(Arg.Any<CancellationToken>());
    }

    // UTC09 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Account active but has no role
    // Đầu vào : loginIdentifier="norole.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: not signed in; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : GBR-01 (only Owner, Staff, Tenant); MSG17
    [Fact(DisplayName = "UTC09 - Tai khoan khong co role: khong dang nhap")]
    public async Task UTC09_NoRole()
    {
        AccountExists("norole.dev@example.invalid", Guid.NewGuid());

        await AssertNotSignedIn(await Service().LoginAsync("norole.dev@example.invalid", Password));
    }

    // UTC10 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Account has roles Owner + Administrator (Administrator is not a GBR-01 role)
    // Đầu vào : loginIdentifier="admin.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: not signed in; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : GBR-01; MSG17
    [Fact(DisplayName = "UTC10 - Role ngoai GBR-01 (Administrator): khong dang nhap")]
    public async Task UTC10_RoleOutsideGbr01()
    {
        AccountExists("admin.dev@example.invalid", Guid.NewGuid(), Roles.Owner, "Administrator");

        await AssertNotSignedIn(await Service().LoginAsync("admin.dev@example.invalid", Password));
    }

    // UTC11 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner account becomes unavailable (Inactive) during sign-in
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: not signed in; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §3.2 User (Active / Inactive); MSG17
    [Fact(DisplayName = "UTC11 - Tai khoan khong kha dung khi dang dang nhap: khong dang nhap")]
    public async Task UTC11_AccountUnavailable()
    {
        credentials.VerifyAsync(OwnerEmail, Password, Arg.Any<CancellationToken>()).Returns(new VerifiedIdentity(Guid.NewGuid(), [Roles.Owner], "STAMP"));
        sessions.CreateAsync(Arg.Any<VerifiedIdentity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>()).Returns((LoginResult?)null);

        Assert.Null(await Service().LoginAsync(OwnerEmail, Password));
    }
}
