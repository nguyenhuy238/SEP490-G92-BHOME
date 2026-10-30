namespace BHome.Infrastructure.IdentityAccess;

public sealed class JwtOptions
{
    public const string Section = "Jwt";
    public string Issuer { get; set; } = "BHome";
    public string Audience { get; set; } = "BHome.Clients";
    public string SigningKey { get; set; } = "";
    public int LifetimeMinutes { get; set; } = 30;
}
