using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Unit test cho sheet "Session" (BHOME_Unit_Test_Document_v1.0.xlsx), UTC01-UTC12.
// Kết quả mong đợi lấy từ sheet, sheet viết theo SRS v1.3:
//   §2.1.1 Sign In / Sign Out, UC-01, UC-02, MSG02, MSG17, GBR-01/02, NFR §2.3 Authentication.
// Phụ thuộc bên ngoài (xác thực mật khẩu, cấp token, đồng hồ, transaction, audit) giả lập bằng NSubstitute.
// Kho phiên đăng nhập là bản giả lập trong bộ nhớ (InMemoryIdentityPersistence) để theo dõi phiên qua nhiều bước.
public sealed class SessionUnitTests
{
    private const string Password = "Valid@Pass2026";
    private static readonly DateTimeOffset Now = new(2026, 11, 6, 9, 0, 0, TimeSpan.Zero);

    private readonly InMemoryIdentityPersistence store = new();
    private readonly ICredentialVerifier credentials = Substitute.For<ICredentialVerifier>();
    private readonly ISecurityAudit audit = Substitute.For<ISecurityAudit>();
    private readonly IdentitySessionService sessions;

    public SessionUnitTests()
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(Now);
        var issuer = Substitute.For<IAccessTokenIssuer>();
        issuer.Issue(Arg.Any<Guid>(), Arg.Any<IReadOnlyCollection<string>>(), Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<DateTimeOffset>())
            .Returns(new AccessToken("access-token", Now.AddMinutes(30)));
        sessions = new IdentitySessionService(store, new IdentitySecurityStore(store, clock), issuer, Options.Create(new SessionOptions()), clock);
    }

    private LoginService SignIn() => new(credentials, sessions, audit);

    private ApplicationUser Account(string name, string role, bool active = true, string? phone = null)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(), UserName = name, Email = $"{name}@example.invalid", PhoneNumber = phone,
            SecurityStamp = $"STAMP-{name}", IsActive = active
        };
        store.Users[user.Id] = user;
        store.UserRoles[user.Id] = [role];
        return user;
    }

    // Tài khoản đã qua bước xác thực mật khẩu với định danh này.
    private void PasswordAccepted(string identifier, ApplicationUser user) =>
        credentials.VerifyAsync(identifier, Password, Arg.Any<CancellationToken>())
            .Returns(new VerifiedIdentity(user.Id, store.UserRoles[user.Id], user.SecurityStamp!));

    private async Task<LoginResult> SignedIn(ApplicationUser user)
    {
        PasswordAccepted(user.Email!, user);
        return (await SignIn().LoginAsync(user.Email!, Password))!;
    }

    private Task<bool> Validate(ApplicationUser user, Guid sessionId) =>
        sessions.ValidateAsync(new SessionIdentity(user.Id, sessionId, store.UserRoles[user.Id]), user.SecurityStamp!, default);

    // ---------------- signIn ----------------

    // UTC01 (Normal) - sheet "Session"
    // Điều kiện: staff.dev account Active; role Staff
    // Đầu vào : loginIdentifier=<registered email of staff.dev>; password=<correct password>
    // Mong đợi: Return: authenticated session created; user directed to role-appropriate Home screen (Staff Home); Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 Sign In; UC-01; Screen List #29 Staff Home; GBR-01
    [Fact(DisplayName = "Session UTC01 - Staff dang nhap bang email: tao phien, role Staff")]
    public async Task UTC01_StaffSignInCreatesSession()
    {
        var staff = Account("staff.dev", Roles.Staff);
        PasswordAccepted(staff.Email!, staff);

        var result = await SignIn().LoginAsync(staff.Email!, Password);

        Assert.NotNull(result);
        Assert.Equal([Roles.Staff], result.Roles);
        Assert.Contains(store.Sessions, s => s.Id == result.SessionId && s.UserId == staff.Id && s.RevokedAt is null);
    }

    // UTC02 (Normal) - sheet "Session"
    // Điều kiện: staff.dev account Active; role Staff; phone number registered
    // Đầu vào : loginIdentifier=<registered phone number of staff.dev>; password=<correct password>
    // Mong đợi: Return: authenticated session created; user directed to Staff Home; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 Login Identifier = registered email address or phone number; UC-01
    [Fact(DisplayName = "Session UTC02 - Staff dang nhap bang so dien thoai: tao phien, role Staff")]
    public async Task UTC02_StaffSignInWithPhoneCreatesSession()
    {
        var staff = Account("staff.dev", Roles.Staff, phone: "0912345678");
        PasswordAccepted("0912345678", staff);

        var result = await SignIn().LoginAsync("0912345678", Password);

        Assert.NotNull(result);
        Assert.Equal([Roles.Staff], result.Roles);
        Assert.Contains(store.Sessions, s => s.Id == result.SessionId && s.UserId == staff.Id);
    }

    // UTC03 (Normal) - sheet "Session"
    // Điều kiện: tenant.dev account Active; role Tenant
    // Đầu vào : loginIdentifier=<registered email of tenant.dev>; password=<correct password>
    // Mong đợi: Return: authenticated session created; user directed to role-appropriate Home screen (Tenant Home); Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 (role-appropriate Home screen); UC-01; Screen List #31 Tenant Home
    [Fact(DisplayName = "Session UTC03 - Tenant dang nhap bang email: tao phien, role Tenant")]
    public async Task UTC03_TenantSignInCreatesSession()
    {
        var tenant = Account("tenant.dev", Roles.Tenant);
        PasswordAccepted(tenant.Email!, tenant);

        var result = await SignIn().LoginAsync(tenant.Email!, Password);

        Assert.NotNull(result);
        Assert.Equal([Roles.Tenant], result.Roles);
        Assert.Contains(store.Sessions, s => s.Id == result.SessionId && s.UserId == tenant.Id);
    }

    // UTC04 (Abnormal) - sheet "Session"
    // Điều kiện: staff.dev account status Inactive (deactivated by Owner)
    // Đầu vào : loginIdentifier=<registered email of staff.dev>; password=<correct password>
    // Mong đợi: Return: sign-in rejected; no session created; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §2.1.1 Error Message (account unavailable); MSG17; Entity User status Active/Inactive; UC-08
    [Fact(DisplayName = "Session UTC04 - Tai khoan Inactive: tu choi, khong tao phien")]
    public async Task UTC04_InactiveAccountGetsNoSession()
    {
        var staff = Account("staff.dev", Roles.Staff, active: false);
        PasswordAccepted(staff.Email!, staff);

        Assert.Null(await SignIn().LoginAsync(staff.Email!, Password));
        Assert.Empty(store.Sessions);
    }

    // UTC05 (Abnormal) - sheet "Session"
    // Điều kiện: staff.dev account Active
    // Đầu vào : loginIdentifier=<registered email of staff.dev>; password=<wrong password>
    // Mong đợi: Return: sign-in rejected; no session created; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §2.1.1 Error Message (generic); MSG17
    [Fact(DisplayName = "Session UTC05 - Sai mat khau: tu choi, khong tao phien")]
    public async Task UTC05_WrongPasswordGetsNoSession()
    {
        var staff = Account("staff.dev", Roles.Staff);
        credentials.VerifyAsync(staff.Email!, "Wrong@Pass2026", Arg.Any<CancellationToken>()).Returns((VerifiedIdentity?)null);

        Assert.Null(await SignIn().LoginAsync(staff.Email!, "Wrong@Pass2026"));
        Assert.Empty(store.Sessions);
    }

    // UTC06 (Abnormal) - sheet "Session"
    // Điều kiện: No account uses this login identifier
    // Đầu vào : loginIdentifier=<unregistered email>; password=<any password>
    // Mong đợi: Return: sign-in rejected; no session created; same generic message as wrong password; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : SRS §2.1.1 Error Message (generic); MSG17; NFR §2.1 Clear errors (no sensitive information exposed)
    [Fact(DisplayName = "Session UTC06 - Dinh danh chua dang ky: tu choi giong sai mat khau, khong tao phien")]
    public async Task UTC06_UnknownIdentifierGetsNoSession()
    {
        credentials.VerifyAsync("ghost.dev@example.invalid", Password, Arg.Any<CancellationToken>()).Returns((VerifiedIdentity?)null);
        credentials.VerifyAsync("staff.dev@example.invalid", "Wrong@Pass2026", Arg.Any<CancellationToken>()).Returns((VerifiedIdentity?)null);
        Account("staff.dev", Roles.Staff);

        var unknown = await SignIn().LoginAsync("ghost.dev@example.invalid", Password);
        var wrongPassword = await SignIn().LoginAsync("staff.dev@example.invalid", "Wrong@Pass2026");

        Assert.Null(unknown);
        Assert.Equal(wrongPassword, unknown); // cùng một kết quả chung, không lộ tài khoản có tồn tại hay không
        Assert.Empty(store.Sessions);
    }

    // UTC07 (Abnormal) - sheet "Session"
    // Điều kiện: staff.dev account Active
    // Đầu vào : loginIdentifier=<registered email of staff.dev>; password=""
    // Mong đợi: Return: sign-in not submitted; no session created; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : SRS §2.1.1 Password field; MSG02 (required field)
    [Fact(DisplayName = "Session UTC07 - Thieu mat khau: khong dang nhap, khong tao phien")]
    public async Task UTC07_MissingPasswordGetsNoSession()
    {
        var staff = Account("staff.dev", Roles.Staff);

        Assert.Null(await SignIn().LoginAsync(staff.Email!, ""));
        await credentials.DidNotReceiveWithAnyArgs().VerifyAsync(default!, default!, default);
        Assert.Empty(store.Sessions);
    }

    // ---------------- validateSession ----------------

    // UTC08 (Normal) - sheet "Session"
    // Điều kiện: owner.dev signed in; session S-51 active
    // Đầu vào : identity=(U-0101, S-51, ["Owner"])
    // Mong đợi: Return: true (Owner may use functions allowed for the Owner role); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-01; NFR §2.3 Authentication/Authorization; GBR-01, GBR-02
    [Fact(DisplayName = "Session UTC08 - Phien dang hoat dong: hop le")]
    public async Task UTC08_ActiveSessionIsValid()
    {
        var owner = Account("owner.dev", Roles.Owner);
        var session = await SignedIn(owner);

        Assert.True(await Validate(owner, session.SessionId));
    }

    // UTC09 (Abnormal) - sheet "Session"
    // Điều kiện: owner.dev has signed out of session S-51
    // Đầu vào : identity=(U-0101, S-51, ["Owner"])
    // Mong đợi: Return: false (terminated session cannot access protected functions); Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 (Sign Out securely terminates the current authenticated session); UC-02; NFR §2.3 Authentication
    [Fact(DisplayName = "Session UTC09 - Phien da dang xuat: khong hop le")]
    public async Task UTC09_SignedOutSessionIsInvalid()
    {
        var owner = Account("owner.dev", Roles.Owner);
        var session = await SignedIn(owner);
        await sessions.RevokeAsync(owner.Id, session.SessionId, allDevices: false, default);

        Assert.False(await Validate(owner, session.SessionId));
    }

    // UTC10 (Abnormal) - sheet "Session"
    // Điều kiện: Session S-99 was never created by Sign In (unauthenticated request)
    // Đầu vào : identity=(U-0101, S-99, ["Owner"])
    // Mong đợi: Return: false (same for Staff and Tenant roles); Exception: N/A; Log Message: N/A
    // Căn cứ  : NFR §2.3 Authentication (all operations require authenticated accounts except approved public information)
    [Theory(DisplayName = "Session UTC10 - Phien chua tung dang nhap: khong hop le voi moi role")]
    [InlineData(Roles.Owner)]
    [InlineData(Roles.Staff)]
    [InlineData(Roles.Tenant)]
    public async Task UTC10_UnknownSessionIsInvalid(string role)
    {
        var user = Account($"{role.ToLowerInvariant()}.dev", role);

        Assert.False(await Validate(user, Guid.NewGuid()));
    }

    // ---------------- signOut ----------------

    // UTC11 (Normal) - sheet "Session"
    // Điều kiện: owner.dev signed in on two devices; sessions S-31 (current) and S-32 active
    // Đầu vào : userId=U-0101; sessionId=S-31
    // Mong đợi: Return: current session S-31 terminated; S-32 remains active; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS §2.1.1 (Sign Out terminates the current authenticated session); UC-02
    [Fact(DisplayName = "Session UTC11 - Dang xuat: chi ket thuc phien hien tai, phien thiet bi khac van hoat dong")]
    public async Task UTC11_SignOutEndsOnlyCurrentSession()
    {
        var owner = Account("owner.dev", Roles.Owner);
        var current = await SignedIn(owner);
        var otherDevice = await SignedIn(owner);

        await sessions.RevokeAsync(owner.Id, current.SessionId, allDevices: false, default);

        Assert.False(await Validate(owner, current.SessionId));
        Assert.True(await Validate(owner, otherDevice.SessionId));
    }

    // UTC12 (Abnormal) - sheet "Session"
    // Điều kiện: Session S-41 belongs to staff.dev (U-0102)
    // Đầu vào : userId=U-0101; sessionId=S-41
    // Mong đợi: Return: S-41 not terminated (a user ends only their own current session); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-02 (users end their current session); Permission Matrix §4.4 Account = own account; GBR-02
    [Fact(DisplayName = "Session UTC12 - Dang xuat phien cua nguoi khac: phien do khong bi ket thuc")]
    public async Task UTC12_CannotSignOutAnotherUsersSession()
    {
        var owner = Account("owner.dev", Roles.Owner);
        var staff = Account("staff.dev", Roles.Staff);
        var staffSession = await SignedIn(staff);

        await sessions.RevokeAsync(owner.Id, staffSession.SessionId, allDevices: false, default);

        Assert.True(await Validate(staff, staffSession.SessionId));
    }
}

// Kho phiên đăng nhập trong bộ nhớ, mô phỏng phần lưu trữ của BHOME:
// phiên chỉ hợp lệ khi đúng người dùng, chưa đăng xuất, chưa hết hạn và tài khoản còn hoạt động.
internal sealed class InMemoryIdentityPersistence : IIdentityPersistence
{
    public Dictionary<Guid, ApplicationUser> Users { get; } = [];
    public Dictionary<Guid, string[]> UserRoles { get; } = [];
    public List<AuthenticationSession> Sessions { get; } = [];
    public List<RefreshTokenRecord> Tokens { get; } = [];
    public List<SecurityAuditRecord> AuditLog { get; } = [];

    public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken token) => Task.FromResult(Substitute.For<IDbContextTransaction>());
    public Task<int> SaveChangesAsync(CancellationToken token) => Task.FromResult(0);
    public Task<ApplicationUser?> LockUserAsync(Guid userId, CancellationToken token) => Task.FromResult(Users.GetValueOrDefault(userId));
    public Task<string[]> RolesAsync(Guid userId, CancellationToken token) => Task.FromResult(UserRoles.GetValueOrDefault(userId) ?? []);
    public void Audit(SecurityAuditRecord record) => AuditLog.Add(record);
    public Task RevokeAllAsync(Guid userId, string reason, DateTimeOffset now, CancellationToken token)
    {
        foreach (var s in Sessions.Where(s => s.UserId == userId && s.RevokedAt is null)) { s.RevokedAt = now; s.RevocationReason = reason; }
        return Task.CompletedTask;
    }
    public Task<AuthenticationSession?> SessionAsync(Guid id, Guid? userId, CancellationToken token) =>
        Task.FromResult(Sessions.FirstOrDefault(s => s.Id == id && (userId is null || s.UserId == userId)));
    public void AddSession(AuthenticationSession session) => Sessions.Add(session);
    public void AddToken(RefreshTokenRecord refresh) => Tokens.Add(refresh);
    public Guid IssuedTokenId(string hash) => Tokens.First(t => t.TokenHash == hash).Id;
    public Task<bool> ValidSessionAsync(SessionIdentity identity, string stamp, DateTimeOffset now, CancellationToken token) =>
        Task.FromResult(Sessions.Any(s => s.Id == identity.SessionId && s.UserId == identity.UserId && s.RevokedAt is null &&
            s.ExpiresAt > now && s.SecurityStamp == stamp && Users.TryGetValue(s.UserId, out var u) && u.IsActive && u.SecurityStamp == stamp));
    public Task<int> TouchSessionAsync(Guid id, DateTimeOffset now, CancellationToken token)
    {
        var session = Sessions.FirstOrDefault(s => s.Id == id && s.RevokedAt is null);
        if (session is null) return Task.FromResult(0);
        session.LastActivityAt = now;
        return Task.FromResult(1);
    }
    public Task<bool> CurrentSessionAsync(Guid userId, Guid sessionId, string? stamp, DateTimeOffset now, CancellationToken token) =>
        Task.FromResult(Sessions.Any(s => s.Id == sessionId && s.UserId == userId && s.RevokedAt is null && s.ExpiresAt > now));
    public Task<Guid?> TokenOwnerAsync(string hash, CancellationToken token) => throw new NotSupportedException("Không dùng trong sheet Session.");
    public Task<RefreshTokenRecord> TokenAsync(string hash, CancellationToken token) => throw new NotSupportedException("Không dùng trong sheet Session.");
    public Task<PasswordResetGrant?> ResetGrantAsync(Guid userId, CancellationToken token) => throw new NotSupportedException("Không dùng trong sheet Session.");
    public void AddResetGrant(PasswordResetGrant grant) => throw new NotSupportedException("Không dùng trong sheet Session.");
    public Task ConsumeResetGrantsAsync(Guid userId, DateTimeOffset now, CancellationToken token) => throw new NotSupportedException("Không dùng trong sheet Session.");
}
