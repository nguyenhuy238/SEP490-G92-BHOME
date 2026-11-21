using BHome.Domain.TenantContracts;
using BHome.Domain.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Persistence;

internal sealed class ContractHandoverConfiguration : IEntityTypeConfiguration<ContractHandover>, IEntityTypeConfiguration<ContractHandoverHistory>
{
    public void Configure(EntityTypeBuilder<ContractHandover> b)
    {
        b.ToTable("ContractHandovers", t => t.HasCheckConstraint("CK_ContractHandover_State", "\"Version\" > 0 AND \"Status\" BETWEEN 0 AND 2 AND (\"TenantConfirmedVersion\" IS NULL OR \"TenantConfirmedVersion\" = \"Version\") AND (\"Status\" <> 2 OR (\"TenantConfirmedVersion\" IS NOT NULL AND \"TenantConfirmedVersion\" = \"Version\" AND \"TenantConfirmedAt\" IS NOT NULL AND \"StaffConfirmedAt\" IS NOT NULL AND \"TenantConfirmedBy\" IS NOT NULL AND \"StaffConfirmedBy\" IS NOT NULL))"));
        b.HasIndex(h => h.ContractId).IsUnique(); b.Property(h => h.Version).IsConcurrencyToken(); b.Property(h => h.Snapshot).HasColumnType("jsonb");
        b.HasOne<Contract>().WithMany().HasForeignKey(h => h.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MeterReading>().WithMany().HasForeignKey(h => h.ElectricityReadingId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MeterReading>().WithMany().HasForeignKey(h => h.WaterReadingId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(h => h.TenantConfirmedBy).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(h => h.StaffConfirmedBy).OnDelete(DeleteBehavior.Restrict);
    }
    public void Configure(EntityTypeBuilder<ContractHandoverHistory> b)
    {
        b.ToTable("ContractHandoverHistory"); b.Property(h => h.Snapshot).HasColumnType("jsonb"); b.Property(h => h.Action).HasMaxLength(50); b.Property(h => h.Note).HasMaxLength(2000);
        b.HasOne<Contract>().WithMany().HasForeignKey(h => h.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MeterReading>().WithMany().HasForeignKey(h => h.ElectricityReadingId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MeterReading>().WithMany().HasForeignKey(h => h.WaterReadingId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(h => h.ActorId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(h => new { h.ContractId, h.OccurredAt });
    }
}
