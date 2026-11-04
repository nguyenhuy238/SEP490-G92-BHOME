using BHome.Infrastructure.IdentityAccess;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class MainDraftData(BHomePersistenceContext db, IIdentityProtection protection) : IMainDraftData
{
    private sealed record StoredSettings(Guid OwnerId, DateOnly From, DateOnly? To, int Version, EncryptedIdentity Envelope);
    private static IdentityProtectionScope SettingsScope(Guid owner, Guid location) => new(owner, new Guid(SHA256.HashData(Encoding.UTF8.GetBytes($"contract-lessor:{location:N}"))[..16]));
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
    private async Task<StoredSettings[]> AllSettings(Guid location, CancellationToken t)
    {
        var json = await db.Locations.Where(l => l.Id == location && l.IsActive).Select(l => l.ContractSettings).SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
        return JsonSerializer.Deserialize<StoredSettings[]>(json) ?? [];
    }
    public async Task<MainContractSettings?> SettingsAsync(Guid locationId, DateOnly on, CancellationToken t)
    {
        var matches = (await AllSettings(locationId, t)).GroupBy(s => s.From).Select(g => g.MaxBy(s => s.Version)!).Where(s => s.From <= on && (s.To is null || s.To >= on)).ToArray();
        if (matches.Length > 1) throw ContractException.Conflict("ambiguous_contract_settings");
        var s = matches.SingleOrDefault();
        return s is null ? null : Decode<MainContractSettings>(s.Envelope, SettingsScope(s.OwnerId, locationId));
    }
    public async Task<MainContractSettings?> OwnerSettingsAsync(Guid locationId, CancellationToken t)
    {
        var s = (await AllSettings(locationId, t)).MaxBy(s => s.Version);
        return s is null ? null : Decode<MainContractSettings>(s.Envelope, SettingsScope(s.OwnerId, locationId));
    }
    public async Task SetSettingsAsync(Guid locationId, MainContractSettingsInput input, Guid actor, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        var location = await db.Locked<BHome.Domain.Locations.Location>(locationId).SingleOrDefaultAsync(t) ?? throw ContractException.Missing();
        var all = JsonSerializer.Deserialize<StoredSettings[]>(location.ContractSettings) ?? [];
        var version = all.Select(s => s.Version).DefaultIfEmpty(0).Max();
        if (version != input.ExpectedVersion) throw ContractException.Conflict("draft_configuration_changed_save_again");
        if (all.GroupBy(s => s.From).Select(g => g.MaxBy(s => s.Version)!).Any(s => s.From != input.EffectiveFrom && s.From <= (input.EffectiveTo ?? DateOnly.MaxValue) && input.EffectiveFrom <= (s.To ?? DateOnly.MaxValue))) throw ContractException.Conflict("contract_settings_period_overlaps");
        var value = new MainContractSettings(input.OwnerSignerId, input.EffectiveFrom, input.EffectiveTo, input.SecurityDeposit, input.PaymentTerms, input.AdditionalTerms, input.Owner, version + 1);
        location.ContractSettings = JsonSerializer.Serialize(all.Append(new(input.OwnerSignerId, input.EffectiveFrom, input.EffectiveTo, version + 1, Encode(value, SettingsScope(input.OwnerSignerId, locationId)))));
        location.Version++;
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = actor, Event = "ContractSettingsConfigured", TargetType = "Location", TargetId = locationId, Succeeded = true, OccurredAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(t); await transaction.CommitAsync(t);
    }
    public async Task<IdentityConfirmation> IdentityAsync(Guid roomId, Guid residentId, CancellationToken t)
    {
        var r = await db.Set<Resident>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == residentId && r.RoomId == roomId && r.VerificationStatus == IdentityVerificationStatus.Verified, t) ?? throw ContractException.Invalid("verified_residents_required");
        if (string.IsNullOrWhiteSpace(r.IdentityData) || r.IdentityData == "{}") throw ContractException.Invalid("confirmed_identity_required");
        return Decode<IdentityConfirmation>(JsonSerializer.Deserialize<EncryptedIdentity>(r.IdentityData)!, new(r.OwnerUserId, r.Id));
    }
    public Task<bool> DuplicateAsync(Guid roomId, Guid except, Guid[] people, DateOnly from, DateOnly to, CancellationToken t) => db.Set<Contract>().AnyAsync(c => c.RoomId == roomId && c.Id != except &&
        (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Active) && c.StartDate <= to && c.EndDate >= from && c.Residents.Any(r => people.Contains(r.ResidentId)), t);
    public Task<string?> PhoneAsync(Guid roomId, Guid residentId, CancellationToken t) =>
        (from r in db.Set<Resident>().AsNoTracking()
         join account in db.Users.AsNoTracking() on r.TenantUserId equals (Guid?)account.Id
         where r.RoomId == roomId && r.Id == residentId && r.VerificationStatus == IdentityVerificationStatus.Verified
         select account.PhoneNumber).SingleOrDefaultAsync(t);
    public string Protect(Contract c, MainDraftState state) => JsonSerializer.Serialize(Encode(state, new(c.OwnerSignerId, c.Id)));
    public MainDraftState Unprotect(Contract c) => Decode<MainDraftState>(JsonSerializer.Deserialize<EncryptedIdentity>(c.DraftMetadata)!, new(c.OwnerSignerId, c.Id));
    public Task<ContractDocumentFile?> FileAsync(Guid id, Guid fileId, CancellationToken t) => db.Set<ContractDocumentFile>().AsNoTracking().SingleOrDefaultAsync(f => f.Id == fileId && f.ContractId == id, t);
    public async Task<IReadOnlyList<ContractDocumentFile>> FilesAsync(Guid id, string hash, CancellationToken t) => await db.Set<ContractDocumentFile>().AsNoTracking().Where(f => f.ContractId == id && f.SnapshotHash == hash).OrderByDescending(f => f.RecordedAt).ToArrayAsync(t);
    public async Task LockConfigurationAsync(Guid id, CancellationToken t)
    {
        await db.Locked<BHome.Domain.Locations.Location>(id, shared: true).SingleAsync(t);
    }
}
