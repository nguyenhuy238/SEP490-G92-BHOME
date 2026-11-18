using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Ocr;

// Household fields use the same encrypted envelopes and PostgreSQL Resident history as identity capture.
internal sealed class HouseholdProfiles(Compact24DbContext db, CaptureScope scope, ICurrentUser user,
    IIdentityProtection protection, TimeProvider clock, IMainDraftData drafts) : IHouseholdProfiles
{
    private async Task<Resident> Operator(Guid id, bool write, CancellationToken t)
    {
        if (user.UserId is null || !(user.IsInRole(Roles.Staff) || !write && user.IsInRole(Roles.Owner)))
            throw new OcrAccessException();
        var person = await db.Set<Resident>().AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, t) ?? throw ContractException.Missing();
        if (!await scope.VisibleRooms.AnyAsync(r => r.Id == person.RoomId, t)) throw new OcrAccessException();
        if (person.ResidentType != ResidentType.Representative || person.VerificationStatus != IdentityVerificationStatus.Verified)
            throw ContractException.Conflict("household_representative_not_verified");
        return person;
    }
    private HouseholdMemberInput Profile(Resident resident)
    {
        var bytes = protection.Decrypt(JsonSerializer.Deserialize<EncryptedIdentity>(resident.HouseholdProfile)!, new(resident.OwnerUserId, resident.Id));
        try { return JsonSerializer.Deserialize<HouseholdMemberInput>(bytes)!; }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    private async Task<HouseholdView> Read(Resident representative, Guid[]? ids, CancellationToken t)
    {
        var query = db.Set<Resident>().AsNoTracking().Where(r => r.Id != representative.Id && r.OwnerUserId == representative.OwnerUserId);
        query = ids is null ? query.Where(r => r.HouseholdRepresentativeId == representative.Id) : query.Where(r => ids.Contains(r.Id));
        var members = await query.OrderBy(r => r.HouseholdClientKey).ToArrayAsync(t);
        HouseholdRepresentativeView? primary = null;
        if (!string.IsNullOrWhiteSpace(representative.IdentityData) && representative.IdentityData != "{}") {
            var bytes = protection.Decrypt(JsonSerializer.Deserialize<EncryptedIdentity>(representative.IdentityData)!, new(representative.OwnerUserId, representative.Id));
            try {
                var p = JsonSerializer.Deserialize<IdentityConfirmation>(bytes)!;
                var phone = representative.TenantUserId is { } account ? await db.Users.Where(u => u.Id == account).Select(u => u.PhoneNumber).SingleOrDefaultAsync(t) : null;
                primary = new(p.FullName,p.DateOfBirth,phone,p.CitizenIdentityNumber is { Length: >=4 } number ? "********"+number[^4..] : null);
            } finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        var draftId = await db.Set<Contract>().Where(c => c.RepresentativeResidentId == representative.Id && c.Kind == ContractKind.Main && c.Status == ContractStatus.Draft)
            .OrderByDescending(c => c.CreatedAt).Select(c => (Guid?)c.Id).FirstOrDefaultAsync(t);
        return new(representative.Id, representative.HouseholdVersion, members.Select(r => {
            if (!string.IsNullOrWhiteSpace(r.HouseholdProfile) && r.HouseholdProfile != "{}") {
                var p = Profile(r); return new HouseholdMemberView(r.Id, p.ClientKey, p.FullName, p.DateOfBirth, p.Relationship, p.Phone, p.CitizenNumber);
            }
            if (!string.IsNullOrWhiteSpace(r.IdentityData) && r.IdentityData != "{}") {
                var bytes = protection.Decrypt(JsonSerializer.Deserialize<EncryptedIdentity>(r.IdentityData)!, new(r.OwnerUserId,r.Id));
                try { var p=JsonSerializer.Deserialize<IdentityConfirmation>(bytes)!;
                    return new HouseholdMemberView(r.Id,r.Id.ToString("N"),p.FullName,p.DateOfBirth,"Thành viên cùng ở",null,p.CitizenIdentityNumber);
                } finally { CryptographicOperations.ZeroMemory(bytes); }
            }
            return new HouseholdMemberView(r.Id,r.Id.ToString("N"),r.DisplayLabel,default,"Thành viên cùng ở",null,null);
        }).ToArray(),primary,draftId);
    }
    public async Task<HouseholdView> GetAsync(Guid representative, CancellationToken t) => await Read(await Operator(representative, false, t), null, t);
    public async Task<HouseholdView> ContractAsync(Guid contract, CancellationToken t)
    {
        if (user.UserId is not { } actor) throw new OcrAccessException();
        var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).SingleOrDefaultAsync(c => c.Id == contract, t)
            ?? throw ContractException.Missing();
        var representative = await db.Set<Resident>().AsNoTracking().SingleAsync(r => r.Id == c.RepresentativeResidentId, t);
        var allowed = user.IsInRole(Roles.Tenant) && c.TenantUserId == actor && representative.TenantUserId == actor ||
            user.IsInRole(Roles.Owner) && c.OwnerSignerId == actor || user.IsInRole(Roles.Staff) && await scope.VisibleRooms.AnyAsync(r => r.Id == c.RoomId, t);
        if (!allowed) throw ContractException.Missing();
        return await Read(representative, c.Residents.Select(r => r.ResidentId).ToArray(), t);
    }
    public async Task<HouseholdView> SaveAsync(Guid id, HouseholdSaveInput input, Guid key, CancellationToken t)
    {
        await Operator(id, true, t);
        if (key == Guid.Empty || !input.HumanConfirmed || input.Members is null || input.ExpectedVersion < 0)
            throw ContractException.Invalid("invalid_household_input");
        var today = DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(7)).DateTime);
        if (input.Members.Any(m => m is null || string.IsNullOrWhiteSpace(m.ClientKey) || m.ClientKey.Length > 80 ||
            string.IsNullOrWhiteSpace(m.FullName) || m.FullName.Trim().Length > 150 || m.DateOfBirth == default || m.DateOfBirth > today ||
            string.IsNullOrWhiteSpace(m.Relationship) || m.Relationship.Trim().Length > 100 ||
            !string.IsNullOrWhiteSpace(m.Phone) && ContactPhone.Normalize(m.Phone) is null ||
            !string.IsNullOrWhiteSpace(m.CitizenNumber) && !System.Text.RegularExpressions.Regex.IsMatch(m.CitizenNumber.Trim(), "^[0-9]{12}$")) ||
            input.Members.Select(m => m.ClientKey).Distinct().Count() != input.Members.Length ||
            input.Members.Where(m => m.ResidentId.HasValue).Select(m => m.ResidentId).Distinct().Count() != input.Members.Count(m => m.ResidentId.HasValue) ||
            input.Members.Any(m => m.ResidentId == id) ||
            input.Members.Where(m => !string.IsNullOrWhiteSpace(m.CitizenNumber)).Select(m => m.CitizenNumber!.Trim()).Distinct().Count() != input.Members.Count(m => !string.IsNullOrWhiteSpace(m.CitizenNumber)))
            throw ContractException.Invalid("invalid_household_members");
        var hash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input)));
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var before = await Operator(id, true, t);
        var location = await scope.VisibleRooms.Where(r => r.Id == before.RoomId).Select(r => r.LocationId).SingleAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))", t);
        // Same room lock as contract creation serializes capacity and contract/household changes.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM rooms WHERE id={before.RoomId} FOR UPDATE", t);
        await db.Locked<ApplicationUser>(before.OwnerUserId).SingleAsync(t);
        var representative = await db.Locked<Resident>(id).SingleAsync(t);
        if (representative.RoomId != before.RoomId || representative.OwnerUserId != before.OwnerUserId || representative.VerificationStatus != IdentityVerificationStatus.Verified)
            throw ContractException.Conflict("household_representative_not_verified");
        if (representative.HouseholdRequestKey == key) {
            if (representative.HouseholdRequestHash != hash) throw ContractException.Conflict("idempotency_key_reused");
            await tx.CommitAsync(t); return await Read(representative, null, t);
        }
        if (representative.HouseholdVersion != input.ExpectedVersion) throw ContractException.Conflict("household_version_changed");
        var room = await scope.VisibleRooms.AsNoTracking().SingleOrDefaultAsync(r => r.Id == representative.RoomId, t) ?? throw new OcrAccessException();
        if (room.Status is not (BHome.Domain.PropertyManagement.RoomStatus.Available or BHome.Domain.PropertyManagement.RoomStatus.Occupied))
            throw ContractException.Conflict("room_not_available");
        var occupying = await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == room.Id && c.Status == ContractStatus.Active && c.Kind != ContractKind.Holding)
            .SelectMany(c => c.Residents.Select(r => r.ResidentId)).Distinct().CountAsync(t);
        if (input.Members.Length + 1 > room.Capacity - occupying) throw ContractException.Conflict("room_capacity_exceeded");
        var bound = await db.Set<Contract>().Include(c => c.Residents).Include(c => c.Signatures)
            .Where(c => c.Residents.Any(r => r.ResidentId == id) && c.Status != ContractStatus.Cancelled && c.Status != ContractStatus.Expired).ToArrayAsync(t);
        if (bound.Any(c => c.Status != ContractStatus.Draft || c.Signatures.Count != 0 || c.Kind != ContractKind.Main || c.DraftMetadata == "{}"))
            throw ContractException.Conflict("household_already_used_by_contract");
        var previous = await db.Set<Resident>().Where(r => r.HouseholdRepresentativeId == id).ToArrayAsync(t);
        var keep = new HashSet<Guid>();
        foreach (var member in input.Members)
        {
            var resident = previous.SingleOrDefault(r => r.HouseholdClientKey == member.ClientKey);
            if (member.ResidentId is { } existing && (resident is null || resident.Id != existing))
                throw ContractException.Conflict("household_member_mismatch");
            var created = resident is null;
            resident ??= new Resident { RoomId = room.Id, OwnerUserId = representative.OwnerUserId, ResidentType = ResidentType.CoOccupant,
                DisplayLabel = "Thành viên hộ gia đình", HouseholdRepresentativeId = id, HouseholdClientKey = member.ClientKey };
            if (!string.IsNullOrWhiteSpace(member.CitizenNumber)) {
                var index = protection.CreateMatchIndex(member.CitizenNumber.Trim(), resident.OwnerUserId);
                var digests = protection.CreateMatchIndexes(member.CitizenNumber.Trim(), resident.OwnerUserId).Select(i => i.Digest).ToArray();
                if (await db.Set<Resident>().AnyAsync(r => r.Id != resident.Id && r.IdentityHmac != null && digests.Contains(r.IdentityHmac), t))
                    throw ContractException.Conflict("duplicate_or_conflicting_record");
                resident.IdentityHmac = index.Digest; resident.HmacKeyVersion = index.KeyVersion;
            } else { resident.IdentityHmac = null; resident.HmacKeyVersion = null; }
            var normalized = member with { FullName = member.FullName.Trim().Normalize(), Relationship = member.Relationship.Trim(),
                Phone = string.IsNullOrWhiteSpace(member.Phone) ? null : ContactPhone.Normalize(member.Phone),
                CitizenNumber = string.IsNullOrWhiteSpace(member.CitizenNumber) ? null : member.CitizenNumber.Trim(), ResidentId = resident.Id };
            var bytes = JsonSerializer.SerializeToUtf8Bytes(normalized);
            try { resident.HouseholdProfile = JsonSerializer.Serialize(protection.Encrypt(bytes, new(resident.OwnerUserId, resident.Id))); }
            finally { CryptographicOperations.ZeroMemory(bytes); }
            resident.HouseholdConfirmedByUserId = user.UserId; resident.HouseholdConfirmedAt = clock.GetUtcNow();
            if (created) db.Add(resident);
            keep.Add(resident.Id);
        }
        foreach (var removed in previous.Where(r => !keep.Contains(r.Id))) {
            removed.HouseholdRepresentativeId = null;
            if (removed.VerificationStatus != IdentityVerificationStatus.Verified && (removed.IdentityData == "{}" || string.IsNullOrWhiteSpace(removed.IdentityData))) {
                removed.IdentityHmac = null; removed.HmacKeyVersion = null;
            }
        }
        // An unsigned shared Main draft follows roster edits atomically. Old previews become stale;
        // signatures/issued invitations are never modified and have already been rejected above.
        foreach (var draft in bound) {
            var state = drafts.Unprotect(draft);
            var ids = new[] { id }.Concat(keep.Order()).ToArray();
            state = state with { Input = state.Input with { ResidentIds = ids, ExpectedVersion = draft.DraftVersion + 1 } };
            foreach (var removed in draft.Residents.Where(r => !ids.Contains(r.ResidentId)).ToArray()) draft.Residents.Remove(removed);
            foreach (var resident in ids.Where(resident => draft.Residents.All(r => r.ResidentId != resident)))
                draft.Residents.Add(new ContractResident { ContractId = draft.Id, ResidentId = resident,
                    Role = resident == id ? ResidentType.Representative : ResidentType.CoOccupant, ResidenceFrom = draft.StartDate });
            draft.DraftVersion++;
            draft.DraftMetadata = drafts.Protect(draft,state);
            draft.SnapshotHash = MainDraftService.Snapshot(draft,state);
        }
        representative.HouseholdVersion++; representative.HouseholdRequestKey = key; representative.HouseholdRequestHash = hash;
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = user.UserId, Event = "HouseholdSaved", TargetType = "Resident", TargetId = id, Succeeded = true, OccurredAt = clock.GetUtcNow() });
        await db.SaveChangesAsync(t); await tx.CommitAsync(t);
        return await Read(representative, null, t);
    }
}
