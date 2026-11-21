using System.ComponentModel.DataAnnotations;
using BHome.Api.IdentityAccess;
using BHome.Application.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BHome.Api.Controllers.IdentityAccess;

[ApiController]
[Route("api/v1/auth")]
[AllowAnonymous]
[ServiceFilter(typeof(AuthTransportFilter), Order = int.MinValue)]
[RequestSizeLimit(16 * 1024)]
[EnableRateLimiting("Auth")]
public sealed class EmailVerificationController(IEmailVerification verification) : ControllerBase
{
    [HttpPost("request-email-verification")]
    public async Task<IActionResult> RequestVerification(ForgotPasswordRequest request, CancellationToken t)
    {
        Response.Headers.CacheControl = "no-store";
        await verification.RequestAsync(request.UserName!, t);
        return Accepted(new { message = "Nếu tài khoản đủ điều kiện, hướng dẫn xác nhận email sẽ được gửi." });
    }

    [HttpPost("confirm-email")]
    public async Task<IActionResult> Confirm(ConfirmEmailRequest request, CancellationToken t)
    {
        Response.Headers.CacheControl = "no-store";
        return await verification.ConfirmAsync(request.UserName!, request.Token!, t)
            ? NoContent() : Problem(statusCode: 400, title: "Email confirmation failed.");
    }
}

public sealed record ConfirmEmailRequest(
    [Required, StringLength(LoginService.MaxUserNameLength)] string? UserName,
    [Required, StringLength(4096)] string? Token);
