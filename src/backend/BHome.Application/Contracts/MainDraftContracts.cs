using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Domain.TenantContracts;
using System.ComponentModel.DataAnnotations;

namespace BHome.Application.Contracts;

// A draft has an identified, verified Resident; an online Tenant account is not required yet.
public sealed record MainDraftInput(Guid RoomId, Guid RepresentativeResidentId,
    Guid[] ResidentIds, DateOnly StartDate, DateOnly EndDate,
    [StringLength(4000)] string Notes, [StringLength(30)] string? TenantPhone,
    [Required, StringLength(200)] string TenantPlaceOfIssue, int ExpectedVersion = 0)
{ public override string ToString() => "Main tenancy draft input (personal supplements omitted)"; }
public sealed record LessorProfile(string FullName, DateOnly DateOfBirth, string CitizenNumber,
    DateOnly DateOfIssue, string PlaceOfIssue, string Address, string Phone)
{ public override string ToString() => "Lessor profile (redacted)"; }
public sealed record MainContractSettingsInput(Guid OwnerSignerId, DateOnly EffectiveFrom, DateOnly? EffectiveTo,
    [property: System.Text.Json.Serialization.JsonNumberHandling(System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString | System.Text.Json.Serialization.JsonNumberHandling.WriteAsString)] decimal SecurityDeposit, string PaymentTerms, string AdditionalTerms, LessorProfile Owner, int ExpectedVersion);
public sealed record MainContractSettings(Guid OwnerSignerId, DateOnly EffectiveFrom, DateOnly? EffectiveTo,
    [property: System.Text.Json.Serialization.JsonNumberHandling(System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString | System.Text.Json.Serialization.JsonNumberHandling.WriteAsString)] decimal SecurityDeposit, string PaymentTerms, string AdditionalTerms, LessorProfile Owner, int Version);
public sealed record DraftTenantSummary(Guid Id, string FullName, string MaskedCitizenNumber, DateOnly? DateOfIssue, bool Representative, string? Phone = null);
public sealed record MainDraftPreparation(Guid RoomId, Guid LocationId, string LocationName, string RoomNumber,
    string Address, DateOnly EffectiveOn, IReadOnlyList<DraftTenantSummary> Residents,
    IReadOnlyList<PolicyDto> Charges, [property: System.Text.Json.Serialization.JsonNumberHandling(System.Text.Json.Serialization.JsonNumberHandling.WriteAsString | System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString)] decimal? SecurityDeposit, string? PaymentTerms,
    string? OwnerName, IReadOnlyList<string> Blockers);
public sealed record MainDraftState(MainDraftInput Input, IReadOnlyList<PolicyDto> Charges,
    int SettingsVersion, string SettingsHash, string TemplateHash);
public sealed record MainDraftView(Guid Id, string Status, int Version, MainDraftInput Input, MainDraftPreparation Preparation);
public sealed record MainDraftFiles(ContractDocumentView Docx, ContractDocumentView? Pdf, string? PreviewError);
public sealed record MainDraftReleaseInput(Guid? TenantUserId, int ExpectedVersion, Guid ReviewedFileId,
    [property: System.Text.Json.Serialization.JsonRequired] bool HumanReviewed);
public sealed record MainDraftRenderData(Contract Contract, MainDraftState State, MainContractSettings Settings,
    IdentityConfirmation Tenant, string LocationName, string RoomNumber, string Address, string[]? Occupants = null, bool SigningReview = false);
public interface IMainDraftData
{
    Task<MainContractSettings?> SettingsAsync(Guid locationId, DateOnly on, CancellationToken t);
    Task<MainContractSettings?> OwnerSettingsAsync(Guid locationId, CancellationToken t);
    Task SetSettingsAsync(Guid locationId, MainContractSettingsInput input, Guid actor, CancellationToken t);
    Task<IdentityConfirmation> IdentityAsync(Guid roomId, Guid residentId, CancellationToken t);
    Task<string?> PhoneAsync(Guid roomId, Guid residentId, CancellationToken t);
    Task<bool> DuplicateAsync(Guid roomId, Guid except, Guid[] people, DateOnly from, DateOnly to, CancellationToken t);
    string Protect(Contract contract, MainDraftState value);
    MainDraftState Unprotect(Contract contract);
    Task<ContractDocumentFile?> FileAsync(Guid contractId, Guid fileId, CancellationToken t);
    Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid contractId, string hash, CancellationToken t);
    Task LockConfigurationAsync(Guid locationId, CancellationToken t);
}
public interface IMainDraftRenderer
{
    string TemplateHash { get; }
    bool SigningReviewAvailable => false;
    Task<byte[]> DocxAsync(MainDraftRenderData data, CancellationToken t);
    Task<byte[]> PdfAsync(byte[] docx, CancellationToken t);
}
public sealed record DraftPreviewPage(int Number, float Width, float Height);
public sealed record DraftPreviewInfo(Guid FileId, IReadOnlyList<DraftPreviewPage> Pages);
public interface IMainDraftPreviewRenderer
{
    IReadOnlyList<DraftPreviewPage> Inspect(byte[] pdf);
    Task<byte[]> PageAsync(byte[] pdf, int page, CancellationToken token);
}
