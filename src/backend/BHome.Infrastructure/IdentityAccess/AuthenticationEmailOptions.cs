namespace BHome.Infrastructure.IdentityAccess;

public sealed class AuthenticationEmailOptions
{
    public string WebResetUrl { get; set; } = "";
    public string MobileResetUrl { get; set; } = "";
    public string WebInvitationUrl { get; set; } = "";
    public string MobileInvitationUrl { get; set; } = "";
    public string WebVerificationUrl { get; set; } = "";
    public string MobileVerificationUrl { get; set; } = "";
    // Login entry point for Staff assignment emails (e.g. the deployed Staff app URL).
    public string StaffPortalUrl { get; set; } = "";
    public string[] TrustedOrigins { get; set; } = [];
    public int ResendCooldownSeconds { get; set; } = 60;

    public bool Trusted(string value, bool development) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        (development || !uri.IsLoopback) &&
        string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
        (uri.Scheme == "https" || development && uri.Scheme == "http" && uri.IsLoopback ||
            uri.Scheme == "bhome" && uri.Host is "reset-password" or "accept-invitation" or "confirm-email" && uri.AbsolutePath is "" or "/") &&
        TrustedOrigins.Contains(uri.GetLeftPart(UriPartial.Authority), StringComparer.OrdinalIgnoreCase);

    public bool PasswordResetConfigured(bool development) => CallbacksConfigured(WebResetUrl, MobileResetUrl, development);

    public bool InvitationConfigured(bool development) => CallbacksConfigured(WebInvitationUrl, MobileInvitationUrl, development);

    public bool VerificationConfigured(bool development) => CallbacksConfigured(WebVerificationUrl, MobileVerificationUrl, development);

    public bool Configured(bool development) => PasswordResetConfigured(development) && InvitationConfigured(development);

    public bool AnyConfigured(bool development) => PasswordResetConfigured(development) ||
        InvitationConfigured(development) || VerificationConfigured(development);

    private bool CallbacksConfigured(string web, string mobile, bool development) =>
        ResendCooldownSeconds is >= 30 and <= 3600 && Trusted(web, development) &&
        new Uri(web).Scheme is "https" or "http" && Trusted(mobile, development);
}
