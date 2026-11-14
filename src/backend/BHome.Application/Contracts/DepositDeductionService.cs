using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Contracts;

public sealed record DepositDeductionItem(Guid? AssetId, string ReasonCode,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Description, Guid[] EvidenceIds);
public sealed record DepositDeductionInput(int ExpectedVersion, string ExpectedReference, string Reason,
    bool HumanConfirmed, DepositDeductionItem[] Items);
public sealed record DeductionEvidence(Guid Id, long Length, string Sha256);
public sealed record DepositDeductionPlan(Guid Id, Guid ContractId, Guid DepositContractId, Guid InspectionId, int InspectionVersion,
    int Version, Guid ApprovedByUserId, DateTimeOffset ApprovedAt, string Reason, string ObligationReference,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Total,
    IReadOnlyList<DepositDeductionItem> Items, IReadOnlyList<DeductionEvidence> Evidence, Guid OperationKey, string Fingerprint,
    bool IsDevelopmentDemo = false);
public interface IDepositDeductionRepository
{
    Task<T> TransactionAsync<T>(Guid contractId, Func<Task<T>> work, CancellationToken token);
    Task<DepositDeductionPlan?> OperationAsync(Guid actor, Guid key, CancellationToken token);
}
public interface IDepositDeductionEvidence
{
    Task<IReadOnlyList<DeductionEvidence>> CaptureAsync(Guid contractId, Guid[] ids, CancellationToken token);
    Task VerifyAsync(DepositDeductionPlan plan, CancellationToken token);
}

public static class DepositDeductionPolicy
{
    public static DepositDeductionItem[] Normalize(DepositDeductionInput input, decimal budget, Guid[] assets, Guid[] evidence)
    {
        if (!input.HumanConfirmed || input.ExpectedVersion < 0 || string.IsNullOrWhiteSpace(input.ExpectedReference) ||
            string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000 || input.Items is null || input.Items.Length > 20 ||
            input.Items.Any(i => i is null) || input.ExpectedVersion == int.MaxValue)
            throw ContractException.Invalid("invalid_deposit_deduction");
        if (input.Items.Select(i => i.AssetId).Distinct().Count() != input.Items.Length)
            throw ContractException.Invalid("duplicate_deposit_deduction");
        var normalized = input.Items.Select(i =>
        {
            if (i.ReasonCode != "TenantDamage" || i.Amount <= 0 || i.Amount >= 1_000_000_000_000_000_000m ||
                decimal.Truncate(i.Amount) != i.Amount || string.IsNullOrWhiteSpace(i.Description) || i.Description.Length > 2000 ||
                i.AssetId == Guid.Empty || i.AssetId is { } asset && !assets.Contains(asset) || i.EvidenceIds is null ||
                i.EvidenceIds.Length is < 1 or > 5 || i.EvidenceIds.Distinct().Count() != i.EvidenceIds.Length || i.EvidenceIds.Any(e => !evidence.Contains(e)))
                throw ContractException.Invalid("invalid_deposit_deduction_item");
            return i with { Amount = decimal.Truncate(i.Amount), Description = i.Description.Trim(), EvidenceIds = i.EvidenceIds.Order().ToArray() };
        }).OrderBy(i => i.AssetId).ToArray();
        if (budget < 0 || normalized.Sum(i => i.Amount) > budget) throw ContractException.Conflict("deposit_deduction_exceeds_available");
        return normalized;
    }
}

public sealed class DepositDeductionService(IDepositDeductionRepository repository, ICurrentUser user, PaymentRuntimeMode? mode = null)
{
    public Task<DepositDeductionPlan> ApproveAsync(Guid contractId, DepositDeductionInput input, Guid key, CancellationToken token)
    {
        if (user.UserId is not { } actor || actor == Guid.Empty) throw new ContractException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new ContractException(403, "deposit_deduction_owner_required");
        if (key == Guid.Empty) throw ContractException.Invalid("idempotency_key_required");
        if (input.Items is null || input.Items.Any(i => i is null)) throw ContractException.Invalid("invalid_deposit_deduction");
        return repository.TransactionAsync(contractId, async () =>
        {
            // Replay uses normalized input, not a refreshed financial snapshot, and has no second effect.
            var previous = await repository.OperationAsync(actor, key, token);
            var items = DepositDeductionPolicy.Normalize(input, 999999999999999999m,
                input.Items?.Where(i => i.AssetId != null).Select(i => i.AssetId!.Value).ToArray() ?? [], input.Items?.SelectMany(i => i.EvidenceIds ?? []).ToArray() ?? []);
            var normalized = input with { Reason = input.Reason.Trim(), Items = items };
            var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { contractId, input = normalized })));
            if (previous is not null)
            {
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                if (previous.ContractId != contractId || previous.Fingerprint != fingerprint)
                    throw ContractException.Conflict("deposit_deduction_idempotency_conflict");
                return previous;
            }
            throw ContractException.Conflict("settlement_receivables_replace_legacy_deductions");
        }, token);
    }
}
