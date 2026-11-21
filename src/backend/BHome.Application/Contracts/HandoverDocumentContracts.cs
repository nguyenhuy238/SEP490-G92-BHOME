namespace BHome.Application.Contracts;

public sealed record HandoverDocumentPhoto(Guid Id, string Caption, byte[] Bytes);
public sealed record HandoverDocumentReport(Guid DocumentId, Guid ContractId, string Type, int Version,
    string LocationName, string Address, Guid OwnerId, Guid? TenantId, Guid StaffId,
    DateTimeOffset? TenantConfirmedAt, DateTimeOffset ConfirmedAt, HandoverSnapshot Snapshot,
    HandoverSnapshot? Baseline, string[] References, string[] Decisions, HandoverDocumentPhoto[] Photos);
public interface IHandoverDocumentRenderer
{
    Task<byte[]> RenderAsync(HandoverDocumentReport report, CancellationToken t);
}
