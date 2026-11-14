using System.Text.Json.Serialization;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.Contracts;

public sealed record SettlementBankAllocationInput(string ExpectedReference, Guid TransferId, Guid? PaidByUserId, bool HumanConfirmed);
public sealed record SettlementTransferInstructions(Guid ContractId, Guid ReceivableId, string Availability, string? BankIdentifier,
    string? AccountNumber, string? AccountHolder, [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    string TransferReference, string? QrImageDataUri, bool IsDevelopmentDemo);
[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)]
public sealed record SettlementBankAllocationResult(Guid Id, Guid ContractId, Guid ReceivableId, Guid TransferId,
    string Status, string Reason, decimal AllocatedAmount, decimal UnallocatedAmount, Guid? AllocationId,
    Guid? PaidByUserId, Guid ApprovedByUserId, Guid OperationKey, string Fingerprint, DateTimeOffset ApprovedAt, bool IsDevelopmentDemo);

public sealed partial class SettlementReceivablesService
{
    public async Task<SettlementTransferInstructions> TransferInstructionsAsync(Guid id, Guid chargeId, CancellationToken token)
    {
        var view = await GetAsync(id, token);
        var balance = view.Receivables.SingleOrDefault(r => r.Charge.Id == chargeId) ?? throw ContractException.Missing();
        if (payments is null) throw new ContractException(503, "settlement_bank_allocation_unavailable");
        var account = await payments.ReceivingAccountAsync(await repository.LocationAsync(id, token), token);
        var reference = PaymentRules.InvoiceReference(chargeId);
        var available = balance.Outstanding <= 0 ? "Settled" : account is null || !account.Enabled ||
            account.IsDevelopmentDemo != balance.Charge.IsDevelopmentDemo || account.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true ? "ReceivingAccountUnavailable" : "Available";
        if (available != "Available") return new(id, chargeId, available, null, null, null, balance.Outstanding, reference, null, false);
        var image = qr?.Generate(account!.BankIdentifier, account.AccountNumber, balance.Outstanding, reference)?.PngDataUri;
        return new(id, chargeId, image is null ? "InstructionsOnly" : "Available", account!.BankIdentifier, account.AccountNumber, account.AccountHolder,
            balance.Outstanding, reference, image, account.IsDevelopmentDemo);
    }
    public async Task<SettlementBankAllocationResult> AllocateBankAsync(Guid id, Guid chargeId, SettlementBankAllocationInput input, Guid key, CancellationToken token)
    {
        await AuthorizeAsync(id, true, token);
        if (key == Guid.Empty || chargeId == Guid.Empty || input.TransferId == Guid.Empty || input.PaidByUserId == Guid.Empty ||
            !input.HumanConfirmed || string.IsNullOrWhiteSpace(input.ExpectedReference)) throw ContractException.Invalid("invalid_settlement_bank_allocation");
        if (payments is null) throw new ContractException(503, "settlement_bank_allocation_unavailable");
        var fingerprint = Fingerprint(id, new { chargeId, input });
        return await repository.TransactionAsync(id, async () =>
        {
            var previous = await repository.BankOperationAsync(Actor, key, token);
            if (previous is not null)
            {
                if (previous.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw ContractException.Conflict("development_payment_unavailable");
                if (previous.ContractId != id || previous.Fingerprint != fingerprint) throw ContractException.Conflict("settlement_idempotency_conflict");
                return previous;
            }
            await AuthorizeAsync(id, true, token);
            var context = await repository.ContextAsync(id, token);
            var balance = context.View.Receivables.SingleOrDefault(r => r.Charge.Id == chargeId) ?? throw ContractException.Missing();
            var transfer = await payments.TransferAsync(input.TransferId, token) ?? throw ContractException.Missing();
            if (input.PaidByUserId is not null && await payments.ExternalPayerRecordedAsync(transfer.Id, token)) throw ContractException.Conflict("receipt_payer_already_external");
            if ((context.IsDevelopmentDemo || transfer.IsDevelopmentDemo) && mode?.AllowDevelopmentDemo != true || transfer.IsDevelopmentDemo && !context.IsDevelopmentDemo)
                throw ContractException.Conflict("development_payment_unavailable");
            if (input.PaidByUserId is { } payer && !balance.Charge.RecipientUserIds.Contains(payer)) throw ContractException.Invalid("payer_not_settlement_recipient");
            var allocated = await payments.AllocationAsync(input.TransferId, token);
            if (allocated is not null)
            {
                if (allocated.TargetSettlementContractId != id || allocated.SettlementReceivableId != chargeId || allocated.PaidByUserId != input.PaidByUserId)
                    throw ContractException.Conflict("bank_transaction_already_allocated");
                var repeated = new SettlementBankAllocationResult(Guid.NewGuid(), id, chargeId, transfer.Id, "Allocated", "already_allocated",
                    allocated.Amount, transfer.Amount - allocated.Amount, allocated.Id, allocated.PaidByUserId, Actor, key, fingerprint, clock.GetUtcNow(), transfer.IsDevelopmentDemo);
                await repository.SaveBankResultAsync(repeated, token); return repeated;
            }
            if (context.View.Reference != input.ExpectedReference) throw ContractException.Conflict("settlement_review_changed");
            if (!context.InspectionConfirmed) throw ContractException.Conflict("settlement_charge_not_ready");
            var latest = await payments.LatestReviewAsync(transfer.Id, token);
            if (latest?.Decision is "ExcessRefundPending" or "ExcessRefundCompleted") throw ContractException.Conflict("receipt_excess_already_confirmed");
            if (latest?.Decision == "Rejected") throw ContractException.Conflict("bank_transfer_rejected");
            var reason = await payments.ReferenceClaimedAsync(transfer.NormalizedReference, token) ? "bank_reference_already_credited" :
                balance.Outstanding <= 0 ? "settlement_already_paid" :
                !string.Equals(transfer.TransferDescription.Trim(), PaymentRules.InvoiceReference(chargeId), StringComparison.OrdinalIgnoreCase) ? "settlement_transfer_reference_mismatch" : null;
            PaymentAllocation? allocation = null;
            if (reason is null)
            {
                await VerifyChargeAsync(balance.Charge, token);
                allocation = new PaymentAllocation
                {
                    TransferId = transfer.Id,
                    TargetSettlementContractId = id,
                    SettlementReceivableId = chargeId,
                    Amount = Math.Min(transfer.Amount, balance.Outstanding),
                    PaidByUserId = input.PaidByUserId,
                    VerifiedByUserId = Actor,
                    AllocatedAt = clock.GetUtcNow()
                };
                payments.Add(allocation);
            }
            var outcome = reason ?? (transfer.Amount < balance.Outstanding ? "verified_partial_settlement_payment" :
                transfer.Amount > balance.Outstanding ? "verified_excess_payment_pending_refund" : "verified_full_settlement_payment");
            var result = new SettlementBankAllocationResult(Guid.NewGuid(), id, chargeId, transfer.Id, allocation is null ? "PendingReview" : "Allocated", outcome,
                allocation?.Amount ?? 0, transfer.Amount - (allocation?.Amount ?? 0), allocation?.Id, input.PaidByUserId, Actor, key, fingerprint, clock.GetUtcNow(), transfer.IsDevelopmentDemo);
            payments.Add(new PaymentReconciliation { TransferId = transfer.Id, Decision = result.Status, Reason = outcome, ActorId = Actor, OccurredAt = result.ApprovedAt });
            await repository.SaveBankResultAsync(result, token); return result;
        }, token);
    }
}
