using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

// The legacy Resident is a detached business value; the physical row and typed
// historical snapshot are the persistence boundary.
internal static class NativeResidentPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record ResidentState(Guid Id, Guid? RoomId, string DisplayLabel, ResidentType ResidentType,
        IdentityVerificationStatus VerificationStatus, Guid OwnerUserId, Guid? TenantUserId,
        Guid? HouseholdRepresentativeId, string? HouseholdClientKey, string HouseholdProfile,
        DateTimeOffset? HouseholdConfirmedAt, Guid? HouseholdConfirmedByUserId, int HouseholdVersion,
        Guid? HouseholdRequestKey, string? HouseholdRequestHash, string? ContactEmail, string IdentityData,
        string? IdentityHmac, string? HmacKeyVersion, Guid? ConfirmedByUserId, DateTimeOffset? ConfirmedAt,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    internal static Resident Read(Native.Resident row)
    {
        var entry = row.History.EnumerateArray().Reverse().FirstOrDefault(h => h.ValueKind == JsonValueKind.Object &&
            h.TryGetProperty("recordType", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "Resident");
        var state = entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("state", out var payload)
            ? payload.Deserialize<ResidentState>(Json) : null;
        var resident = Resident.Rehydrate(row.Id, state?.CreatedAt is { } created && created != default ? created : DateTimeOffset.UnixEpoch,
            state?.UpdatedAt is { } updated && updated != default ? updated : DateTimeOffset.UnixEpoch);
        resident.RoomId = row.CurrentRoomId;
        resident.DisplayLabel = row.DisplayLabel;
        resident.ResidentType = state?.ResidentType ?? ResidentType.Representative;
        resident.VerificationStatus = (IdentityVerificationStatus)row.VerificationStatus;
        resident.OwnerUserId = row.IdentityOwnerScopeId;
        resident.TenantUserId = row.UserId;
        resident.HouseholdRepresentativeId = state?.HouseholdRepresentativeId;
        resident.HouseholdClientKey = state?.HouseholdClientKey;
        resident.HouseholdProfile = state?.HouseholdProfile ?? "";
        resident.HouseholdConfirmedAt = state?.HouseholdConfirmedAt;
        resident.HouseholdConfirmedByUserId = state?.HouseholdConfirmedByUserId;
        resident.HouseholdVersion = state?.HouseholdVersion ?? 0;
        resident.HouseholdRequestKey = state?.HouseholdRequestKey;
        resident.HouseholdRequestHash = state?.HouseholdRequestHash;
        resident.ContactEmail = row.ContactEmail;
        resident.IdentityData = row.IdentityData.GetRawText();
        resident.IdentityHmac = row.IdentityHmac;
        resident.HmacKeyVersion = row.HmacKeyVersion;
        resident.ConfirmedByUserId = row.VerifiedByUserId;
        resident.ConfirmedAt = row.VerifiedAt;
        return resident;
    }

    internal static async Task LinkAsync(Compact24DbContext db, Resident resident, Guid tenantId, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Resident link requires its existing room and resident locks.");
        resident.TenantUserId = tenantId;
        resident.Stamp(DateTimeOffset.UtcNow, false);
        var snapshot = new ResidentState(resident.Id, resident.RoomId, resident.DisplayLabel, resident.ResidentType,
            resident.VerificationStatus, resident.OwnerUserId, resident.TenantUserId, resident.HouseholdRepresentativeId,
            resident.HouseholdClientKey, resident.HouseholdProfile, resident.HouseholdConfirmedAt, resident.HouseholdConfirmedByUserId,
            resident.HouseholdVersion, resident.HouseholdRequestKey, resident.HouseholdRequestHash, resident.ContactEmail,
            resident.IdentityData, resident.IdentityHmac, resident.HmacKeyVersion, resident.ConfirmedByUserId, resident.ConfirmedAt,
            resident.CreatedAt, resident.UpdatedAt);
        var history = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "Resident", recordKey = resident.Id.ToString(), deleted = false, state = snapshot }, Json);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE residents SET user_id={tenantId},history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={resident.Id} AND user_id IS NULL
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Resident account link changed.");
    }
}
