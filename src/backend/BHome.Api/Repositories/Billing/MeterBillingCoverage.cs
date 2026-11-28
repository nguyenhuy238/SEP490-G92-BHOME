using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

internal sealed record MeterCoveragePosition(BillableMeterPoint? Baseline, decimal AlreadyBilledQuantity,
    string? PreviousPricingSnapshot, bool FullyCovered, IReadOnlyList<string> MissingInputs);
internal sealed record MeterFinancialRange(Guid Id, DateOnly Period, BillableMeterPoint End, decimal From, decimal Quantity, string? Pricing);

internal static class MeterBillingCoverage
{
    private sealed class InvoicePoint
    {
        public Guid Id { get; init; }
        public Guid ReadingId { get; init; }
        public Guid EvidenceId { get; init; }
        public DateOnly Period { get; init; }
        public DateOnly Date { get; init; }
        public decimal NativeValue { get; init; }
        public decimal? From { get; init; }
        public decimal? To { get; init; }
        public decimal Quantity { get; init; }
        public string ImageHash { get; init; } = "";
        public long Length { get; init; }
        public string? Pricing { get; init; }
        public Guid? PolicyId { get; init; }
        public int? PolicyVersion { get; init; }
        public decimal Rate { get; init; }
        public string Schedule { get; init; } = "";
    }
    public static async Task<MeterCoveragePosition> ReadAsync(BHomePersistenceContext db, Guid roomId, Guid meterId,
        DateOnly period, BillableMeterPoint target, DateTimeOffset confirmedAt, CancellationToken token)
    {
        var compact = db as Compact24DbContext;
        var utilityType = compact is not null
            ? (UtilityType)await compact.Set<BHome.Domain.Billing.Meter>().AsNoTracking().Where(m => m.Id == meterId).Select(m => m.UtilityType).SingleAsync(token)
            : await db.Set<Meter>().AsNoTracking().Where(m => m.Id == meterId).Select(m => m.UtilityType).SingleAsync(token);
        var category = utilityType == UtilityType.Electricity ? ChargeCategory.Electricity : ChargeCategory.Water;
        var replacement = compact is not null
            ? await compact.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM invoice_items li JOIN invoices i ON i.id=li.invoice_id
                    JOIN meter_readings r ON r.id=li.meter_reading_id JOIN meters m ON m.id=r.meter_id
                    WHERE i.room_id={roomId} AND i.status={(short)InvoiceStatus.Final} AND i.billing_period={period}
                      AND m.utility_type={(short)utilityType} AND m.id<>{meterId} AND li.quantity>0
                      AND COALESCE((li.calculation_snapshot->'compactState'->>'category')::integer,0)={(int)category}) AS "Value"
                """).SingleAsync(token)
            : await (from line in db.Set<InvoiceItem>()
                     join invoice in db.Set<Invoice>() on line.InvoiceId equals invoice.Id
                     join reading in db.Set<MeterReading>() on line.MeterReadingId equals reading.Id
                     join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
                     where invoice.RoomId == roomId && invoice.Status == InvoiceStatus.Final && invoice.BillingPeriod == period &&
                       meter.UtilityType == utilityType && meter.Id != meterId && line.Quantity > 0 &&
                       (utilityType == UtilityType.Electricity && line.Category == ChargeCategory.Electricity || utilityType == UtilityType.Water && line.Category == ChargeCategory.Water)
                     select line.Id).AnyAsync(token);
        if (replacement)
            return new(null, 0, null, false, ["meter_replacement_allocation_required"]);
        if (db is Compact24DbContext && await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
              WHERE c.room_id={roomId} AND h->>'recordType'={SettlementChargeRecords.ChargeKind}
                AND h->'state'->'utility'->>'utilityType'={utilityType.ToString()}
                AND h->'state'->'utility'->>'billingPeriod'={period.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)}
                AND (h->'state'->'utility'->>'quantity')::numeric>0
                AND h->'state'->'utility'->>'meterId'<>{meterId.ToString()}) AS "Value"
            """).SingleAsync(token)) return new(null, 0, null, false, ["meter_replacement_allocation_required"]);
        InvoicePoint[] rows;
        if (compact is not null)
        {
            var items = compact.Set<BHome.Domain.Billing.InvoiceItem>().FromSqlInterpolated($"""
                SELECT * FROM invoice_items WHERE COALESCE((calculation_snapshot->'compactState'->>'category')::integer,0)={(int)category}
                """).AsNoTracking();
            var nativeRows = await (from line in items
                                    join invoice in compact.Set<BHome.Domain.Billing.Invoice>().AsNoTracking() on line.InvoiceId equals invoice.Id
                                    join reading in NativeBillingMeterQueries.Confirmed(compact) on line.MeterReadingId equals reading.Id
                                    join task in compact.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking() on reading.OperationalTaskId equals task.Id
                                    where invoice.RoomId == roomId && invoice.Status == InvoiceStatus.Final &&
                                      invoice.BillingPeriod <= period && reading.MeterId == meterId
                                    select new { line, invoice, reading, task }).Take(501).ToArrayAsync(token);
            rows = nativeRows.Select(r =>
            {
                var line = r.line;
                var point = NativeBillingMeterQueries.Read(r.reading, r.task);
                var schedule = r.invoice.BillingSnapshot.TryGetProperty("compactState", out var state) &&
                    state.TryGetProperty("scheduleSnapshot", out var snapshot) ? snapshot.GetString() ?? "" : "";
                return new InvoicePoint
                {
                    Id = line.Id,
                    ReadingId = point.Reading.Id,
                    EvidenceId = point.Evidence.Id,
                    Period = r.invoice.BillingPeriod,
                    Date = point.Task.ReadingDate,
                    NativeValue = point.Reading.ConfirmedValue,
                    From = line.PreviousReading,
                    To = line.ConfirmedReading,
                    Quantity = line.Quantity,
                    ImageHash = point.Evidence.ImageHash,
                    Length = point.Evidence.Length,
                    Pricing = line.UtilityCalculationSnapshot,
                    PolicyId = line.PolicyId,
                    PolicyVersion = line.PolicyVersion,
                    Rate = line.Rate,
                    Schedule = schedule
                };
            }).ToArray();
        }
        else rows = await (from line in db.Set<InvoiceItem>().AsNoTracking()
                           join invoice in db.Set<Invoice>() on line.InvoiceId equals invoice.Id
                           join reading in db.Set<MeterReading>() on line.MeterReadingId equals reading.Id
                           join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
                           join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
                           join proof in db.Set<MeterEvidence>() on reading.EvidenceId equals proof.Id
                           where invoice.RoomId == roomId && invoice.Status == InvoiceStatus.Final && invoice.BillingPeriod <= period &&
                             reading.MeterId == meterId && task.MeterStatus == MeterTaskStatus.Completed && proof.IsLinked && proof.IsUploaded &&
                             (meter.UtilityType == UtilityType.Electricity && line.Category == ChargeCategory.Electricity || meter.UtilityType == UtilityType.Water && line.Category == ChargeCategory.Water)
                           select new InvoicePoint
                           {
                               Id = line.Id,
                               ReadingId = reading.Id,
                               EvidenceId = proof.Id,
                               Period = invoice.BillingPeriod,
                               Date = task.ReadingDate,
                               NativeValue = reading.ConfirmedValue,
                               From = line.PreviousReading,
                               To = line.ConfirmedReading,
                               Quantity = line.Quantity,
                               ImageHash = proof.ImageHash,
                               Length = proof.Length,
                               Pricing = line.UtilityCalculationSnapshot,
                               PolicyId = line.PolicyId,
                               PolicyVersion = line.PolicyVersion,
                               Rate = line.Rate,
                               Schedule = invoice.ScheduleSnapshot
                           }).Take(501).ToArrayAsync(token);
        if (rows.Length > 500) return new(null, 0, null, false, ["utility_history_review_required"]);
        var ranges = new List<MeterFinancialRange>(); var missing = new List<string>();
        foreach (var row in rows)
        {
            if (row.From is not { } from || row.To is not { } to || to != row.NativeValue || to < from || row.Quantity != to - from)
            { missing.Add("utility_billed_source_integrity_failed"); continue; }
            var pricing = row.Pricing;
            if (string.IsNullOrWhiteSpace(pricing))
            {
                BillingSchedule? schedule = null;
                try { schedule = JsonSerializer.Deserialize<BillingSchedule>(row.Schedule); } catch (JsonException) { }
                if (schedule is not null) pricing = JsonSerializer.Serialize(new
                {
                    kind = "FlatMeteredIncrement/v1",
                    policyId = row.PolicyId,
                    policyVersion = row.PolicyVersion,
                    rate = row.Rate,
                    rounding = schedule.Rounding
                });
            }
            ranges.Add(new(row.Id, row.Period, new(row.ReadingId, row.EvidenceId, row.Date, to, row.ImageHash, row.Length, "FinalInvoice", row.Id), from, row.Quantity, pricing));
        }
        if (db is Compact24DbContext)
        {
            var json = await db.Database.SqlQuery<string>($"""
                SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                WHERE c.room_id={roomId} AND h->>'recordType'={SettlementChargeRecords.ChargeKind}
                  AND h->'state'->'utility'->>'meterId'={meterId.ToString()}
                """).Take(501).ToArrayAsync(token);
            if (json.Length > 500) return new(null, 0, null, false, ["utility_history_review_required"]);
            foreach (var value in json)
            {
                var charge = JsonSerializer.Deserialize<SettlementReceivable>(value, SettlementChargeRecords.Json)
                    ?? throw ContractException.Conflict("settlement_history_invalid");
                var utility = charge.Utility!;
                if (utility.BillingPeriod > period) continue;
                if (utility.Quantity < 0 || utility.Final.Value - utility.Baseline.Value != utility.Quantity)
                { missing.Add("utility_billed_source_integrity_failed"); continue; }
                ranges.Add(new(charge.Id, utility.BillingPeriod, utility.Final with { SourceKind = "SettlementReceivable", SourceId = charge.Id },
                    utility.Baseline.Value, utility.Quantity, utility.CumulativePricingSnapshot));
            }
        }
        BillableMeterPoint? initialPoint;
        if (compact is not null)
        {
            var initialTasks = compact.Set<BHome.Domain.Billing.OperationalTask>().FromSqlInterpolated($"""
                SELECT * FROM operational_tasks WHERE task_type='METER_READ' AND task_data->'state'->>'purpose'='0'
                    AND (task_data->'state'->>'readingDate')::date<={target.Date}
                """).AsNoTracking();
            var row = await (from reading in NativeBillingMeterQueries.Confirmed(compact)
                             join task in initialTasks on reading.OperationalTaskId equals task.Id
                             where reading.MeterId == meterId && reading.ConfirmedAt <= confirmedAt
                             orderby reading.ReadingAt descending, reading.ConfirmedAt descending
                             select new { reading, task }).FirstOrDefaultAsync(token);
            if (row is null) initialPoint = null;
            else
            {
                var point = NativeBillingMeterQueries.Read(row.reading, row.task);
                initialPoint = new(point.Reading.Id, point.Evidence.Id, point.Task.ReadingDate,
                    point.Reading.ConfirmedValue, point.Evidence.ImageHash, point.Evidence.Length, "ConfirmedInitial", point.Reading.Id);
            }
        }
        else
        {
            var initial = await (from reading in db.Set<MeterReading>().AsNoTracking()
                                 join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
                                 join proof in db.Set<MeterEvidence>() on reading.EvidenceId equals proof.Id
                                 where reading.MeterId == meterId && task.Purpose == ReadingPurpose.Initial && task.MeterStatus == MeterTaskStatus.Completed &&
                                   task.ReadingDate <= target.Date && reading.ConfirmedAt <= confirmedAt && proof.IsLinked && proof.IsUploaded
                                 orderby task.ReadingDate descending, reading.ConfirmedAt descending
                                 select new { reading.Id, proofId = proof.Id, task.ReadingDate, reading.ConfirmedValue, proof.ImageHash, proof.Length }).FirstOrDefaultAsync(token);
            initialPoint = initial is null ? null : new(initial.Id, initial.proofId, initial.ReadingDate, initial.ConfirmedValue,
                initial.ImageHash, initial.Length, "ConfirmedInitial", initial.Id);
        }
        var prior = ranges.Where(r => r.Period < period && r.End.Date <= target.Date).OrderByDescending(r => r.End.Date).ThenByDescending(r => r.End.Value).FirstOrDefault();
        var current = ranges.Where(r => r.Period == period).OrderBy(r => r.From).ThenBy(r => r.End.Value).ToArray();
        if (prior is not null && prior.Period < period.AddMonths(-1)) missing.Add("utility_prior_period_billing_required");
        var baseline = prior?.End;
        if (initialPoint is not null && (baseline is null || initialPoint.Date > baseline.Date || initialPoint.Value > baseline.Value))
        {
            if (baseline is not null && initialPoint.Value > baseline.Value) missing.Add("utility_prior_occupancy_allocation_required");
            baseline = initialPoint;
        }
        var previousPricing = (string?)null; decimal already = 0;
        var cursor = baseline?.Value;
        var opening = cursor ?? current.FirstOrDefault()?.From;
        foreach (var range in current)
        {
            if (cursor is null) cursor = range.From;
            if (range.Quantity > 0 && range.From != cursor) missing.Add(range.From < cursor ? "utility_duplicate_billing_detected" : "utility_coverage_gap_requires_review");
            if (range.End.Value < cursor) continue;
            cursor = range.End.Value; already += range.Quantity; baseline = range.End; previousPricing = range.Pricing;
        }
        if (baseline is null) missing.Add("confirmed_billable_baseline_required");
        var covered = baseline is not null && baseline.Value >= target.Value && target.Value >= opening && current.Length > 0 && missing.Count == 0;
        if (covered) baseline = target with { SourceKind = "AlreadyBilled", SourceId = baseline!.SourceId };
        else if (baseline is not null && (baseline.Date > target.Date || baseline.Value > target.Value)) missing.Add("final_reading_below_billed_baseline");
        return new(baseline, already, previousPricing, covered, missing.Distinct().ToArray());
    }
}
