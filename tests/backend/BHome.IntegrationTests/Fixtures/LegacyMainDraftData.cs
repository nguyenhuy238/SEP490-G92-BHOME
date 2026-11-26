using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.Locations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Fixtures;

// The archived import source stores encrypted settings on Locations. Keep that
// source shape in tests; production uses users.business_profile in Compact24.
internal sealed class LegacyMainDraftData(BHomePersistenceContext db, IIdentityProtection protection) : IMainDraftData
{
    private readonly MainDraftData documents = new(db, protection);
    private sealed record StoredSettings(Guid OwnerId, DateOnly From, DateOnly? To, int Version, EncryptedIdentity Envelope);
    private static IdentityProtectionScope Scope(Guid owner, Guid location) =>
        new(owner, new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("contract-lessor:" + location.ToString("D")))[..16]));
    private static StoredSettings[] Read(string json) => JsonSerializer.Deserialize<StoredSettings[]>(json) ?? [];
    private MainContractSettings Decode(Guid location, StoredSettings settings)
    {
        var bytes = protection.Decrypt(settings.Envelope, Scope(settings.OwnerId, location));
        try { return JsonSerializer.Deserialize<MainContractSettings>(bytes) ?? throw ContractException.Conflict("contract_metadata_unavailable"); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    private async Task<(Guid Location, StoredSettings Settings)[]> OwnerVersions(Guid owner, CancellationToken t)
    {
        var locations = await db.Locations.AsNoTracking().Where(l => l.IsActive)
            .Select(l => new { l.Id, l.ContractSettings }).ToArrayAsync(t);
        return locations.SelectMany(l => Read(l.ContractSettings).Where(s => s.OwnerId == owner).Select(s => (l.Id, s))).ToArray();
    }
    public async Task<MainContractSettings?> SettingsAsync(Guid ownerId, DateOnly on, CancellationToken t)
    {
        var matches = (await OwnerVersions(ownerId, t)).GroupBy(v => v.Settings.From)
            .Select(g => g.MaxBy(v => v.Settings.Version)).Where(v => v.Settings.From <= on && (v.Settings.To is null || v.Settings.To >= on)).ToArray();
        if (matches.Length > 1) throw ContractException.Conflict("ambiguous_contract_settings");
        return matches.Length == 0 ? null : Decode(matches[0].Location, matches[0].Settings);
    }
    public async Task<MainContractSettings?> OwnerWideSettingsAsync(Guid ownerId, CancellationToken t)
    {
        var versions = await OwnerVersions(ownerId, t);
        if (versions.Length == 0) return null;
        var latest = versions.MaxBy(v => v.Settings.Version);
        return Decode(latest.Location, latest.Settings);
    }
    public async Task<MainContractSettings?> OwnerSettingsAsync(Guid locationId, CancellationToken t)
    {
        var json = await db.Locations.AsNoTracking().Where(l => l.Id == locationId && l.IsActive).Select(l => l.ContractSettings).SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        var current = Read(json).MaxBy(s => s.Version);
        return current is null ? null : await OwnerWideSettingsAsync(current.OwnerId, t);
    }
    public Task SetSettingsAsync(Guid locationId, MainContractSettingsInput input, Guid actor, CancellationToken t) =>
        Save(locationId, input.OwnerSignerId, input, actor, t);
    public async Task SetOwnerSettingsAsync(Guid ownerId, MainContractSettingsInput input, Guid actor, CancellationToken t)
    {
        var location = await db.Set<Resident>().Where(r => r.OwnerUserId == ownerId)
            .Select(r => r.Room.LocationId).OrderBy(id => id).FirstOrDefaultAsync(t);
        if (location == Guid.Empty) throw ContractException.Missing();
        await Save(location, ownerId, input, actor, t);
    }
    private async Task Save(Guid locationId, Guid ownerId, MainContractSettingsInput input, Guid actor, CancellationToken t)
    {
        if (actor != ownerId || input.OwnerSignerId != ownerId) throw new ContractException(403, "owner_profile_must_be_own");
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({ownerId.ToString()},0))", t);
        var location = await db.Locked<Location>(locationId).SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
        var all = (await OwnerVersions(ownerId, t)).Select(v => v.Settings).ToArray();
        var version = all.Select(s => s.Version).DefaultIfEmpty(0).Max();
        if (version != input.ExpectedVersion) throw ContractException.Conflict("draft_configuration_changed_save_again");
        if (all.GroupBy(s => s.From).Select(g => g.MaxBy(s => s.Version)!).Any(s => s.From != input.EffectiveFrom && s.From <= (input.EffectiveTo ?? DateOnly.MaxValue) && input.EffectiveFrom <= (s.To ?? DateOnly.MaxValue)))
            throw ContractException.Conflict("contract_settings_period_overlaps");
        var value = new MainContractSettings(ownerId, input.EffectiveFrom, input.EffectiveTo, input.PaymentTerms, input.AdditionalTerms, input.Owner, version + 1);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        EncryptedIdentity envelope;
        try { envelope = protection.Encrypt(bytes, Scope(ownerId, locationId)); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
        location.ContractSettings = JsonSerializer.Serialize(Read(location.ContractSettings).Append(new(ownerId, input.EffectiveFrom, input.EffectiveTo, version + 1, envelope)));
        location.Version++;
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = actor, Event = "OwnerContractSettingsConfigured", TargetType = "Owner", TargetId = ownerId, Succeeded = true, OccurredAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(t);
        await transaction.CommitAsync(t);
    }
    public Task<IdentityConfirmation> IdentityAsync(Guid roomId, Guid residentId, CancellationToken t) => documents.IdentityAsync(roomId, residentId, t);
    public Task<string?> PhoneAsync(Guid roomId, Guid residentId, CancellationToken t) => documents.PhoneAsync(roomId, residentId, t);
    public Task<string?> EmailAsync(Guid roomId, Guid residentId, CancellationToken t) => documents.EmailAsync(roomId, residentId, t);
    public Task<HouseholdMemberInput?> HouseholdMemberAsync(Guid roomId, Guid residentId, CancellationToken t) => documents.HouseholdMemberAsync(roomId, residentId, t);
    public Task<bool> DuplicateAsync(Guid roomId, Guid except, Guid[] people, DateOnly from, DateOnly to, CancellationToken t) => documents.DuplicateAsync(roomId, except, people, from, to, t);
    public string Protect(Contract contract, MainDraftState value) => documents.Protect(contract, value);
    public MainDraftState Unprotect(Contract contract) => documents.Unprotect(contract);
    public Task<ContractDocumentFile?> FileAsync(Guid contractId, Guid fileId, CancellationToken t) => documents.FileAsync(contractId, fileId, t);
    public Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid contractId, string hash, CancellationToken t) => documents.FilesAsync(contractId, hash, t);
    public Task LockConfigurationAsync(Guid ownerId, CancellationToken t) => documents.LockConfigurationAsync(ownerId, t);
}
