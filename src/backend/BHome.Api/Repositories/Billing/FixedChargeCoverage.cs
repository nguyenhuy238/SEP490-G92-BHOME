using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

internal sealed class FixedChargeCoverageRepository(BHomePersistenceContext db) : IFixedChargeCoverage
{
    public async Task<IReadOnlyList<FixedChargeCoverage>> ReadAsync(Guid roomId, DateOnly period, string code, CancellationToken token)
    {
        var result = new List<FixedChargeCoverage>();
        if (db is not Compact24DbContext compact) return result;
        var nativeLines = await (from line in compact.Set<Native.InvoiceItem>().AsNoTracking()
                                 join invoice in compact.Set<Native.Invoice>().AsNoTracking() on line.InvoiceId equals invoice.Id
                                 join contract in compact.Set<Native.Contract>().AsNoTracking() on invoice.ContractId equals contract.Id
                                 where invoice.RoomId == roomId && (invoice.BillingPeriod == period ||
                                     code == "RENT" && invoice.BillingPeriod == period.AddMonths(-1)) &&
                                     invoice.Status == (short)InvoiceStatus.Final && line.ChargeCode == code
                                 select new { line, invoice.BillingPeriod, invoice.BillingSnapshot, contract.SnapshotHash }).ToArrayAsync(token);
        var lines = nativeLines.Select(r => new
        {
            line = NativeInvoicePersistence.ReadLine(r.line),
            r.BillingPeriod,
            SnapshotHash = r.SnapshotHash ?? "",
            ScheduleSnapshot = r.BillingSnapshot.TryGetProperty("compactState", out var state) &&
                state.TryGetProperty("scheduleSnapshot", out var snapshot) ? snapshot.GetString() ?? "" : ""
        }).ToArray();
        var invoiceIds = lines.Select(r => r.line.InvoiceId).Distinct().ToArray();
        var adjustmentRows = await compact.Set<Native.InvoiceAdjustment>().FromSqlInterpolated($"""
            SELECT * FROM invoice_adjustments WHERE decision_snapshot->>'chargeCode'={code}
                AND COALESCE((decision_snapshot->>'invoiceStatus')::integer,0)=1 AND decision_snapshot->>'outcome'='Approved'
            """).AsNoTracking().Where(d => invoiceIds.Contains(d.InvoiceId)).Take(501).ToArrayAsync(token);
        var adjustments = adjustmentRows.Select(r => NativeAdjustmentPersistence.ReadDecision(r)!).ToArray();
        if (adjustments.Length > 500) throw ContractException.Conflict("fixed_charge_history_review_required");
        foreach (var row in lines)
        {
            var decisions = adjustments.Where(d => d.InvoiceId == row.line.InvoiceId).ToArray();
            var reduction = Math.Max(0, (row.line.CalculatedAmount ?? row.line.Amount) - row.line.Amount - decisions.Sum(d => d.Delta));
            if (!string.IsNullOrWhiteSpace(row.line.UtilityCalculationSnapshot))
            {
                using var json = JsonDocument.Parse(row.line.UtilityCalculationSnapshot);
                if (json.RootElement.TryGetProperty("kind", out var kind) && kind.GetString() == "FixedChargeCoverage/v1")
                {
                    var source = json.RootElement.GetProperty("source").Deserialize<FixedChargeSource>()!;
                    if (source.BillingPeriod == period)
                        result.Add(new(row.line.Id, source, reduction, decisions.Select(d => d.Id).Order().ToArray()));
                    continue;
                }
            }
            // Historical invoices without a charge-period snapshot charged rent in their own billing period.
            if (row.BillingPeriod != period) continue;
            var schedule = JsonSerializer.Deserialize<BillingSchedule>(row.ScheduleSnapshot) ?? throw ContractException.Conflict("billing_schedule_snapshot_invalid");
            var policy = new PolicyDto(row.line.PolicyId ?? Guid.Empty, Guid.Empty, roomId, row.line.Category, row.line.ChargeCode,
                row.line.Name, ChargingMethod.FixedPerRoomPerMonth, row.line.Rate, period, null, row.line.PolicyVersion ?? 0);
            var reference = FixedChargeCalculation.PolicyReference(policy, schedule, row.SnapshotHash);
            result.Add(new(row.line.Id, new(period, code, row.line.Category.ToString(), row.line.PolicyId, row.line.PolicyVersion, row.line.Rate,
                reference, schedule.PartialMonth, schedule.Rounding, row.line.OccupiedDays, row.line.PeriodDays,
                row.line.CalculatedAmount ?? row.line.Amount, 0), reduction, decisions.Select(d => d.Id).Order().ToArray()));
        }
        var records = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE c.room_id={roomId} AND h->>'recordType'={SettlementChargeRecords.ChargeKind}
              AND h->'state'->'fixedCharge'->>'billingPeriod'={period.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)}
              AND h->'state'->'fixedCharge'->>'chargeCode'={code}
            """).Take(501).ToArrayAsync(token);
        if (records.Length > 500) throw ContractException.Conflict("fixed_charge_history_review_required");
        foreach (var record in records)
        {
            var charge = JsonSerializer.Deserialize<SettlementReceivable>(record, SettlementChargeRecords.Json)!;
            result.Add(new(charge.Id, charge.FixedCharge!));
        }
        return result;
    }
}
