using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.TenantContracts;

public enum ResidentType { Representative, CoOccupant }
public enum IdentityVerificationStatus { Pending, Verified, Rejected }

public sealed class Resident : AuditableEntity
{
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    // Non-sensitive workspace label. Actual name/DOB/address live only in the encrypted envelope.
    public string DisplayLabel { get; set; } = "";
    public ResidentType ResidentType { get; set; }
    public IdentityVerificationStatus VerificationStatus { get; set; }
    public Guid OwnerUserId { get; set; }
    public string IdentityData { get; set; } = "{}";
    public string? IdentityHmac { get; set; }
    public string? HmacKeyVersion { get; set; }
    public Guid? ConfirmedByUserId { get; set; }
    public DateTimeOffset? ConfirmedAt { get; set; }
}
