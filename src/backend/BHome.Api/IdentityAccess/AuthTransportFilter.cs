using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace BHome.Api.IdentityAccess;

// Cookie refresh is opt-in. Custom header + exact Origin checking applies before action execution.
public sealed class AuthTransportFilter(IConfiguration configuration) : IAsyncActionFilter
{
    public const string CookieName = "__Secure-bhome-refresh";
    public static bool IsWeb(HttpRequest request) => request.Headers["X-BHome-Client"] == "web";

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        if (!HttpMethods.IsGet(request.Method))
        {
            var web = IsWeb(request);
            if (request.Headers.ContainsKey("X-BHome-Client") && !web)
            {
                context.Result = new BadRequestResult();
                return;
            }
            if (web || request.Cookies.ContainsKey(CookieName))
            {
                var origin = request.Headers.Origin.ToString();
                var allowed = configuration.GetSection("AuthWeb:AllowedOrigins").Get<string[]>() ?? [];
                var sameOrigin = $"{request.Scheme}://{request.Host}";
                if (!web || string.IsNullOrEmpty(origin) ||
                    (!string.Equals(origin, sameOrigin, StringComparison.Ordinal) && !allowed.Contains(origin, StringComparer.Ordinal)))
                {
                    context.Result = new ObjectResult(new ProblemDetails { Status = 403, Title = "Request origin is not permitted." }) { StatusCode = 403 };
                    return;
                }
            }
        }
        await next();
    }

    public static CookieOptions CookieOptions(DateTimeOffset? expires = null) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Path = "/api/v1/auth",
        Expires = expires,
        IsEssential = true
    };
}
