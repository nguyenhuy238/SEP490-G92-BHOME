using System.IdentityModel.Tokens.Jwt;
using System.Text;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.IdentityAccess;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Unit test cho chức năng issueAccessToken (cấp quyền truy cập sau khi đăng nhập - UC-01).
// Kết quả mong đợi của MỌI test chỉ lấy từ SRS v1.3:
//   S3  UC-01 + GBR-01: người dùng vào chức năng theo đúng role; chỉ có Owner / Staff / Tenant
//   S7  NFR §2.3 Authentication: thao tác cần tài khoản đã xác thực
//       NFR §2.3 Authorization: server phải kiểm soát role
// SRS KHÔNG quy định thuật toán, thời hạn token hay cách xử lý role trùng nên không có test cho các điểm đó.
// Đồng hồ được giả lập bằng NSubstitute (TimeProvider).
public sealed class AccessTokenIssuerUnitTests
{
    private const string SigningKey = "unit-test-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    private static readonly DateTimeOffset Now = new(2026, 10, 28, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid UserId = Guid.Parse("00000000-0000-0000-0000-000000000101");
    private static readonly Guid SessionId = Guid.Parse("00000000-0000-0000-0000-000000000022");

    private static JwtTokenIssuer Issuer()
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(Now);
        return new JwtTokenIssuer(Options.Create(new JwtOptions { SigningKey = SigningKey }), clock);
    }

    private static string Issue(Guid userId, params string[] roles) =>
        Issuer().Issue(userId, roles, SessionId, "STAMP-0101", Now.AddDays(7)).Value;

    private static string[] RolesIn(string token) =>
        new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.Where(c => c.Type == "role").Select(c => c.Value).ToArray();

    // UTC19 (Normal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner U-0101 verified; role Owner
    // Đầu vào : userId=U-0101; roles=["Owner"]
    // Mong đợi: Return: access granted to U-0101 with role Owner only; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-01; GBR-01
    [Fact(DisplayName = "UTC19 - Nguoi dung da xac thuc: quyen truy cap dung nguoi dung va role")]
    public void UTC19_AccessIdentifiesUserAndRole()
    {
        var token = Issue(UserId, Roles.Owner);

        Assert.Equal(UserId.ToString(), new JwtSecurityTokenHandler().ReadJwtToken(token).Subject);
        Assert.Equal([Roles.Owner], RolesIn(token));
    }

    // UTC20 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: N/A
    // Đầu vào : userId=00000000-0000-0000-0000-000000000000; roles=["Owner"]
    // Mong đợi: Return: no access granted; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS NFR §2.3 Authentication
    [Fact(DisplayName = "UTC20 - Khong co nguoi dung hop le: khong cap quyen")]
    public void UTC20_NoUserNoAccess() => Assert.ThrowsAny<Exception>(() => Issue(Guid.Empty, Roles.Owner));

    // UTC21 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: N/A
    // Đầu vào : roles=["Administrator"]
    // Mong đợi: Return: no access granted; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-01; SRS NFR §2.3 Authorization
    [Fact(DisplayName = "UTC21 - Role ngoai GBR-01 (Administrator): khong cap quyen")]
    public void UTC21_RoleOutsideGbr01() => Assert.ThrowsAny<Exception>(() => Issue(UserId, "Administrator"));

    // UTC22 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: N/A
    // Đầu vào : roles=[]
    // Mong đợi: Return: no access granted; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-01; SRS NFR §2.3 Authorization
    [Fact(DisplayName = "UTC22 - Khong co role: khong cap quyen")]
    public void UTC22_NoRole() => Assert.ThrowsAny<Exception>(() => Issue(UserId));

    // UTC23 (Abnormal) - sheet "Login", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff U-0102 holds access with role Staff; the client changes the role to "Owner"
    // Đầu vào : Request sent with the modified access
    // Mong đợi: Return: rejected by the server; no Owner permission granted; Exception: N/A; Log Message: N/A
    // Căn cứ  : SRS NFR §2.3 Authorization; GBR-01
    [Fact(DisplayName = "UTC23 - Tu sua role Staff thanh Owner: server tu choi, khong nang quyen")]
    public void UTC23_TamperedRoleIsRejected()
    {
        var token = Issue(UserId, Roles.Staff);
        var parts = token.Split('.');
        var payload = Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(parts[1])).Replace("\"Staff\"", "\"Owner\"");
        var tampered = $"{parts[0]}.{Base64UrlEncoder.Encode(payload)}.{parts[2]}";
        Assert.Equal([Roles.Owner], RolesIn(tampered));

        var parameters = new TokenValidationParameters
        {
            ValidIssuer = "BHome",
            ValidAudience = "BHome.Clients",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
            ValidateLifetime = false
        };
        var handler = new JwtSecurityTokenHandler();
        handler.ValidateToken(token, parameters, out _);
        Assert.ThrowsAny<SecurityTokenException>(() => handler.ValidateToken(tampered, parameters, out _));
    }
}
