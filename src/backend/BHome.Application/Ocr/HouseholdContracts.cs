using BHome.Domain.TenantContracts;

namespace BHome.Application.Ocr;

public sealed record HouseholdMemberInput(string ClientKey, string FullName, DateOnly DateOfBirth,
    string Relationship, string? Phone = null, string? CitizenNumber = null, Guid? ResidentId = null)
{ public override string ToString() => "Household member (personal data omitted)"; }
public sealed record HouseholdSaveInput(int ExpectedVersion, bool HumanConfirmed, HouseholdMemberInput[] Members);
public sealed record HouseholdMemberView(Guid ResidentId, string ClientKey, string FullName, DateOnly DateOfBirth,
    string Relationship, string? Phone, string? CitizenNumber)
{ public override string ToString() => "Household member (personal data omitted)"; }
public sealed record HouseholdRepresentativeView(string FullName, DateOnly DateOfBirth, string? Phone, string? MaskedCitizenNumber);
public sealed record HouseholdView(Guid RepresentativeResidentId, int Version, IReadOnlyList<HouseholdMemberView> Members,
    HouseholdRepresentativeView? Representative = null, Guid? DraftId = null);
public interface IHouseholdProfiles
{
    Task<HouseholdView> GetAsync(Guid representative, CancellationToken t);
    Task<HouseholdView> SaveAsync(Guid representative, HouseholdSaveInput input, Guid key, CancellationToken t);
    Task<HouseholdView> ContractAsync(Guid contract, CancellationToken t);
}
public static class ContractResidentEligibility
{
    public static bool Ready(Resident resident, Guid representative) =>
        (resident.HouseholdRepresentativeId is null || resident.HouseholdRepresentativeId == representative) && (
        resident.VerificationStatus == IdentityVerificationStatus.Verified ||
        resident.ResidentType == ResidentType.CoOccupant && resident.HouseholdRepresentativeId == representative &&
        !string.IsNullOrWhiteSpace(resident.HouseholdProfile) && resident.HouseholdProfile != "{}" && resident.HouseholdConfirmedAt != null);
}
