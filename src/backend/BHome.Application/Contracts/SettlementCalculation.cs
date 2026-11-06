using System.Text.Json.Serialization;

namespace BHome.Application.Contracts;

// Source positions, not authorization to spend a deposit or proof of a bank transfer.
public sealed record DepositLedgerPosition(decimal Received, decimal Allocated, decimal Refunded, decimal Reserved);
public interface IContractDepositPosition
{
    Task<DepositLedgerPosition?> ReadAsync(Guid[] contractIds, CancellationToken token);
}

[JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)]
public sealed record SettlementCalculation(decimal IssuedTotal, decimal ApprovedAdjustmentTotal,
    decimal PayableTotal, decimal VerifiedInvoicePayments, decimal RoomOutstanding,
    decimal? ContractSpecificOutstanding, decimal PotentialInvoiceExcess,
    decimal? DepositAllocated, decimal? DepositRefunded, decimal? DepositReserved,
    decimal? AvailableSecurityDeposit, bool DepositPositionConsistent);

public static class SettlementCalculator
{
    public static SettlementCalculation Calculate(IReadOnlyList<SettlementInvoice> invoices,
        decimal verifiedDeposit, DepositLedgerPosition? deposit)
    {
        if (verifiedDeposit < 0 || invoices.Select(i => i.InvoiceId).Distinct().Count() != invoices.Count)
            throw ContractException.Conflict("settlement_source_integrity_failed");
        // Shared Room debt has no approved individual split. Never assign all of it to the departing Tenant.
        decimal? personal = invoices.Any(i => i.Shared && i.Financials.OutstandingAmount > 0)
            ? null : invoices.Sum(i => i.Financials.OutstandingAmount);
        var available = deposit is null ? (decimal?)null : deposit.Received - deposit.Allocated - deposit.Refunded - deposit.Reserved;
        var consistent = deposit is not null && deposit.Received == verifiedDeposit && deposit.Allocated >= 0 &&
            deposit.Refunded >= 0 && deposit.Reserved >= 0 && available >= 0;
        return new(invoices.Sum(i => i.Financials.OriginalIssuedAmount), invoices.Sum(i => i.Financials.ApprovedAdjustmentTotal),
            invoices.Sum(i => i.Financials.EffectivePayableAmount), invoices.Sum(i => i.Financials.AllocatedPayments),
            invoices.Sum(i => i.Financials.OutstandingAmount), personal, invoices.Sum(i => i.Financials.PotentialExcessAmount),
            deposit?.Allocated, deposit?.Refunded, deposit?.Reserved, consistent ? available : null, consistent);
    }
}
