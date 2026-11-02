using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Persistence;

internal sealed class PaymentTransferConfiguration : IEntityTypeConfiguration<PaymentTransfer>
{
    public void Configure(EntityTypeBuilder<PaymentTransfer> e)
    {
        e.ToTable("PaymentTransfers", t => t.HasCheckConstraint("CK_PaymentTransfer_Values", "\"Amount\" > 0 AND \"Currency\" = 'VND' AND length(\"NormalizedReference\") > 0 AND \"NormalizedReference\" = upper(btrim(\"BankReference\"))"));
        e.Property(x => x.Amount).HasPrecision(18, 0); e.Property(x => x.Currency).HasMaxLength(3);
        e.Property(x => x.ProviderIdentity).HasMaxLength(80); e.Property(x => x.BankReference).HasMaxLength(150); e.Property(x => x.NormalizedReference).HasMaxLength(150);
        e.Property(x => x.TransferDescription).HasMaxLength(100); e.Property(x => x.StatementReference).HasMaxLength(500);
        e.Property(x => x.VerificationReason).HasMaxLength(2000); e.Property(x => x.VerificationSource).HasMaxLength(50);
        e.HasIndex(x => new { x.ProviderIdentity, x.NormalizedReference }).IsUnique();
        e.HasIndex(x => x.VerifiedAt); e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.ProposedInvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class PaymentAllocationConfiguration : IEntityTypeConfiguration<PaymentAllocation>
{
    public void Configure(EntityTypeBuilder<PaymentAllocation> e)
    {
        e.ToTable("PaymentAllocations", t => t.HasCheckConstraint("CK_PaymentAllocation_Amount", "\"Amount\" > 0"));
        e.Property(x => x.Amount).HasPrecision(18, 0); e.HasIndex(x => x.TransferId).IsUnique();
        e.HasOne<PaymentTransfer>().WithMany().HasForeignKey(x => x.TransferId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.PaidByUserId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class PaymentReconciliationConfiguration : IEntityTypeConfiguration<PaymentReconciliation>
{
    public void Configure(EntityTypeBuilder<PaymentReconciliation> e)
    {
        e.ToTable("PaymentReconciliations", t => t.HasCheckConstraint("CK_PaymentReconciliation_Decision", "\"Decision\" IN ('PendingReview','Allocated','Rejected')"));
        e.Property(x => x.Sequence).UseIdentityByDefaultColumn();
        e.Property(x => x.Decision).HasMaxLength(30); e.Property(x => x.Reason).HasMaxLength(2000);
        e.HasIndex(x => new { x.TransferId, x.OccurredAt });
        e.HasOne<PaymentTransfer>().WithMany().HasForeignKey(x => x.TransferId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class BankReferenceClaimConfiguration : IEntityTypeConfiguration<BankReferenceClaim>
{
    public void Configure(EntityTypeBuilder<BankReferenceClaim> e)
    {
        e.ToTable("BankReferenceClaims", t => t.HasCheckConstraint("CK_BankReferenceClaim_Target", "(\"AllocationId\" IS NULL) <> (\"DepositVerificationId\" IS NULL)"));
        e.HasKey(x => x.NormalizedReference); e.Property(x => x.NormalizedReference).HasMaxLength(150);
        e.HasIndex(x => x.AllocationId).IsUnique(); e.HasIndex(x => x.DepositVerificationId).IsUnique();
        e.HasOne<PaymentAllocation>().WithMany().HasForeignKey(x => x.AllocationId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<DepositVerification>().WithMany().HasForeignKey(x => x.DepositVerificationId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class PaymentCommandConfiguration : IEntityTypeConfiguration<PaymentCommand>
{
    public void Configure(EntityTypeBuilder<PaymentCommand> e)
    {
        e.ToTable("PaymentCommands"); e.HasKey(x => new { x.ActorId, x.Key, x.Operation });
        e.Property(x => x.Operation).HasMaxLength(30); e.Property(x => x.Fingerprint).HasMaxLength(64);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class PaymentConfirmedEventConfiguration : IEntityTypeConfiguration<PaymentConfirmedEvent>
{
    public void Configure(EntityTypeBuilder<PaymentConfirmedEvent> e)
    {
        e.ToTable("PaymentConfirmedEvents"); e.HasKey(x => x.AllocationId); e.Property(x => x.Name).HasMaxLength(50);
        e.HasOne<PaymentAllocation>().WithMany().HasForeignKey(x => x.AllocationId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class ReceivingBankAccountConfiguration : IEntityTypeConfiguration<ReceivingBankAccount>
{
    public void Configure(EntityTypeBuilder<ReceivingBankAccount> e)
    {
        e.ToTable("ReceivingBankAccounts", t => t.HasCheckConstraint("CK_ReceivingBankAccount_Format", "\"BankIdentifier\" ~ '^[0-9]{6}$' AND \"AccountNumber\" ~ '^[0-9]{6,19}$' AND \"AccountHolder\" ~ '^[A-Z0-9 ]{5,50}$' AND \"Version\" > 0"));
        e.Property(x => x.BankIdentifier).HasMaxLength(6); e.Property(x => x.AccountNumber).HasMaxLength(19); e.Property(x => x.AccountHolder).HasMaxLength(50);
        e.HasIndex(x => new { x.LocationId, x.Version }).IsUnique();
        e.HasOne<BHome.Domain.Locations.Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ConfirmedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
