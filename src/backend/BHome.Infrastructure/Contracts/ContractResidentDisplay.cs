using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;

namespace BHome.Infrastructure.Contracts;

internal static class ContractResidentDisplay
{
    internal static (string Name, string? Number) Read(Resident resident, IIdentityProtection? protection)
    {
        if (protection is null) return (resident.DisplayLabel, null);
        var household = resident.ResidentType == ResidentType.CoOccupant && resident.HouseholdConfirmedAt != null && resident.HouseholdProfile != "{}";
        var json = household ? resident.HouseholdProfile : resident.IdentityData;
        if (string.IsNullOrWhiteSpace(json) || json == "{}") return (resident.DisplayLabel, null);
        byte[]? bytes = null;
        try
        {
            var envelope = JsonSerializer.Deserialize<EncryptedIdentity>(json);
            if (envelope is null) return (resident.DisplayLabel, null);
            bytes = protection.Decrypt(envelope, new(resident.OwnerUserId, resident.Id));
            if (household)
            {
                var member = JsonSerializer.Deserialize<HouseholdMemberInput>(bytes);
                return (member?.FullName ?? resident.DisplayLabel, member?.CitizenNumber);
            }
            var identity = JsonSerializer.Deserialize<IdentityConfirmation>(bytes);
            return identity is { HumanConfirmed: true } ? (identity.FullName, identity.CitizenIdentityNumber) : (resident.DisplayLabel, null);
        }
        catch (Exception e) when (e is JsonException or CryptographicException or ArgumentException or InvalidOperationException)
        { return (resident.DisplayLabel, null); }
        finally { if (bytes is not null) CryptographicOperations.ZeroMemory(bytes); }
    }
}
