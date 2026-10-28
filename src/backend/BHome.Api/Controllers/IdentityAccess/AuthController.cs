using System.ComponentModel.DataAnnotations;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Api.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

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
    public async Task<ActionResult<LoginResult>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        var session = await login.LoginAsync(request.Email, request.Password, cancellationToken, request.Device);
        return session is null
            ? Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed.")
            : Ok(Transport(session));
    }

    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResult>> Refresh(RefreshRequest request, CancellationToken cancellationToken)
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

    private LoginResult Transport(LoginResult result)
    {
        if (!AuthTransportFilter.IsWeb(Request)) return result;
        Response.Cookies.Append(AuthTransportFilter.CookieName, result.RefreshToken!, AuthTransportFilter.CookieOptions(result.SessionExpiresAt));
        return result with { RefreshToken = null };
    }

    private void ClearCookie() => Response.Cookies.Delete(AuthTransportFilter.CookieName, AuthTransportFilter.CookieOptions());

    private async Task<IActionResult> Revoke(bool allDevices, CancellationToken cancellationToken)
    {
        await sessions.RevokeAsync(UserId, SessionId, allDevices, cancellationToken);
        ClearCookie();
        return NoContent();
    }
}

public sealed record LoginRequest(
    [Required, EmailAddress, StringLength(LoginService.MaxEmailLength)] string? Email,
    [Required, StringLength(LoginService.MaxPasswordLength)] string? Password,
    [StringLength(256)] string? Device = null);

public sealed record RefreshRequest([StringLength(256)] string? RefreshToken = null);
public sealed record ChangePasswordRequest(
    [Required, StringLength(LoginService.MaxPasswordLength)] string? CurrentPassword,
    [Required, StringLength(LoginService.MaxPasswordLength, MinimumLength = 12)] string? NewPassword);
public sealed record ForgotPasswordRequest([Required, StringLength(LoginService.MaxUserNameLength)] string? UserName);
public sealed record ResetPasswordRequest(
    [Required, StringLength(LoginService.MaxUserNameLength)] string? UserName,
    [Required, StringLength(4096)] string? Token,
    [Required, StringLength(LoginService.MaxPasswordLength, MinimumLength = 12)] string? NewPassword);
