using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;

namespace BHome.Domain.Billing;

public sealed class MeterEvidence : AuditableEntity
{
    internal static MeterEvidence Rehydrate(Guid id) => new() { Id = id };
    public Guid TaskId { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ImageHash { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Length { get; set; }
    public DateTimeOffset CleanupAfter { get; set; }
    public bool IsUploaded { get; set; }
    public bool IsLinked { get; set; }
}
