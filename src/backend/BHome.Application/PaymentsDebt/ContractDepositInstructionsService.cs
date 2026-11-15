using System.Globalization;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.TenantContracts;

namespace BHome.Application.PaymentsDebt;

public sealed record ContractDepositInstructions(Guid ContractId, string Mode, string Availability,
    string? BankIdentifier, string? AccountNumber, string? AccountHolder, string OutstandingAmount,
    string TransferReference, string? QrImageDataUri, bool PreviewOnly = false);

// One instruction and payment-code path for either configured provider environment.
public sealed class ContractDepositInstructionsService(ContractService contracts, IContractRepository contractData,
    IPaymentRepository payments, IPaymentCodeRegistry codes, ITransferQrGenerator qr, SePayOptions options,
    IHoldingTestScope testScope, TimeProvider clock)
{
    public async Task<ContractDepositInstructions> GetAsync(Guid id, CancellationToken t)
    {
        await contracts.GetAsync(id, t); // Effective Owner/Staff/Tenant resource scope.
        var c = await contractData.FindAsync(id, t) ?? throw new PaymentException(404, "contract_not_found");
        if (c.Kind != ContractKind.Holding || c.ApprovedAt is null || c.Status is not (ContractStatus.PendingActivation or ContractStatus.Active))
            throw new PaymentException(409, "holding_not_payable");
        if (!ContractChargeSnapshot.IsIntact(c)) throw new PaymentException(409, "signed_terms_changed");
        if (c.Status != ContractStatus.Active)
        {
            var readiness = await contracts.ReadinessAsync(id, t);
            if (readiness.Blockers.Any(b => b is "verified_signature_evidence_required" or "internal_acceptance_evidence_required"))
                throw new PaymentException(409, "verified_signature_evidence_required");
        }
        var mode = ContractPaymentModes.Of(c);
        if (!options.Enabled || options.Mode != mode || mode == "Test" && !testScope.Allows(c.Room.LocationId) && !testScope.AllowsExternalDatabase)
            throw new PaymentException(409, "sepay_environment_mismatch");
        var remaining = Math.Max(0, c.RequiredDeposit - await contractData.DepositTotalAsync(id, t));
        if (remaining > 0 && (c.HoldingExpiryAt is null || c.HoldingExpiryAt <= clock.GetUtcNow()))
            throw new PaymentException(409, "holding_expired");
        var account = await payments.ReceivingAccountAsync(c.Room.LocationId, t);
        if (account is null || !account.Enabled || account.IsDevelopmentDemo != (mode == "Test") ||
            !options.ReceivingAccounts.Any(a => a.LocationId == c.Room.LocationId && a.BankIdentifier == account.BankIdentifier && a.AccountNumber == account.AccountNumber))
            throw new PaymentException(409, "receiving_account_unavailable");
        var code = remaining > 0 ? await codes.IssueAsync("Deposit", id, c.Room.LocationId, t) : await codes.GetAsync("Deposit", id, t);
        if (remaining > 0 && code is null) throw new PaymentException(503, "payment_code_generation_unavailable");
        var rendered = remaining > 0 ? qr.Generate(account.BankIdentifier, account.AccountNumber, remaining, code!) : null;
        return new(id, mode, remaining == 0 ? "Settled" : rendered is null ? "InstructionsOnly" : "Available",
            account.BankIdentifier, account.AccountNumber, account.AccountHolder, remaining.ToString("0", CultureInfo.InvariantCulture), code ?? "", rendered?.PngDataUri);
    }
}
