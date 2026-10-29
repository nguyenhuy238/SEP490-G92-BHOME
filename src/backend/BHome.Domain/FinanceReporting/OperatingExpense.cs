using BHome.Domain.Common;

namespace BHome.Domain.FinanceReporting;

// ERD table operating_expenses (DBR-10, GBR-12). Only the maintenance source is written for now;
// FE-08 (BH-30) owns categories, reporting and manual expenses. SourceKey makes writes idempotent.
public sealed class OperatingExpense : AuditableEntity
{
    public const string MaintenanceCategory = "Maintenance";

    private OperatingExpense() { }

    public OperatingExpense(string sourceKey, Guid locationId, Guid? roomId, Guid? assetId, Guid? incidentReportId,
        Guid? workOrderId, decimal amount, DateOnly incurredOn, string description, Guid recordedByUserId)
    {
        SourceKey = sourceKey;
        LocationId = locationId;
        RoomId = roomId;
        AssetId = assetId;
        IncidentReportId = incidentReportId;
        WorkOrderId = workOrderId;
        Category = MaintenanceCategory;
        Amount = amount;
        IncurredOn = incurredOn;
        Description = description;
        RecordedByUserId = recordedByUserId;
    }

    public string SourceKey { get; private set; } = "";
    public Guid LocationId { get; private set; }
    public Guid? RoomId { get; private set; }
    public Guid? AssetId { get; private set; }
    public Guid? IncidentReportId { get; private set; }
    public Guid? WorkOrderId { get; private set; }
    public string Category { get; private set; } = "";
    public decimal Amount { get; private set; }
    public DateOnly IncurredOn { get; private set; }
    public string Description { get; private set; } = "";
    public Guid RecordedByUserId { get; private set; }
}
