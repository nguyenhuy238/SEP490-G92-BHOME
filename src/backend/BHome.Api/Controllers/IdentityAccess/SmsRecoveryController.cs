using System.ComponentModel.DataAnnotations;
using BHome.Api.IdentityAccess;
using BHome.Application.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers.IdentityAccess;

[ApiController, Route("api/v1/auth/sms-recovery"), AllowAnonymous, EnableRateLimiting("Auth")]
[ServiceFilter(typeof(AuthTransportFilter), Order = int.MinValue), RequestSizeLimit(16 * 1024)]
public sealed class SmsRecoveryController(ISmsPasswordRecovery recovery) : ControllerBase
{
    private void PrivateResponse() { Response.Headers.CacheControl = "no-store"; Response.Headers.Pragma = "no-cache"; }
    [HttpPost("request")]
    public async Task<IActionResult> RequestOtp(SmsRecoveryRequest input, CancellationToken t)
    { PrivateResponse(); return Accepted(await recovery.RequestAsync(input.Identifier, HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown", t)); }
    [HttpPost("verify")]
    public async Task<IActionResult> Verify(SmsRecoveryVerify input, CancellationToken t)
    {
        PrivateResponse(); var result = await recovery.VerifyAsync(input.Identifier, input.ChallengeId, input.Otp, t);
        return result is null ? Problem(statusCode: 400, title: "Mã xác minh không hợp lệ hoặc đã hết hạn.") : Ok(result);
    }
    [HttpPost("reset")]
    public async Task<IActionResult> Reset(SmsRecoveryReset input, CancellationToken t)
    {
        PrivateResponse();
        if (input.NewPassword != input.ConfirmPassword) return Problem(statusCode: 400, title: "Mật khẩu xác nhận không khớp.");
        if (!await recovery.ResetAsync(input.Identifier, input.ChallengeId, input.Authorization, input.NewPassword, t))
            return Problem(statusCode: 400, title: "Không thể đặt lại mật khẩu. Kiểm tra mã xác minh và yêu cầu mật khẩu.");
        Response.Cookies.Delete(AuthTransportFilter.CookieName, AuthTransportFilter.CookieOptions()); return NoContent();
    }
}
public sealed record SmsRecoveryRequest([Required, StringLength(LoginService.MaxUserNameLength)] string Identifier);
public sealed record SmsRecoveryVerify([Required, StringLength(LoginService.MaxUserNameLength)] string Identifier,
    Guid ChallengeId, [Required, RegularExpression("^[0-9]{6}$")] string Otp)
{ public override string ToString() => "SMS verification (redacted)"; }
public sealed record SmsRecoveryReset([Required, StringLength(LoginService.MaxUserNameLength)] string Identifier, Guid ChallengeId,
    [Required, StringLength(256)] string Authorization,
    [Required, StringLength(LoginService.MaxPasswordLength, MinimumLength = 12)] string NewPassword,
    [Required, StringLength(LoginService.MaxPasswordLength)] string ConfirmPassword)
{ public override string ToString() => "SMS password reset (redacted)"; }
