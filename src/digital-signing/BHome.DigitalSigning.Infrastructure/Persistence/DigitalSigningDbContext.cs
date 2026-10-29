using BHome.DigitalSigning.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.DigitalSigning.Infrastructure.Persistence;

// Standalone context for this cloned module. When it moves into BHome, the three configurations below are picked up by
// BHomeDbContext's ApplyConfigurationsFromAssembly and this context goes away.
public sealed class DigitalSigningDbContext(DbContextOptions<DigitalSigningDbContext> options) : DbContext(options)
{
    public DbSet<SigningCertificate> SigningCertificates => Set<SigningCertificate>();
    public DbSet<SigningTransaction> SigningTransactions => Set<SigningTransaction>();
    internal DbSet<SigningSettingsRecord> SigningSettings => Set<SigningSettingsRecord>();
    internal DbSet<SignatureImageRecord> SignatureImages => Set<SignatureImageRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
        => modelBuilder.ApplyConfigurationsFromAssembly(typeof(DigitalSigningDbContext).Assembly);
}

// The single row (Id = 1) of saved Viettel account settings. The client secret is AES-GCM encrypted.
internal sealed class SigningSettingsRecord
{
    public const short SingletonId = 1;
    public short Id { get; set; } = SingletonId;
    public string? ViettelBaseUrl { get; set; }
    public string? ViettelClientId { get; set; }
    public string? ViettelProfileId { get; set; }
    public string? ViettelSecretEncrypted { get; set; }
    public Guid? UpdatedByUserId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

// One signature picture per signer.
internal sealed class SignatureImageRecord
{
    public Guid OwnerUserId { get; set; }
    public byte[] Content { get; set; } = [];
    public int Width { get; set; }
    public int Height { get; set; }
    public string Sha256 { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
}

internal sealed class SignatureImageConfiguration : IEntityTypeConfiguration<SignatureImageRecord>
{
    public void Configure(EntityTypeBuilder<SignatureImageRecord> builder)
    {
        builder.ToTable("SignatureImages");
        builder.HasKey(image => image.OwnerUserId);
        builder.Property(image => image.OwnerUserId).ValueGeneratedNever();
        builder.Property(image => image.Content).IsRequired();
        builder.Property(image => image.Sha256).HasMaxLength(64).IsFixedLength().IsRequired();
    }
}

internal sealed class SigningCertificateConfiguration : IEntityTypeConfiguration<SigningCertificate>
{
    public void Configure(EntityTypeBuilder<SigningCertificate> builder)
    {
        builder.ToTable("SigningCertificates");
        builder.HasKey(certificate => certificate.Id);
        builder.Property(certificate => certificate.Provider).HasMaxLength(32).IsRequired();
        builder.Property(certificate => certificate.ProviderUserId).HasMaxLength(100).IsRequired();
        builder.Property(certificate => certificate.CredentialId).HasMaxLength(200).IsRequired();
        builder.Property(certificate => certificate.SerialNumber).HasMaxLength(100).IsRequired();
        builder.Property(certificate => certificate.Subject).HasMaxLength(1000).IsRequired();
        builder.Property(certificate => certificate.Issuer).HasMaxLength(1000).IsRequired();
        // One certificate, one holder.
        builder.HasIndex(certificate => new { certificate.Provider, certificate.SerialNumber }).IsUnique();
        builder.HasIndex(certificate => certificate.OwnerUserId);
    }
}

internal sealed class SigningTransactionConfiguration : IEntityTypeConfiguration<SigningTransaction>
{
    public void Configure(EntityTypeBuilder<SigningTransaction> builder)
    {
        builder.ToTable("SigningTransactions");
        builder.HasKey(transaction => transaction.Id);
        builder.HasOne<SigningCertificate>().WithMany().HasForeignKey(transaction => transaction.CertificateId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.Property(transaction => transaction.Provider).HasMaxLength(32).IsRequired();
        builder.Property(transaction => transaction.ProviderUserId).HasMaxLength(100).IsRequired();
        builder.Property(transaction => transaction.CredentialId).HasMaxLength(200).IsRequired();
        builder.Property(transaction => transaction.SerialNumber).HasMaxLength(100).IsRequired();
        builder.Property(transaction => transaction.ProviderTransactionId).HasMaxLength(200);
        builder.Property(transaction => transaction.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(transaction => transaction.DocumentName).HasMaxLength(200).IsRequired();
        builder.Property(transaction => transaction.SourcePdfSha256).HasMaxLength(64).IsFixedLength().IsRequired();
        builder.Property(transaction => transaction.FieldName).HasMaxLength(64).IsRequired();
        builder.Property(transaction => transaction.PreparedPdf).IsRequired();
        builder.Property(transaction => transaction.DocumentDigest).IsRequired();
        builder.Property(transaction => transaction.DataToSignSha256).HasMaxLength(64).IsFixedLength().IsRequired();
        builder.Property(transaction => transaction.CertificateChain).IsRequired();
        builder.Property(transaction => transaction.Description).HasMaxLength(200);
        builder.Property(transaction => transaction.ErrorCode).HasMaxLength(64);
        builder.Property(transaction => transaction.ErrorMessage).HasMaxLength(1000);
        builder.HasIndex(transaction => new { transaction.RequestedByUserId, transaction.CreatedAt });
    }
}

internal sealed class SigningSettingsConfiguration : IEntityTypeConfiguration<SigningSettingsRecord>
{
    public void Configure(EntityTypeBuilder<SigningSettingsRecord> builder)
    {
        builder.ToTable("SigningSettings", table =>
            table.HasCheckConstraint("CK_SigningSettings_SingleRow", $"\"Id\" = {SigningSettingsRecord.SingletonId}"));
        builder.HasKey(settings => settings.Id);
        builder.Property(settings => settings.Id).ValueGeneratedNever();
        builder.Property(settings => settings.ViettelBaseUrl).HasMaxLength(300);
        builder.Property(settings => settings.ViettelClientId).HasMaxLength(200);
        builder.Property(settings => settings.ViettelProfileId).HasMaxLength(200);
    }
}
