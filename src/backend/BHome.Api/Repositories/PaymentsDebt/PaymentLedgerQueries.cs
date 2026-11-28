using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace BHome.Infrastructure.PaymentsDebt;

// Receipt queries explicitly exclude non-receipt payment records. List
// projections retain server-side filtering of history fields.
internal static class PaymentLedgerQueries
{
    internal static IQueryable<PaymentTransfer> ReceiptEntities(BHomePersistenceContext db) =>
        db.Set<PaymentTransfer>().AsNoTracking().Where(p => EF.Functions.JsonExists(p.VerificationData, "compactState"));

    internal static PaymentTransfer HydrateReceipt(PaymentTransfer payment)
    {
        // Physical columns remain authoritative, including nullable provider
        // metadata; only the business extras come from the v1 receipt snapshot.
        var state = payment.VerificationData.GetProperty("compactState");
        JsonElement Field(string name) => state.ValueKind == JsonValueKind.Object &&
            state.TryGetProperty(name, out var value) ? value : default;
        string? Text(string name) => Field(name) is { ValueKind: JsonValueKind.String } value ? value.GetString() : null;
        Guid? Id(string name) => Field(name) is { ValueKind: JsonValueKind.String } value ? value.GetGuid() : null;
        DateTimeOffset Timestamp(string name) => Field(name) is { ValueKind: JsonValueKind.String } value
            ? value.GetDateTimeOffset() : DateTimeOffset.UnixEpoch;
        if (payment.StoredVerifiedAt is null)
            throw new InvalidOperationException("Receipt verification timestamp is missing.");
        payment.NormalizedReference = Text("normalizedReference") ?? "";
        payment.StatementReference = Text("statementReference") ?? "";
        payment.StatementEvidenceObjectKey = Text("statementEvidenceObjectKey");
        payment.StatementEvidenceSha256 = Text("statementEvidenceSha256");
        payment.StatementEvidenceContentType = Text("statementEvidenceContentType");
        payment.StatementEvidenceLength = Field("statementEvidenceLength") is { ValueKind: JsonValueKind.Number } length ? length.GetInt64() : null;
        payment.VerificationReason = Text("verificationReason") ?? "";
        payment.VerificationSource = Text("verificationSource") ?? "";
        payment.ProposedInvoiceId = Id("proposedInvoiceId");
        payment.ProposedDepositContractId = Id("proposedDepositContractId");
        payment.IsDevelopmentDemo = Field("isDevelopmentDemo").ValueKind == JsonValueKind.True;
        payment.CreatedAt = Timestamp("createdAt");
        payment.UpdatedAt = Timestamp("updatedAt");
        return payment;
    }

    internal static IQueryable<PaymentReceiptListRow> ReceiptList(BHomePersistenceContext db) => db.Database.SqlQueryRaw<PaymentReceiptListRow>("""
        SELECT p.id AS "Id",p.provider_code AS "ProviderIdentity",p.transaction_reference AS "BankReference",
          p.amount AS "Amount",p.currency AS "Currency",
          p.received_at AS "OccurredAt",p.remittance_info AS "TransferDescription",
          COALESCE(s.data->>'statementReference','') AS "StatementReference",
          s.data->>'statementEvidenceSha256' AS "StatementEvidenceSha256",
          s.data->>'statementEvidenceContentType' AS "StatementEvidenceContentType",
          (s.data->>'statementEvidenceLength')::bigint AS "StatementEvidenceLength",
          COALESCE(s.data->>'verificationReason','') AS "VerificationReason",
          COALESCE(p.verified_by_user_id,'00000000-0000-0000-0000-000000000000'::uuid) AS "VerifiedByUserId",
          p.verified_at AS "VerifiedAt",(s.data->>'proposedInvoiceId')::uuid AS "ProposedInvoiceId",
          COALESCE((s.data->>'isDevelopmentDemo')::boolean,false) AS "IsDevelopmentDemo"
        FROM payments p CROSS JOIN LATERAL (SELECT p.verification_data->'compactState' AS data) s
        WHERE p.verification_data ? 'compactState'
        """);

    // Only the audit timestamps are stored outside the allocation's physical columns.
    internal static async Task HydrateAllocationAuditAsync(BHomePersistenceContext db,
        IReadOnlyCollection<PaymentAllocation> allocations, CancellationToken token)
    {
        if (allocations.Count == 0) return;
        var ids = allocations.Select(a => a.Id).ToArray();
        var rows = await db.Database.SqlQuery<AllocationAuditRow>($"""
        SELECT a.id AS "Id",
          COALESCE((s.data->>'createdAt')::timestamptz,a.allocated_at) AS "CreatedAt",
          COALESCE((s.data->>'updatedAt')::timestamptz,a.allocated_at) AS "UpdatedAt"
        FROM payment_allocations a LEFT JOIN payments p ON p.id=a.source_payment_id
        LEFT JOIN LATERAL (
          SELECT h->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY e(h,n)
          WHERE h->>'recordType'='PaymentAllocation' AND h->>'recordKey'=a.id::text ORDER BY n DESC LIMIT 1
        ) s ON true
        WHERE a.id=ANY({ids})
        """).ToDictionaryAsync(a => a.Id, token);
        foreach (var allocation in allocations)
        {
            var audit = rows[allocation.Id];
            allocation.CreatedAt = audit.CreatedAt;
            allocation.UpdatedAt = audit.UpdatedAt;
        }
    }

    internal static IQueryable<PaymentReviewRow> Reviews(BHomePersistenceContext db) => db.Database.SqlQueryRaw<PaymentReviewRow>("""
        SELECT COALESCE((s.data->>'id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "Id",
          COALESCE((s.data->>'sequence')::bigint,0) AS "Sequence",
          COALESCE((s.data->>'transferId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "TransferId",
          (s.data->>'invoiceId')::uuid AS "InvoiceId",(s.data->>'depositContractId')::uuid AS "DepositContractId",
          COALESCE(s.data->>'decision','') AS "Decision",COALESCE(s.data->>'reason','') AS "Reason",
          COALESCE((s.data->>'actorId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "ActorId",
          COALESCE((s.data->>'occurredAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "OccurredAt",
          COALESCE((s.data->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt",
          COALESCE((s.data->>'updatedAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "UpdatedAt"
        FROM payments p CROSS JOIN LATERAL (
          SELECT DISTINCT ON (h.value->>'recordKey') h.value->'state' AS data,h.value->>'deleted' AS deleted
          FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
          WHERE h.value->>'recordType'='PaymentReconciliation' ORDER BY h.value->>'recordKey',h.n DESC
        ) s WHERE COALESCE(s.deleted,'false')<>'true'
        """);

    internal static async Task<PaymentCommand?> CommandAsync(BHomePersistenceContext db, Guid actor, Guid key, string operation, CancellationToken token)
    {
        var row = await db.Database.SqlQuery<PaymentCommandRow>($"""
            SELECT COALESCE((task_data->'state'->>'actorId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "ActorId",
              COALESCE((task_data->'state'->>'key')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "Key",
              COALESCE(task_data->'state'->>'operation','') AS "Operation",
              COALESCE(task_data->'state'->>'fingerprint','') AS "Fingerprint",
              COALESCE((task_data->'state'->>'resultId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AS "ResultId",
              COALESCE((task_data->'state'->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt"
            FROM operational_tasks WHERE task_type='COMMAND' AND task_data->>'recordType'='PaymentCommand'
              AND COALESCE(task_data->>'deleted','false')<>'true'
            """).Where(c => c.ActorId == actor && c.Key == key && c.Operation == operation).SingleOrDefaultAsync(token);
        return row is null ? null : new PaymentCommand
        {
            ActorId = row.ActorId,
            Key = row.Key,
            Operation = row.Operation,
            Fingerprint = row.Fingerprint,
            ResultId = row.ResultId,
            CreatedAt = row.CreatedAt
        };
    }
}

internal sealed class PaymentCommandRow
{
    public Guid ActorId { get; set; }
    public Guid Key { get; set; }
    public string Operation { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public Guid ResultId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

internal sealed class PaymentReceiptListRow
{
    public Guid Id { get; set; }
    public string ProviderIdentity { get; set; } = "";
    public string BankReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
    public string TransferDescription { get; set; } = "";
    public string StatementReference { get; set; } = "";
    public string? StatementEvidenceSha256 { get; set; }
    public string? StatementEvidenceContentType { get; set; }
    public long? StatementEvidenceLength { get; set; }
    public string VerificationReason { get; set; } = "";
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
    public Guid? ProposedInvoiceId { get; set; }
    public bool IsDevelopmentDemo { get; set; }
}

internal sealed class AllocationAuditRow
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

internal sealed class PaymentReviewRow
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid TransferId { get; set; }
    public Guid? InvoiceId { get; set; }
    public Guid? DepositContractId { get; set; }
    public string Decision { get; set; } = "";
    public string Reason { get; set; } = "";
    public Guid ActorId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    internal PaymentReconciliation ToValue()
    {
        var r = PaymentReconciliation.RestoreIdentity(Id, CreatedAt, UpdatedAt);
        r.Sequence = Sequence; r.TransferId = TransferId; r.InvoiceId = InvoiceId; r.DepositContractId = DepositContractId;
        r.Decision = Decision; r.Reason = Reason; r.ActorId = ActorId; r.OccurredAt = OccurredAt;
        return r;
    }
}
