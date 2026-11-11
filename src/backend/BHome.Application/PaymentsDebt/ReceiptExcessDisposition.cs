using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt;

public sealed record ReceiptExcessTarget(Guid? InvoiceId = null, Guid? SettlementContractId = null, Guid? ReceivableId = null, Guid? HoldingContractId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? DepositContractId = null);
public sealed record ReceiptExcessPayer(Guid ResidentId, Guid? UserId, string Label);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record ReceiptExcessDisposition(Guid Id, Guid TransferId, ReceiptExcessTarget Target, Guid RoomId, decimal Amount,
    Guid? PayerResidentId, Guid? PayerUserId, string PayerLabel, string TransferFingerprint, string Reason, Guid ApprovedByUserId,
    DateTimeOffset ApprovedAt, Guid OperationKey, string Fingerprint, bool IsDevelopmentDemo,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? ExternalPayerAttestationId = null);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record ReceiptExcessContext(Guid TransferId, ReceiptExcessTarget Target, Guid RoomId, decimal Amount, decimal Outstanding,
    string TransferReference, IReadOnlyList<ReceiptExcessPayer> Payers, string Reference, IReadOnlyList<string> Problems,
    ReceiptExcessDisposition? Disposition, bool IsDevelopmentDemo,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ExternalPaymentPayer? ExternalPayer = null);
public sealed record ReceiptExcessConfirmation(ReceiptExcessTarget Target, string ExpectedReference, Guid? PayerResidentId, string Reason, bool HumanConfirmed,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? ExternalPayerAttestationId = null);
public static class ReceiptExcessRules
{
    public static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    public static string TransferFingerprint(PaymentTransfer transfer) => Hash(new
    {
        transfer.Id, transfer.NormalizedReference, Amount = transfer.Amount.ToString("G29", System.Globalization.CultureInfo.InvariantCulture),
        transfer.Currency, transfer.OccurredAt, transfer.TransferDescription, transfer.StatementReference,
        transfer.VerifiedByUserId, transfer.VerifiedAt, transfer.IsDevelopmentDemo
    });
    public static void Validate(ReceiptExcessTarget target)
    {
        if (target is null || target.InvoiceId == Guid.Empty || target.SettlementContractId == Guid.Empty || target.ReceivableId == Guid.Empty || target.HoldingContractId == Guid.Empty || target.DepositContractId == Guid.Empty ||
            (target.SettlementContractId is null) != (target.ReceivableId is null) ||
            new[] { target.InvoiceId is not null, target.SettlementContractId is not null, target.HoldingContractId is not null, target.DepositContractId is not null }.Count(v => v) != 1)
            throw new PaymentException(400, "receipt_excess_target_required");
    }
}
public interface IReceiptExcessRepository
{
    Task<T> TransactionAsync<T>(Guid transferId, ReceiptExcessTarget target, Func<Task<T>> work, CancellationToken token);
    Task<ReceiptExcessContext> ContextAsync(Guid transferId, ReceiptExcessTarget target, CancellationToken token);
    Task<ReceiptExcessDisposition?> GetAsync(Guid transferId, CancellationToken token);
    Task<ReceiptExcessDisposition?> OperationAsync(Guid actor, Guid key, CancellationToken token);
    Task SaveAsync(ReceiptExcessDisposition disposition, CancellationToken token);
}
public sealed class ReceiptExcessService(IReceiptExcessRepository repository, IPaymentRepository payments, ICurrentUser user,
    TimeProvider clock, PaymentRuntimeMode? mode = null)
{
    private Guid Owner()
    {
        if (user.UserId is not { } actor || actor == Guid.Empty) throw new PaymentException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new PaymentException(403, "payment_owner_required");
        return actor;
    }
    public Task<ReceiptExcessDisposition?> GetAsync(Guid transferId, CancellationToken token)
    { _ = Owner(); return repository.GetAsync(transferId, token); }
    public async Task<ReceiptExcessContext> ContextAsync(Guid transferId, ReceiptExcessTarget target, CancellationToken token)
    {
        _ = Owner(); ReceiptExcessRules.Validate(target);
        var context = await repository.ContextAsync(transferId, target, token);
        if (context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw new PaymentException(409, "development_payment_unavailable");
        return context;
    }
    public Task<ReceiptExcessDisposition> ConfirmAsync(Guid transferId, ReceiptExcessConfirmation input, Guid key, CancellationToken token)
    {
        var actor = Owner(); ReceiptExcessRules.Validate(input.Target);
        if (key == Guid.Empty || !input.HumanConfirmed || input.PayerResidentId == Guid.Empty || input.ExternalPayerAttestationId == Guid.Empty ||
            (input.PayerResidentId is null) == (input.ExternalPayerAttestationId is null) || string.IsNullOrWhiteSpace(input.ExpectedReference) ||
            string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000) throw new PaymentException(400, "receipt_excess_confirmation_required");
        var normalized = input with { Reason = input.Reason.Trim() }; var fingerprint = ReceiptExcessRules.Hash(new { transferId, input = normalized });
        return repository.TransactionAsync(transferId, input.Target, async () =>
        {
            if (await repository.OperationAsync(actor, key, token) is { } previous)
            {
                if (previous.TransferId != transferId || previous.Fingerprint != fingerprint) throw new PaymentException(409, "payment_idempotency_conflict");
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw new PaymentException(409, "development_payment_unavailable");
                return previous;
            }
            var context = await ContextAsync(transferId, input.Target, token);
            if (context.Disposition is not null) throw new PaymentException(409, "receipt_excess_already_confirmed");
            if (context.Reference != input.ExpectedReference) throw new PaymentException(409, "receipt_excess_review_changed");
            if (context.Problems.Count > 0 || context.Outstanding != 0) throw new PaymentException(409, "receipt_excess_not_ready");
            var payer = context.Payers.SingleOrDefault(p => p.ResidentId == input.PayerResidentId);
            var external = input.ExternalPayerAttestationId is { } externalId && context.ExternalPayer?.Id == externalId ? context.ExternalPayer : null;
            if (payer is null && external is null) throw new PaymentException(400, "receipt_verified_payer_required");
            var transfer = await payments.TransferAsync(transferId, token) ?? throw new PaymentException(404, "bank_transfer_not_found");
            var result = new ReceiptExcessDisposition(Guid.NewGuid(), transferId, input.Target, context.RoomId, context.Amount,
                payer?.ResidentId, payer?.UserId, payer?.Label ?? external!.PayerLabel, ReceiptExcessRules.TransferFingerprint(transfer), normalized.Reason, actor,
                PaymentRules.Timestamp(clock.GetUtcNow()), key, fingerprint, context.IsDevelopmentDemo, external?.Id);
            await repository.SaveAsync(result, token); return result;
        }, token);
    }
}
