namespace BHome.Infrastructure.IdentityAccess;

public sealed class AuthenticationEmailOptions
{
    public string WebResetUrl { get; set; } = "";
    public string MobileResetUrl { get; set; } = "";
    public string WebInvitationUrl { get; set; } = "";
    public string MobileInvitationUrl { get; set; } = "";
    public string WebVerificationUrl { get; set; } = "";
    public string MobileVerificationUrl { get; set; } = "";
    public string[] TrustedOrigins { get; set; } = [];
    public int ResendCooldownSeconds { get; set; } = 60;

    public bool Trusted(string value, bool development) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
        (uri.Scheme == "https" || development && uri.Scheme == "http" && uri.IsLoopback ||
            uri.Scheme == "bhome" && uri.Host is "reset-password" or "accept-invitation" or "confirm-email" && uri.AbsolutePath is "" or "/") &&
        TrustedOrigins.Contains(uri.GetLeftPart(UriPartial.Authority), StringComparer.OrdinalIgnoreCase);

    public bool Configured(bool development) => ResendCooldownSeconds is >= 30 and <= 3600 &&
        new[] { WebResetUrl, MobileResetUrl, WebInvitationUrl, MobileInvitationUrl }.All(u => Trusted(u, development));

    public bool VerificationConfigured(bool development) => Configured(development) &&
        new[] { WebVerificationUrl, MobileVerificationUrl }.All(u => Trusted(u, development));
}
