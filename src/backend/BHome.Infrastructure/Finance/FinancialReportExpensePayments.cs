using BHome.Application.Finance;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    private async Task<Dictionary<Guid, ExpensePaymentAggregate>> ReadExpensePaymentsAsync(ReportFilter filter, CancellationToken token)
    {
        var rows = await db.Database.SqlQuery<ExpensePaymentAggregate>($"""
            WITH amounts AS (
              SELECT e.location_id,e.expense_type,e.occurred_on,e.amount,
                count(h->'state') confirmations,
                COALESCE(sum((h->'state'->>'amount')::numeric),0) paid_total,
                COALESCE(sum((h->'state'->>'amount')::numeric) FILTER(WHERE (h->'state'->>'paidOn')::date BETWEEN {filter.From} AND {filter.To}),0) paid_period,
                COALESCE(sum((h->'state'->>'amount')::numeric) FILTER(WHERE (h->'state'->>'paidOn')::date<={filter.To}),0) paid_cumulative
              FROM expenses e
              LEFT JOIN LATERAL (SELECT h FROM jsonb_array_elements(e.history) h WHERE h->>'recordType'='ExpensePaymentV1') p ON TRUE
              WHERE ({filter.LocationId}::uuid IS NULL OR e.location_id={filter.LocationId})
                AND ({filter.RoomId}::uuid IS NULL OR e.room_id={filter.RoomId})
              GROUP BY e.id,e.location_id,e.expense_type,e.occurred_on,e.amount
            )
            SELECT location_id AS "LocationId",
              COALESCE(sum(paid_period) FILTER(WHERE expense_type='OPERATING'),0) AS "OperatingPaid",
              COALESCE(sum(amount-paid_total) FILTER(WHERE expense_type='OPERATING' AND confirmations>0 AND occurred_on BETWEEN {filter.From} AND {filter.To}),0) AS "OperatingUnpaid",
              COALESCE(sum(amount) FILTER(WHERE expense_type='OPERATING' AND confirmations=0 AND occurred_on BETWEEN {filter.From} AND {filter.To}),0) AS "OperatingUnknown",
              COALESCE(sum(amount) FILTER(WHERE expense_type='OPERATING' AND confirmations=0 AND occurred_on<={filter.To}),0) AS "OperatingUnknownCumulative",
              COALESCE(sum(paid_cumulative) FILTER(WHERE expense_type='OPERATING'),0) AS "OperatingPaidCumulative",
              COALESCE(sum(paid_period) FILTER(WHERE expense_type='INITIAL_INVESTMENT'),0) AS "InvestmentPaid",
              COALESCE(sum(amount) FILTER(WHERE expense_type='INITIAL_INVESTMENT' AND confirmations=0 AND occurred_on<={filter.To}),0) AS "InvestmentUnknown",
              COALESCE(sum(amount) FILTER(WHERE expense_type='INITIAL_INVESTMENT' AND occurred_on BETWEEN {filter.From} AND {filter.To}),0) AS "InvestmentInPeriod",
              bool_or(paid_total<0 OR paid_total>amount) AS "Invalid"
            FROM amounts GROUP BY location_id
            """).ToArrayAsync(token);
        if (rows.Any(r => r.Invalid)) throw new FinanceException(409, "expense_payment_history_requires_review");
        return rows.ToDictionary(r => r.LocationId);
    }
}

public sealed class ExpensePaymentAggregate
{
    public Guid LocationId { get; set; }
    public decimal OperatingPaid { get; set; }
    public decimal OperatingUnpaid { get; set; }
    public decimal OperatingUnknown { get; set; }
    public decimal OperatingUnknownCumulative { get; set; }
    public decimal OperatingPaidCumulative { get; set; }
    public decimal InvestmentPaid { get; set; }
    public decimal InvestmentUnknown { get; set; }
    public decimal InvestmentInPeriod { get; set; }
    public bool Invalid { get; set; }
}
