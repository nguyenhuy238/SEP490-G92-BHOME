using System.Globalization;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;

namespace BHome.Application.PaymentsDebt;

public sealed record DepositPayerChoice(Guid ResidentId, Guid? UserId, string Label);
public sealed record ContractDepositPosition(Guid ContractId, string TransferReference, string Required, string Received, string Remaining, bool IsDevelopmentDemo);
public sealed record DepositReceiptAllocation(Guid Id, Guid TransferId, Guid ContractId, Guid AllocationId,
    Guid? PayerResidentId, Guid? PayerUserId, Guid? ExternalPayerAttestationId, string TransferFingerprint,
    string NormalizedBankReference, string ReceiptAmount, string AllocatedAmount, Guid VerifiedByUserId,
    DateTimeOffset VerifiedAt, Guid OperationKey);
public sealed record DepositAllocationContext(Guid TransferId, Guid ContractId, string Reference, string DepositReference,
    string Required, string Received, string Remaining, string ProposedAllocation, string Excess,
    IReadOnlyList<DepositPayerChoice> Payers, ExternalPaymentPayer? ExternalPayer, string[] Problems, bool IsDevelopmentDemo);

public sealed partial class PaymentService
{
    public async Task<ContractDepositPosition> DepositPositionAsync(Guid contractId, CancellationToken token)
    {
        Owner();
        var contract = await repository.HoldingAsync(contractId, token) ?? throw new PaymentException(404, "contract_not_found");
        if (contract.Kind is not (ContractKind.Main or ContractKind.Holding) || contract.PreviousContractId is not null) throw new PaymentException(400, "deposit_contract_required");
        if (contract.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) throw new PaymentException(409, "development_payment_unavailable");
        var received = await repository.DepositAllocatedAsync(contract.Id, token);
        return new(contract.Id, PaymentRules.DepositReference(contract.Id), contract.RequiredDeposit.ToString("0", CultureInfo.InvariantCulture),
            received.ToString("0", CultureInfo.InvariantCulture), Math.Max(0, contract.RequiredDeposit - received).ToString("0", CultureInfo.InvariantCulture), contract.IsDevelopmentDemo);
    }
    public async Task<DepositAllocationContext> DepositContextAsync(Guid transferId, Guid contractId, CancellationToken token)
    {
        Owner();
        var transfer = await repository.TransferAsync(transferId, token) ?? throw new PaymentException(404, "bank_transfer_not_found");
        var contract = await repository.HoldingAsync(contractId, token) ?? throw new PaymentException(404, "contract_not_found");
        var received = await repository.DepositAllocatedAsync(contract.Id, token);
        var remaining = Math.Max(0, contract.RequiredDeposit - received);
        var proposed = Math.Min(transfer.Amount, remaining);
        var external = await repository.ExternalPayerAsync(transferId, token);
        var problems = new List<string>();
        if (!await repository.VerifiedReceiptAsync(transferId, token)) problems.Add("verified_bank_receipt_required");
        if (contract.Kind is not (ContractKind.Main or ContractKind.Holding) || contract.PreviousContractId is not null ||
            contract.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active)) problems.Add("deposit_not_payable");
        if (contract.Kind == ContractKind.Holding && (contract.ApprovedAt is null || contract.HoldingExpiryAt is null || contract.HoldingExpiryAt <= Now)) problems.Add("holding_deposit_requires_manual_review");
        if (!contract.Room.Location.IsActive) problems.Add("location_inactive");
        if (transfer.IsDevelopmentDemo != contract.IsDevelopmentDemo || transfer.IsDevelopmentDemo && mode?.AllowDevelopmentDemo != true) problems.Add("development_payment_unavailable");
        if (await repository.AllocationAsync(transferId, token) is not null) problems.Add("bank_transaction_already_allocated");
        if (await repository.ReferenceClaimedAsync(transfer.NormalizedReference, token)) problems.Add("bank_reference_already_credited");
        var review = await repository.LatestReviewAsync(transferId, token);
        if (review?.Decision == "Rejected") problems.Add("bank_transfer_rejected");
        if (review?.Decision is "ExcessRefundPending" or "ExcessRefundCompleted") problems.Add("receipt_excess_already_confirmed");
        if (remaining <= 0) problems.Add("deposit_already_satisfied");
        if (!string.Equals(transfer.TransferDescription.Trim(), PaymentRules.DepositReference(contract.Id), StringComparison.OrdinalIgnoreCase)) problems.Add("deposit_transfer_reference_mismatch");
        if (external is not null && external.TransferFingerprint != ReceiptExcessRules.TransferFingerprint(transfer)) problems.Add("external_payer_history_invalid");
        var payers = external is null ? await repository.DepositPayersAsync(contract.Id, token) : [];
        static string MoneyText(decimal value) => value.ToString("0", CultureInfo.InvariantCulture);
        var context = new DepositAllocationContext(transferId, contractId, "", PaymentRules.DepositReference(contractId),
            MoneyText(contract.RequiredDeposit), MoneyText(received), MoneyText(remaining), MoneyText(proposed), MoneyText(transfer.Amount - proposed),
            payers, external, problems.Distinct().Order().ToArray(), transfer.IsDevelopmentDemo);
        return context with { Reference = "DEPOSIT-" + Fingerprint(new { context, Receipt = ReceiptExcessRules.TransferFingerprint(transfer), contract.Status, contract.AppliedHoldingDeposit }) };
    }

    public async Task<PaymentReviewResult> AllocateDepositAsync(Guid transferId, PaymentDepositMatchInput x, Guid key, CancellationToken t)
    {
        Owner(); Validate(x);
        if (!x.HumanVerified || x.ContractId == Guid.Empty || x.PaidByUserId == Guid.Empty || x.PaidByResidentId == Guid.Empty ||
            x.ExternalPayerAttestationId == Guid.Empty || x.ExternalPayerAttestationId is not null && (x.PaidByUserId is not null || x.PaidByResidentId is not null))
            throw new PaymentException(400, "deposit_allocation_confirmation_required");
        return await repository.DepositTransactionAsync(transferId, x.ContractId, async () =>
        {
            if (await Replay(key, "allocate-deposit", new { transferId, x }, t) is not null) return await Outcome(transferId, t);
            var context = await DepositContextAsync(transferId, x.ContractId, t);
            if (x.ExpectedReference is not null && x.ExpectedReference != context.Reference) throw new PaymentException(409, "deposit_context_changed");
            if (context.Problems.Length > 0) throw new PaymentException(409, context.Problems[0]);
            var candidates = context.Payers.Where(p => x.PaidByResidentId is { } resident ? p.ResidentId == resident : x.PaidByUserId is { } userId && p.UserId == userId).Take(2).ToArray();
            var payer = candidates.Length == 1 ? candidates[0] : null;
            if (context.ExternalPayer is { } external ? x.ExternalPayerAttestationId != external.Id || payer is not null :
                x.ExternalPayerAttestationId is not null || payer is null || x.PaidByUserId is { } supplied && supplied != payer.UserId)
                throw new PaymentException(400, "deposit_payer_confirmation_required");
            var transfer = (await repository.TransferAsync(transferId, t))!;
            var contract = (await repository.HoldingAsync(x.ContractId, t))!;
            var amount = decimal.Parse(context.ProposedAllocation, CultureInfo.InvariantCulture);
            if (contract.Kind == ContractKind.Holding)
            {
                if (contracts is null) throw new PaymentException(503, "holding_deposit_verification_unavailable");
                if (!await contracts.CanAcceptHoldingDepositAsync(contract.Id, t)) throw new PaymentException(409, "holding_room_commitment_requires_manual_review");
                await contracts.ConfirmHoldingDepositAllocationAsync(contract.Id, amount, transfer.VerifiedAt, t);
            }
            var allocation = new PaymentAllocation
            {
                TransferId = transferId,
                TargetDepositContractId = contract.Id,
                Amount = amount,
                PaidByUserId = payer?.UserId,
                VerifiedByUserId = Actor,
                AllocatedAt = Now
            };
            await repository.RecordDepositReceiptAsync(new(Guid.NewGuid(), transferId, contract.Id, allocation.Id, payer?.ResidentId,
                payer?.UserId, context.ExternalPayer?.Id, ReceiptExcessRules.TransferFingerprint(transfer), transfer.NormalizedReference,
                transfer.Amount.ToString("0", CultureInfo.InvariantCulture), context.ProposedAllocation, Actor, Now, key), t);
            repository.Add(allocation);
            var reason = transfer.Amount > amount ? "verified_deposit_excess_refund_required" : amount < decimal.Parse(context.Remaining, CultureInfo.InvariantCulture) ? "verified_partial_deposit" : "verified_deposit";
            repository.Add(new PaymentReconciliation
            {
                TransferId = transferId,
                DepositContractId = contract.Id,
                ActorId = Actor,
                OccurredAt = Now,
                Decision = "Allocated",
                Reason = reason
            });
            repository.Audit(Actor, "ContractDepositReceiptAllocated", allocation.Id, Now);
            Remember(key, "allocate-deposit", new { transferId, x }, allocation.Id);
            return new("Allocated", reason, transferId, null, contract.Id);
        }, t);
    }
}
