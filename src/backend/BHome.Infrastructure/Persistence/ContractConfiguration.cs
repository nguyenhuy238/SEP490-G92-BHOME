using BHome.Domain.TenantContracts;
using BHome.Domain.Billing;
using BHome.DigitalSigning.Domain;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence;

internal static class ContractConfiguration
{
    public static void ConfigureContracts(this ModelBuilder b)
    {
        b.Entity<Contract>(e =>
        {
            e.ToTable("Contracts", t =>
            {
                t.HasCheckConstraint("CK_Contract_Terms", "\"EndDate\" > \"StartDate\" AND \"MonthlyRent\" > 0 AND \"RequiredDeposit\" >= 0");
                t.HasCheckConstraint("CK_Contract_Activation", "\"Status\" <> 3 OR (\"ActivatedAt\" IS NOT NULL AND \"ActivatedByUserId\" IS NOT NULL)");
                t.HasCheckConstraint("CK_Contract_Signers", "\"OwnerSignerId\" <> \"TenantUserId\"");
                t.HasCheckConstraint("CK_Contract_Holding", "\"AppliedHoldingDeposit\" >= 0 AND \"AppliedHoldingDeposit\" <= \"RequiredDeposit\" AND ((\"HoldingContractId\" IS NULL AND \"HoldingAllocationReference\" IS NULL AND \"AppliedHoldingDeposit\" = 0) OR (\"HoldingContractId\" IS NOT NULL AND \"HoldingAllocationReference\" IS NOT NULL))");
            });
            e.HasOne(c => c.Room).WithMany().HasForeignKey(c => c.RoomId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Contract>().WithMany().HasForeignKey(c => c.PreviousContractId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Resident>().WithMany().HasForeignKey(c => c.RepresentativeResidentId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(c => c.OwnerSignerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(c => c.TenantUserId).OnDelete(DeleteBehavior.Restrict);
            e.Property(c => c.MonthlyRent).HasPrecision(18, 0); e.Property(c => c.RequiredDeposit).HasPrecision(18, 0);
            e.Property(c => c.AppliedHoldingDeposit).HasPrecision(18, 0); e.Property(c => c.HoldingAllocationReference).HasMaxLength(200);
            e.HasIndex(c => c.HoldingContractId).IsUnique().HasFilter("\"HoldingContractId\" IS NOT NULL");
            e.HasIndex(c => c.HoldingAllocationReference).IsUnique().HasFilter("\"HoldingAllocationReference\" IS NOT NULL");
            e.Property(c => c.Terms).HasMaxLength(12000); e.Property(c => c.SnapshotHash).HasMaxLength(64);
            e.HasIndex(c => c.RoomId).IsUnique().HasFilter("\"Status\" = 3").HasDatabaseName("UX_Contract_ActiveRoom");
            e.HasIndex(c => c.PreviousContractId).IsUnique().HasFilter("\"PreviousContractId\" IS NOT NULL AND \"Status\" IN (0,1,2,3)");
            e.HasMany(c => c.Residents).WithOne().HasForeignKey(r => r.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(c => c.Signatures).WithOne().HasForeignKey(s => s.ContractId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ContractResident>(e =>
        {
            e.ToTable("ContractResidents"); e.HasKey(r => new { r.ContractId, r.ResidentId });
            e.HasOne<Resident>().WithMany().HasForeignKey(r => r.ResidentId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ContractSignature>(e =>
        {
            e.ToTable("ContractSignatures"); e.HasIndex(s => new { s.ContractId, s.SignerUserId }).IsUnique().HasFilter("\"Status\" <> 4");
            e.HasIndex(s => s.ProviderReference).IsUnique().HasFilter("\"ProviderReference\" IS NOT NULL");
            e.Property(s => s.SnapshotHash).HasMaxLength(64); e.Property(s => s.SourceHash).HasMaxLength(64);
            e.Property(s => s.PreparedHash).HasMaxLength(64);
            e.Property(s => s.SignedHash).HasMaxLength(64); e.Property(s => s.PreparedObjectKey).HasMaxLength(250);
            e.Property(s => s.SignedObjectKey).HasMaxLength(250); e.Property(s => s.ProviderReference).HasMaxLength(200);
            e.Property(s => s.ProviderUserId).HasMaxLength(100); e.Property(s => s.CredentialId).HasMaxLength(200);
        });
        b.Entity<DepositVerification>(e =>
        {
            e.ToTable("ContractDepositVerifications", t => t.HasCheckConstraint("CK_Deposit_Positive", "\"Amount\" > 0"));
            e.HasOne<Contract>().WithMany().HasForeignKey(d => d.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(d => d.VerifiedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.Property(d => d.Amount).HasPrecision(18, 0); e.Property(d => d.BankTransactionReference).HasMaxLength(150);
            e.Property(d => d.VerificationReason).HasMaxLength(2000); e.HasIndex(d => d.BankTransactionReference).IsUnique();
        });
        b.Entity<ContractMoveOut>(e =>
        {
            e.ToTable("ContractMoveOuts"); e.HasIndex(m => m.ContractId).IsUnique();
            e.HasOne<Contract>().WithMany().HasForeignKey(m => m.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<MeterReading>().WithMany().HasForeignKey(m => m.ElectricityReadingId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<MeterReading>().WithMany().HasForeignKey(m => m.WaterReadingId).OnDelete(DeleteBehavior.Restrict);
            e.Property(m => m.Reason).HasMaxLength(2000); e.Property(m => m.InspectionNotes).HasMaxLength(4000);
            e.Property(m => m.SettlementDecision).HasMaxLength(2000); e.Property(m => m.PendingReason).HasMaxLength(200);
            e.Property(m => m.SettlementLedgerReference).HasMaxLength(200);
        });
        b.Entity<ContractInspectionEvidence>(e =>
        {
            e.ToTable("ContractInspectionEvidence"); e.HasOne<Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.ObjectKey).HasMaxLength(250); e.Property(x => x.ContentType).HasMaxLength(30); e.HasIndex(x => x.ObjectKey).IsUnique();
            e.HasIndex(x => x.ContractId);
        });
        b.Entity<ContractSettlementReview>(e =>
        {
            e.ToTable("ContractSettlementReviews"); e.HasOne<Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Decision).HasMaxLength(2000); e.Property(x => x.LedgerReference).HasMaxLength(200);
            e.HasIndex(x => new { x.ContractId, x.ReviewedAt });
        });
        b.Entity<ContractFileUpload>(e =>
        {
            e.ToTable("ContractFileUploads"); e.HasKey(x => x.ObjectKey); e.Property(x => x.ObjectKey).HasMaxLength(250); e.HasIndex(x => x.CleanupAfter);
        });
        b.Entity<ContractOperation>(e =>
        {
            e.ToTable("ContractOperations"); e.HasKey(o => new { o.ActorId, o.Operation, o.Key });
            e.Property(o => o.Operation).HasMaxLength(50); e.Property(o => o.Fingerprint).HasMaxLength(64);
        });
        // Reuse the standalone module's certificate identity, never its iText infrastructure.
        b.Entity<SigningCertificate>(e =>
        {
            e.ToTable("SigningCertificates"); e.HasKey(c => c.Id);
            e.Property(c => c.Provider).HasMaxLength(32); e.Property(c => c.ProviderUserId).HasMaxLength(100);
            e.Property(c => c.CredentialId).HasMaxLength(200); e.Property(c => c.SerialNumber).HasMaxLength(100);
            e.Property(c => c.Subject).HasMaxLength(1000); e.Property(c => c.Issuer).HasMaxLength(1000);
            e.HasIndex(c => new { c.Provider, c.SerialNumber }).IsUnique(); e.HasIndex(c => c.OwnerUserId);
        });
    }
}
