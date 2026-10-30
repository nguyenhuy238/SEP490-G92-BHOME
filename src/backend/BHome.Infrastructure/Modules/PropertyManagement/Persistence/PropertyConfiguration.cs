using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

internal sealed class RoomTypeConfiguration : IEntityTypeConfiguration<RoomType>
{
    public void Configure(EntityTypeBuilder<RoomType> b)
    {
        b.ToTable("RoomTypes", t => t.HasCheckConstraint("CK_RoomType_Values", "\"DefaultCapacity\" BETWEEN 1 AND 32767 AND (\"AreaM2\" IS NULL OR \"AreaM2\" > 0)"));
        b.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasAlternateKey(x => new { x.Id, x.LocationId });
        b.Property(x => x.Name).HasMaxLength(100).IsRequired(); b.Property(x => x.Description).HasMaxLength(2000);
        b.Property(x => x.AreaM2).HasPrecision(8, 2); b.Property(x => x.Amenities).HasColumnType("text[]");
        b.Property(x => x.Version).IsConcurrencyToken();
    }
}
internal sealed class PropertyRoomConfiguration : IEntityTypeConfiguration<Room>
{
    public void Configure(EntityTypeBuilder<Room> b)
    {
        b.ToTable("Rooms", t => t.HasCheckConstraint("CK_Room_Values", "\"Capacity\" BETWEEN 1 AND 32767 AND \"Status\" BETWEEN 0 AND 3"));
        b.HasAlternateKey(x => new { x.Id, x.LocationId });
        b.HasOne(x => x.RoomType).WithMany().HasForeignKey(x => new { x.RoomTypeId, x.LocationId })
            .HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.Floor).HasMaxLength(30); b.Property(x => x.Version).IsConcurrencyToken();
    }
}
internal sealed class AssetConfiguration : IEntityTypeConfiguration<Asset>
{
    public void Configure(EntityTypeBuilder<Asset> b)
    {
        b.ToTable("Assets", t =>
        {
            t.HasCheckConstraint("CK_Asset_Scope", "(\"RoomId\" IS NOT NULL AND \"CommonArea\" IS NULL) OR (\"RoomId\" IS NULL AND \"CommonArea\" IS NOT NULL AND length(trim(\"CommonArea\")) > 0)");
            t.HasCheckConstraint("CK_Asset_Status", "\"Status\" BETWEEN 0 AND 3");
        });
        b.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId })
            .HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.CommonArea).HasMaxLength(200); b.Property(x => x.Code).HasMaxLength(80);
        b.Property(x => x.Name).HasMaxLength(150); b.Property(x => x.Category).HasMaxLength(80); b.Property(x => x.Condition).HasMaxLength(1000);
        b.Property(x => x.Version).IsConcurrencyToken();
    }
}
internal sealed class BillingPolicyConfiguration : IEntityTypeConfiguration<BillingPolicy>
{
    public void Configure(EntityTypeBuilder<BillingPolicy> b)
    {
        b.ToTable("BillingPolicies", t =>
        {
            t.HasCheckConstraint("CK_Policy_Values", "\"Rate\" >= 0 AND (\"EffectiveTo\" IS NULL OR \"EffectiveTo\" >= \"EffectiveFrom\") AND NOT (\"RoomId\" IS NOT NULL AND \"RoomTypeId\" IS NOT NULL)");
            t.HasCheckConstraint("CK_Policy_Method", "(\"Category\" = 0 AND \"Method\" = 0 AND \"ChargeCode\" = 'RENT') OR (\"Category\" = 1 AND \"Method\" = 1 AND \"ChargeCode\" = 'ELECTRICITY') OR (\"Category\" = 2 AND \"Method\" = 1 AND \"ChargeCode\" = 'WATER') OR (\"Category\" = 3 AND \"Method\" = 0 AND \"ChargeCode\" NOT IN ('RENT', 'ELECTRICITY', 'WATER'))");
        });
        b.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Room>().WithMany().HasForeignKey(x => new { x.RoomId, x.LocationId })
            .HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<RoomType>().WithMany().HasForeignKey(x => new { x.RoomTypeId, x.LocationId })
            .HasPrincipalKey(x => new { x.Id, x.LocationId }).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.ChargeCode).HasMaxLength(80); b.Property(x => x.Name).HasMaxLength(150);
        b.Property(x => x.Rate).HasPrecision(18, 4); b.Property(x => x.Version).IsConcurrencyToken();
        b.HasIndex(x => new { x.LocationId, x.ChargeCode, x.EffectiveFrom });
    }
}
internal sealed class PropertyChangeConfiguration : IEntityTypeConfiguration<PropertyChange>
{
    public void Configure(EntityTypeBuilder<PropertyChange> b)
    {
        b.ToTable("PropertyChanges"); b.HasKey(x => x.Id);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.TargetType).HasMaxLength(100); b.Property(x => x.Action).HasMaxLength(50);
        b.Property(x => x.Reason).HasMaxLength(500); b.Property(x => x.Before).HasColumnType("jsonb"); b.Property(x => x.After).HasColumnType("jsonb");
        b.HasIndex(x => new { x.TargetId, x.OccurredAt });
    }
}
