using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace BHome.Infrastructure.Persistence;
internal sealed class ContractMoveHistoryConfiguration:IEntityTypeConfiguration<ContractMoveOutHistory>
{
    public void Configure(EntityTypeBuilder<ContractMoveOutHistory> e)
    {
        e.ToTable("ContractMoveOutHistory");e.HasIndex(x=>new{x.ContractId,x.Version}).IsUnique();e.Property(x=>x.Snapshot).HasColumnType("jsonb");e.Property(x=>x.Action).HasMaxLength(50);
        e.HasOne<Contract>().WithMany().HasForeignKey(x=>x.ContractId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x=>x.ActorId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class ContractFinalInspectionConfiguration:IEntityTypeConfiguration<ContractFinalInspection>
{
    public void Configure(EntityTypeBuilder<ContractFinalInspection> e)
    {
        e.ToTable("ContractFinalInspections");e.HasIndex(x=>new{x.ContractId,x.Version}).IsUnique();
        e.Property(x=>x.BaselineSnapshot).HasColumnType("jsonb");e.Property(x=>x.ObservedSnapshot).HasColumnType("jsonb");e.Property(x=>x.OwnerReason).HasMaxLength(2000);e.Property(x=>x.OwnerDecision).HasMaxLength(30);
        e.HasOne<Contract>().WithMany().HasForeignKey(x=>x.ContractId).OnDelete(DeleteBehavior.Restrict);e.HasOne<Contract>().WithMany().HasForeignKey(x=>x.BaselineContractId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x=>x.StaffId).OnDelete(DeleteBehavior.Restrict);e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x=>x.OwnerId).OnDelete(DeleteBehavior.Restrict);
    }
}
