using BHome.Domain.Common;
namespace BHome.Domain.TenantContracts;

public enum ContractHandoverStatus { Draft, Disputed, Confirmed }
public sealed class ContractHandover : AuditableEntity
{
    public Guid ContractId { get; set; }
    public int Version { get; set; } = 1;
    public ContractHandoverStatus Status { get; set; }
    public string Snapshot { get; set; } = "{}";
    public Guid ElectricityReadingId { get; set; }
    public Guid WaterReadingId { get; set; }
    public int? TenantConfirmedVersion { get; set; }
    public Guid? TenantConfirmedBy { get; set; }
    public DateTimeOffset? TenantConfirmedAt { get; set; }
    public Guid? StaffConfirmedBy { get; set; }
    public DateTimeOffset? StaffConfirmedAt { get; set; }
}
public sealed class ContractHandoverHistory : AuditableEntity
{
    public Guid ContractId { get; set; }
    public int Version { get; set; }
    public string Action { get; set; } = "";
    public Guid ActorId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public string Snapshot { get; set; } = "{}";
    public Guid ElectricityReadingId { get; set; }
    public Guid WaterReadingId { get; set; }
    public string Note { get; set; } = "";
}
