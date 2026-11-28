using BHome.Domain.Common;

namespace BHome.Domain.Billing;

public sealed class InvoiceAdjustmentDecision : AuditableEntity
{
    internal static InvoiceAdjustmentDecision RestoreIdentity(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public long Sequence { get; set; }
    public Guid RequestId { get; set; }
    public Guid InvoiceId { get; set; }
    public string Outcome { get; set; } = "";
    public InvoiceStatus InvoiceStatus { get; set; }
    public string? ChargeCode { get; set; }
    public decimal BeforeAmount { get; set; }
    public decimal? CorrectedAmount { get; set; }
    public decimal Delta { get; set; }
    public decimal EffectiveBefore { get; set; }
    public decimal EffectiveAfter { get; set; }
    public decimal PaidAtDecision { get; set; }
    public string SourceFingerprint { get; set; } = "";
    public string Reason { get; set; } = "";
    public Guid OwnerId { get; set; }
    public DateTimeOffset DecidedAt { get; set; }
}
public sealed class InvoiceAdjustmentEvidence
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }
    public Guid UploaderId { get; set; }
    public Guid? RequestId { get; set; }
    public string ObjectKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Length { get; set; }
    public bool Uploaded { get; set; }
    public DateTimeOffset CleanupAfter { get; set; }
}
public sealed class InvoiceAdjustmentCommand
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public string Operation { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public Guid RequestId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
public sealed class InvoiceAdjustmentEvent
{
    public Guid RequestId { get; set; }
    public string Name { get; set; } = "";
    public Guid InvoiceId { get; set; }
    public Guid RequesterId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
