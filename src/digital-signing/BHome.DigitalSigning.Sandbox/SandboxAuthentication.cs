using System.Security.Claims;
using System.Text.Encodings.Web;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace BHome.DigitalSigning.Sandbox;

// Demo sign-in: the page sends X-Demo-User (owner | staff | tenant) and is that fixed user. No password, no JWT:
// this only exists so the team can try signing before BHome's real login is wired in.
internal sealed class DemoAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Demo";
    public const string Header = "X-Demo-User";

    public static readonly IReadOnlyDictionary<string, (Guid Id, string Role)> Users = new Dictionary<string, (Guid, string)>
    {
        ["owner"] = (Guid.Parse("11111111-1111-1111-1111-111111111111"), Roles.Owner),
        ["staff"] = (Guid.Parse("22222222-2222-2222-2222-222222222222"), Roles.Staff),
        ["tenant"] = (Guid.Parse("33333333-3333-3333-3333-333333333333"), Roles.Tenant)
    };

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var name = Request.Headers[Header].ToString().Trim().ToLowerInvariant();
        if (!Users.TryGetValue(name, out var user)) return Task.FromResult(AuthenticateResult.NoResult());
        var identity = new ClaimsIdentity([new Claim("sub", user.Id.ToString()), new Claim("role", user.Role)],
            SchemeName, "sub", "role");
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}

internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? UserId => Guid.TryParse(accessor.HttpContext?.User.FindFirst("sub")?.Value, out var id) ? id : null;
    public bool IsInRole(string role) => accessor.HttpContext?.User.IsInRole(role) == true;
}
