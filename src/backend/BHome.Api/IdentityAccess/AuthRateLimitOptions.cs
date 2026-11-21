namespace BHome.Api.IdentityAccess;

public sealed class AuthRateLimitOptions
{
    public int PermitLimit { get; set; } = 30;
    public int WindowSeconds { get; set; } = 60;
}
