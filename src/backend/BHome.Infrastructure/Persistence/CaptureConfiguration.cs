using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence;

internal static class CaptureConfiguration
{
    public static void ConfigureCapture(this ModelBuilder b)
    {
        b.Entity<Chain>().ToTable("Chains"); b.Entity<Room>().ToTable("Rooms");
        b.Entity<Resident>().ToTable("Residents"); b.Entity<MeterEvidence>().ToTable("MeterEvidence");
        b.Entity<Chain>(e => e.Property(x => x.Name).HasMaxLength(150));
        b.Entity<Room>(e => { e.HasOne(x => x.Location).WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict); e.Property(x => x.RoomNumber).HasMaxLength(50); e.HasIndex(x => new { x.LocationId, x.RoomNumber }).IsUnique(); });
        b.Entity<Resident>(e =>
        {
            e.HasOne(x => x.Room).WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ConfirmedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.DisplayLabel).HasMaxLength(150); e.Property(x => x.IdentityData).HasColumnType("jsonb");
            e.Property(x => x.IdentityHmac).HasMaxLength(64); e.Property(x => x.HmacKeyVersion).HasMaxLength(32);
            e.HasIndex(x => new { x.OwnerUserId, x.HmacKeyVersion, x.IdentityHmac }).IsUnique().HasFilter("\"IdentityHmac\" IS NOT NULL");
        });
        b.Entity<Meter>(e =>
        {
            e.HasOne(x => x.Room).WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Code).HasMaxLength(80);
            e.HasIndex(x => new { x.RoomId, x.UtilityType }).IsUnique().HasFilter("\"IsActive\"");
            e.ToTable("Meters", t => t.HasCheckConstraint("CK_Meter_Precision", "\"DecimalPlaces\" BETWEEN 0 AND 4"));
        });
        b.Entity<OperationalTask>(e =>
        {
            e.HasOne(x => x.Meter).WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Contract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.OcrProposedValue).HasPrecision(18, 4); e.Property(x => x.OcrImageHash).HasMaxLength(64); e.Property(x => x.OcrEngineVersion).HasMaxLength(150);
            e.HasIndex(x => new { x.MeterId, x.BillingPeriod }).IsUnique().HasFilter("\"Purpose\" = 1 AND \"Status\" <> 3");
            e.HasIndex(x => x.MeterId).IsUnique().HasFilter("\"Purpose\" = 0 AND \"Status\" <> 3");
            e.HasIndex(x => x.Status);
            e.HasIndex(x => new { x.MeterId, x.ContractId }).IsUnique().HasFilter("\"Purpose\" = 2 AND \"Status\" <> 3");
            e.ToTable("OperationalTasks", t => t.HasCheckConstraint("CK_Task_Period", "(\"Purpose\" IN (0,2) AND \"BillingPeriod\" IS NULL) OR (\"Purpose\" = 1 AND \"BillingPeriod\" IS NOT NULL AND EXTRACT(DAY FROM \"BillingPeriod\") = 1)"));
            e.ToTable("OperationalTasks", t => t.HasCheckConstraint("CK_Task_FinalContract", "(\"Purpose\" = 2 AND \"ContractId\" IS NOT NULL) OR (\"Purpose\" <> 2 AND \"ContractId\" IS NULL)"));
        });
        b.Entity<MeterEvidence>(e =>
        {
            e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.ObjectKey).HasMaxLength(250); e.HasIndex(x => x.ObjectKey).IsUnique();
            e.Property(x => x.ImageHash).HasMaxLength(64); e.Property(x => x.ContentType).HasMaxLength(30);
            e.HasIndex(x => new { x.IsLinked, x.CleanupAfter });
        });
        b.Entity<MeterReading>(e =>
        {
            e.HasOne<OperationalTask>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Meter>().WithMany().HasForeignKey(x => x.MeterId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<MeterEvidence>().WithMany().HasForeignKey(x => x.EvidenceId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ConfirmedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.TaskId).IsUnique(); e.HasIndex(x => x.EvidenceId).IsUnique();
            e.Property(x => x.PreviousValue).HasPrecision(18, 4); e.Property(x => x.ConfirmedValue).HasPrecision(18, 4);
            e.Property(x => x.OcrProposedValue).HasPrecision(18, 4); e.Property(x => x.Consumption).HasPrecision(18, 4);
            e.ToTable("MeterReadings", t => t.HasCheckConstraint("CK_Reading_Values", "\"ConfirmedValue\" >= 0 AND (\"PreviousValue\" IS NULL OR \"ConfirmedValue\" >= \"PreviousValue\")"));
        });
    }
}
