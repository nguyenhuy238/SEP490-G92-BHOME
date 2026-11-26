using BHome.Application.Finance;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    // Bank money enters once per verified allocation. Internal deposit conversion and
    // deposit offsets have no source_payment_id and cannot enter these cash totals.
    private async Task<Dictionary<Guid, BankReceiptBasisRow>> ReadBankReceiptBasisAsync(
        ReportFilter filter, DateTimeOffset start, DateTimeOffset end, CancellationToken token)
    {
        var rows = await db.Database.SqlQuery<BankReceiptBasisRow>($"""
            WITH sources AS (
              SELECT i.location_id, i.room_id, i.billing_period basis_date, a.amount,
                p.received_at cash_at,
                'Invoice' kind
              FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
              JOIN invoices i ON i.id=a.target_invoice_id
              WHERE p.status='VERIFIED' AND i.status=1
                AND (COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true' OR p.provider_code='SEPAY:TEST')
              UNION ALL
              SELECT r.location_id,r.id,c.start_date,a.amount,
                p.received_at,
                CASE WHEN a.target_initial_contract_id IS NOT NULL THEN 'InitialRent' ELSE 'Deposit' END
              FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
              JOIN contracts c ON c.id=COALESCE(a.target_initial_contract_id,a.target_deposit_contract_id)
              JOIN rooms r ON r.id=c.room_id
              WHERE p.status='VERIFIED'
                AND (COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true' OR p.provider_code='SEPAY:TEST')
            )
            SELECT location_id AS "LocationId",
              COALESCE(sum(amount) FILTER(WHERE kind IN ('Invoice','InitialRent') AND cash_at>={start} AND cash_at<{end}),0) AS "BusinessCollected",
              COALESCE(sum(amount) FILTER(WHERE kind IN ('Invoice','InitialRent') AND basis_date<{filter.From} AND cash_at>={start} AND cash_at<{end}),0) AS "PriorCollections",
              COALESCE(sum(amount) FILTER(WHERE kind IN ('Invoice','InitialRent') AND basis_date>{filter.To} AND cash_at>={start} AND cash_at<{end}),0) AS "AdvanceCollections",
              COALESCE(sum(amount) FILTER(WHERE kind='Deposit' AND cash_at>={start} AND cash_at<{end}),0) AS "DepositReceipts",
              COALESCE(sum(amount) FILTER(WHERE kind='InitialRent' AND cash_at>={start} AND cash_at<{end}),0) AS "InitialRentAndFees",
              COALESCE(sum(amount) FILTER(WHERE kind='Invoice' AND basis_date BETWEEN {filter.From} AND {filter.To}),0) AS "PeriodVerifiedCollections",
              COALESCE(sum(amount) FILTER(WHERE kind IN ('Invoice','InitialRent') AND cash_at<{end}),0) AS "CumulativeBusinessCollected"
            FROM sources WHERE ({filter.LocationId}::uuid IS NULL OR location_id={filter.LocationId})
              AND ({filter.RoomId}::uuid IS NULL OR room_id={filter.RoomId})
            GROUP BY location_id
            """).ToArrayAsync(token);
        return rows.ToDictionary(r => r.LocationId);
    }
}

public sealed class BankReceiptBasisRow
{
    public Guid LocationId { get; set; }
    public decimal BusinessCollected { get; set; }
    public decimal PriorCollections { get; set; }
    public decimal DepositReceipts { get; set; }
    public decimal InitialRentAndFees { get; set; }
    public decimal AdvanceCollections { get; set; }
    public decimal PeriodVerifiedCollections { get; set; }
    public decimal CumulativeBusinessCollected { get; set; }
}

public sealed class ReportExpenseCategoryRow
{
    public Guid LocationId { get; set; }
    public string Category { get; set; } = "";
    public decimal Amount { get; set; }
}
