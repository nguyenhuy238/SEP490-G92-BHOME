using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Unit test cho chức năng verifyCredentials (xác thực thông tin đăng nhập của UC-01).
// Kết quả mong đợi của MỌI test chỉ lấy từ SRS v1.3:
//   S1  FE-02 §2.1.1: Login Identifier = "Registered email address or phone number used to sign in."
//   S2  FE-02 §2.1.1 + MSG17: sai thông tin hoặc tài khoản không khả dụng -> cùng một kết quả chung
//   S3  GBR-01: role cố định Owner / Staff / Tenant
//   S4  §3.2 Entity User: "the configured login identifier must uniquely resolve one account"
//   S5  §3.2 Entity User: trạng thái Active / Inactive / Temporarily Locked
// SRS KHÔNG quy định số lần sai tối đa, thời gian khóa hay 2FA nên không có test cho các điểm đó.
// UserManager/SignInManager là bản thật của ASP.NET Core Identity; phụ thuộc phụ được giả lập bằng NSubstitute.
public sealed class CredentialVerifierUnitTests
{
    private const string Password = "Valid@Pass2026";

    private readonly IPasswordHasher<ApplicationUser> hasher = Substitute.For<IPasswordHasher<ApplicationUser>>();

    public CredentialVerifierUnitTests()
    {
        hasher.VerifyHashedPassword(Arg.Any<ApplicationUser>(), Arg.Any<string>(), Arg.Any<string>())
            .Returns(call => call.ArgAt<string>(2) == Password ? PasswordVerificationResult.Success : PasswordVerificationResult.Failed);
    }

    private static ApplicationUser User(string name, bool active = true, DateTimeOffset? lockoutEnd = null, string? phone = null) => new()
    {
        Id = Guid.NewGuid(),
        UserName = name,
        NormalizedUserName = name.ToUpperInvariant(),
        Email = $"{name}@example.invalid",
        NormalizedEmail = $"{name}@example.invalid".ToUpperInvariant(),
        PhoneNumber = phone,
        PasswordHash = "stored-hash",
        SecurityStamp = $"STAMP-{name}",
        IsActive = active,
        LockoutEnabled = true,
        LockoutEnd = lockoutEnd
    };

    private IdentityCredentialVerifier Verifier(IEnumerable<(ApplicationUser User, string[] Roles)> accounts)
    {
        var list = accounts.ToArray();
        var store = new InMemoryUserStore(list.Select(a => a.User).ToArray());
        foreach (var (user, roles) in list) store.Roles[user.Id] = [.. roles];
        var options = Options.Create(new IdentityOptions());
        var users = new UserManager<ApplicationUser>(store, options, hasher, [], [], new UpperInvariantLookupNormalizer(),
            new IdentityErrorDescriber(), Substitute.For<IServiceProvider>(), NullLogger<UserManager<ApplicationUser>>.Instance);
        var signIn = new SignInManager<ApplicationUser>(users, Substitute.For<IHttpContextAccessor>(),
            Substitute.For<IUserClaimsPrincipalFactory<ApplicationUser>>(), options, NullLogger<SignInManager<ApplicationUser>>.Instance,
            Substitute.For<IAuthenticationSchemeProvider>(), Substitute.For<IUserConfirmation<ApplicationUser>>());
        return new IdentityCredentialVerifier(users, signIn);
    }

    private IdentityCredentialVerifier Verifier(ApplicationUser user, params string[] roles) => Verifier([(user, roles)]);

    // UTC12 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner account active; role Owner
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: the Owner account is verified with role Owner; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1; GBR-01
    [Fact(DisplayName = "UTC12 - Email va mat khau dung: xac thuc dung tai khoan, role Owner")]
    public async Task UTC12_ValidEmailAndPassword()
    {
        var owner = User("owner.dev");

        var identity = await Verifier(owner, Roles.Owner).VerifyAsync(owner.Email!, Password, default);

        Assert.NotNull(identity);
        Assert.Equal(owner.Id, identity.UserId);
        Assert.Equal([Roles.Owner], identity.Roles);
    }

    // UTC13 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff account active; registered phone number 0912345678; role Staff
    // Đầu vào : loginIdentifier="0912345678"; password=<correct password>
    // Mong đợi: Return: the Staff account is verified with role Staff; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1: Login Identifier = registered email address or phone number
    [Fact(DisplayName = "UTC13 - So dien thoai va mat khau dung (SRS 2.1.1): xac thuc dung tai khoan")]
    public async Task UTC13_ValidPhoneAndPassword()
    {
        var staff = User("staff.dev", phone: "0912345678");

        var identity = await Verifier(staff, Roles.Staff).VerifyAsync("0912345678", Password, default);

        Assert.NotNull(identity);
        Assert.Equal(staff.Id, identity.UserId);
        Assert.Equal([Roles.Staff], identity.Roles);
    }

    // UTC14 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: No account uses "ghost.dev@example.invalid"
    // Đầu vào : loginIdentifier="ghost.dev@example.invalid"; password=<any>
    // Mong đợi: Return: verification failed, same result as a wrong password; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §2.1.1 (generic error message); MSG17
    [Fact(DisplayName = "UTC14 - Dinh danh chua dang ky: xac thuc that bai")]
    public async Task UTC14_UnknownIdentifier()
    {
        Assert.Null(await Verifier(User("owner.dev"), Roles.Owner).VerifyAsync("ghost.dev@example.invalid", Password, default));
    }

    // UTC15 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner account active
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=<wrong password>
    // Mong đợi: Return: verification failed; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §2.1.1; MSG17
    [Fact(DisplayName = "UTC15 - Sai mat khau: xac thuc that bai")]
    public async Task UTC15_WrongPassword()
    {
        var owner = User("owner.dev");

        Assert.Null(await Verifier(owner, Roles.Owner).VerifyAsync(owner.Email!, "Wrong@Pass2026", default));
    }

    // UTC16 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff account Inactive
    // Đầu vào : loginIdentifier="staff.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: verification failed although the password is correct; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §3.2 User (Inactive); MSG17
    [Fact(DisplayName = "UTC16 - Tai khoan Inactive, mat khau dung: xac thuc that bai")]
    public async Task UTC16_InactiveAccount()
    {
        var staff = User("staff.dev", active: false);

        Assert.Null(await Verifier(staff, Roles.Staff).VerifyAsync(staff.Email!, Password, default));
    }

    // UTC17 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner account Temporarily Locked
    // Đầu vào : loginIdentifier="owner.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: verification failed although the password is correct; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §3.2 User (Temporarily Locked); MSG17
    [Fact(DisplayName = "UTC17 - Tai khoan Temporarily Locked, mat khau dung: xac thuc that bai")]
    public async Task UTC17_TemporarilyLockedAccount()
    {
        var owner = User("owner.dev", lockoutEnd: DateTimeOffset.UtcNow.AddMinutes(10));

        Assert.Null(await Verifier(owner, Roles.Owner).VerifyAsync(owner.Email!, Password, default));
    }

    // UTC18 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Two existing accounts share "shared.dev@example.invalid"
    // Đầu vào : loginIdentifier="shared.dev@example.invalid"; password=<correct password>
    // Mong đợi: Return: verification failed; no account is picked; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §3.2 User: login identifier must uniquely resolve one account
    [Fact(DisplayName = "UTC18 - Dinh danh trung 2 tai khoan: xac thuc that bai")]
    public async Task UTC18_IdentifierMustResolveOneAccount()
    {
        var first = User("shared.dev");
        var second = User("shared.dev");

        Assert.Null(await Verifier([(first, [Roles.Owner]), (second, [Roles.Staff])]).VerifyAsync("shared.dev@example.invalid", Password, default));
    }
}
