using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

// Query DTOs retain the original snapshot defaults and physical-column
// precedence without registering domain classes as persistence projections.
internal static class PaymentLedgerQueries
{
    internal static IQueryable<PaymentReceiptRow> Receipts(BHomePersistenceContext db) => db.Database.SqlQueryRaw<PaymentReceiptRow>("""
        SELECT p.id AS "Id",p.provider_code AS "ProviderIdentity",p.transaction_reference AS "BankReference",
          COALESCE(s.data->>'normalizedReference','') AS "NormalizedReference",p.amount AS "Amount",p.currency AS "Currency",
          p.received_at AS "OccurredAt",p.remittance_info AS "TransferDescription",
          COALESCE(s.data->>'statementReference','') AS "StatementReference",
          s.data->>'statementEvidenceObjectKey' AS "StatementEvidenceObjectKey",
          s.data->>'statementEvidenceSha256' AS "StatementEvidenceSha256",
          s.data->>'statementEvidenceContentType' AS "StatementEvidenceContentType",
          (s.data->>'statementEvidenceLength')::bigint AS "StatementEvidenceLength",
          COALESCE(s.data->>'verificationReason','') AS "VerificationReason",
          COALESCE(s.data->>'verificationSource','') AS "VerificationSource",
          COALESCE(p.verified_by_user_id,'00000000-0000-0000-0000-000000000000'::uuid) AS "VerifiedByUserId",
          p.verified_at AS "VerifiedAt",(s.data->>'proposedInvoiceId')::uuid AS "ProposedInvoiceId",
          (s.data->>'proposedDepositContractId')::uuid AS "ProposedDepositContractId",
          COALESCE((s.data->>'isDevelopmentDemo')::boolean,false) AS "IsDevelopmentDemo",
          COALESCE((s.data->>'createdAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "CreatedAt",
          COALESCE((s.data->>'updatedAt')::timestamptz,'1970-01-01Z'::timestamptz) AS "UpdatedAt"
        FROM payments p CROSS JOIN LATERAL (SELECT p.verification_data->'compactState' AS data) s
        WHERE p.verification_data ? 'compactState'
        """);

    internal static IQueryable<PaymentAllocationRow> AllocationRows(BHomePersistenceContext db) => db.Database.SqlQueryRaw<PaymentAllocationRow>("""
        SELECT a.id AS "Id",a.source_payment_id AS "TransferId",a.source_deposit_contract_id AS "SourceDepositContractId",
          a.target_invoice_id AS "InvoiceId",a.target_deposit_contract_id AS "TargetDepositContractId",
          a.target_initial_contract_id AS "TargetInitialContractId",a.target_settlement_contract_id AS "TargetSettlementContractId",
          a.settlement_receivable_id AS "SettlementReceivableId",a.deposit_offset_approval_id AS "DepositOffsetApprovalId",
          a.amount AS "Amount",a.paid_by_user_id AS "PaidByUserId",a.allocated_at AS "AllocatedAt",
          COALESCE(a.created_by_user_id,'00000000-0000-0000-0000-000000000000'::uuid) AS "VerifiedByUserId",
          COALESCE((s.data->>'createdAt')::timestamptz,a.allocated_at) AS "CreatedAt",
          COALESCE((s.data->>'updatedAt')::timestamptz,a.allocated_at) AS "UpdatedAt"
        FROM payment_allocations a LEFT JOIN payments p ON p.id=a.source_payment_id
        LEFT JOIN LATERAL (
          SELECT h->'state' AS data FROM jsonb_array_elements(p.history) WITH ORDINALITY e(h,n)
          WHERE h->>'recordType'='PaymentAllocation' AND h->>'recordKey'=a.id::text ORDER BY n DESC LIMIT 1
        ) s ON true
        WHERE a.target_invoice_id IS NOT NULL OR a.target_deposit_contract_id IS NOT NULL OR
          a.target_settlement_contract_id IS NOT NULL OR a.target_initial_contract_id IS NOT NULL
        """);

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
        return row is null ? null : new PaymentCommand { ActorId = row.ActorId, Key = row.Key, Operation = row.Operation,
            Fingerprint = row.Fingerprint, ResultId = row.ResultId, CreatedAt = row.CreatedAt };
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

internal sealed class PaymentReceiptRow
{
    public Guid Id { get; set; }
    public string ProviderIdentity { get; set; } = "";
    public string BankReference { get; set; } = "";
    public string NormalizedReference { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
    public string TransferDescription { get; set; } = "";
    public string StatementReference { get; set; } = "";
    public string? StatementEvidenceObjectKey { get; set; }
    public string? StatementEvidenceSha256 { get; set; }
    public string? StatementEvidenceContentType { get; set; }
    public long? StatementEvidenceLength { get; set; }
    public string VerificationReason { get; set; } = "";
    public string VerificationSource { get; set; } = "";
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
    public Guid? ProposedInvoiceId { get; set; }
    public Guid? ProposedDepositContractId { get; set; }
    public bool IsDevelopmentDemo { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    internal PaymentTransfer ToValue()
    {
        var p = PaymentTransfer.RestoreIdentity(Id, CreatedAt, UpdatedAt);
        p.ProviderIdentity = ProviderIdentity; p.BankReference = BankReference; p.NormalizedReference = NormalizedReference;
        p.Amount = Amount; p.Currency = Currency; p.OccurredAt = OccurredAt; p.TransferDescription = TransferDescription;
        p.StatementReference = StatementReference; p.StatementEvidenceObjectKey = StatementEvidenceObjectKey;
        p.StatementEvidenceSha256 = StatementEvidenceSha256; p.StatementEvidenceContentType = StatementEvidenceContentType;
        p.StatementEvidenceLength = StatementEvidenceLength; p.VerificationReason = VerificationReason;
        p.VerificationSource = VerificationSource; p.VerifiedByUserId = VerifiedByUserId; p.VerifiedAt = VerifiedAt;
        p.ProposedInvoiceId = ProposedInvoiceId; p.ProposedDepositContractId = ProposedDepositContractId;
        p.IsDevelopmentDemo = IsDevelopmentDemo;
        return p;
    }
}

internal sealed class PaymentAllocationRow
{
    public Guid Id { get; set; }
    public Guid? TransferId { get; set; }
    public Guid? SourceDepositContractId { get; set; }
    public Guid? InvoiceId { get; set; }
    public Guid? TargetDepositContractId { get; set; }
    public Guid? TargetInitialContractId { get; set; }
    public Guid? TargetSettlementContractId { get; set; }
    public Guid? SettlementReceivableId { get; set; }
    public Guid? DepositOffsetApprovalId { get; set; }
    public decimal Amount { get; set; }
    public Guid? PaidByUserId { get; set; }
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset AllocatedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    internal PaymentAllocation ToValue()
    {
        var a = PaymentAllocation.RestoreIdentity(Id, CreatedAt, UpdatedAt);
        a.TransferId = TransferId; a.SourceDepositContractId = SourceDepositContractId; a.InvoiceId = InvoiceId;
        a.TargetDepositContractId = TargetDepositContractId; a.TargetInitialContractId = TargetInitialContractId;
        a.TargetSettlementContractId = TargetSettlementContractId; a.SettlementReceivableId = SettlementReceivableId;
        a.DepositOffsetApprovalId = DepositOffsetApprovalId; a.Amount = Amount; a.PaidByUserId = PaidByUserId;
        a.VerifiedByUserId = VerifiedByUserId; a.AllocatedAt = AllocatedAt;
        return a;
    }
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
