namespace BHome.Infrastructure.IdentityAccess;

public sealed class SessionOptions
{
    // Approved fixed-deadline policy: refresh never extends a session beyond its original deadline.
    public const int MaximumLifetimeDays = 7;
    public int RefreshTokenDays { get; set; } = 7;
    public int AbsoluteLifetimeDays { get; set; } = 7;
    public int PasswordResetMinutes { get; set; } = 15;
}
