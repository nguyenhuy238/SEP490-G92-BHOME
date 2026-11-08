namespace BHome.Application.Contracts;

// The ways a contract party can sign. OTP is the in-app electronic signature (drawn or uploaded picture, a one-time
// code sent by email, BHOME seals the PDF); VIETTEL_MYSIGN is remote digital signing with the signer's own certificate;
// SIMULATED is the labelled Development/Testing simulation. SRS v1.3 keeps certified digital signature outside the
// MVP, so MySign stays available behind a switch instead of being removed.
public static class SigningMethods
{
    public const string Otp = "OTP";
    public const string ViettelMySign = "VIETTEL_MYSIGN";
    public const string Simulated = "SIMULATED";

    public static bool IsOtp(string? method) => string.Equals(method?.Trim(), Otp, StringComparison.OrdinalIgnoreCase);
}

// Configuration section "ContractSigning". Defaults keep the previous behaviour (MySign on, OTP off) so existing
// deployments and tests are unchanged until a deployment opts in.
public sealed class ContractSigningOptions
{
    public const string Section = "ContractSigning";
    public SigningMethodSwitches Methods { get; set; } = new();
    public OtpSigningOptions Otp { get; set; } = new();
    public SigningSealOptions Seal { get; set; } = new();
}

public sealed class SigningMethodSwitches
{
    public bool Otp { get; set; }
    public bool ViettelMySign { get; set; } = true;
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
}
public sealed record SigningOtpConfirmation(string Code);
public sealed record SigningOtpView(Guid SignatureId, string Status, string MaskedEmail, DateTimeOffset ExpiresAt, int ResendAfterSeconds);
