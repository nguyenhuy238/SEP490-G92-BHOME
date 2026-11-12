using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;

namespace BHome.Application.PaymentsDebt.SePay;

public sealed class SePayService(ISePayRepository repository, IPaymentRepository payments, SePayOptions options,
    ContractService contracts, TimeProvider clock)
{
    public async Task ReceiveAsync(SePayTransaction transaction, CancellationToken token)
    {
        if (!options.Enabled) throw new PaymentException(503, "sepay_disabled");
        transaction.Validate(clock.GetUtcNow());
        var id = await repository.ReceiveAsync(transaction, token);
        await ReconcileAsync(id, token);
    }
    public Task ReconcileAsync(Guid id, CancellationToken token) => repository.TransactionAsync(async () =>
    {
        var received = await repository.EventAsync(id, token);
        if (received.Status != "Pending") return true;
        if (!options.Enabled || received.Mode != options.Mode) return true;
        var tx = received.Transaction;
        async Task<bool> Finish(string status, string reason, Guid? receipt = null)
        { await repository.FinishAsync(received, status, reason, receipt, token); return true; }
        if (tx.TransferType != "in") return await Finish("Ignored", "outgoing_transaction");
        var bindings = options.ReceivingAccounts.Where(a => a.Gateway.Equals(tx.Gateway, StringComparison.OrdinalIgnoreCase) && a.AccountNumber == tx.AccountNumber).ToArray();
        if (bindings.Length == 0 || !string.IsNullOrEmpty(tx.SubAccount)) return await Finish("ManualReview", "receiving_account_not_configured");
        var reference = Reference(received.Mode, tx);
        var prior = await payments.TransferReferenceAsync("SEPAY:" + received.Mode.ToUpperInvariant(), reference, token);
        if (prior is not null)
        {
            if (prior.Amount != tx.TransferAmount || prior.OccurredAt != PaymentRules.Timestamp(tx.OccurredAt) || prior.TransferDescription != tx.Content)
                throw new PaymentException(409, "sepay_transaction_identity_conflict");
            return await Finish("Duplicate", "bank_transaction_already_received", prior.Id);
        }
        var code = ResolveCode(tx);
        var target = code is null ? null : await repository.ResolveAsync(code, token);
        var receipt = new PaymentTransfer
        {
            ProviderIdentity = "SEPAY:" + received.Mode.ToUpperInvariant(), BankReference = reference, NormalizedReference = reference,
            Amount = tx.TransferAmount, OccurredAt = PaymentRules.Timestamp(tx.OccurredAt), TransferDescription = tx.Content,
            StatementReference = "SePay/" + received.Mode + "/" + tx.Id, VerificationReason = "Authenticated SePay bank transaction",
            VerificationSource = "SePay" + received.Mode, VerifiedAt = PaymentRules.Timestamp(clock.GetUtcNow()),
            IsDevelopmentDemo = received.Mode == "Test", ProposedInvoiceId = target?.Kind == "Invoice" ? target.ObligationId : null,
            ProposedDepositContractId = target?.Kind == "Deposit" ? target.ObligationId : null
        };
        await repository.AddReceiptAsync(received, receipt, token);
        async Task<bool> Review(string reason)
        {
            payments.Add(new PaymentReconciliation { TransferId = receipt.Id, InvoiceId = receipt.ProposedInvoiceId,
                DepositContractId = receipt.ProposedDepositContractId, Decision = "PendingReview", Reason = reason, OccurredAt = receipt.VerifiedAt });
            return await Finish("ManualReview", reason, receipt.Id);
        }
        if (target is null) return await Review("unknown_or_ambiguous_payment_code");
        await repository.LockTargetAsync(target, token);
        var binding = bindings.SingleOrDefault(a => a.LocationId == target.LocationId);
        var account = await payments.ReceivingAccountAsync(target.LocationId, token);
        if (binding is null || account is null || !account.Enabled || account.BankIdentifier != binding.BankIdentifier ||
            account.AccountNumber != tx.AccountNumber || account.IsDevelopmentDemo != receipt.IsDevelopmentDemo ||
            !await payments.ActiveLocationAsync(target.LocationId, token)) return await Review("receiving_account_mismatch");
        decimal outstanding;
        Invoice? invoice = null;
        if (target.Kind == "Invoice")
        {
            invoice = await repository.InvoiceAsync(target.ObligationId, token);
            if (invoice?.Status != InvoiceStatus.Final) return await Review("final_invoice_required");
            if (await repository.DemoInvoiceAsync(invoice.Id, token) != receipt.IsDevelopmentDemo) return await Review("sepay_environment_mismatch");
            outstanding = (await payments.FinancialsAsync(invoice.Id, token)).OutstandingAmount;
        }
        else
        {
            var contract = await payments.HoldingAsync(target.ObligationId, token);
            if (contract is null || contract.Kind is not (ContractKind.Main or ContractKind.Holding) || contract.PreviousContractId is not null ||
                contract.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active))
                return await Review("deposit_not_payable");
            if (contract.IsDevelopmentDemo != receipt.IsDevelopmentDemo) return await Review("sepay_environment_mismatch");
            outstanding = Math.Max(0, contract.RequiredDeposit - await payments.DepositAllocatedAsync(contract.Id, token));
            if (contract.Kind == ContractKind.Holding)
            {
                if (contract.ApprovedAt is null || contract.HoldingExpiryAt is null || contract.HoldingExpiryAt <= clock.GetUtcNow())
                    return await Review("holding_deposit_requires_manual_review");
                if (outstanding > 0 && !await contracts.ConfirmProviderHoldingDepositAsync(contract.Id, Math.Min(receipt.Amount, outstanding), receipt.VerifiedAt, token))
                    return await Review("holding_room_commitment_requires_manual_review");
            }
        }
        if (outstanding <= 0) return await Review(target.Kind == "Invoice" ? "invoice_already_settled" : "deposit_already_satisfied");
        if (await payments.ReferenceClaimedAsync(reference, token)) return await Review("bank_reference_already_credited");
        var allocation = new PaymentAllocation { TransferId = receipt.Id, InvoiceId = invoice?.Id,
            TargetDepositContractId = invoice is null ? target.ObligationId : null, Amount = Math.Min(receipt.Amount, outstanding), AllocatedAt = receipt.VerifiedAt };
        payments.Add(allocation);
        var reason = receipt.Amount < outstanding ? "verified_partial_payment" : receipt.Amount > outstanding ? "verified_excess_payment_pending_review" : "verified_full_payment";
        payments.Add(new PaymentReconciliation { TransferId = receipt.Id, InvoiceId = invoice?.Id, DepositContractId = allocation.TargetDepositContractId,
            Decision = "Allocated", Reason = reason, OccurredAt = receipt.VerifiedAt });
        if (invoice is not null)
        {
            var financial = await payments.FinancialsAsync(invoice.Id, token);
            payments.Add(new PaymentConfirmedEvent { AllocationId = allocation.Id, InvoiceId = invoice.Id, OccurredAt = receipt.VerifiedAt,
                PaidAmount = financial.AllocatedPayments + allocation.Amount, OutstandingAmount = outstanding - allocation.Amount });
        }
        return await Finish("Completed", reason, receipt.Id);
    }, token);

    public static string Reference(string mode, SePayTransaction tx) => "SP:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        System.Text.Json.JsonSerializer.Serialize(new[] { mode, tx.Gateway.ToUpperInvariant(), tx.AccountNumber, tx.ReferenceCode.Trim().ToUpperInvariant() }))));
    private static string? ResolveCode(SePayTransaction tx)
    {
        var matches = Regex.Matches(tx.Content.ToUpperInvariant(), "(?<![A-Z0-9])BH[0-9]{8}(?![A-Z0-9])").Select(m => m.Value).Distinct().ToArray();
        if (matches.Length != 1 || !string.IsNullOrEmpty(tx.Code) && !string.Equals(tx.Code, matches[0], StringComparison.OrdinalIgnoreCase)) return null;
        return matches[0];
    }
}
