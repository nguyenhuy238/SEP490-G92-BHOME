using System.Text.Json.Serialization;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;

namespace BHome.Application.Billing;

public sealed record AdjustmentSubmit(Guid? InvoiceLineId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal? ProposedAmount,
    string Reason, Guid[] EvidenceIds, int ExpectedInvoiceVersion);
public sealed record AdjustmentEvidenceView(Guid Id, string ContentType, long Length);
public sealed record AdjustmentView(Guid Id, Guid InvoiceId, string LocationName, string RoomNumber, DateOnly BillingPeriod,
    Guid RequesterId, Guid? InvoiceLineId, string? ChargeCode,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal CurrentAmount,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? ProposedAmount,
    string Reason, string InvoiceSnapshot, string InvoiceStatus, int InvoiceVersion, int FinancialVersion,
    string Status, int Version, DateTimeOffset SubmittedAt, IReadOnlyList<AdjustmentEvidenceView> Evidence);
public sealed class AdjustmentQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? InvoiceId { get; set; }
    public string? Status { get; set; }
}
public sealed class AdjustmentException(int status, string code) : Exception("Invoice adjustment rejected.")
{ public int Status { get; } = status; public string Code { get; } = code; }
public interface IAdjustmentRepository
{
    Task<T> TransactionAsync<T>(Guid invoiceId, Func<Task<T>> work, CancellationToken t);
    Task<Invoice?> InvoiceAsync(Guid id, InvoiceScope scope, CancellationToken t);
    Task<InvoiceAdjustmentRequest?> RequestAsync(Guid id, InvoiceScope scope, CancellationToken t);
    Task<PagedResult<InvoiceAdjustmentRequest>> ListAsync(AdjustmentQuery query, InvoiceScope scope, CancellationToken t);
    Task<InvoiceAdjustmentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t);
    Task<InvoiceAdjustmentEvidence[]> EvidenceAsync(Guid[] ids, CancellationToken t);
    void Add(object entity);
    void Audit(Guid actor, string action, Guid target, DateTimeOffset at);
}
public interface IAdjustmentEvidenceFiles
{
    Task<AdjustmentEvidenceView> UploadAsync(Guid invoiceId, Guid actor, byte[] content, string contentType, CancellationToken t);
    Task CopyAsync(string key, Stream destination, CancellationToken t);
}
