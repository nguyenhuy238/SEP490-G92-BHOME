using System.Text.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

// Map physical columns explicitly; only calculation/audit metadata comes from
// the existing versioned snapshots. Domain objects here are detached workflow values.
internal static class NativeInvoicePersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record InvoiceMetadata(DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
        Guid? AutomationPlanId, Guid? AutomationFinalizationPlanId, string? RoomNumber,
        string? LocationName, string? ScheduleSnapshot, Guid CreatedByUserId);
    private sealed record LineMetadata(ChargeCategory Category, int? PolicyVersion,
        DateOnly RateDate, int OccupiedDays, int PeriodDays, decimal? CalculatedAmount,
        Guid? CorrectionRequestId, decimal? PreviousReading, decimal? ConfirmedReading,
        string? UtilityCalculationSnapshot);

    internal static IQueryable<Native.Invoice> Visible(Compact24DbContext db, InvoiceScope scope) =>
        db.Set<Native.Invoice>().AsNoTracking().Where(i => scope.Owner ||
            scope.Tenant && i.RecipientUserIds.Contains(scope.Actor));

    internal static async Task<Invoice[]> ReadAsync(Compact24DbContext db, IQueryable<Native.Invoice> query,
        CancellationToken t, bool includeLines = true)
    {
        var rows = await query.ToArrayAsync(t);
        if (rows.Length == 0) return [];
        var ids = rows.Select(r => r.Id).ToArray();
        var items = includeLines
            ? await db.Set<Native.InvoiceItem>().AsNoTracking().Where(l => ids.Contains(l.InvoiceId)).ToArrayAsync(t)
            : Array.Empty<Native.InvoiceItem>();
        var lines = items.ToLookup(l => l.InvoiceId);
        return rows.Select(row => Read(row, lines[row.Id])).ToArray();
    }

    private static Invoice Read(Native.Invoice row, IEnumerable<Native.InvoiceItem> lines)
    {
        var state = row.BillingSnapshot.TryGetProperty("compactState", out var data)
            ? data.Deserialize<InvoiceMetadata>(Json) : null;
        var invoice = Invoice.RestoreIdentity(row.Id,
            state is null || state.CreatedAt == default ? DateTimeOffset.UnixEpoch : state.CreatedAt.ToUniversalTime(),
            state is null || state.UpdatedAt == default ? DateTimeOffset.UnixEpoch : state.UpdatedAt.ToUniversalTime());
        invoice.RoomId = row.RoomId;
        invoice.LocationId = row.LocationId;
        invoice.RepresentativeContractId = row.ContractId;
        invoice.RepresentativeTenantUserId = row.RepresentativeTenantUserId;
        invoice.Type = row.InvoiceType;
        invoice.BillingPeriod = row.BillingPeriod;
        invoice.Status = (InvoiceStatus)row.Status;
        invoice.Version = row.Version;
        invoice.Total = row.BaseTotalAmount;
        invoice.MissingInputs = row.MissingInputs;
        invoice.ScheduledFinalDate = row.ScheduledFinalDate;
        invoice.DueDate = row.DueDate;
        invoice.FinalizedAt = row.FinalizedAt;
        invoice.FinalizedByUserId = row.FinalizedByUserId;
        invoice.AutomationPlanId = state?.AutomationPlanId;
        invoice.AutomationFinalizationPlanId = state?.AutomationFinalizationPlanId;
        invoice.RoomNumber = state?.RoomNumber ?? "";
        invoice.LocationName = state?.LocationName ?? "";
        invoice.ScheduleSnapshot = state?.ScheduleSnapshot ?? "";
        invoice.CreatedByUserId = state?.CreatedByUserId ?? Guid.Empty;
        invoice.Recipients = row.RecipientUserIds.Select(id => new InvoiceRecipient
        { InvoiceId = row.Id, TenantUserId = id }).ToList();
        invoice.Lines = lines.Select(ReadLine).ToList();
        return invoice;
    }

    internal static InvoiceLine ReadLine(Native.InvoiceItem row)
    {
        var state = row.CalculationSnapshot.TryGetProperty("compactState", out var data)
            ? data.Deserialize<LineMetadata>(Json) : null;
        return new InvoiceLine
        {
            Id = row.Id, InvoiceId = row.InvoiceId, ChargeCode = row.ChargeCode, Name = row.Description,
            PolicyId = row.BillingPolicyId, MeterReadingId = row.MeterReadingId, Quantity = row.Quantity,
            Rate = row.UnitPrice, Amount = row.Amount, Category = state?.Category ?? default,
            PolicyVersion = state?.PolicyVersion, RateDate = state?.RateDate ?? default,
            OccupiedDays = state?.OccupiedDays ?? 0, PeriodDays = state?.PeriodDays ?? 0,
            CalculatedAmount = state?.CalculatedAmount, CorrectionRequestId = state?.CorrectionRequestId,
            PreviousReading = state?.PreviousReading, ConfirmedReading = state?.ConfirmedReading,
            UtilityCalculationSnapshot = state?.UtilityCalculationSnapshot
        };
    }

    private static JsonElement State(Invoice i) => JsonSerializer.SerializeToElement(new
    {
        i.Id, i.CreatedAt, i.UpdatedAt, i.Type, i.AutomationPlanId, i.AutomationFinalizationPlanId,
        i.RoomId, i.LocationId, i.RoomNumber, i.LocationName, i.BillingPeriod, i.RepresentativeContractId,
        i.RepresentativeTenantUserId, i.Status, i.Version, i.Total, i.MissingInputs, i.ScheduleSnapshot,
        i.ScheduledFinalDate, i.DueDate, i.CreatedByUserId, i.FinalizedByUserId, i.FinalizedAt
    }, Json);

    internal static async Task SaveAsync(Compact24DbContext db, Invoice i, int? expectedVersion,
        bool replaceLines, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Invoice writes require the existing billing transaction.");
        if (expectedVersion is null && i.Status != InvoiceStatus.Draft)
            throw new InvalidOperationException("Create Draft before finalization.");
        if (replaceLines && i.Status != InvoiceStatus.Draft)
            throw new InvalidOperationException("Final invoice items are immutable.");
        var recipients = i.Recipients.Select(r => r.TenantUserId).Distinct().ToArray();
        if (recipients.Length == 0)
            throw new InvalidOperationException("Invoice recipient snapshot is required.");
        i.Stamp(DateTimeOffset.UtcNow, expectedVersion is null);
        var state = State(i);
        var snapshot = JsonSerializer.Serialize(new { schemaVersion = 1, compactState = state }, Json);
        var history = JsonSerializer.Serialize(new
        { schemaVersion = 1, recordType = "Invoice", recordKey = i.Id.ToString(), deleted = false, state }, Json);

        if (expectedVersion is null)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO invoices(id,location_id,room_id,contract_id,representative_tenant_user_id,
                    invoice_type,billing_period,recipient_user_ids,base_total_amount,status,missing_inputs,
                    billing_snapshot,scheduled_final_date,due_date,finalized_at,finalized_by_user_id,version,history)
                VALUES({i.Id},{i.LocationId},{i.RoomId},{i.RepresentativeContractId},{i.RepresentativeTenantUserId},
                    {i.Type},{i.BillingPeriod},{recipients},{i.Total},{(short)i.Status},{i.MissingInputs},
                    CAST({snapshot} AS jsonb),{i.ScheduledFinalDate},{i.DueDate},{i.FinalizedAt},
                    {i.FinalizedByUserId},{i.Version},jsonb_build_array(CAST({history} AS jsonb)))
                """, t);
        }
        else
        {
            var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE invoices SET contract_id={i.RepresentativeContractId},
                    representative_tenant_user_id={i.RepresentativeTenantUserId},recipient_user_ids={recipients},
                    base_total_amount={i.Total},status={(short)i.Status},missing_inputs={i.MissingInputs},
                    billing_snapshot=CAST({snapshot} AS jsonb),scheduled_final_date={i.ScheduledFinalDate},
                    due_date={i.DueDate},finalized_at={i.FinalizedAt},finalized_by_user_id={i.FinalizedByUserId},
                    version={i.Version},history=history||jsonb_build_array(CAST({history} AS jsonb))
                WHERE id={i.Id} AND status=0 AND version={expectedVersion.Value} AND recipient_user_ids <@ {recipients}
                """, t);
            if (affected != 1) throw new DbUpdateConcurrencyException("Invoice changed or no longer exists.");
        }

        if (expectedVersion is not null && replaceLines)
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM invoice_items WHERE invoice_id={i.Id}", t);
        if (expectedVersion is null || replaceLines)
            foreach (var line in i.Lines)
                await InsertLineAsync(db, line, t);
    }

    private static string LineSnapshot(InvoiceLine line)
    {
        return JsonSerializer.Serialize(new
        {
            schemaVersion = 1, compactState = new
            {
                line.Id, line.InvoiceId, line.Category, line.ChargeCode, line.Name, line.PolicyId,
                line.PolicyVersion, line.RateDate, line.Rate, line.Quantity, line.OccupiedDays, line.PeriodDays,
                line.Amount, line.CalculatedAmount, line.CorrectionRequestId, line.MeterReadingId,
                line.PreviousReading, line.ConfirmedReading, line.UtilityCalculationSnapshot
            }
        }, Json);
    }

    private static Task<int> InsertLineAsync(Compact24DbContext db, InvoiceLine line, CancellationToken t)
    {
        var snapshot = LineSnapshot(line);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO invoice_items(id,invoice_id,charge_code,description,billing_policy_id,meter_reading_id,
                quantity,unit_price,amount,calculation_snapshot)
            VALUES({line.Id},{line.InvoiceId},{line.ChargeCode},{line.Name},{line.PolicyId},{line.MeterReadingId},
                {line.Quantity},{line.Rate},{line.Amount},CAST({snapshot} AS jsonb))
            """, t);
    }

    // An approved draft correction retains the original line identity, policy,
    // rate and evidence. The immutable-item trigger still protects final rows.
    internal static async Task CorrectDraftLineAsync(Compact24DbContext db, InvoiceLine line, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Draft correction requires the adjustment transaction.");
        var snapshot = LineSnapshot(line);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE invoice_items SET amount={line.Amount},calculation_snapshot=CAST({snapshot} AS jsonb)
            WHERE id={line.Id} AND invoice_id={line.InvoiceId}
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Draft invoice line changed.");
    }

    internal static Task<int> WriteIssuedAsync(Compact24DbContext db, InvoiceIssuedEvent issued, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Invoice issuance requires the billing transaction.");
        var key = "InvoiceIssuedEvent:" + issued.InvoiceId;
        var id = Compact24DbContext.DeterministicId("InvoiceIssuedEvent/" + issued.InvoiceId);
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, recordType = "InvoiceIssuedEvent", state = issued,
            audienceRole = (string?)null, category = (string?)null, succeeded = (bool?)null,
            sessionId = (Guid?)null, targetUserId = (Guid?)null
        }, Json);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
            VALUES({id},'OUTBOX',{key},'InvoiceIssuedEvent',CAST({data} AS jsonb),{issued.OccurredAt})
            """, t);
    }
}
