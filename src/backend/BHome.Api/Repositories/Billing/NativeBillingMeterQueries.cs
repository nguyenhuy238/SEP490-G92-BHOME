using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

// The reading's immutable evidence identity must still refer to linked, uploaded
// evidence on its operational task. Do not authorize a download from a stale snapshot.
internal static class NativeBillingMeterQueries
{
    internal const string ConfirmedWithEvidence = """
        SELECT r.* FROM meter_readings r
        JOIN operational_tasks t ON t.id=r.operational_task_id
        WHERE t.task_type='METER_READ' AND t.status='2'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.evidence) e
            WHERE e->>'recordType'='MeterEvidence'
              AND e->>'id'=(SELECT h->'state'->>'evidenceId' FROM jsonb_array_elements(r.history)
                WITH ORDINALITY a(h,n) WHERE h->>'recordType'='MeterReading' ORDER BY n DESC LIMIT 1)
              AND e->>'isLinked'='true' AND e->>'isUploaded'='true')
        """;

    internal sealed record ReadingWithEvidence(MeterReading Reading, OperationalTask Task, MeterEvidence Evidence);

    internal static IQueryable<BHome.Domain.Billing.MeterReading> Confirmed(Compact24DbContext db) =>
        db.Set<BHome.Domain.Billing.MeterReading>().FromSqlRaw(ConfirmedWithEvidence).AsNoTracking();

    internal static IQueryable<BHome.Domain.Billing.MeterReading> TenantVisible(Compact24DbContext db, Guid actor) =>
        db.Set<BHome.Domain.Billing.MeterReading>().FromSqlInterpolated($"""
            SELECT r.* FROM meter_readings r
            JOIN operational_tasks t ON t.id=r.operational_task_id
            JOIN meters m ON m.id=r.meter_id
            WHERE t.task_type='METER_READ' AND t.status='2'
              AND r.status IN ({(short)MeterReadingStatus.Confirmed},{(short)MeterReadingStatus.Corrected})
              AND r.confirmed_at<>{DateTimeOffset.MinValue}
              AND t.meter_id=m.id
              AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.evidence) e
                WHERE e->>'recordType'='MeterEvidence'
                  AND e->>'taskId'=t.id::text
                  AND e->>'id'=(SELECT h->'state'->>'evidenceId' FROM jsonb_array_elements(r.history)
                    WITH ORDINALITY a(h,n) WHERE h->>'recordType'='MeterReading' ORDER BY n DESC LIMIT 1)
                  AND e->>'isLinked'='true' AND e->>'isUploaded'='true')
              AND (EXISTS(SELECT 1 FROM contracts c JOIN contract_residents cr ON cr.contract_id=c.id
                    JOIN residents res ON res.id=cr.resident_id
                    WHERE c.room_id=m.room_id AND c.contract_type IN ('MAIN','RENEWAL','ADDENDUM')
                      AND c.activated_at IS NOT NULL
                      AND c.status IN ({(short)ContractStatus.Active},{(short)ContractStatus.Terminated},{(short)ContractStatus.Superseded})
                      AND res.user_id={actor}
                      AND c.start_date<=COALESCE((t.billing_period+interval '1 month'-interval '1 day')::date,(t.task_data->'state'->>'readingDate')::date)
                      AND COALESCE(c.actual_end_date,c.end_date)>=COALESCE(t.billing_period,(t.task_data->'state'->>'readingDate')::date)
                      AND cr.residence_from<=COALESCE((t.billing_period+interval '1 month'-interval '1 day')::date,(t.task_data->'state'->>'readingDate')::date)
                      AND COALESCE(cr.residence_to,'infinity'::date)>=COALESCE(t.billing_period,(t.task_data->'state'->>'readingDate')::date))
                OR EXISTS(SELECT 1 FROM invoice_items li JOIN invoices i ON i.id=li.invoice_id
                    WHERE li.meter_reading_id=r.id AND {actor}=ANY(i.recipient_user_ids)))
            """).AsNoTracking();

    internal static ReadingWithEvidence Read(MeterReading reading, BHome.Domain.Billing.OperationalTask task)
    {
        var evidence = NativeCaptureReads.Evidence(task, reading.EvidenceId)
            ?? throw new InvalidOperationException("Confirmed meter evidence was not found.");
        return new(reading, NativeCaptureReads.Task(task), evidence);
    }
}
