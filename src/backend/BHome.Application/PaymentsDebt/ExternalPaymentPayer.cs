using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt;

public sealed record ExternalPaymentPayer(Guid Id, Guid TransferId, string PayerLabel, string Reason, string TransferFingerprint,
    string NormalizedBankReference, string ReceiptAmount, Guid VerifiedByUserId, DateTimeOffset VerifiedAt, Guid OperationKey,
    string Fingerprint, bool IsDevelopmentDemo);
public sealed record ExternalPaymentPayerContext(Guid TransferId, string TransferFingerprint, string StatementReference,
    string[] Problems, ExternalPaymentPayer? Payer, bool IsDevelopmentDemo);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ExternalPaymentPayerInput(string ExpectedTransferFingerprint, string PayerLabel, string Reason,
    bool PayerHasNoResidentProfile, bool HumanConfirmed);
public interface IExternalPaymentPayerRepository
{
    Task<ExternalPaymentPayer?> GetAsync(Guid transferId, CancellationToken token);
    Task<ExternalPaymentPayer?> OperationAsync(Guid actor, Guid key, CancellationToken token);
    Task<ExternalPaymentPayerContext> ContextAsync(Guid transferId, CancellationToken token);
    Task SaveAsync(ExternalPaymentPayer payer, CancellationToken token);
}
public sealed class ExternalPaymentPayerService(IExternalPaymentPayerRepository repository, IPaymentRepository payments,
    ICurrentUser user, TimeProvider clock, PaymentRuntimeMode? mode = null)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new PaymentException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new PaymentException(403, "payment_owner_required"); return id;
    }
    public async Task<ExternalPaymentPayerContext> ContextAsync(Guid id, CancellationToken token)
    {
        _ = Owner(); var context = await repository.ContextAsync(id, token);
        if (context.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw new PaymentException(409, "development_payment_unavailable");
        return context;
    }
    public Task<ExternalPaymentPayer> ConfirmAsync(Guid transferId, ExternalPaymentPayerInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty || !input.HumanConfirmed || !input.PayerHasNoResidentProfile || string.IsNullOrWhiteSpace(input.ExpectedTransferFingerprint) ||
            string.IsNullOrWhiteSpace(input.PayerLabel) || input.PayerLabel.Length > 150 || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000)
            throw new PaymentException(400, "external_payer_confirmation_required");
        var normalized = input with { PayerLabel = input.PayerLabel.Trim(), Reason = input.Reason.Trim() };
        var fingerprint = ReceiptExcessRules.Hash(new { transferId, input = normalized });
        return payments.TransactionAsync(transferId, null, async () =>
        {
            if (await repository.OperationAsync(actor, key, token) is { } previous)
            {
                if (previous.TransferId != transferId || previous.Fingerprint != fingerprint) throw new PaymentException(409, "payment_idempotency_conflict");
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw new PaymentException(409, "development_payment_unavailable");
                return previous;
            }
            var context = await ContextAsync(transferId, token);
            if (context.Payer is not null) throw new PaymentException(409, "external_payer_already_confirmed");
            if (context.Problems.Length > 0 || context.TransferFingerprint != input.ExpectedTransferFingerprint) throw new PaymentException(409, "external_payer_review_changed");
            var transfer = await payments.TransferAsync(transferId, token) ?? throw new PaymentException(404, "bank_transfer_not_found");
            var payer = new ExternalPaymentPayer(Guid.NewGuid(), transferId, normalized.PayerLabel, normalized.Reason, context.TransferFingerprint,
                transfer.NormalizedReference, transfer.Amount.ToString("G29", System.Globalization.CultureInfo.InvariantCulture), actor,
                PaymentRules.Timestamp(clock.GetUtcNow()), key, fingerprint, transfer.IsDevelopmentDemo);
            await repository.SaveAsync(payer, token); return payer;
        }, token);
    }
}
