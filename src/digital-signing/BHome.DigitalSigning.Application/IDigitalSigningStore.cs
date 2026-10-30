using BHome.DigitalSigning.Domain;

namespace BHome.DigitalSigning.Application;

public interface ISigningCertificateStore
{
    Task<IReadOnlyList<SigningCertificate>> CertificatesOfAsync(Guid ownerUserId, CancellationToken cancellationToken);
    Task<SigningCertificate?> CertificateAsync(Guid id, CancellationToken cancellationToken);
    Task<SigningCertificate?> CertificateAsync(string provider, string serialNumber, CancellationToken cancellationToken);
    Task AddCertificateAsync(SigningCertificate certificate, CancellationToken cancellationToken);
    Task RemoveCertificateAsync(Guid id, CancellationToken cancellationToken);
    Task SetLockedAsync(Guid id, bool locked, CancellationToken cancellationToken);
}

public interface IDigitalSigningStore : ISigningCertificateStore
{
    Task AddTransactionAsync(SigningTransaction transaction, CancellationToken cancellationToken);
    Task<SigningTransaction?> TransactionAsync(Guid id, CancellationToken cancellationToken);
    Task SetProviderTransactionAsync(Guid id, string providerTransactionId, DateTimeOffset now,
        CancellationToken cancellationToken);

    // Moves only while the row is still in `from`; false means another request moved it first.
    Task<bool> MoveAsync(Guid id, SigningTransactionStatus from, SigningTransactionStatus to, string? errorCode,
        string? errorMessage, DateTimeOffset now, CancellationToken cancellationToken);

    // Signing -> Signed together with the signed file.
    Task<bool> CompleteAsync(Guid id, byte[] signedPdf, DateTimeOffset now, CancellationToken cancellationToken);
}

// The single row of saved Viettel account settings; a blank field falls back to configuration.
public sealed record ViettelSettingsRow(
    string? BaseUrl, string? ClientId, string? ProfileId, string? ClientSecretEncrypted, Guid? UpdatedByUserId,
    DateTimeOffset? UpdatedAt);

public interface ISigningSettingsStore
{
    Task<ViettelSettingsRow?> FindAsync(CancellationToken cancellationToken);
    Task SaveAsync(ViettelSettingsRow row, CancellationToken cancellationToken);
}

// Secrets at rest. Unprotect throws SecretUnreadableException when the key changed since the secret was saved.
public interface ISecretProtector
{
    string Protect(string value);
    string Unprotect(string protectedValue);
}

public sealed class SecretUnreadableException(string message, Exception? inner = null) : Exception(message, inner);
