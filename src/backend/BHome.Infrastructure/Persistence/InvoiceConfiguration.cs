using BHome.Domain.Billing;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Persistence;

internal sealed class BillingScheduleConfiguration : IEntityTypeConfiguration<BillingSchedule>
{
    public void Configure(EntityTypeBuilder<BillingSchedule> e)
    {
        e.ToTable("BillingSchedules", t => t.HasCheckConstraint("CK_BillingSchedule_Settings", "\"RateDate\" IN (0,1) AND \"RentSource\" IN (0,1) AND \"PartialMonth\" IN (0,1) AND \"Rounding\" IN (0,1) AND \"DraftDay\" BETWEEN 1 AND 31 AND \"FinalDay\" BETWEEN 1 AND 31 AND \"DueDay\" BETWEEN 1 AND 31 AND \"DraftMonthOffset\" BETWEEN 0 AND 2 AND \"FinalMonthOffset\" BETWEEN 0 AND 2 AND \"DueMonthOffset\" BETWEEN 0 AND 2 AND \"Version\" > 0"));
        e.HasIndex(x => x.LocationId).IsUnique(); e.Property(x => x.Version).IsConcurrencyToken();
        e.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> e)
    {
        e.ToTable("Invoices", t =>
        {
            t.HasCheckConstraint("CK_Invoice_State", "\"Status\" IN (0,1) AND \"Version\" > 0 AND \"Total\" >= 0 AND EXTRACT(DAY FROM \"BillingPeriod\") = 1");
            t.HasCheckConstraint("CK_Invoice_Final", "\"Status\" = 0 OR (\"FinalizedAt\" IS NOT NULL AND \"FinalizedByUserId\" IS NOT NULL AND cardinality(\"MissingInputs\") = 0 AND \"DueDate\" >= \"ScheduledFinalDate\")");
        });
        e.HasIndex(x => new { x.RoomId, x.BillingPeriod }).IsUnique(); e.Property(x => x.Version).IsConcurrencyToken();
        e.HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<Contract>().WithMany().HasForeignKey(x => x.RepresentativeContractId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.RepresentativeTenantUserId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.FinalizedByUserId).OnDelete(DeleteBehavior.Restrict);
        e.Property(x => x.RoomNumber).HasMaxLength(50); e.Property(x => x.LocationName).HasMaxLength(200);
        e.Property(x => x.ScheduleSnapshot).HasColumnType("jsonb"); e.Property(x => x.Total).HasPrecision(18, 0);
        e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
        e.HasMany(x => x.Recipients).WithOne().HasForeignKey(x => x.InvoiceId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class InvoiceLineConfiguration : IEntityTypeConfiguration<InvoiceLine>
{
    public void Configure(EntityTypeBuilder<InvoiceLine> e)
    {
        e.ToTable("InvoiceLines", t => t.HasCheckConstraint("CK_InvoiceLine_Amounts", "\"Rate\" >= 0 AND \"Quantity\" >= 0 AND \"Amount\" >= 0 AND \"OccupiedDays\" BETWEEN 1 AND \"PeriodDays\" AND \"PeriodDays\" BETWEEN 28 AND 31"));
        e.Property(x => x.Rate).HasPrecision(18, 4); e.Property(x => x.Quantity).HasPrecision(18, 4); e.Property(x => x.Amount).HasPrecision(18, 0);
        e.Property(x => x.PreviousReading).HasPrecision(18, 4); e.Property(x => x.ConfirmedReading).HasPrecision(18, 4);
        e.Property(x => x.ChargeCode).HasMaxLength(80); e.Property(x => x.Name).HasMaxLength(150);
        e.HasIndex(x => new { x.InvoiceId, x.ChargeCode }).IsUnique();
        e.HasOne<BillingPolicy>().WithMany().HasForeignKey(x => x.PolicyId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<MeterReading>().WithMany().HasForeignKey(x => x.MeterReadingId).OnDelete(DeleteBehavior.Restrict);
    }
}
internal sealed class InvoiceRecipientConfiguration : IEntityTypeConfiguration<InvoiceRecipient>
{
    public void Configure(EntityTypeBuilder<InvoiceRecipient> e)
    {
        e.ToTable("InvoiceRecipients"); e.HasKey(x => new { x.InvoiceId, x.TenantUserId });
        e.HasIndex(x => x.TenantUserId); e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
