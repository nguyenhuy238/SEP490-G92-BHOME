using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

// Issue the existing AD_HOC invoice through its mandatory draft -> final
// transition. Finalization and the durable issued event share the ledger
// transaction with the compensation decision.
internal static class NativeCompensationInvoice
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static async Task IssueAsync(Compact24DbContext db, Invoice invoice, InvoiceIssuedEvent issued, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null || invoice.Type != "AD_HOC" ||
            invoice.Status != InvoiceStatus.Draft || invoice.FinalizedAt is null || invoice.FinalizedByUserId is null ||
            issued.InvoiceId != invoice.Id || invoice.Lines.Count != 1 || invoice.Lines[0].ChargeCode != "TENANT_DAMAGE")
            throw new InvalidOperationException("A compensation invoice requires the protected issuance transaction.");
        var recipients = invoice.Recipients.Select(r => r.TenantUserId).Distinct().ToArray();
        if (recipients.Length == 0 || !recipients.Contains(invoice.RepresentativeTenantUserId))
            throw new InvalidOperationException("Invoice recipient snapshot is required.");
        invoice.Stamp(DateTimeOffset.UtcNow, true);
        var draft = State(invoice);
        var draftSnapshot = JsonSerializer.Serialize(new { schemaVersion = 1, compactState = draft }, Json);
        var draftHistory = History(invoice, draft);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO invoices(id,location_id,room_id,contract_id,representative_tenant_user_id,invoice_type,billing_period,
                recipient_user_ids,base_total_amount,status,missing_inputs,billing_snapshot,scheduled_final_date,due_date,
                finalized_at,finalized_by_user_id,version,history)
            VALUES({invoice.Id},{invoice.LocationId},{invoice.RoomId},{invoice.RepresentativeContractId},
                {invoice.RepresentativeTenantUserId},{invoice.Type},{invoice.BillingPeriod},{recipients},{invoice.Total},
                {(short)invoice.Status},{invoice.MissingInputs},CAST({draftSnapshot} AS jsonb),
                {invoice.ScheduledFinalDate},{invoice.DueDate},{invoice.FinalizedAt},{invoice.FinalizedByUserId},
                {invoice.Version},jsonb_build_array(CAST({draftHistory} AS jsonb)))
            """, t);
        foreach (var line in invoice.Lines)
        {
            var snapshot = JsonSerializer.Serialize(new
            {
                schemaVersion = 1, compactState = new
                {
                    line.Id, line.InvoiceId, line.Category, line.ChargeCode, line.Name, line.PolicyId,
                    line.PolicyVersion, line.RateDate, line.Rate, line.Quantity, line.OccupiedDays, line.PeriodDays,
                    line.Amount, line.CalculatedAmount, line.CorrectionRequestId, line.MeterReadingId,
                    line.PreviousReading, line.ConfirmedReading, line.UtilityCalculationSnapshot
                }
            }, Json);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO invoice_items(id,invoice_id,charge_code,description,billing_policy_id,meter_reading_id,
                    quantity,unit_price,amount,calculation_snapshot)
                VALUES({line.Id},{invoice.Id},{line.ChargeCode},{line.Name},{line.PolicyId},{line.MeterReadingId},
                    {line.Quantity},{line.Rate},{line.Amount},CAST({snapshot} AS jsonb))
                """, t);
        }
        var originalVersion = invoice.Version;
        invoice.Status = InvoiceStatus.Final;
        invoice.Version++;
        invoice.Stamp(DateTimeOffset.UtcNow, false);
        var final = State(invoice);
        var finalSnapshot = JsonSerializer.Serialize(new { schemaVersion = 1, compactState = final }, Json);
        var finalHistory = History(invoice, final);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE invoices SET status={(short)invoice.Status},version={invoice.Version},billing_snapshot=CAST({finalSnapshot} AS jsonb),
                history=history||jsonb_build_array(CAST({finalHistory} AS jsonb))
            WHERE id={invoice.Id} AND status=0 AND version={originalVersion}
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Compensation invoice changed before issuance.");
        var key = "InvoiceIssuedEvent:" + issued.InvoiceId;
        var id = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("InvoiceIssuedEvent/" + issued.InvoiceId)).AsSpan(0, 16));
        var eventData = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, recordType = "InvoiceIssuedEvent", state = issued,
            audienceRole = (string?)null, category = (string?)null, succeeded = (bool?)null,
            sessionId = (Guid?)null, targetUserId = (Guid?)null
        }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
            VALUES({id},'OUTBOX',{key},'InvoiceIssuedEvent',CAST({eventData} AS jsonb),{issued.OccurredAt})
            """, t);
    }

    private static JsonElement State(Invoice invoice) => JsonSerializer.SerializeToElement(new
    {
        invoice.Id, invoice.CreatedAt, invoice.UpdatedAt, invoice.Type, invoice.AutomationPlanId,
        invoice.AutomationFinalizationPlanId, invoice.RoomId, invoice.LocationId, invoice.RoomNumber,
        invoice.LocationName, invoice.BillingPeriod, invoice.RepresentativeContractId,
        invoice.RepresentativeTenantUserId, invoice.Status, invoice.Version, invoice.Total,
        invoice.MissingInputs, invoice.ScheduleSnapshot, invoice.ScheduledFinalDate, invoice.DueDate,
        invoice.CreatedByUserId, invoice.FinalizedByUserId, invoice.FinalizedAt
    }, Json);
    private static string History(Invoice invoice, JsonElement state) => JsonSerializer.Serialize(new
    {
        schemaVersion = 1, recordType = "Invoice", recordKey = invoice.Id.ToString(), deleted = false, state
    }, Json);
}
