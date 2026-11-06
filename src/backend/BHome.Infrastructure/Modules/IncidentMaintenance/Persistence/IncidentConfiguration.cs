using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class IncidentReportConfiguration
{
    public void Configure(EntityTypeBuilder<IncidentReport> b)
    {
        b.ToTable("IncidentReports", t =>
        {
            t.HasCheckConstraint("CK_Incident_Scope", "(\"RoomId\" IS NOT NULL AND \"CommonArea\" IS NULL) OR (\"RoomId\" IS NULL AND \"CommonArea\" IS NOT NULL AND length(trim(\"CommonArea\")) > 0)");
            t.HasCheckConstraint("CK_Incident_Values", "\"Severity\" IN (0,1) AND \"Status\" BETWEEN 0 AND 5 AND length(trim(\"Description\")) >= 10 AND \"Version\" > 0");
            t.HasCheckConstraint("CK_Incident_Acknowledgement", "(\"AcknowledgedById\" IS NULL) = (\"AcknowledgedAt\" IS NULL)");
            t.HasCheckConstraint("CK_Incident_Duplicate", "\"DuplicateOfId\" IS NULL OR \"DuplicateOfId\" <> \"Id\"");
        });
        b.HasOne<Location>().WithMany().HasForeignKey(r => r.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Room>().WithMany().HasForeignKey(r => new { r.RoomId, r.LocationId }).HasPrincipalKey(r => new { r.Id, r.LocationId }).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Asset>().WithMany().HasForeignKey(r => r.AssetId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Contract>().WithMany().HasForeignKey(r => r.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(r => r.ReporterId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(r => r.AcknowledgedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(r => r.DuplicateOfId).OnDelete(DeleteBehavior.Restrict);
        b.Property(r => r.Description).HasMaxLength(8000); b.Property(r => r.CommonArea).HasMaxLength(200);
        b.Property(r => r.Type).HasMaxLength(100); b.Property(r => r.Category).HasMaxLength(100);
        b.Property(r => r.ReporterRole).HasMaxLength(20); b.Property(r => r.ResolutionNote).HasMaxLength(8000);
        b.Property(r => r.Version).IsConcurrencyToken(); b.Ignore(r => r.IsOpen);
        b.HasIndex(r => new { r.LocationId, r.Status, r.CreatedAt }); b.HasIndex(r => new { r.ReporterId, r.CreatedAt });
    }
}
internal sealed class WorkOrderConfiguration
{
    public void Configure(EntityTypeBuilder<MaintenanceWorkOrder> b)
    {
        b.ToTable("MaintenanceWorkOrders", t =>
        {
            t.HasCheckConstraint("CK_WorkOrder_State", "\"Status\" BETWEEN 0 AND 5 AND \"Version\" > 0 AND \"ProposalVersion\" >= 0");
            t.HasCheckConstraint("CK_WorkOrder_Cost", "(\"EstimatedCost\" IS NULL OR \"EstimatedCost\" >= 0) AND (\"ActualCost\" IS NULL OR \"ActualCost\" >= 0) AND (\"EstimatedMinutes\" IS NULL OR \"EstimatedMinutes\" > 0)");
            t.HasCheckConstraint("CK_WorkOrder_Approval", "\"Status\" NOT IN (2,3,4) OR (\"ApprovedAt\" IS NOT NULL AND \"ApprovedById\" IS NOT NULL AND \"ApprovedProposalVersion\" IS NOT NULL AND \"ApprovedProposalVersion\" = \"ProposalVersion\")");
            t.HasCheckConstraint("CK_WorkOrder_Verification", "\"Status\" <> 4 OR (\"VerifiedById\" IS NOT NULL AND \"VerifiedAt\" IS NOT NULL AND \"ActualCost\" IS NOT NULL AND \"CompletionActivityId\" IS NOT NULL)");
        });
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(w => w.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Location>().WithMany().HasForeignKey(w => w.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Room>().WithMany().HasForeignKey(w => w.RoomId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Asset>().WithMany().HasForeignKey(w => w.AssetId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(w => w.AssignedStaffId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(w => w.ApprovedById).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(w => w.VerifiedById).OnDelete(DeleteBehavior.Restrict);
        // CompletionActivityId is an immutable history reference, not an FK cycle with Activity.WorkOrderId.
        b.Property(w => w.ExpectedOutcome).HasMaxLength(4000); b.Property(w => w.InspectionResult).HasMaxLength(8000);
        b.Property(w => w.ProposedSolution).HasMaxLength(8000); b.Property(w => w.Result).HasMaxLength(8000);
        b.Property(w => w.Vendor).HasMaxLength(500); b.Property(w => w.EstimatedCost).HasPrecision(18, 0); b.Property(w => w.ActualCost).HasPrecision(18, 0);
        b.Property(w => w.Version).IsConcurrencyToken(); b.Ignore(w => w.PlanApproved); b.Ignore(w => w.IsOpen);
        b.HasIndex(w => new { w.IncidentId, w.Status }); b.HasIndex(w => new { w.LocationId, w.TargetCompletionAt }); b.HasIndex(w => new { w.AssetId, w.Status });
    }
}
internal sealed class IncidentActivityConfiguration
{
    public void Configure(EntityTypeBuilder<IncidentActivity> b)
    {
        b.ToTable("IncidentActivities");
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(a => a.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MaintenanceWorkOrder>().WithMany().HasForeignKey(a => a.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(a => a.ActorId).OnDelete(DeleteBehavior.Restrict);
        b.Property(a => a.Action).HasMaxLength(60); b.Property(a => a.Note).HasMaxLength(8000); b.Property(a => a.DataJson).HasColumnType("jsonb");
        b.HasIndex(a => new { a.IncidentId, a.OccurredAt });
    }
}
internal sealed class IncidentEvidenceConfiguration
{
    public void Configure(EntityTypeBuilder<IncidentEvidence> b)
    {
        b.ToTable("IncidentEvidence", t => t.HasCheckConstraint("CK_IncidentEvidence_Values", "\"Kind\" BETWEEN 0 AND 4 AND \"Length\" > 0 AND \"Length\" <= 5000000 AND \"ContentType\" IN ('image/png','image/jpeg')"));
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(e => e.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MaintenanceWorkOrder>().WithMany().HasForeignKey(e => e.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<IncidentActivity>().WithMany().HasForeignKey(e => e.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.UploadedById).OnDelete(DeleteBehavior.Restrict);
        b.Property(e => e.ObjectKey).HasMaxLength(250); b.Property(e => e.ContentType).HasMaxLength(30); b.Property(e => e.Sha256).HasMaxLength(64);
        b.HasIndex(e => e.ObjectKey).IsUnique(); b.HasIndex(e => new { e.IncidentId, e.Kind, e.WorkOrderId });
    }
}
internal sealed class EmergencyActionConfiguration
{
    public void Configure(EntityTypeBuilder<EmergencyAction> b)
    {
        b.ToTable("IncidentEmergencyActions", t =>
        {
            t.HasCheckConstraint("CK_EmergencyAction_Cost", "\"RequestedCost\" IS NULL OR \"RequestedCost\" >= 0");
            t.HasCheckConstraint("CK_EmergencyAction_Decision", "(\"CostApproved\" IS NULL AND \"CostDecidedAt\" IS NULL AND \"CostDecidedById\" IS NULL) OR (\"CostApproved\" IS NOT NULL AND \"RequestedCost\" IS NOT NULL AND \"CostDecidedAt\" IS NOT NULL AND \"CostDecidedById\" IS NOT NULL)");
        });
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(a => a.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<IncidentActivity>().WithMany().HasForeignKey(a => a.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(a => a.ActorId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(a => a.CostDecidedById).OnDelete(DeleteBehavior.Restrict);
        b.Property(a => a.RequestedCost).HasPrecision(18, 0); b.HasIndex(a => a.ActivityId).IsUnique();
    }
}
internal sealed class MaintenanceExpenseConfiguration
{
    public void Configure(EntityTypeBuilder<MaintenanceExpense> b)
    {
        b.ToTable("OperatingExpenses", t =>
        {
            t.HasCheckConstraint("CK_MaintenanceExpense_Values", "\"Amount\" > 0 AND \"Category\" = 'Maintenance' AND \"SourceType\" IN ('WorkOrder','Direct','EmergencyAction')");
            t.HasCheckConstraint("CK_MaintenanceExpense_Source", "(\"SourceType\" = 'WorkOrder' AND \"WorkOrderId\" = \"SourceId\" AND \"WorkOrderId\" IS NOT NULL AND \"EmergencyActionId\" IS NULL) OR (\"SourceType\" = 'EmergencyAction' AND \"EmergencyActionId\" = \"SourceId\" AND \"EmergencyActionId\" IS NOT NULL AND \"WorkOrderId\" IS NULL) OR (\"SourceType\" = 'Direct' AND \"WorkOrderId\" IS NULL AND \"EmergencyActionId\" IS NULL)");
        });
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(e => e.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Location>().WithMany().HasForeignKey(e => e.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Room>().WithMany().HasForeignKey(e => e.RoomId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Asset>().WithMany().HasForeignKey(e => e.AssetId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MaintenanceWorkOrder>().WithMany().HasForeignKey(e => e.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<EmergencyAction>().WithMany().HasForeignKey(e => e.EmergencyActionId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.ConfirmedById).OnDelete(DeleteBehavior.Restrict);
        b.Property(e => e.Amount).HasPrecision(18, 0); b.Property(e => e.Category).HasMaxLength(50); b.Property(e => e.SourceType).HasMaxLength(30);
        b.HasIndex(e => new { e.SourceType, e.SourceId }).IsUnique(); b.HasIndex(e => new { e.LocationId, e.ExpenseDate });
    }
}
internal sealed class MaintenanceHistoryConfiguration
{
    public void Configure(EntityTypeBuilder<MaintenanceHistory> b)
    {
        b.ToTable("MaintenanceHistory", t => t.HasCheckConstraint("CK_MaintenanceHistory_Cost", "\"ActualCost\" >= 0"));
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(h => h.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<MaintenanceWorkOrder>().WithMany().HasForeignKey(h => h.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<IncidentActivity>().WithMany().HasForeignKey(h => h.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Location>().WithMany().HasForeignKey(h => h.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Room>().WithMany().HasForeignKey(h => h.RoomId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Asset>().WithMany().HasForeignKey(h => h.AssetId).OnDelete(DeleteBehavior.Restrict);
        b.Property(h => h.ConditionBefore).HasMaxLength(1000); b.Property(h => h.ConditionAfter).HasMaxLength(1000);
        b.Property(h => h.StatusBefore).HasMaxLength(30); b.Property(h => h.StatusAfter).HasMaxLength(30);
        b.Property(h => h.ActualCost).HasPrecision(18, 0); b.HasIndex(h => h.ActivityId).IsUnique(); b.HasIndex(h => new { h.LocationId, h.VerifiedAt });
    }
}
internal sealed class IncidentCommandConfiguration
{
    public void Configure(EntityTypeBuilder<IncidentCommand> b)
    {
        b.ToTable("IncidentCommands"); b.HasIndex(c => new { c.ActorId, c.Key }).IsUnique();
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(c => c.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(c => c.ActorId).OnDelete(DeleteBehavior.Restrict);
        b.Property(c => c.Fingerprint).HasMaxLength(64); b.Property(c => c.ResponseJson).HasColumnType("jsonb");
    }
}
internal sealed class IncidentNotificationConfiguration
{
    public void Configure(EntityTypeBuilder<IncidentNotification> b)
    {
        b.ToTable("IncidentNotifications");
        b.HasOne<IncidentReport>().WithMany().HasForeignKey(n => n.IncidentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<IncidentActivity>().WithMany().HasForeignKey(n => n.ActivityId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<ApplicationUser>().WithMany().HasForeignKey(n => n.RecipientId).OnDelete(DeleteBehavior.Restrict);
        b.Property(n => n.Event).HasMaxLength(60); b.Property(n => n.DeliveryState).HasMaxLength(30);
        b.Property(n => n.DeliveryReference).HasMaxLength(200); b.Property(n => n.DeliveryError).HasMaxLength(60);
        b.HasIndex(n => new { n.ActivityId, n.RecipientId }).IsUnique(); b.HasIndex(n => new { n.RecipientId, n.CreatedAt });
    }
}
internal sealed class IncidentFileUploadConfiguration
{
    public void Configure(EntityTypeBuilder<IncidentFileUpload> b)
    {
        b.ToTable("IncidentFileUploads"); b.Property(u => u.ObjectKey).HasMaxLength(250);
        b.HasIndex(u => u.ObjectKey).IsUnique(); b.HasIndex(u => u.CleanupAfter);
    }
}
