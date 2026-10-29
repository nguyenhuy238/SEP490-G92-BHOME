namespace BHome.DigitalSigning.Application;

// How long the signer has to confirm on the phone (Viettel's own window is about 5 minutes), the largest PDF
// accepted, and the account values configuration supplies when nothing was saved.
public sealed record DigitalSigningPolicy(TimeSpan TransactionTtl, long MaxPdfBytes, ViettelAccount ViettelDefaults);

// The Viettel MySign account in force. The four paths are settings because Viettel's documents disagree about them.
public sealed record ViettelAccount(
    string? BaseUrl, string? ClientId, string? ClientSecret, string? ProfileId, string LoginPath, string CredentialsPath,
    string SignHashPath, string StatusPath, int TimeoutSeconds)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(BaseUrl) && !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret);
}

public interface IViettelAccountSource
{
    Task<ViettelAccount> CurrentAsync(CancellationToken cancellationToken);
}
