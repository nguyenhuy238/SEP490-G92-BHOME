using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Application.Contracts;

namespace BHome.Application.StaffOperations;

// This is an operational asset-responsibility acknowledgement, not a tenancy-contract signature.
// A session acknowledgement is evidence of who accepted which immutable report, not a PKI signature.
public sealed record LocationAssetHandoverAcceptance(Guid ActorId, DateTimeOffset SignedAt,
    string Method, string SnapshotSha256);

public sealed record LocationAssetHandoverReportView(
    Guid TaskId, Guid LocationId, Guid AssignmentId, Guid StaffId, int TaskVersion,
    int Revision, string Status, int TotalItems, int DirectItems, int InheritedItems,
    string SnapshotSha256, string PdfSha256, DateTimeOffset ApprovedAt, Guid ApprovedBy,
    string? ExceptionDecision, LocationAssetHandoverAcceptance? OwnerSignature,
    LocationAssetHandoverAcceptance? StaffSignature, bool CanDownloadFinal);

// Former Staff can discover only revisions they personally signed after Owner acceptance.
// TaskId + Revision is the immutable report identity; a successor may own a different task.
public sealed record LocationAssetHandoverArchiveListItem(
    Guid TaskId, Guid LocationId, Guid AssignmentId, Guid StaffId, Guid OwnerId,
    int Revision, string LocationName, string Address, int TotalItems, int DirectItems,
    int InheritedItems, string SnapshotSha256, string PdfSha256, DateTimeOffset ApprovedAt,
    string? ExceptionDecision, LocationAssetHandoverAcceptance OwnerSignature,
    LocationAssetHandoverAcceptance StaffSignature);

public sealed record LocationAssetHandoverArchiveAssetView(
    Guid Id, string Scope, string Name, int Quantity, string Condition, bool Inherited,
    Guid? SourceHandoverContractId, Guid? IncidentId, string? Note,
    Guid? PriorStaffTaskId, Guid? PriorStaffUserId)
{
    public string? Unit { get; init; }
}

public sealed record LocationAssetHandoverArchiveReportView(
    LocationAssetHandoverArchiveListItem Report,
    IReadOnlyList<LocationAssetHandoverArchiveAssetView> Items);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationAssetHandoverApprove(
    [Range(1, int.MaxValue)] int TaskVersion,
    [StringLength(2000)] string? ExceptionDecision = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationAssetHandoverRework(
    [Range(1, int.MaxValue)] int TaskVersion,
    [Required, MinLength(1), MaxLength(1000)] Guid[] ItemIds,
    [Required, MinLength(10), StringLength(2000)] string Note);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationAssetHandoverSign(
    [Range(1, int.MaxValue)] int Revision,
    [Required, RegularExpression("^[0-9A-Fa-f]{64}$")] string SnapshotSha256,
    bool Confirmed,
    HandoverInkInput? Ink = null);

public sealed record LocationAssetHandoverDocumentPreview(int PageCount, string DocumentSha256);
