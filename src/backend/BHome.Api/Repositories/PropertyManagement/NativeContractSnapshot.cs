using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

// Physical columns are authoritative. The typed root history stores the extra
// business fields and is shared with the existing contract readers during migration.
internal static class NativeContractSnapshot
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal sealed record ContractState(
        Guid Id, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, Guid RoomId, Guid OwnerSignerId,
        Guid? TenantUserId, string DraftMetadata, int DraftVersion, Guid RepresentativeResidentId,
        Guid? PreviousContractId, Guid? ParentContractId, Guid? HoldingContractId,
        decimal AppliedHoldingDeposit, string? HoldingAllocationReference, DateTimeOffset? HoldingExpiryAt,
        short? ReservedCapacity, Guid? ApprovedByUserId, DateTimeOffset? ApprovedAt, string? ApprovalReason,
        string AgreedPriceSnapshot, string? PriceLockTrigger, DateTimeOffset? PriceLockedAt,
        Guid? ConvertedMainContractId, Guid? LifecycleActorId, DateTimeOffset? LifecycleAt, string? LifecycleReason,
        ContractKind Kind, ContractStatus Status, DateOnly StartDate, DateOnly EndDate, decimal MonthlyRent,
        decimal RequiredDeposit, string Terms, string SnapshotHash, bool IsDevelopmentDemo,
        string SigningMode, string InternalAcceptance, bool InitialPaymentRequired, string? PaymentMode,
        string OperatingPolicySnapshot, Guid? ActivatedByUserId, DateTimeOffset? ActivatedAt, DateOnly? ActualEndDate);

    internal sealed record ResidentState(Guid ContractId, Guid ResidentId, ResidentType Role, DateOnly ResidenceFrom, DateOnly? ResidenceTo);
    internal sealed record SignatureState(Guid Id, Guid ContractId, Guid SignerUserId, Guid CertificateId,
        SignatureStatus Status, string SnapshotHash, string SourceHash, string PreparedHash, string PreparedObjectKey,
        string FieldName, string DocumentDigest, string DataToSignDigest, string CertificateChain, string ProviderUserId,
        string CredentialId, string? ProviderReference, string? SignedObjectKey, string? SignedHash,
        DateTimeOffset? SignedAt, DateTimeOffset ExpiresAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
    private sealed record History<T>(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, T State);

    private static JsonElement LastState(JsonElement history, string kind)
    {
        var item = history.EnumerateArray().Reverse().FirstOrDefault(e => e.ValueKind == JsonValueKind.Object &&
            e.TryGetProperty("recordType", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == kind);
        return item.ValueKind == JsonValueKind.Object && item.TryGetProperty("state", out var state) ? state : default;
    }
    private static string HistoryJson<T>(string kind, string key, T state) =>
        JsonSerializer.Serialize(new[] { new History<T>(1, kind, key, false, state) }, Json);

    internal static Contract Read(Contract row)
    {
        var data = LastState(row.History, "Contract");
        var state = data.ValueKind == JsonValueKind.Object ? data.Deserialize<ContractState>(Json) : null;
        DateTimeOffset At(string name) => data.ValueKind == JsonValueKind.Object &&
            data.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        var contract = row;
        contract.CreatedAt = At("createdAt");
        contract.UpdatedAt = At("updatedAt");
        contract.HoldingAllocationReference = state?.HoldingAllocationReference;
        contract.ApprovedByUserId = state?.ApprovedByUserId;
        contract.ApprovedAt = state?.ApprovedAt;
        contract.ApprovalReason = state?.ApprovalReason;
        contract.AgreedPriceSnapshot = state?.AgreedPriceSnapshot ?? "{}";
        contract.PriceLockTrigger = state?.PriceLockTrigger;
        contract.PriceLockedAt = state?.PriceLockedAt;
        contract.ConvertedMainContractId = state?.ConvertedMainContractId;
        contract.LifecycleActorId = state?.LifecycleActorId;
        contract.LifecycleAt = state?.LifecycleAt;
        contract.LifecycleReason = state?.LifecycleReason;
        contract.IsDevelopmentDemo = state?.IsDevelopmentDemo ?? false;
        contract.SigningMode = state?.SigningMode ?? "";
        contract.InternalAcceptance = state?.InternalAcceptance ?? "{}";
        contract.InitialPaymentRequired = state?.InitialPaymentRequired ?? false;
        contract.PaymentMode = state?.PaymentMode;
        contract.OperatingPolicySnapshot = state?.OperatingPolicySnapshot ?? "";
        return contract;
    }

    internal static ContractSignature Read(ContractSignature row)
    {
        var state = row.SigningData.TryGetProperty("compactState", out var value) ? value : default;
        string Text(string key) => state.ValueKind == JsonValueKind.Object && state.TryGetProperty(key, out var field) &&
            field.ValueKind == JsonValueKind.String ? field.GetString()! : "";
        var signature = row;
        signature.FieldName = Text("fieldName");
        signature.DocumentDigest = Text("documentDigest");
        signature.DataToSignDigest = Text("dataToSignDigest");
        signature.CertificateChain = Text("certificateChain");
        signature.ProviderUserId = Text("providerUserId");
        signature.CredentialId = Text("credentialId");
        signature.UpdatedAt = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("updatedAt", out var at) &&
            at.ValueKind != JsonValueKind.Null ? at.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        return signature;
    }

    internal static async Task<Contract?> LoadAsync(Compact24DbContext db, Guid id, CancellationToken token)
    {
        var row = await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, token);
        if (row is null || !Enum.IsDefined(row.Kind)) return null;
        var contract = Read(row);
        var room = await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().SingleAsync(r => r.Id == row.RoomId, token);
        var location = await db.Set<BHome.Domain.Locations.Location>().AsNoTracking().SingleAsync(l => l.Id == room.LocationId, token);
        contract.Room = NativeRoomLocationPersistence.Read(room);
        contract.Room.Location = NativeRoomLocationPersistence.Read(location);
        RestoreRoomType(contract.Room, location.OperatingSettings);
        contract.Residents = (await db.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking().Where(r => r.ContractId == id)
            .ToArrayAsync(token)).ToList();
        contract.Signatures = (await db.Set<BHome.Domain.TenantContracts.ContractSignature>().AsNoTracking().Where(s => s.ContractId == id)
            .ToArrayAsync(token)).Select(Read).ToList();
        return contract;
    }

    internal static void RestoreRoomType(Room room, JsonElement settings)
    {
        if (room.RoomTypeId is not { } id || settings.ValueKind != JsonValueKind.Object ||
            !settings.TryGetProperty("legacyRoomTypes", out var types) || types.ValueKind != JsonValueKind.Array) return;
        foreach (var type in types.EnumerateArray())
            if (type.ValueKind == JsonValueKind.Object && type.TryGetProperty("id", out var key) &&
                key.ValueKind == JsonValueKind.String && key.GetGuid() == id)
            {
                room.RoomType = type.Deserialize<RoomType>(Json);
                return;
            }
    }

    internal static ContractState Snapshot(Contract c) => new(c.Id, c.CreatedAt, c.UpdatedAt, c.RoomId, c.OwnerSignerId, c.TenantUserId,
        c.DraftMetadata, c.DraftVersion, c.RepresentativeResidentId, c.PreviousContractId, c.ParentContractId,
        c.HoldingContractId, c.AppliedHoldingDeposit, c.HoldingAllocationReference, c.HoldingExpiryAt,
        c.ReservedCapacity, c.ApprovedByUserId, c.ApprovedAt, c.ApprovalReason, c.AgreedPriceSnapshot,
        c.PriceLockTrigger, c.PriceLockedAt, c.ConvertedMainContractId, c.LifecycleActorId, c.LifecycleAt,
        c.LifecycleReason, c.Kind, c.Status, c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit,
        c.Terms, c.SnapshotHash, c.IsDevelopmentDemo, c.SigningMode, c.InternalAcceptance,
        c.InitialPaymentRequired, c.PaymentMode, c.OperatingPolicySnapshot, c.ActivatedByUserId, c.ActivatedAt, c.ActualEndDate);

    internal static ResidentState Snapshot(ContractResident r) => new(r.ContractId, r.ResidentId, r.Role, r.ResidenceFrom, r.ResidenceTo);
    internal static SignatureState Snapshot(ContractSignature s) => new(s.Id, s.ContractId, s.SignerUserId, s.CertificateId,
        s.Status, s.SnapshotHash, s.SourceHash, s.PreparedHash, s.PreparedObjectKey, s.FieldName, s.DocumentDigest,
        s.DataToSignDigest, s.CertificateChain, s.ProviderUserId, s.CredentialId, s.ProviderReference, s.SignedObjectKey,
        s.SignedHash, s.SignedAt, s.ExpiresAt, s.CreatedAt, s.UpdatedAt);

    internal static async Task InsertAddendumAsync(Compact24DbContext db, Contract c, DateTimeOffset at, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null || c.Kind != ContractKind.Addendum ||
            c.Status != ContractStatus.Draft || c.ParentContractId is null || c.Signatures.Count != 0)
            throw new InvalidOperationException("Only a new operating-policy addendum can be persisted here.");
        await SaveRootAsync(db, c, null, at, token);
        foreach (var resident in c.Residents)
        {
            resident.ContractId = c.Id;
            await SaveMemberAsync(db, resident, true, token);
        }
    }

    internal static async Task SaveRootAsync(Compact24DbContext db, Contract c, int? originalVersion, DateTimeOffset at, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Contract write requires its locked transaction.");
        c.Stamp(at, originalVersion is null);
        var history = HistoryJson("Contract", c.Id.ToString(), Snapshot(c));
        var kind = c.Kind.ToString().ToUpperInvariant();
        var affected = originalVersion is null
            ? await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO contracts(id,room_id,representative_resident_id,tenant_user_id,owner_signer_id,contract_type,
                previous_contract_id,parent_contract_id,source_holding_contract_id,start_date,end_date,holding_expiry_at,
                monthly_rent,deposit_required,applied_holding_deposit,reserved_capacity,terms,snapshot_hash,draft_metadata,
                status,activated_at,activated_by_user_id,actual_end_date,version,history)
            VALUES ({c.Id},{c.RoomId},{c.RepresentativeResidentId},{c.TenantUserId},{c.OwnerSignerId},{kind},
                {c.PreviousContractId},{c.ParentContractId},{c.HoldingContractId},{c.StartDate},{c.EndDate},{c.HoldingExpiryAt},
                {c.MonthlyRent},{c.RequiredDeposit},{c.AppliedHoldingDeposit},{c.ReservedCapacity},{c.Terms},{c.SnapshotHash},
                CAST({c.DraftMetadata} AS jsonb),{(short)c.Status},{c.ActivatedAt},{c.ActivatedByUserId},{c.ActualEndDate},
                {c.DraftVersion},CAST({history} AS jsonb))
            """, token)
            : await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contracts SET room_id={c.RoomId},representative_resident_id={c.RepresentativeResidentId},
                    tenant_user_id={c.TenantUserId},owner_signer_id={c.OwnerSignerId},contract_type={kind},
                    previous_contract_id={c.PreviousContractId},parent_contract_id={c.ParentContractId},source_holding_contract_id={c.HoldingContractId},
                    start_date={c.StartDate},end_date={c.EndDate},holding_expiry_at={c.HoldingExpiryAt},monthly_rent={c.MonthlyRent},
                    deposit_required={c.RequiredDeposit},applied_holding_deposit={c.AppliedHoldingDeposit},reserved_capacity={c.ReservedCapacity},
                    terms={c.Terms},snapshot_hash={c.SnapshotHash},draft_metadata=CAST({c.DraftMetadata} AS jsonb),status={(short)c.Status},
                    activated_at={c.ActivatedAt},activated_by_user_id={c.ActivatedByUserId},actual_end_date={c.ActualEndDate},
                    version={c.DraftVersion},history=history||CAST({history} AS jsonb)
                WHERE id={c.Id} AND version={originalVersion.Value}
                """, token);
        if (affected != 1) throw new DbUpdateConcurrencyException("Contract changed or no longer exists.");
    }

    internal static async Task SaveMemberAsync(Compact24DbContext db, ContractResident resident, bool added, CancellationToken token)
    {
        var residentHistory = HistoryJson("ContractResident", $"{resident.ContractId}/{resident.ResidentId}", Snapshot(resident));
        var affected = added
            ? await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO contract_residents(contract_id,resident_id,resident_role,residence_from,residence_to,history)
                VALUES ({resident.ContractId},{resident.ResidentId},{(short)resident.Role},{resident.ResidenceFrom},{resident.ResidenceTo},
                    CAST({residentHistory} AS jsonb))
                """, token)
            : await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contract_residents SET resident_role={(short)resident.Role},residence_from={resident.ResidenceFrom},
                    residence_to={resident.ResidenceTo},history=history||CAST({residentHistory} AS jsonb)
                WHERE contract_id={resident.ContractId} AND resident_id={resident.ResidentId}
                """, token);
        if (affected != 1) throw new DbUpdateConcurrencyException("Contract member changed or no longer exists.");
    }

    internal static async Task SaveSignatureAsync(Compact24DbContext db, ContractSignature s, bool added, DateTimeOffset at, CancellationToken token)
    {
        s.Stamp(at, added);
        var state = JsonSerializer.Serialize(Snapshot(s), Json);
        var history = HistoryJson("ContractSignature", s.Id.ToString(), Snapshot(s));
        var affected = added
            ? await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO contract_signings(id,contract_id,signer_user_id,certificate_id,provider_code,certificate_snapshot,
                    provider_reference,signing_status,snapshot_hash,source_hash,prepared_hash,prepared_object_key,signed_object_key,
                    signed_hash,requested_at,expires_at,signed_at,signing_data,history)
                SELECT {s.Id},{s.ContractId},{s.SignerUserId},{s.CertificateId},
                    CASE WHEN {s.CredentialId}='BHOME-OTP' THEN 'BHOME_OTP' WHEN {s.CredentialId}='BHOME-UPLOAD-PROOF' THEN 'UPLOAD_PROOF'
                        ELSE COALESCE(e.value->>'provider','EVIDENCE_WITHOUT_DIRECTORY') END,
                    COALESCE(e.value,jsonb_build_object('id',{s.CertificateId},'unresolvedDirectoryReference',true,'certificateChain',{s.CertificateChain},
                        'providerUserId',{s.ProviderUserId},'credentialId',{s.CredentialId})),
                    {s.ProviderReference},{(short)s.Status},{s.SnapshotHash},{s.SourceHash},{s.PreparedHash},{s.PreparedObjectKey},
                    {s.SignedObjectKey},{s.SignedHash},{s.CreatedAt},{s.ExpiresAt},{s.SignedAt},
                    jsonb_build_object('schemaVersion',1,'compactState',CAST({state} AS jsonb)),CAST({history} AS jsonb)
                FROM (SELECT 1) v LEFT JOIN LATERAL (
                    SELECT c AS value FROM users u CROSS JOIN LATERAL jsonb_array_elements(u.signing_credentials) c
                    WHERE u.id={s.SignerUserId} AND c->>'id'={s.CertificateId.ToString()}
                ) e ON true
                """, token)
            : await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE contract_signings SET contract_id={s.ContractId},signer_user_id={s.SignerUserId},certificate_id={s.CertificateId},
                    provider_reference={s.ProviderReference},signing_status={(short)s.Status},snapshot_hash={s.SnapshotHash},
                    source_hash={s.SourceHash},prepared_hash={s.PreparedHash},prepared_object_key={s.PreparedObjectKey},
                    signed_object_key={s.SignedObjectKey},signed_hash={s.SignedHash},requested_at={s.CreatedAt},
                    expires_at={s.ExpiresAt},signed_at={s.SignedAt},signing_data=jsonb_build_object('schemaVersion',1,'compactState',CAST({state} AS jsonb)),
                    history=history||CAST({history} AS jsonb)
                WHERE id={s.Id}
                """, token);
        if (affected != 1) throw new DbUpdateConcurrencyException("Contract signature changed or no longer exists.");
    }
}
