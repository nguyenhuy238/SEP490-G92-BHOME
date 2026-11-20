using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

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
    bool Confirmed);
