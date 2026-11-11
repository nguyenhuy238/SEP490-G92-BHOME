using System.ComponentModel.DataAnnotations;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public static class ContractSigningModes
{
    public const string Internal = "INTERNAL_OTP_DRAWN";
    public const string InternalConsent = "internal-acceptance-v1";
}
public sealed record SigningInvitationInput(DateTimeOffset ExpiresAt, [Required] string SnapshotHash);
public sealed record SigningInvitationResult(Guid Id, string Status, DateTimeOffset ExpiresAt, string? Token = null);
public sealed record AnonymousSigningToken([Required, StringLength(128, MinimumLength = 40)] string Token);
public sealed record AnonymousOtpInput([Required] string Token, [Required, RegularExpression("^[0-9]{6}$")] string Otp);
public sealed record AnonymousSigningSession([Required] string Token, [Required] string Session);
public sealed record AnonymousSigningInfo(string MaskedEmail, DateTimeOffset ExpiresAt, bool Accepted, string Mode);
public sealed record AnonymousSigningAccess(string Session, string DocumentHash, string ConsentVersion);
public sealed record DrawnPoint(double X, double Y);
public sealed record AnonymousAcceptanceInput([Required] string Token, [Required] string Session,
    [Required] string DocumentHash, [Required] string ConsentVersion, bool Consent, DrawnPoint[][] Strokes);
public sealed record InternalOwnerAcceptance([Required] string DocumentHash, [Required] string ConsentVersion, bool Consent);
public sealed record InternalAcceptanceEvidence(Guid InvitationId, Guid ResidentId, string SnapshotHash, string SourceHash,
    string SignatureHash, string TenantDocumentKey, string TenantDocumentHash, DateTimeOffset AcceptedAt,
    Guid? OwnerId = null, DateTimeOffset? OwnerAcceptedAt = null, string? FinalDocumentKey = null, string? FinalDocumentHash = null);
public sealed record InternalSigningStatus(string Mode, string State, string? DocumentHash, DateTimeOffset? TenantAcceptedAt,
    DateTimeOffset? OwnerAcceptedAt, IReadOnlyList<SigningInvitationResult> Invitations);
public sealed record InternalAcceptedDocument(byte[] SignaturePng, byte[] Pdf);
public interface IAnonymousSigningRepository
{
    Task<ContractSigningInvitation?> FindByTokenHashAsync(string hash, CancellationToken t);
    Task<ContractSigningInvitation?> FindAsync(Guid id, CancellationToken t);
    Task<IReadOnlyList<ContractSigningInvitation>> ListAsync(Guid contractId, CancellationToken t);
    void Add(ContractSigningInvitation invitation);
}
public interface IAnonymousSigningSecurity
{
    string OtpHash(Guid invitationId, string tokenHash, string otp);
    bool EmailConfigured { get; }
    string? InvitationUrl(string token);
    Task SendAsync(string email, string eventKey, string title, string body, CancellationToken t);
}
public interface IInternalAcceptanceRenderer
{
    InternalAcceptedDocument Accept(byte[] source, DrawnPoint[][] strokes, Guid residentId, DateTimeOffset acceptedAt, string sourceHash);
    byte[] ConfirmOwner(byte[] tenantAcceptedPdf, Guid ownerId, DateTimeOffset acceptedAt, string sourceHash);
}
public interface IPostActivationTenantProvisioning
{
    // Invoked inside the contract transaction only after Main becomes Active.
    Task ProvisionAsync(Contract contract, Guid ownerId, CancellationToken t);
}
