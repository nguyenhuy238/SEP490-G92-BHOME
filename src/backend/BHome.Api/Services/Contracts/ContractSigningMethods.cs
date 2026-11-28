namespace BHome.Application.Contracts;

public static class ContractPaymentModes
{
    public static string Of(BHome.Domain.TenantContracts.Contract contract) =>
        contract.PaymentMode ?? (contract.IsDevelopmentDemo ? "Test" : "Live");
    public static bool IsTest(BHome.Domain.TenantContracts.Contract contract) => Of(contract) == "Test";
    public static async Task<string?> ConfiguredAsync(BHome.Application.PaymentsDebt.SePay.SePayOptions? options,
        BHome.Application.PaymentsDebt.IPaymentRepository? accounts, Guid locationId, Guid ownerId, CancellationToken token,
        BHome.Application.PaymentsDebt.SePay.ISePayOwnerConnections? connections = null)
    {
        if (connections is not null) await connections.ApplyOwnerAsync(ownerId, token);
        if (accounts is not null && await accounts.OwnerPaymentModeAsync(ownerId, token) is { } selected) return selected;
        if (options?.Enabled != true) return null;
        var mode = accounts is null ? options.Mode : await accounts.OwnerPaymentModeAsync(ownerId, token) ?? options.Mode;
        var provider = options.For(mode);
        // Freeze the selected mode even before a new Location has a receiving binding.
        // Instructions/activation still require the configured bank; missing setup must never turn Test into Live.
        if (options.DualMode) return mode;
        return provider.Enabled && provider.Bound(locationId, ownerId) ? mode : null;
    }
}

// Active methods and historical signature labels.
public static class SigningMethods
{
    public const string Otp = "OTP";
    // Explicit Owner consent authenticated by the current account session, with the BHOME system seal.
    public const string OwnerSession = "OWNER_SESSION";
    // Handover-only: Tenant signs the Owner-issued report with hand-drawn ink
    // while authenticated as the contract's Tenant, without an email OTP.
    public const string TenantSession = "TENANT_SESSION";
    public const string ViettelMySign = "VIETTEL_MYSIGN";
    public const string Simulated = "SIMULATED";
    // The Owner signs the issued PDF outside BHOME with their own certificate (e.g. Viettel MySign registered through
    // VNeID) and uploads it; BHOME verifies the signature, the certificate issuer and that only a signature was added.
    public const string UploadProof = "UPLOAD_PROOF";

    public static bool IsOtp(string? method) => string.Equals(method?.Trim(), Otp, StringComparison.OrdinalIgnoreCase);
    public static bool IsOwnerSession(string? method) => string.Equals(method?.Trim(), OwnerSession, StringComparison.OrdinalIgnoreCase);
    public static bool IsTenantSession(string? method) => string.Equals(method?.Trim(), TenantSession, StringComparison.OrdinalIgnoreCase);
}

// Configuration section "ContractSigning".
public sealed class ContractSigningOptions
{
    public const string Section = "ContractSigning";
    public SigningMethodSwitches Methods { get; set; } = new();
    public OtpSigningOptions Otp { get; set; } = new();
    public SigningSealOptions Seal { get; set; } = new();
    public SigningInvitationLinkOptions InvitationLink { get; set; } = new();
}

// The "Bạn có hợp đồng cần ký" email carries a button that opens the BHOME app on the contract's signing page
// (signing in first when needed). Mail clients such as Gmail often drop non-http links, so when PublicOpenUrl is set the
// button points to that http(s) page on the API, which forwards to the app; otherwise it points to the app link directly.
public sealed class SigningInvitationLinkOptions
{
    // App deep link; "?contractId=<id>" is appended. Expo Go during development: "exp://<LAN IP>:8081/--/sign-contract".
    public string MobileAppUrl { get; set; } = "bhome://sign-contract";
    // Absolute http(s) URL of GET /open/sign-contract on this API as the phone reaches it, e.g. "http://192.168.1.10:5240/open/sign-contract".
    public string PublicOpenUrl { get; set; } = "";

    public string? AppLink(Guid contractId) => Absolute(MobileAppUrl, http: false) is { } app ? $"{app}?contractId={contractId:D}" : null;

    public string? EmailLink(Guid contractId) =>
        Absolute(PublicOpenUrl, http: true) is { } open ? $"{open}?contractId={contractId:D}" : AppLink(contractId);

    // Only a plain base URL from configuration is used: no query, fragment or user info; http(s) for the public page,
    // the app's own scheme (bhome, or exp/exps for Expo Go) for the app.
    private static string? Absolute(string value, bool http) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment) &&
        string.IsNullOrEmpty(uri.UserInfo) && (http ? uri.Scheme is "http" or "https" : uri.Scheme is "bhome" or "exp" or "exps")
            ? value.TrimEnd('/')
            : null;
}

public sealed class SigningMethodSwitches
{
    public bool Otp { get; set; } = true;
}

// Proposed values (decisions D5/D6 of BHOME_OTP_Signing_Plan.md); SRS v1.3 does not fix them, so they are configuration.
public sealed class OtpSigningOptions
{
    public int Length { get; set; } = 6;
    public int TtlSeconds { get; set; } = 300;
    public int MaxAttempts { get; set; } = 5;
    public int ResendSeconds { get; set; } = 60;
    // HMAC key for the stored code hash. Falls back to DigitalSigning:SecretKey; Development may use a per-process key.
    public string? Secret { get; set; }
    // Development only: writes the code to the server log when the email channel is the Sandbox (no real email).
    public bool DevelopmentLogCode { get; set; }

    public bool IsValid() => Length is >= 6 and <= 8 && TtlSeconds is >= 60 and <= 1800 && MaxAttempts is >= 1 and <= 10 &&
        ResendSeconds is >= 0 and <= 600 && (Secret is null || Secret.Length >= 32);
}

// The BHOME seal certificate (PKCS#12) used to seal OTP-signed PDFs. It is the system's key, never a user's key.
public sealed class SigningSealOptions
{
    public string? PfxPath { get; set; }
    public string? PfxPassword { get; set; }
}

public interface IContractSigningMethods
{
    IReadOnlyList<string> Enabled { get; }
    bool IsEnabled(string method);
}

public sealed record SigningMethodsView(IReadOnlyList<string> Methods, string? Default);

// After a signature completes: who signs next (null when everyone has signed) and the parties to tell.
public sealed record ContractSigningProgress(Guid ContractId, string RoomNumber, string LocationName, Guid? NextSignerUserId, IReadOnlyList<Guid> Parties);
public interface IContractSigningNotifier
{
    Task SignatureCompletedAsync(ContractSigningProgress progress, CancellationToken t);
    Task HoldingOwnerSignedAsync(Guid contractId, CancellationToken t) => Task.CompletedTask;
}
public sealed record SigningOtpConfirmation(string Code);
public sealed record SigningOtpView(Guid SignatureId, string Status, string MaskedEmail, DateTimeOffset ExpiresAt, int ResendAfterSeconds);
