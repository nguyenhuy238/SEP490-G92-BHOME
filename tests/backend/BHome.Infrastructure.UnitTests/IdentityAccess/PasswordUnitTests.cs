using System.Collections.Concurrent;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Unit test cho chức năng protectPassword - sheet "Password", BHOME_Unit_Test_Document_v1.0.xlsx.
// Kết quả mong đợi lấy từ sheet (căn cứ SRS v1.3):
//   NFR §2.3 Password Protection: mật khẩu không bao giờ được lưu hoặc ghi log ở dạng đọc được (plaintext)
//   SRS §2.1.1 Sign In + MSG17: sai mật khẩu -> thông báo chung
// Code chỉ dùng để biết cách gọi hàm. Thành phần chạy thật: UserManager + PasswordHasher mặc định của ASP.NET Identity,
// SignInManager, IdentityCredentialVerifier, LoginService. Kho tài khoản là bản trong bộ nhớ (InMemoryUserStore);
// phiên đăng nhập và audit giả lập bằng NSubstitute; mọi log được thu lại bằng CapturingLoggerProvider.
// "Log hoặc audit record" được kiểm tra bằng cách: gom toàn bộ log của Identity + toàn bộ tham số các lần gọi audit
// và tạo phiên, rồi khẳng định không chỗ nào chứa nguyên văn mật khẩu.
public sealed class PasswordUnitTests
{
    private const string CorrectPassword = "Valid@Pass2026";
    private const string WrongPassword = "Wrong@Pass2026";
    private const string StaffEmail = "staff.dev@example.invalid";

    private readonly InMemoryUserStore store = new();
    private readonly CapturingLoggerProvider logs = new();
    private readonly IAuthenticationSessions sessions = Substitute.For<IAuthenticationSessions>();
    private readonly ISecurityAudit audit = Substitute.For<ISecurityAudit>();
    private readonly UserManager<ApplicationUser> users;
    private readonly SignInManager<ApplicationUser> signIn;

    public PasswordUnitTests()
    {
        var options = Options.Create(new IdentityOptions());
        var factory = LoggerFactory.Create(builder => builder.AddProvider(logs).SetMinimumLevel(LogLevel.Trace));
        users = new UserManager<ApplicationUser>(store, options, new PasswordHasher<ApplicationUser>(), [], [],
            new UpperInvariantLookupNormalizer(), new IdentityErrorDescriber(), Substitute.For<IServiceProvider>(),
            factory.CreateLogger<UserManager<ApplicationUser>>());
        signIn = new SignInManager<ApplicationUser>(users, Substitute.For<IHttpContextAccessor>(),
            Substitute.For<IUserClaimsPrincipalFactory<ApplicationUser>>(), options, factory.CreateLogger<SignInManager<ApplicationUser>>(),
            Substitute.For<IAuthenticationSchemeProvider>(), Substitute.For<IUserConfirmation<ApplicationUser>>());
        sessions.CreateAsync(Arg.Any<VerifiedIdentity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>()).Returns(call =>
        {
            var identity = call.Arg<VerifiedIdentity>();
            return new LoginResult(identity.UserId, identity.Roles, "access-token", DateTimeOffset.UtcNow.AddMinutes(30),
                Guid.NewGuid(), "refresh-token", DateTimeOffset.UtcNow.AddDays(7));
        });
    }

    // Điều kiện chung: staff.dev Active, role Staff, mật khẩu được đặt = <correct password> qua Identity thật.
    private async Task<ApplicationUser> StaffDevWithPassword()
    {
        var staff = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = "staff.dev",
            Email = StaffEmail,
            IsActive = true,
            LockoutEnabled = true
        };
        var created = await users.CreateAsync(staff, CorrectPassword);
        Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
        store.Roles[staff.Id] = [Roles.Staff];
        logs.Clear();
        return staff;
    }

    private LoginService Login() => new(new IdentityCredentialVerifier(users, signIn), sessions, audit);

    // Mọi nội dung đã ghi ra: log của Identity + tham số của mọi lần gọi audit và tạo phiên.
    private IEnumerable<string> EverythingRecorded() =>
        logs.Messages.Concat(audit.ReceivedCalls().Concat(sessions.ReceivedCalls())
            .Select(call => $"{call.GetMethodInfo().Name}({string.Join(", ", call.GetArguments().Select(a => a?.ToString()))})"));

    private void AssertNotRecorded(string password) =>
        Assert.All(EverythingRecorded(), entry => Assert.DoesNotContain(password, entry, StringComparison.Ordinal));

    // UTC01 (Normal) - sheet "Password", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff.dev account Active with password set to <correct password>
    // Đầu vào : stored credential of staff.dev
    // Mong đợi: Return: stored password value is not <correct password> in readable plaintext; Exception: N/A; Log Message: N/A
    // Căn cứ  : NFR §2.3 Password Protection (passwords never stored in readable plaintext)
    [Fact(DisplayName = "Password UTC01 - Mat khau luu tru khong o dang plaintext")]
    public async Task UTC01_StoredPasswordIsNotPlaintext()
    {
        var staff = await StaffDevWithPassword();

        var stored = (await store.FindByIdAsync(staff.Id.ToString(), default))!.PasswordHash;

        Assert.False(string.IsNullOrEmpty(stored));
        Assert.NotEqual(CorrectPassword, stored);
        Assert.DoesNotContain(CorrectPassword, stored, StringComparison.Ordinal);
    }

    // UTC02 (Normal) - sheet "Password", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff.dev account Active
    // Đầu vào : loginIdentifier=<registered email of staff.dev>; password=<correct password>
    // Mong đợi: Return: sign-in succeeds; no log or audit record written for this sign-in contains <correct password> in readable plaintext; Exception: N/A; Log Message: N/A
    // Căn cứ  : NFR §2.3 Password Protection (never logged in readable plaintext); SRS §2.1.1
    [Fact(DisplayName = "Password UTC02 - Dang nhap dung: thanh cong, log/audit khong chua mat khau")]
    public async Task UTC02_CorrectPasswordIsNotLogged()
    {
        var staff = await StaffDevWithPassword();

        var result = await Login().LoginAsync(StaffEmail, CorrectPassword);

        Assert.NotNull(result);
        Assert.Equal(staff.Id, result.UserId);
        AssertNotRecorded(CorrectPassword);
    }

    // UTC03 (Abnormal) - sheet "Password", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: staff.dev account Active
    // Đầu vào : loginIdentifier=<registered email of staff.dev>; password=<wrong password>
    // Mong đợi: Return: sign-in rejected; no log or audit record contains <wrong password> in readable plaintext; Exception: N/A; Log Message: "Incorrect login information or account unavailable. Please try again."
    // Căn cứ  : NFR §2.3 Password Protection; SRS §2.1.1 Error Message; MSG17
    // Ghi chú : câu thông báo MSG17 do tầng API trả về; ở tầng này kiểm tra đăng nhập bị từ chối + không tạo phiên.
    [Fact(DisplayName = "Password UTC03 - Sai mat khau: bi tu choi, log/audit khong chua mat khau sai")]
    public async Task UTC03_WrongPasswordIsNotLogged()
    {
        await StaffDevWithPassword();

        var result = await Login().LoginAsync(StaffEmail, WrongPassword);

        Assert.Null(result);
        await sessions.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
        AssertNotRecorded(WrongPassword);
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> messages = new();
        public IEnumerable<string> Messages => messages;
        public void Clear() => messages.Clear();
        public ILogger CreateLogger(string categoryName) => new Logger(messages);
        public void Dispose() { }

        private sealed class Logger(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                messages.Enqueue($"{formatter(state, exception)} {state} {exception}");
        }
    }
}
