using System.ComponentModel.DataAnnotations;
using BHome.Application.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.Api.Controllers.IdentityAccess;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(LoginService login) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    [RequestSizeLimit(16 * 1024)]
    public async Task<ActionResult<LoginResult>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        var session = await login.LoginAsync(request.UserName, request.Password, cancellationToken);
        return session is null
            ? Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Sign-in failed.")
            : Ok(session);
    }
}

public sealed record LoginRequest(
    [Required, StringLength(LoginService.MaxUserNameLength)] string? UserName,
    [Required, StringLength(LoginService.MaxPasswordLength)] string? Password);
