using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Persistence;

internal sealed class AdjustmentRequestConfiguration : IEntityTypeConfiguration<InvoiceAdjustmentRequest>
{
    public void Configure(EntityTypeBuilder<InvoiceAdjustmentRequest> e)
    {
        e.ToTable("InvoiceAdjustmentRequests", t => t.HasCheckConstraint("CK_AdjustmentRequest_Values", "\"CurrentAmount\" >= 0 AND (\"ProposedAmount\" IS NULL OR \"ProposedAmount\" >= 0) AND length(btrim(\"Reason\")) > 0 AND \"InvoiceVersion\" > 0 AND \"InvoiceStatus\" IN (0,1)"));
        e.Property(x => x.CurrentAmount).HasPrecision(18, 0); e.Property(x => x.ProposedAmount).HasPrecision(18, 0);
        e.Property(x => x.Reason).HasMaxLength(2000); e.Property(x => x.ChargeCode).HasMaxLength(50); e.Property(x => x.InvoiceSnapshot).HasColumnType("jsonb");
        e.HasOne(x => x.Invoice).WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RequesterId).OnDelete(DeleteBehavior.Restrict);
        e.HasIndex(x => new { x.InvoiceId, x.SubmittedAt }); e.HasIndex(x => new { x.RequesterId, x.SubmittedAt });
        // InvoiceLineId is a snapshot: Draft refresh legitimately replaces source line IDs.
    }
}
internal sealed class AdjustmentEvidenceConfiguration : IEntityTypeConfiguration<InvoiceAdjustmentEvidence>
{
    public void Configure(EntityTypeBuilder<InvoiceAdjustmentEvidence> e)
    {
        e.ToTable("InvoiceAdjustmentEvidence", t => t.HasCheckConstraint("CK_AdjustmentEvidence_Values", "\"Length\" > 0 AND \"Length\" <= 5242880 AND \"ContentType\" IN ('image/png','image/jpeg')"));
        e.Property(x => x.ObjectKey).HasMaxLength(200); e.Property(x => x.ContentType).HasMaxLength(50); e.HasIndex(x => x.ObjectKey).IsUnique();
        e.HasIndex(x => new { x.RequestId, x.CleanupAfter });
        e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UploaderId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<InvoiceAdjustmentRequest>().WithMany(x => x.Evidence).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class AdjustmentCommandConfiguration : IEntityTypeConfiguration<InvoiceAdjustmentCommand>
{
    public void Configure(EntityTypeBuilder<InvoiceAdjustmentCommand> e)
    {
        e.ToTable("InvoiceAdjustmentCommands"); e.HasKey(x => new { x.ActorId, x.Key, x.Operation });
        e.Property(x => x.Operation).HasMaxLength(30); e.Property(x => x.Fingerprint).HasMaxLength(64);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<InvoiceAdjustmentRequest>().WithMany().HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class AdjustmentEventConfiguration : IEntityTypeConfiguration<InvoiceAdjustmentEvent>
{
    public void Configure(EntityTypeBuilder<InvoiceAdjustmentEvent> e)
    {
        e.ToTable("InvoiceAdjustmentEvents"); e.HasKey(x => new { x.RequestId, x.Name }); e.Property(x => x.Name).HasMaxLength(80);
        e.HasOne<InvoiceAdjustmentRequest>().WithMany().HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Invoice>().WithMany().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RequesterId).OnDelete(DeleteBehavior.Restrict);
    }
}
