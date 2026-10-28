namespace BHome.Infrastructure.IdentityAccess;

public sealed class SessionOptions
{
    public int RefreshTokenDays { get; set; } = 7;
    public int AbsoluteLifetimeDays { get; set; } = 7;
    public int PasswordResetMinutes { get; set; } = 15;
}
