using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;

namespace BHome.DigitalSigning.Sandbox;

// Everything in memory, gone on restart: enough to demo without PostgreSQL. Moves are conditional, like the SQL ones.
internal sealed class MemorySigningStore : IDigitalSigningStore
{
    private readonly object gate = new();
    private readonly Dictionary<Guid, SigningCertificate> certificates = [];
    private readonly Dictionary<Guid, SigningTransaction> transactions = [];

    public Task<IReadOnlyList<SigningCertificate>> CertificatesOfAsync(Guid ownerUserId, CancellationToken cancellationToken)
    {
        lock (gate)
            return Task.FromResult<IReadOnlyList<SigningCertificate>>(certificates.Values
                .Where(certificate => certificate.OwnerUserId == ownerUserId).OrderBy(certificate => certificate.CreatedAt)
                .ToList());
    }

    public Task<SigningCertificate?> CertificateAsync(Guid id, CancellationToken cancellationToken)
    {
        lock (gate) return Task.FromResult(certificates.GetValueOrDefault(id));
    }

    public Task<SigningCertificate?> CertificateAsync(string provider, string serialNumber, CancellationToken cancellationToken)
    {
        lock (gate)
            return Task.FromResult(certificates.Values.SingleOrDefault(
                certificate => certificate.Provider == provider && certificate.SerialNumber == serialNumber));
    }

    public Task AddCertificateAsync(SigningCertificate certificate, CancellationToken cancellationToken)
    {
        lock (gate) certificates.Add(certificate.Id, certificate);
        return Task.CompletedTask;
    }

    public Task RemoveCertificateAsync(Guid id, CancellationToken cancellationToken)
    {
        lock (gate) certificates.Remove(id);
        return Task.CompletedTask;
    }

    public Task SetLockedAsync(Guid id, bool locked, CancellationToken cancellationToken)
    {
        lock (gate)
            if (certificates.TryGetValue(id, out var certificate)) certificate.Locked = locked;
        return Task.CompletedTask;
    }

    public Task AddTransactionAsync(SigningTransaction transaction, CancellationToken cancellationToken)
    {
        lock (gate) transactions.Add(transaction.Id, transaction);
        return Task.CompletedTask;
    }

    public Task<SigningTransaction?> TransactionAsync(Guid id, CancellationToken cancellationToken)
    {
        lock (gate) return Task.FromResult(transactions.GetValueOrDefault(id));
    }

    public Task SetProviderTransactionAsync(Guid id, string providerTransactionId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        lock (gate)
        {
            transactions[id].ProviderTransactionId = providerTransactionId;
            transactions[id].UpdatedAt = now;
        }
        return Task.CompletedTask;
    }

    public Task<bool> MoveAsync(Guid id, SigningTransactionStatus from, SigningTransactionStatus to, string? errorCode,
        string? errorMessage, DateTimeOffset now, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (!transactions.TryGetValue(id, out var transaction) || transaction.Status != from) return Task.FromResult(false);
            transaction.Status = to;
            transaction.ErrorCode = errorCode;
            transaction.ErrorMessage = errorMessage;
            transaction.UpdatedAt = now;
            return Task.FromResult(true);
        }
    }

    public Task<bool> CompleteAsync(Guid id, byte[] signedPdf, DateTimeOffset now, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (!transactions.TryGetValue(id, out var transaction) || transaction.Status != SigningTransactionStatus.Signing)
                return Task.FromResult(false);
            transaction.Status = SigningTransactionStatus.Signed;
            transaction.SignedPdf = signedPdf;
            transaction.UpdatedAt = now;
            return Task.FromResult(true);
        }
    }
}

internal sealed class MemorySignatureImageStore : ISignatureImageStore
{
    private readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, SignatureImage> images = new();

    public Task<SignatureImage?> FindAsync(Guid ownerUserId, CancellationToken cancellationToken)
        => Task.FromResult(images.GetValueOrDefault(ownerUserId));

    public Task SaveAsync(Guid ownerUserId, SignatureImage image, CancellationToken cancellationToken)
    {
        images[ownerUserId] = image;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(Guid ownerUserId, CancellationToken cancellationToken)
    {
        images.TryRemove(ownerUserId, out _);
        return Task.CompletedTask;
    }
}

internal sealed class MemorySettingsStore : ISigningSettingsStore
{
    private volatile ViettelSettingsRow? row;

    public Task<ViettelSettingsRow?> FindAsync(CancellationToken cancellationToken) => Task.FromResult(row);

    public Task SaveAsync(ViettelSettingsRow value, CancellationToken cancellationToken)
    {
        row = value;
        return Task.CompletedTask;
    }
}
