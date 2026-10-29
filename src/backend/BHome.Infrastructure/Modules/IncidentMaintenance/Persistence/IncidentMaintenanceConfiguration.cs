using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Domain.FinanceReporting;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

// ERD Trang-2 tables assets / incident_reports / maintenance_work_orders / operating_expenses.
// Keys are Guid and table names PascalCase like the rest of the code (plan D17).
// Evidence and history are JSONB columns (plan D13: no extra tables); the domain only appends to them.
// RowVersion maps to PostgreSQL xmin for optimistic concurrency (no extra column).

internal sealed class AssetConfiguration : IEntityTypeConfiguration<Asset>
{
    public void Configure(EntityTypeBuilder<Asset> builder)
    {
        builder.ToTable("Assets");
        builder.Property(x => x.AssetCode).HasMaxLength(50);
        builder.Property(x => x.Name).HasMaxLength(150);
        builder.Property(x => x.Category).HasMaxLength(50);
        builder.Property(x => x.PurchaseInfo).HasMaxLength(1000);
        builder.Property(x => x.Condition).HasMaxLength(1000);
        builder.Property(x => x.RowVersion).IsRowVersion();
        builder.HasIndex(x => new { x.LocationId, x.AssetCode }).IsUnique();
        builder.HasIndex(x => x.RoomId);
        builder.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class IncidentReportConfiguration : IEntityTypeConfiguration<IncidentReport>
{
    public void Configure(EntityTypeBuilder<IncidentReport> builder)
    {
        builder.ToTable("IncidentReports");
        builder.Property(x => x.ReportCode).HasMaxLength(30);
        builder.Property(x => x.Summary).HasMaxLength(200);
        builder.Property(x => x.Description).HasMaxLength(2000);
        builder.Property(x => x.OwnerDecisionReason).HasMaxLength(1000);
        builder.Property(x => x.OfficialCategory).HasMaxLength(50);
        builder.Property(x => x.ResolutionNote).HasMaxLength(2000);
        builder.Property(x => x.CancelReason).HasMaxLength(1000);
        builder.Property(x => x.RowVersion).IsRowVersion();
        builder.Ignore(x => x.IsEmergency);
        builder.Ignore(x => x.IsClosed);
        builder.Ignore(x => x.Evidence);
        builder.Ignore(x => x.ImmediateActions);
        builder.JsonList<IncidentReport, EvidenceRef>("evidence", "Evidence");
        builder.JsonList<IncidentReport, IncidentAction>("immediateActions", "ImmediateActions");

        builder.HasIndex(x => x.ReportCode).IsUnique();
        builder.HasIndex(x => new { x.LocationId, x.Status });
        builder.HasIndex(x => x.ReporterUserId);
        builder.HasIndex(x => new { x.Severity, x.Status, x.AcknowledgedAt });
        builder.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<IncidentReport>().WithMany().HasForeignKey(x => x.DuplicateOfReportId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.ReporterUserId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class MaintenanceWorkOrderConfiguration : IEntityTypeConfiguration<MaintenanceWorkOrder>
{
    public void Configure(EntityTypeBuilder<MaintenanceWorkOrder> builder)
    {
        builder.ToTable("MaintenanceWorkOrders");
        builder.Property(x => x.WorkDescription).HasMaxLength(2000);
        builder.Property(x => x.ExpectedOutcome).HasMaxLength(1000);
        builder.Property(x => x.InspectionResult).HasMaxLength(2000);
        builder.Property(x => x.ProposedPlan).HasMaxLength(2000);
        builder.Property(x => x.EstimatedDuration).HasMaxLength(50);
        builder.Property(x => x.EstimatedCost).HasPrecision(18, 2);
        builder.Property(x => x.PlanRejectionReason).HasMaxLength(1000);
        builder.Property(x => x.ResultSummary).HasMaxLength(2000);
        builder.Property(x => x.ActualCost).HasPrecision(18, 2);
        builder.Property(x => x.CostVarianceReason).HasMaxLength(1000);
        builder.Property(x => x.ReworkReason).HasMaxLength(1000);
        builder.Property(x => x.CancelReason).HasMaxLength(1000);
        builder.Property(x => x.RowVersion).IsRowVersion();
        builder.Ignore(x => x.IsOpen);
        builder.Ignore(x => x.IsPlanApproved);
        builder.Ignore(x => x.Evidence);
        builder.Ignore(x => x.History);
        builder.JsonList<MaintenanceWorkOrder, EvidenceRef>("evidence", "Evidence");
        builder.JsonList<MaintenanceWorkOrder, WorkOrderEntry>("history", "History");

        builder.HasIndex(x => x.IncidentReportId);
        builder.HasIndex(x => new { x.AssignedStaffUserId, x.Status });
        builder.HasIndex(x => new { x.AssetId, x.Status });
        builder.HasOne<IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Asset>().WithMany().HasForeignKey(x => x.AssetId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.AssignedStaffUserId).OnDelete(DeleteBehavior.Restrict);
        builder.ToTable(t => t.HasCheckConstraint("CK_WorkOrder_Costs",
            "(\"EstimatedCost\" IS NULL OR \"EstimatedCost\" >= 0) AND (\"ActualCost\" IS NULL OR \"ActualCost\" >= 0)"));
    }
}

internal sealed class OperatingExpenseConfiguration : IEntityTypeConfiguration<OperatingExpense>
{
    public void Configure(EntityTypeBuilder<OperatingExpense> builder)
    {
        builder.ToTable("OperatingExpenses", t => t.HasCheckConstraint("CK_OperatingExpense_Amount", "\"Amount\" > 0"));
        builder.Property(x => x.SourceKey).HasMaxLength(100);
        builder.Property(x => x.Category).HasMaxLength(50);
        builder.Property(x => x.Amount).HasPrecision(18, 2);
        builder.Property(x => x.Description).HasMaxLength(500);
        builder.HasIndex(x => x.SourceKey).IsUnique();
        builder.HasIndex(x => new { x.LocationId, x.IncurredOn });
        builder.HasOne<Location>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<MaintenanceWorkOrder>().WithMany().HasForeignKey(x => x.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<IncidentReport>().WithMany().HasForeignKey(x => x.IncidentReportId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal static class JsonColumns
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    // Maps a private List<T> field to a jsonb column.
    public static void JsonList<TEntity, TItem>(this EntityTypeBuilder<TEntity> builder, string field, string column)
        where TEntity : class
    {
        var comparer = new ValueComparer<List<TItem>>(
            (a, b) => JsonSerializer.Serialize(a, Options) == JsonSerializer.Serialize(b, Options),
            v => JsonSerializer.Serialize(v, Options).GetHashCode(),
            v => JsonSerializer.Deserialize<List<TItem>>(JsonSerializer.Serialize(v, Options), Options)!);

        builder.Property<List<TItem>>(field)
            .HasField(field)
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName(column)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, Options),
                v => JsonSerializer.Deserialize<List<TItem>>(v, Options) ?? new List<TItem>(),
                comparer);
    }
}
