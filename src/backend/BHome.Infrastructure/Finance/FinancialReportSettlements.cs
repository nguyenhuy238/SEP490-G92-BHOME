using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Finance;

public sealed partial class FinancialReportRepository
{
    private async Task<Dictionary<Guid, SettlementReportAggregate>> SettlementSourcesAsync(ReportFilter filter, DateTimeOffset start, DateTimeOffset end, CancellationToken token)
    {
        try
        {
            var rows = await db.Database.SqlQuery<SettlementReportAggregate>($"""
                WITH charges AS (
                  SELECT c.id contract_id,c.room_id,room.location_id,(h->'state'->>'id')::uuid charge_id,
                    (h->'state'->>'amount')::numeric amount,
                    (h->'state'->>'contractId'=c.id::text AND h->'state'->>'roomId'=c.room_id::text AND h->'state'->>'kind' IN ('TenantDamage','FinalUtility','FinalFixed')) valid_source,
                    CASE h->'state'->>'kind' WHEN 'FinalUtility' THEN (h->'state'->'utility'->>'billingPeriod')::date
                      WHEN 'FinalFixed' THEN (h->'state'->'fixedCharge'->>'billingPeriod')::date
                      ELSE ((h->'state'->>'approvedAt')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END basis_date
                  FROM contracts c JOIN rooms room ON room.id=c.room_id CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                  WHERE h->>'recordType'='SettlementReceivableV1' AND COALESCE(h->'state'->>'isDevelopmentDemo','false')<>'true'
                    AND ({filter.LocationId}::uuid IS NULL OR room.location_id={filter.LocationId})
                    AND ({filter.RoomId}::uuid IS NULL OR c.room_id={filter.RoomId})
                ), balances AS (
                  SELECT c.*,COALESCE((SELECT sum(a.amount) FROM payment_allocations a
                    WHERE a.target_settlement_contract_id=c.contract_id AND a.settlement_receivable_id=c.charge_id),0) paid
                  FROM charges c
                ), cash AS (
                  SELECT c.location_id,COALESCE(sum(a.amount),0) cumulative,
                    COALESCE(sum(a.amount) FILTER(WHERE a.allocated_at>={start}),0) period_amount
                  FROM charges c JOIN payment_allocations a ON a.target_settlement_contract_id=c.contract_id AND a.settlement_receivable_id=c.charge_id
                  JOIN payments p ON p.id=a.source_payment_id
                  WHERE p.status='VERIFIED' AND a.allocated_at<{end} AND COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')<>'true'
                  GROUP BY c.location_id
                ), offsets AS (
                  SELECT room.location_id,sum(a.amount) amount FROM payment_allocations a
                  JOIN contracts source ON source.id=a.source_deposit_contract_id JOIN rooms room ON room.id=source.room_id
                  WHERE (a.target_invoice_id IS NOT NULL OR a.target_settlement_contract_id IS NOT NULL) AND a.deposit_offset_approval_id IS NOT NULL
                    AND a.allocated_at>={start} AND a.allocated_at<{end}
                    AND COALESCE(source.draft_metadata->>'isDevelopmentDemo','false')<>'true'
                    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source.history) demo WHERE demo->>'recordType'='Contract' AND demo->'state'->>'isDevelopmentDemo'='true')
                    AND ({filter.LocationId}::uuid IS NULL OR room.location_id={filter.LocationId})
                    AND ({filter.RoomId}::uuid IS NULL OR source.room_id={filter.RoomId}) GROUP BY room.location_id
                ), forfeitures AS (
                  SELECT room.location_id,sum(COALESCE((SELECT sum(a.amount) FROM payment_allocations a WHERE a.target_deposit_contract_id=c.id),0)) amount
                  FROM contracts c JOIN rooms room ON room.id=c.room_id
                  JOIN LATERAL (SELECT review FROM jsonb_array_elements(COALESCE(c.settlement->'reviews','[]'::jsonb)) review
                    WHERE review->>'recordType'='ContractSettlementReview' AND review->>'decision'='HoldingDepositForfeited'
                    ORDER BY (review->>'reviewedAt')::timestamptz DESC,review->>'id' DESC LIMIT 1) cancellation ON true
                  WHERE c.contract_type='HOLDING' AND c.status={(short)ContractStatus.Cancelled} AND cancellation.review->>'ledgerReference' ~ {"^HOLDING-[A-F0-9]{64}$"}
                    AND (cancellation.review->>'reviewedAt')::timestamptz>={start} AND (cancellation.review->>'reviewedAt')::timestamptz<{end}
                    AND NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_deposit_contract_id=c.id)
                    AND NOT EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_deposit_contract_id=c.id AND r.status IN ('REQUESTED','APPROVED','COMPLETED'))
                    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) demo WHERE demo->>'recordType'='Contract' AND demo->'state'->>'isDevelopmentDemo'='true')
                    AND ({filter.LocationId}::uuid IS NULL OR room.location_id={filter.LocationId})
                    AND ({filter.RoomId}::uuid IS NULL OR c.room_id={filter.RoomId}) GROUP BY room.location_id
                ), charge_totals AS (
                  SELECT location_id,sum(amount) FILTER(WHERE basis_date>={filter.From} AND basis_date<={filter.To}) amount,
                    sum(amount-paid) FILTER(WHERE basis_date>={filter.From} AND basis_date<={filter.To}) debt,
                    bool_or(amount IS NULL OR amount<0 OR amount<>trunc(amount) OR paid<0 OR paid>amount OR basis_date IS NULL OR COALESCE(valid_source,false)=false) invalid
                  FROM balances GROUP BY location_id
                ), scopes AS (
                  SELECT location_id FROM charge_totals UNION SELECT location_id FROM cash UNION SELECT location_id FROM offsets UNION SELECT location_id FROM forfeitures
                )
                SELECT scope.location_id AS "LocationId",COALESCE(c.amount,0) AS "Charges",COALESCE(c.debt,0) AS "Debt",
                  COALESCE(cash.period_amount,0) AS "Collections",COALESCE(cash.cumulative,0) AS "CumulativeCollections",
                  COALESCE(offsets.amount,0) AS "DepositOffsets",COALESCE(forfeitures.amount,0) AS "HoldingForfeitures",COALESCE(c.invalid,false) AS "Invalid"
                FROM scopes scope LEFT JOIN charge_totals c USING(location_id) LEFT JOIN cash USING(location_id)
                  LEFT JOIN offsets USING(location_id) LEFT JOIN forfeitures USING(location_id)
                """).ToArrayAsync(token);
            if (rows.Any(r => r.Invalid)) throw new FinanceException(409, "settlement_report_sources_require_review");
            return rows.ToDictionary(r => r.LocationId);
        }
        catch (PostgresException error) when (error.SqlState is "22P02" or "22007" or "22008")
        { throw new FinanceException(409, "settlement_report_sources_require_review"); }
    }
}
public sealed class SettlementReportAggregate
{
    public Guid LocationId { get; set; }
    public decimal Charges { get; set; }
    public decimal Debt { get; set; }
    public decimal Collections { get; set; }
    public decimal CumulativeCollections { get; set; }
    public decimal DepositOffsets { get; set; }
    public decimal HoldingForfeitures { get; set; }
    public bool Invalid { get; set; }
}
