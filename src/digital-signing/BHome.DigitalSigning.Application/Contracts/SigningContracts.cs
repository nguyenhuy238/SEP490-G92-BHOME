namespace BHome.DigitalSigning.Application.Contracts;

public sealed record CertificateView(
    Guid Id, string Provider, string ProviderUserIdHint, string SerialNumber, string Subject, string Issuer,
    DateTimeOffset ValidFrom, DateTimeOffset ValidTo, bool Locked, bool Usable);

// SerialNumber may be left out when the subscriber has a single certificate at Viettel.
public sealed record DeclareCertificate(string ProviderUserId, string? SerialNumber);

// Page is 1-based; X, Y and Width are fractions of the page from its top-left (0..1). Null signs invisibly.
public sealed record SignaturePlacement(int Page, double X, double Y, double Width);

public sealed record StartSigning(
    Guid CertificateId, string DocumentName, byte[] Pdf, string? Description, SignaturePlacement? Placement);

// Status: pending | signing | signed | rejected | expired | failed. The screen asks again every few seconds while pending.
public sealed record SigningTransactionView(
    Guid Id, string Status, string Provider, string SerialNumber, string DocumentName, DateTimeOffset ExpiresAt,
    string? ErrorCode, string? ErrorMessage, bool CanDownload);

public sealed record SignedDocument(string FileName, byte[] Content);

// Each *Source is DATABASE, CONFIGURATION or NONE. The secret itself is never returned, only its last characters.
public sealed record ViettelSettingsView(
    string BaseUrl, string BaseUrlSource, string ClientId, string ClientIdSource, string ProfileId,
    string ProfileIdSource, bool SecretSet, string SecretHint, string SecretSource, bool SecretUnreadable,
    Guid? UpdatedByUserId, DateTimeOffset? UpdatedAt);

// A blank secret keeps the stored one; ClearSecret removes it. A blank address or id falls back to configuration.
public sealed record SaveViettelSettings(
    string? BaseUrl, string? ClientId, string? ProfileId, string? ClientSecret, bool ClearSecret);

public sealed record SignatureImageView(bool Present, int Width, int Height, string? Version, DateTimeOffset? UpdatedAt);

// A refusal is an answer, not an error: Ok=false with the reason.
public sealed record ConnectionTestResult(bool Ok, long Milliseconds, string Message);
