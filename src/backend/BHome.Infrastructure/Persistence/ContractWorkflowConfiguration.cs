using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Persistence;

internal sealed class ContractDocumentFileConfiguration : IEntityTypeConfiguration<ContractDocumentFile>
{
    public void Configure(EntityTypeBuilder<ContractDocumentFile> e)
    {
        e.ToTable("ContractDocumentFiles", b => b.HasCheckConstraint("CK_ContractDocumentFile_Length", "\"Length\" > 0 AND \"Length\" <= 10485760"));
        e.HasOne<Contract>().WithMany().HasForeignKey(f => f.ContractId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(f => f.RecordedByUserId).OnDelete(DeleteBehavior.Restrict);
        e.Property(f => f.SnapshotHash).HasMaxLength(64); e.Property(f => f.FileHash).HasMaxLength(64);
        e.Property(f => f.TemplateId).HasMaxLength(80); e.Property(f => f.ObjectKey).HasMaxLength(250); e.Property(f => f.ContentType).HasMaxLength(100);
        e.HasIndex(f => f.ObjectKey).IsUnique();
        e.HasIndex(f => new { f.ContractId, f.SnapshotHash, f.TemplateId, f.TemplateVersion }).IsUnique().HasFilter("\"Kind\" = 0");
    }
}
