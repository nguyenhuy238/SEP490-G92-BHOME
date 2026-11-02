using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Persistence;
internal sealed class ContractExpiryConfiguration : IEntityTypeConfiguration<ContractExpiryNotice>
{
    public void Configure(EntityTypeBuilder<ContractExpiryNotice> e)
    {
        e.ToTable("ContractExpiryNotices"); e.HasKey(n => n.Id);
        e.HasIndex(n => new { n.ContractId, n.EndDate, n.Stage, n.RecipientId }).IsUnique(); e.HasIndex(n => new { n.RecipientId, n.CreatedAt });
        e.Property(n => n.Stage).HasMaxLength(30);
        e.HasOne<Contract>().WithMany().HasForeignKey(n => n.ContractId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(n => n.RecipientId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class ContractExpiryScanConfiguration : IEntityTypeConfiguration<Contract>
{
    public void Configure(EntityTypeBuilder<Contract> e) => e.HasIndex(c => new { c.Status, c.EndDate, c.Id });
}
