namespace BHome.Application.IdentityAccess;

public sealed class SmsRecoveryOptions
{
    public bool Enabled { get; set; }
    public string HashKey { get; set; } = "";
    public int OtpMinutes { get; set; } = 5;
    public int MaxAttempts { get; set; } = 5;
    public int ResendCooldownSeconds { get; set; } = 60;
    public int AuthorizationMinutes { get; set; } = 5;
    public int WindowMinutes { get; set; } = 60;
    public int MaxAccountRequests { get; set; } = 5;
    public int MaxPhoneRequests { get; set; } = 5;
    public int MaxIpRequests { get; set; } = 20;
    public bool Valid()
    {
        if (OtpMinutes is < 1 or > 10 || MaxAttempts is < 1 or > 10 || ResendCooldownSeconds is < 30 or > 3600 ||
            AuthorizationMinutes is < 1 or > 10 || WindowMinutes is < 1 or > 1440 || MaxAccountRequests is < 1 or > 20 ||
            MaxPhoneRequests is < 1 or > 20 || MaxIpRequests is < 1 or > 200) return false;
        if (!Enabled) return true;
        try { return Convert.FromBase64String(HashKey).Length >= 32; } catch (FormatException) { return false; }
    }
}
public sealed record SmsRecoveryRequested(Guid ChallengeId, int RetryAfterSeconds, int ExpiresInSeconds);
public sealed record SmsRecoveryVerified(string Authorization, int ExpiresInSeconds)
{ public override string ToString() => "SMS recovery authorization (redacted)"; }
public interface ISmsPasswordRecovery
{
    Task<SmsRecoveryRequested> RequestAsync(string identifier, string requesterIp, CancellationToken t);
    Task<SmsRecoveryVerified?> VerifyAsync(string identifier, Guid challengeId, string otp, CancellationToken t);
    Task<bool> ResetAsync(string identifier, Guid challengeId, string authorization, string newPassword, CancellationToken t);
}
