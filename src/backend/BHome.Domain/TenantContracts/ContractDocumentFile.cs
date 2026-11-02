using BHome.Domain.Common;

namespace BHome.Domain.TenantContracts;

public enum ContractFileKind { Preview, HandoverEvidence }

public sealed class ContractDocumentFile : AuditableEntity
{
    public Guid ContractId { get; set; }
    public ContractFileKind Kind { get; set; }
    public string SnapshotHash { get; set; } = "";
    public string? TemplateId { get; set; }
    public int? TemplateVersion { get; set; }
    public bool DevelopmentOnly { get; set; }
    public string ObjectKey { get; set; } = "";
    public string FileHash { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Length { get; set; }
    public Guid RecordedByUserId { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
}
