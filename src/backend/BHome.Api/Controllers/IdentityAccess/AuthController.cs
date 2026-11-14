using System.ComponentModel.DataAnnotations;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Api.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json.Serialization;

namespace BHome.Api.Controllers.IdentityAccess;

[ApiController]
[Route("api/v1/auth")]
[ServiceFilter(typeof(AuthTransportFilter), Order = int.MinValue)]
[RequestSizeLimit(16 * 1024)]
[EnableRateLimiting("Auth")]
public sealed class AuthController(LoginService login, IAuthenticationSessions sessions, IPasswordService passwords) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    [RequestSizeLimit(16 * 1024)]
    public async Task<ActionResult<AuthTokenResponse>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        var session = await login.LoginAsync(request.Phone ?? request.Email, request.Password, cancellationToken, request.Device);
        return session is null
            ? Problem(statusCode: StatusCodes.Status401Unauthorized, title: LoginService.InvalidCredentialsMessage)
            : Ok(Transport(session));
    }

    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthTokenResponse>> Refresh(RefreshRequest request, CancellationToken cancellationToken)
    {
        var token = AuthTransportFilter.IsWeb(Request) ? Request.Cookies[AuthTransportFilter.CookieName] : request.RefreshToken;
        var result = string.IsNullOrWhiteSpace(token) ? null : await sessions.RefreshAsync(token, cancellationToken);
        if (result is not null) return Ok(Transport(result));
        ClearCookie();
        return Problem(statusCode: 401, title: "Session is unavailable.");
    }

    [HttpPost("logout")]
    [Authorize(Policy = Permissions.Sessions.RevokeOwn)]
    public Task<IActionResult> Logout(CancellationToken cancellationToken) => Revoke(false, cancellationToken);

    [HttpPost("logout-all")]
    [Authorize(Policy = Permissions.Sessions.RevokeOwn)]
    public Task<IActionResult> LogoutAll(CancellationToken cancellationToken) => Revoke(true, cancellationToken);

    [HttpGet("me")]
    [Authorize(Policy = Permissions.Account.ViewOwn)]
    public ActionResult<SessionIdentity> Me() => Ok(new SessionIdentity(UserId, SessionId, User.FindAll("role").Select(x => x.Value).ToArray()));

    [HttpPost("change-password")]
    [Authorize(Policy = Permissions.Account.ChangePassword)]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        if (!await passwords.ChangeAsync(UserId, SessionId, request.CurrentPassword!, request.NewPassword!, cancellationToken))
            return Problem(statusCode: 400, title: "Password change failed.");
        ClearCookie();
        return NoContent();
    }

    [HttpPost("forgot-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        await passwords.RequestResetAsync(request.UserName!, cancellationToken);
        return Accepted(new { message = "Nếu tài khoản đủ điều kiện, hướng dẫn đặt lại mật khẩu sẽ được gửi." });
    }

    [HttpPost("reset-password")]
    [AllowAnonymous]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        if (!await passwords.ResetAsync(request.UserName!, request.Token!, request.NewPassword!, cancellationToken))
            return Problem(statusCode: 400, title: "Password reset failed.");
        ClearCookie();
        return NoContent();
    }

    private Guid UserId => Guid.Parse(User.FindFirst("sub")!.Value);
    private Guid SessionId => Guid.Parse(User.FindFirst("sid")!.Value);

    private AuthTokenResponse Transport(LoginResult result)
    {
        if (!AuthTransportFilter.IsWeb(Request)) return new AuthTokenResponse(result.AccessToken, result.RefreshToken);
        Response.Cookies.Append(AuthTransportFilter.CookieName, result.RefreshToken!, AuthTransportFilter.CookieOptions(result.SessionExpiresAt));
        return new AuthTokenResponse(result.AccessToken);
    }

    private void ClearCookie() => Response.Cookies.Delete(AuthTransportFilter.CookieName, AuthTransportFilter.CookieOptions());

    private async Task<IActionResult> Revoke(bool allDevices, CancellationToken cancellationToken)
    {
        await sessions.RevokeAsync(UserId, SessionId, allDevices, cancellationToken);
        ClearCookie();
        return NoContent();
    }
}

public sealed record LoginRequest(string? Email, string? Phone, string? Password, string? Device = null) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        var email = !string.IsNullOrWhiteSpace(Email);
        var phone = !string.IsNullOrWhiteSpace(Phone);
        if (!email && !phone) yield return new("Vui lòng nhập email hoặc số điện thoại.", ["identifier"]);
        if (email && phone) yield return new("Chỉ nhập email hoặc số điện thoại.", ["identifier"]);
        if (email && (Email!.Length > LoginService.MaxEmailLength || !LoginIdentifier.IsEmail(Email.Trim())))
            yield return new("Email không đúng định dạng.", ["email"]);
        if (phone && LoginIdentifier.NormalizePhone(Phone) is null)
            yield return new("Số điện thoại không đúng định dạng.", ["phone"]);
        if (string.IsNullOrWhiteSpace(Password)) yield return new("Vui lòng nhập mật khẩu.", ["password"]);
        else if (Password.Length > LoginService.MaxPasswordLength) yield return new("Mật khẩu vượt quá độ dài cho phép.", ["password"]);
        if (Device?.Length > 256) yield return new("Thông tin thiết bị vượt quá độ dài cho phép.", ["device"]);
    }
}

public sealed record RefreshRequest([StringLength(256)] string? RefreshToken = null);
public sealed record AuthTokenResponse(
    string AccessToken,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? RefreshToken = null);
public sealed record ChangePasswordRequest(
    [Required, StringLength(LoginService.MaxPasswordLength)] string? CurrentPassword,
    [Required, StringLength(LoginService.MaxPasswordLength, MinimumLength = 12)] string? NewPassword);
public sealed record ForgotPasswordRequest([Required, StringLength(LoginService.MaxUserNameLength)] string? UserName);
public sealed record ResetPasswordRequest(
    [Required, StringLength(LoginService.MaxUserNameLength)] string? UserName,
    [Required, StringLength(4096)] string? Token,
    [Required, StringLength(LoginService.MaxPasswordLength, MinimumLength = 12)] string? NewPassword);
