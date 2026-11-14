using BHome.Domain.Common;

namespace BHome.Domain.TenantContracts;

// Resident-scoped acceptance, never a manufactured Identity user or CA signature.
public sealed class ContractSigningInvitation : AuditableEntity
{
    public Guid ContractId { get; set; }
    public Guid ResidentId { get; set; }
    public Guid ApprovedByUserId { get; set; }
    public string TokenHash { get; set; } = "";
    public string SnapshotHash { get; set; } = "";
    public string DocumentObjectKey { get; set; } = "";
    public string DocumentHash { get; set; } = "";
    public string RecipientEmail { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? OtpHash { get; set; }
    public DateTimeOffset? OtpExpiresAt { get; set; }
    public DateTimeOffset? OtpSentAt { get; set; }
    public int OtpAttempts { get; set; }
    public int OtpSendCount { get; set; }
    public string? SessionHash { get; set; }
    public DateTimeOffset? SessionExpiresAt { get; set; }
    public DateTimeOffset? AcceptedAt { get; set; }
    public string? SignatureObjectKey { get; set; }
    public string? SignatureHash { get; set; }
    public string? AcceptedDocumentObjectKey { get; set; }
    public string? AcceptedDocumentHash { get; set; }
    public string DeliveryStatus { get; set; } = "Pending";
}
