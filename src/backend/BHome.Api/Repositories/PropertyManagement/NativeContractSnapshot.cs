using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.PropertyManagement.Persistence;

// Physical columns are authoritative. The typed root history stores the extra
// business fields and is shared with the existing contract readers during migration.
internal static class NativeContractSnapshot
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record ContractState(
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

    private sealed record ResidentState(Guid ContractId, Guid ResidentId, ResidentType Role, DateOnly ResidenceFrom, DateOnly? ResidenceTo);
    private sealed record History<T>(int SchemaVersion, string RecordType, string RecordKey, bool Deleted, T State);

    private static JsonElement LastState(JsonElement history, string kind)
    {
        var item = history.EnumerateArray().Reverse().FirstOrDefault(e => e.ValueKind == JsonValueKind.Object &&
            e.TryGetProperty("recordType", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == kind);
        return item.ValueKind == JsonValueKind.Object && item.TryGetProperty("state", out var state) ? state : default;
    }
    private static string HistoryJson<T>(string kind, string key, T state) =>
        JsonSerializer.Serialize(new[] { new History<T>(1, kind, key, false, state) }, Json);

    internal static Contract Read(Native.Contract row)
    {
        var data = LastState(row.History, "Contract");
        var state = data.ValueKind == JsonValueKind.Object ? data.Deserialize<ContractState>(Json) : null;
        DateTimeOffset At(string name) => data.ValueKind == JsonValueKind.Object &&
            data.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        var contract = Contract.Rehydrate(row.Id, At("createdAt"), At("updatedAt"));
        contract.RoomId = row.RoomId;
        contract.OwnerSignerId = row.OwnerSignerId;
        contract.TenantUserId = row.TenantUserId;
        contract.DraftMetadata = row.DraftMetadata.GetRawText();
        contract.DraftVersion = row.Version;
        contract.RepresentativeResidentId = row.RepresentativeResidentId;
        contract.PreviousContractId = row.PreviousContractId;
        contract.ParentContractId = row.ParentContractId;
        contract.HoldingContractId = row.SourceHoldingContractId;
        contract.AppliedHoldingDeposit = row.AppliedHoldingDeposit;
        contract.HoldingAllocationReference = state?.HoldingAllocationReference;
        contract.HoldingExpiryAt = row.HoldingExpiryAt;
        contract.ReservedCapacity = row.ReservedCapacity;
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
        contract.Kind = row.ContractType switch
        {
            "HOLDING" => ContractKind.Holding, "RENEWAL" => ContractKind.Renewal,
            "ADDENDUM" => ContractKind.Addendum, _ => ContractKind.Main
        };
        contract.Status = (ContractStatus)row.Status;
        contract.StartDate = row.StartDate;
        contract.EndDate = row.EndDate;
        contract.MonthlyRent = row.MonthlyRent ?? 0;
        contract.RequiredDeposit = row.DepositRequired;
        contract.Terms = row.Terms;
        contract.SnapshotHash = row.SnapshotHash ?? "";
        contract.IsDevelopmentDemo = state?.IsDevelopmentDemo ?? false;
        contract.SigningMode = state?.SigningMode ?? "";
        contract.InternalAcceptance = state?.InternalAcceptance ?? "{}";
        contract.InitialPaymentRequired = state?.InitialPaymentRequired ?? false;
        contract.PaymentMode = state?.PaymentMode;
        contract.OperatingPolicySnapshot = state?.OperatingPolicySnapshot ?? "";
        contract.ActivatedByUserId = row.ActivatedByUserId;
        contract.ActivatedAt = row.ActivatedAt;
        contract.ActualEndDate = row.ActualEndDate;
        return contract;
    }

    internal static ContractResident Read(Native.ContractResident row) => new()
    {
        ContractId = row.ContractId, ResidentId = row.ResidentId, Role = (ResidentType)row.ResidentRole,
        ResidenceFrom = row.ResidenceFrom, ResidenceTo = row.ResidenceTo
    };

    internal static ContractSignature Read(Native.ContractSigning row)
    {
        var state = row.SigningData.TryGetProperty("compactState", out var value) ? value : default;
        string Text(string key) => state.ValueKind == JsonValueKind.Object && state.TryGetProperty(key, out var field) &&
            field.ValueKind == JsonValueKind.String ? field.GetString()! : "";
        var signature = ContractSignature.RestoreDetachedAttempt(row.Id);
        signature.ContractId = row.ContractId;
        signature.SignerUserId = row.SignerUserId;
        signature.CertificateId = row.CertificateId;
        signature.Status = (SignatureStatus)row.SigningStatus;
        signature.SnapshotHash = row.SnapshotHash;
        signature.SourceHash = row.SourceHash ?? "";
        signature.PreparedHash = row.PreparedHash ?? "";
        signature.PreparedObjectKey = row.PreparedObjectKey ?? "";
        signature.FieldName = Text("fieldName");
        signature.DocumentDigest = Text("documentDigest");
        signature.DataToSignDigest = Text("dataToSignDigest");
        signature.CertificateChain = Text("certificateChain");
        signature.ProviderUserId = Text("providerUserId");
        signature.CredentialId = Text("credentialId");
        signature.ProviderReference = row.ProviderReference;
        signature.SignedObjectKey = row.SignedObjectKey;
        signature.SignedHash = row.SignedHash;
        signature.SignedAt = row.SignedAt;
        signature.ExpiresAt = row.ExpiresAt;
        signature.CreatedAt = row.RequestedAt;
        signature.UpdatedAt = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("updatedAt", out var at) &&
            at.ValueKind != JsonValueKind.Null ? at.GetDateTimeOffset().ToUniversalTime() : DateTimeOffset.UnixEpoch;
        return signature;
    }

    internal static async Task<Contract?> LoadAsync(Compact24DbContext db, Guid id, CancellationToken token)
    {
        var row = await db.Set<Native.Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, token);
        if (row is null) return null;
        var contract = Read(row);
        var room = await db.Set<Native.Room>().AsNoTracking().SingleAsync(r => r.Id == row.RoomId, token);
        var location = await db.Set<Native.Location>().AsNoTracking().SingleAsync(l => l.Id == room.LocationId, token);
        contract.Room = NativeRoomLocationPersistence.Read(room);
        contract.Room.Location = NativeRoomLocationPersistence.Read(location);
        contract.Residents = (await db.Set<Native.ContractResident>().AsNoTracking().Where(r => r.ContractId == id)
            .ToArrayAsync(token)).Select(Read).ToList();
        contract.Signatures = (await db.Set<Native.ContractSigning>().AsNoTracking().Where(s => s.ContractId == id)
            .ToArrayAsync(token)).Select(Read).ToList();
        return contract;
    }

    internal static async Task InsertAddendumAsync(Compact24DbContext db, Contract c, DateTimeOffset at, CancellationToken token)
    {
        if (db.Database.CurrentTransaction is null || c.Kind != ContractKind.Addendum ||
            c.Status != ContractStatus.Draft || c.ParentContractId is null || c.Signatures.Count != 0)
            throw new InvalidOperationException("Only a new operating-policy addendum can be persisted here.");
        c.Stamp(at, true);
        var state = new ContractState(c.Id, c.CreatedAt, c.UpdatedAt, c.RoomId, c.OwnerSignerId, c.TenantUserId,
            c.DraftMetadata, c.DraftVersion, c.RepresentativeResidentId, c.PreviousContractId, c.ParentContractId,
            c.HoldingContractId, c.AppliedHoldingDeposit, c.HoldingAllocationReference, c.HoldingExpiryAt,
            c.ReservedCapacity, c.ApprovedByUserId, c.ApprovedAt, c.ApprovalReason, c.AgreedPriceSnapshot,
            c.PriceLockTrigger, c.PriceLockedAt, c.ConvertedMainContractId, c.LifecycleActorId, c.LifecycleAt,
            c.LifecycleReason, c.Kind, c.Status, c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit,
            c.Terms, c.SnapshotHash, c.IsDevelopmentDemo, c.SigningMode, c.InternalAcceptance,
            c.InitialPaymentRequired, c.PaymentMode, c.OperatingPolicySnapshot, c.ActivatedByUserId, c.ActivatedAt, c.ActualEndDate);
        var history = HistoryJson("Contract", c.Id.ToString(), state);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO contracts(id,room_id,representative_resident_id,tenant_user_id,owner_signer_id,contract_type,
                previous_contract_id,parent_contract_id,source_holding_contract_id,start_date,end_date,holding_expiry_at,
                monthly_rent,deposit_required,applied_holding_deposit,reserved_capacity,terms,snapshot_hash,draft_metadata,
                status,activated_at,activated_by_user_id,actual_end_date,version,history)
            VALUES ({c.Id},{c.RoomId},{c.RepresentativeResidentId},{c.TenantUserId},{c.OwnerSignerId},'ADDENDUM',
                {c.PreviousContractId},{c.ParentContractId},{c.HoldingContractId},{c.StartDate},{c.EndDate},{c.HoldingExpiryAt},
                {c.MonthlyRent},{c.RequiredDeposit},{c.AppliedHoldingDeposit},{c.ReservedCapacity},{c.Terms},{c.SnapshotHash},
                CAST({c.DraftMetadata} AS jsonb),{(short)c.Status},{c.ActivatedAt},{c.ActivatedByUserId},{c.ActualEndDate},
                {c.DraftVersion},CAST({history} AS jsonb))
            """, token);
        foreach (var resident in c.Residents)
        {
            resident.ContractId = c.Id;
            var residentHistory = HistoryJson("ContractResident", $"{c.Id}/{resident.ResidentId}",
                new ResidentState(c.Id, resident.ResidentId, resident.Role, resident.ResidenceFrom, resident.ResidenceTo));
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO contract_residents(contract_id,resident_id,resident_role,residence_from,residence_to,history)
                VALUES ({c.Id},{resident.ResidentId},{(short)resident.Role},{resident.ResidenceFrom},{resident.ResidenceTo},
                    CAST({residentHistory} AS jsonb))
                """, token);
        }
    }
}
