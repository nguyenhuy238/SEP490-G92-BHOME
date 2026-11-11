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

namespace BHome.Infrastructure.Billing;

internal sealed class FixedChargeCoverageRepository(BHomePersistenceContext db) : IFixedChargeCoverage
{
    public async Task<IReadOnlyList<FixedChargeCoverage>> ReadAsync(Guid roomId, DateOnly period, string code, CancellationToken token)
    {
        var result = new List<FixedChargeCoverage>();
        if (db is not Compact24DbContext) return result;
        var lines = await (from line in db.Set<InvoiceLine>().AsNoTracking()
                           join invoice in db.Set<Invoice>() on line.InvoiceId equals invoice.Id
                           join contract in db.Set<Contract>() on invoice.RepresentativeContractId equals contract.Id
                           where invoice.RoomId == roomId && invoice.BillingPeriod == period && invoice.Status == InvoiceStatus.Final && line.ChargeCode == code
                           select new { line, invoice.ScheduleSnapshot, contract.SnapshotHash }).ToArrayAsync(token);
        foreach (var row in lines)
        {
            if (!string.IsNullOrWhiteSpace(row.line.UtilityCalculationSnapshot))
            {
                using var json = JsonDocument.Parse(row.line.UtilityCalculationSnapshot);
                if (json.RootElement.TryGetProperty("kind", out var kind) && kind.GetString() == "FixedChargeCoverage/v1")
                {
                    result.Add(new(row.line.Id, json.RootElement.GetProperty("source").Deserialize<FixedChargeSource>()!)); continue;
                }
            }
            var schedule = JsonSerializer.Deserialize<BillingSchedule>(row.ScheduleSnapshot) ?? throw ContractException.Conflict("billing_schedule_snapshot_invalid");
            var policy = new PolicyDto(row.line.PolicyId ?? Guid.Empty, Guid.Empty, roomId, row.line.Category, row.line.ChargeCode,
                row.line.Name, ChargingMethod.FixedPerRoomPerMonth, row.line.Rate, period, null, row.line.PolicyVersion ?? 0);
            var reference = FixedChargeCalculation.PolicyReference(policy, schedule, row.SnapshotHash);
            result.Add(new(row.line.Id, new(period, code, row.line.Category.ToString(), row.line.PolicyId, row.line.PolicyVersion, row.line.Rate,
                reference, schedule.PartialMonth, schedule.Rounding, row.line.OccupiedDays, row.line.PeriodDays,
                row.line.CalculatedAmount ?? row.line.Amount, 0)));
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
