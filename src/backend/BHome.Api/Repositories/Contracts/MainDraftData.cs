using BHome.Infrastructure.IdentityAccess;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal sealed class MainDraftData(BHomePersistenceContext db, IIdentityProtection protection) : IMainDraftData
{
    private sealed record StoredSettings(Guid OwnerId, DateOnly From, DateOnly? To, int Version, EncryptedIdentity Envelope);
    private static IdentityProtectionScope OwnerSettingsScope(Guid owner) => new(owner, new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("contract-lessor-owner-wide-v1"))[..16]));
    private T Decode<T>(EncryptedIdentity value, IdentityProtectionScope scope)
    {
        var bytes = protection.Decrypt(value, scope);
        try { return JsonSerializer.Deserialize<T>(bytes) ?? throw ContractException.Conflict("contract_metadata_unavailable"); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    private EncryptedIdentity Encode<T>(T value, IdentityProtectionScope scope)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        try { return protection.Encrypt(bytes, scope); } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    private async Task<Guid> OwnerForLocation(Guid locationId, CancellationToken t)
    {
        Guid[] owners;
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            owners = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.users WHERE 'Owner'=ANY(roles) ORDER BY id LIMIT 2").ToArrayAsync(t);
        else
            owners = await db.Database.SqlQuery<Guid>($"""
                SELECT u.id AS "Value" FROM public.users u
                WHERE 'Owner'=ANY(u.roles) AND (
                    u.business_profile->'chain'->>'id' = (SELECT chain_id::text FROM public.locations WHERE id={locationId} AND is_active)
                    OR (SELECT count(*) FROM public.users WHERE 'Owner'=ANY(roles)) = 1)
                ORDER BY u.id LIMIT 2
                """).ToArrayAsync(t);
        if (!await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.locations WHERE id={locationId} AND is_active").AnyAsync(t)) throw ContractException.Missing();
        if (owners.Length != 1) throw ContractException.Conflict("contract_owner_scope_unavailable");
        return owners[0];
    }
    private async Task<StoredSettings[]> OwnerSettings(Guid ownerId, CancellationToken t)
    {
        var json = await db.Database.SqlQuery<string>($"SELECT COALESCE(business_profile->'mainContractPolicy'->'versions','[]'::jsonb)::text AS \"Value\" FROM public.users WHERE id={ownerId} AND 'Owner'=ANY(roles)").SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        return JsonSerializer.Deserialize<StoredSettings[]>(json) ?? [];
    }
    public async Task<MainContractSettings?> SettingsAsync(Guid ownerId, DateOnly on, CancellationToken t)
    {
        var versions = await OwnerSettings(ownerId, t);
        var matches = versions.GroupBy(s => s.From).Select(g => g.MaxBy(s => s.Version)!).Where(s => s.From <= on && (s.To is null || s.To >= on)).ToArray();
        if (matches.Length > 1) throw ContractException.Conflict("ambiguous_contract_settings");
        var s = matches.SingleOrDefault();
        return s is null ? null : Decode<MainContractSettings>(s.Envelope, OwnerSettingsScope(s.OwnerId));
    }
    public async Task<MainContractSettings?> OwnerSettingsAsync(Guid locationId, CancellationToken t)
    {
        var ownerId = await OwnerForLocation(locationId, t);
        return await OwnerWideSettingsAsync(ownerId, t);
    }
    public async Task SetSettingsAsync(Guid locationId, MainContractSettingsInput input, Guid actor, CancellationToken t)
    {
        var ownerId = await OwnerForLocation(locationId, t);
        if (ownerId != input.OwnerSignerId) throw new ContractException(403, "owner_profile_must_be_own");
        await SetOwnerSettingsAsync(ownerId, input, actor, t);
    }
    public async Task<MainContractSettings?> OwnerWideSettingsAsync(Guid ownerId, CancellationToken t)
    {
        var settings = (await OwnerSettings(ownerId, t)).MaxBy(s => s.Version);
        return settings is null ? null : Decode<MainContractSettings>(settings.Envelope, OwnerSettingsScope(ownerId));
    }
    public async Task SetOwnerSettingsAsync(Guid ownerId, MainContractSettingsInput input, Guid actor, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({ownerId.ToString()},0))", t);
        var locked = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM public.users WHERE id={ownerId} AND 'Owner'=ANY(roles) FOR UPDATE").SingleOrDefaultAsync(t);
        if (locked == Guid.Empty) throw ContractException.Missing();
        var all = await OwnerSettings(ownerId, t);
        var version = all.Select(s => s.Version).DefaultIfEmpty(0).Max();
        if (version != input.ExpectedVersion) throw ContractException.Conflict("draft_configuration_changed_save_again");
        if (all.GroupBy(s => s.From).Select(g => g.MaxBy(s => s.Version)!).Any(s => s.From != input.EffectiveFrom && s.From <= (input.EffectiveTo ?? DateOnly.MaxValue) && input.EffectiveFrom <= (s.To ?? DateOnly.MaxValue))) throw ContractException.Conflict("contract_settings_period_overlaps");
        var value = new MainContractSettings(input.OwnerSignerId, input.EffectiveFrom, input.EffectiveTo, input.PaymentTerms, input.AdditionalTerms, input.Owner, version + 1);
        var saved = all.Append(new StoredSettings(ownerId, input.EffectiveFrom, input.EffectiveTo, version + 1, Encode(value, OwnerSettingsScope(ownerId)))).ToArray();
        var policy = JsonSerializer.Serialize(new { current = saved.MaxBy(s => s.Version), versions = saved });
        var historyEntry = JsonSerializer.Serialize(new { recordType = "OwnerContractSettingsConfigured", recordedAt = DateTimeOffset.UtcNow, actorId = actor, state = saved.MaxBy(s => s.Version) });
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE public.users SET business_profile=jsonb_set(COALESCE(business_profile,'{{}}'::jsonb), '{{mainContractPolicy}}', CAST({policy} AS jsonb), true), history=COALESCE(history,'[]'::jsonb)||jsonb_build_array(CAST({historyEntry} AS jsonb)) WHERE id={ownerId}", t);
        await SecurityAuditWrites.AppendAsync(db, new(Guid.NewGuid(), actor, null, null,
            "OwnerContractSettingsConfigured", true, DateTimeOffset.UtcNow, "Owner", ownerId), t);
        await transaction.CommitAsync(t);
    }
    public async Task<IdentityConfirmation> IdentityAsync(Guid roomId, Guid residentId, CancellationToken t)
    {
        var r = await ResidentAsync(roomId, residentId, t) ?? throw ContractException.Invalid("verified_residents_required");
        if (r.ResidentType == ResidentType.CoOccupant && r.HouseholdRepresentativeId != null && r.HouseholdConfirmedAt != null && !string.IsNullOrWhiteSpace(r.HouseholdProfile) && r.HouseholdProfile != "{}")
        {
            var p = Decode<HouseholdMemberInput>(JsonSerializer.Deserialize<EncryptedIdentity>(r.HouseholdProfile)!, new(r.OwnerUserId, r.Id));
            return new(true, p.CitizenNumber ?? "", p.FullName, p.DateOfBirth, null, null, null, null, null, null);
        }
        if (r.VerificationStatus != IdentityVerificationStatus.Verified) throw ContractException.Invalid("verified_residents_required");
        if (string.IsNullOrWhiteSpace(r.IdentityData) || r.IdentityData == "{}") throw ContractException.Invalid("confirmed_identity_required");
        return Decode<IdentityConfirmation>(JsonSerializer.Deserialize<EncryptedIdentity>(r.IdentityData)!, new(r.OwnerUserId, r.Id));
    }
    public Task<bool> DuplicateAsync(Guid roomId, Guid except, Guid[] people, DateOnly from, DateOnly to, CancellationToken t) =>
        db is Compact24DbContext
        ? db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().AnyAsync(c => c.RoomId == roomId && c.Id != except &&
            (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Renewal || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Holding || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Addendum) &&
            (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning ||
             c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Active) &&
            c.StartDate <= to && c.EndDate >= from && db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(r => r.ContractId == c.Id && people.Contains(r.ResidentId)), t)
        : db.Set<Contract>().AnyAsync(c => c.RoomId == roomId && c.Id != except &&
        (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Active) && c.StartDate <= to && c.EndDate >= from && c.Residents.Any(r => people.Contains(r.ResidentId)), t);
    public Task<string?> PhoneAsync(Guid roomId, Guid residentId, CancellationToken t) =>
        db is Compact24DbContext
        ? (from r in db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking()
           join account in db.Users.AsNoTracking() on r.UserId equals (Guid?)account.Id
           where r.CurrentRoomId == roomId && r.Id == residentId && r.VerificationStatus == IdentityVerificationStatus.Verified
           select account.PhoneNumber).SingleOrDefaultAsync(t)
        : (from r in db.Set<Resident>().AsNoTracking()
           join account in db.Users.AsNoTracking() on r.TenantUserId equals (Guid?)account.Id
           where r.RoomId == roomId && r.Id == residentId && r.VerificationStatus == IdentityVerificationStatus.Verified
           select account.PhoneNumber).SingleOrDefaultAsync(t);
    public async Task<HouseholdMemberInput?> HouseholdMemberAsync(Guid roomId, Guid residentId, CancellationToken t)
    {
        var r = await ResidentAsync(roomId, residentId, t);
        return r?.HouseholdRepresentativeId is null || string.IsNullOrWhiteSpace(r.HouseholdProfile) || r.HouseholdProfile == "{}" ? null :
            Decode<HouseholdMemberInput>(JsonSerializer.Deserialize<EncryptedIdentity>(r.HouseholdProfile)!, new(r.OwnerUserId, r.Id));
    }
    public string Protect(Contract c, MainDraftState state) => JsonSerializer.Serialize(Encode(state, new(c.OwnerSignerId, c.Id)));
    public Task<string?> EmailAsync(Guid roomId, Guid residentId, CancellationToken t) =>
        db is Compact24DbContext
        ? (from r in db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking()
           join account in db.Users.AsNoTracking() on r.UserId equals (Guid?)account.Id
           where r.CurrentRoomId == roomId && r.Id == residentId && r.VerificationStatus == IdentityVerificationStatus.Verified
           select account.Email).SingleOrDefaultAsync(t)
        : (from r in db.Set<Resident>().AsNoTracking()
           join account in db.Users.AsNoTracking() on r.TenantUserId equals (Guid?)account.Id
           where r.RoomId == roomId && r.Id == residentId && r.VerificationStatus == IdentityVerificationStatus.Verified
           select account.Email).SingleOrDefaultAsync(t);
    private async Task<Resident?> ResidentAsync(Guid roomId, Guid residentId, CancellationToken t)
    {
        if (db is not Compact24DbContext)
            return await db.Set<Resident>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == residentId && r.RoomId == roomId, t);
        var row = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == residentId && r.CurrentRoomId == roomId, t);
        return row is null ? null : NativeResidentPersistence.Read(row);
    }
    public MainDraftState Unprotect(Contract c) => Decode<MainDraftState>(JsonSerializer.Deserialize<EncryptedIdentity>(c.DraftMetadata)!, new(c.OwnerSignerId, c.Id));
    public async Task<ContractDocumentFile?> FileAsync(Guid id, Guid fileId, CancellationToken t) =>
        (await ContractDocumentPersistence.ListAsync(db, id, t)).SingleOrDefault(f => f.Id == fileId);
    public async Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid id, string hash, CancellationToken t) =>
        (await ContractDocumentPersistence.ListAsync(db, id, t)).Where(f => f.SnapshotHash == hash).OrderByDescending(f => f.RecordedAt).ToArray();
    public async Task LockConfigurationAsync(Guid id, CancellationToken t)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock_shared(hashtextextended({id.ToString()},0))", t);
    }
}
