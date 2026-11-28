using BHome.Domain.Common;

namespace BHome.Domain.IncidentMaintenance;

public sealed class MaintenanceCompensation : AuditableEntity
{
    public Guid WorkOrderId { get; set; }
    public Guid? IncidentId { get; set; }
    public Guid LocationId { get; set; }
    public Guid RoomId { get; set; }
    public Guid ContractId { get; set; }
    public Guid DepositContractId { get; set; }
    public decimal ActualRepairCost { get; set; }
    public decimal Amount { get; set; }
    public string CollectionMethod { get; set; } = "";
    public string Status { get; set; } = "";
    public string Reason { get; set; } = "";
    public string EvidenceIdsJson { get; set; } = "[]";
    public Guid DecidedById { get; set; }
    public DateTimeOffset DecidedAt { get; set; }
    public Guid? InvoiceId { get; set; }
    public DateTimeOffset? DeductedAt { get; set; }
    public int Version { get; set; } = 1;
}
