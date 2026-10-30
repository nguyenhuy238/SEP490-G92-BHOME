using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using Microsoft.EntityFrameworkCore;

namespace BHome.DigitalSigning.Infrastructure.Persistence;

internal sealed class EfDigitalSigningStore(DigitalSigningDbContext db) : IDigitalSigningStore
{
    public async Task<IReadOnlyList<SigningCertificate>> CertificatesOfAsync(Guid ownerUserId, CancellationToken cancellationToken)
        => await db.SigningCertificates.AsNoTracking()
            .Where(certificate => certificate.OwnerUserId == ownerUserId)
            .OrderBy(certificate => certificate.CreatedAt)
            .Take(100)
            .ToListAsync(cancellationToken);

    public Task<SigningCertificate?> CertificateAsync(Guid id, CancellationToken cancellationToken)
        => db.SigningCertificates.AsNoTracking().SingleOrDefaultAsync(certificate => certificate.Id == id, cancellationToken);

    public Task<SigningCertificate?> CertificateAsync(string provider, string serialNumber, CancellationToken cancellationToken)
        => db.SigningCertificates.AsNoTracking().SingleOrDefaultAsync(
            certificate => certificate.Provider == provider && certificate.SerialNumber == serialNumber, cancellationToken);

    public async Task AddCertificateAsync(SigningCertificate certificate, CancellationToken cancellationToken)
    {
        db.SigningCertificates.Add(certificate);
        await db.SaveChangesAsync(cancellationToken);
    }

    public Task RemoveCertificateAsync(Guid id, CancellationToken cancellationToken)
        => db.SigningCertificates.Where(certificate => certificate.Id == id).ExecuteDeleteAsync(cancellationToken);

    public Task SetLockedAsync(Guid id, bool locked, CancellationToken cancellationToken)
        => db.SigningCertificates.Where(certificate => certificate.Id == id)
            .ExecuteUpdateAsync(set => set.SetProperty(certificate => certificate.Locked, locked), cancellationToken);

    public async Task AddTransactionAsync(SigningTransaction transaction, CancellationToken cancellationToken)
    {
        db.SigningTransactions.Add(transaction);
        await db.SaveChangesAsync(cancellationToken);
        db.Entry(transaction).State = EntityState.Detached;
    }

    public Task<SigningTransaction?> TransactionAsync(Guid id, CancellationToken cancellationToken)
        => db.SigningTransactions.AsNoTracking().SingleOrDefaultAsync(transaction => transaction.Id == id, cancellationToken);

    public Task SetProviderTransactionAsync(Guid id, string providerTransactionId, DateTimeOffset now,
        CancellationToken cancellationToken)
        => db.SigningTransactions.Where(transaction => transaction.Id == id)
            .ExecuteUpdateAsync(set => set
                .SetProperty(transaction => transaction.ProviderTransactionId, providerTransactionId)
                .SetProperty(transaction => transaction.UpdatedAt, now), cancellationToken);

    // A conditional UPDATE: the database decides which concurrent request wins, so a signature is embedded once.
    public async Task<bool> MoveAsync(Guid id, SigningTransactionStatus from, SigningTransactionStatus to, string? errorCode,
        string? errorMessage, DateTimeOffset now, CancellationToken cancellationToken)
        => await db.SigningTransactions.Where(transaction => transaction.Id == id && transaction.Status == from)
            .ExecuteUpdateAsync(set => set
                .SetProperty(transaction => transaction.Status, to)
                .SetProperty(transaction => transaction.ErrorCode, errorCode)
                .SetProperty(transaction => transaction.ErrorMessage, errorMessage)
                .SetProperty(transaction => transaction.UpdatedAt, now), cancellationToken) == 1;

    public async Task<bool> CompleteAsync(Guid id, byte[] signedPdf, DateTimeOffset now, CancellationToken cancellationToken)
        => await db.SigningTransactions
            .Where(transaction => transaction.Id == id && transaction.Status == SigningTransactionStatus.Signing)
            .ExecuteUpdateAsync(set => set
                .SetProperty(transaction => transaction.Status, SigningTransactionStatus.Signed)
                .SetProperty(transaction => transaction.SignedPdf, signedPdf)
                .SetProperty(transaction => transaction.UpdatedAt, now), cancellationToken) == 1;
}

internal sealed class EfSignatureImageStore(DigitalSigningDbContext db) : ISignatureImageStore
{
    public async Task<SignatureImage?> FindAsync(Guid ownerUserId, CancellationToken cancellationToken)
    {
        var record = await db.SignatureImages.AsNoTracking()
            .SingleOrDefaultAsync(image => image.OwnerUserId == ownerUserId, cancellationToken);
        return record is null
            ? null
            : new SignatureImage(record.Content, record.Width, record.Height, record.Sha256, record.UpdatedAt);
    }

    public async Task SaveAsync(Guid ownerUserId, SignatureImage image, CancellationToken cancellationToken)
    {
        var record = await db.SignatureImages.SingleOrDefaultAsync(found => found.OwnerUserId == ownerUserId, cancellationToken);
        if (record is null)
        {
            record = new SignatureImageRecord { OwnerUserId = ownerUserId };
            db.SignatureImages.Add(record);
        }
        record.Content = image.Content;
        record.Width = image.Width;
        record.Height = image.Height;
        record.Sha256 = image.Sha256;
        record.UpdatedAt = image.UpdatedAt;
        await db.SaveChangesAsync(cancellationToken);
    }

    public Task DeleteAsync(Guid ownerUserId, CancellationToken cancellationToken)
        => db.SignatureImages.Where(image => image.OwnerUserId == ownerUserId).ExecuteDeleteAsync(cancellationToken);
}

internal sealed class EfSigningSettingsStore(DigitalSigningDbContext db) : ISigningSettingsStore
{
    public async Task<ViettelSettingsRow?> FindAsync(CancellationToken cancellationToken)
    {
        var row = await db.SigningSettings.AsNoTracking()
            .SingleOrDefaultAsync(settings => settings.Id == SigningSettingsRecord.SingletonId, cancellationToken);
        return row is null
            ? null
            : new ViettelSettingsRow(row.ViettelBaseUrl, row.ViettelClientId, row.ViettelProfileId,
                row.ViettelSecretEncrypted, row.UpdatedByUserId, row.UpdatedAt);
    }

    public async Task SaveAsync(ViettelSettingsRow row, CancellationToken cancellationToken)
    {
        var record = await db.SigningSettings
            .SingleOrDefaultAsync(settings => settings.Id == SigningSettingsRecord.SingletonId, cancellationToken);
        if (record is null)
        {
            record = new SigningSettingsRecord();
            db.SigningSettings.Add(record);
        }
        record.ViettelBaseUrl = row.BaseUrl;
        record.ViettelClientId = row.ClientId;
        record.ViettelProfileId = row.ProfileId;
        record.ViettelSecretEncrypted = row.ClientSecretEncrypted;
        record.UpdatedByUserId = row.UpdatedByUserId;
        record.UpdatedAt = row.UpdatedAt ?? DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }
}
