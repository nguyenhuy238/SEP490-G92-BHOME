using System.Text.Json;
using BHome.Application.PaymentsDebt;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal static class ExternalPaymentPayerRecords
{
    internal const string Kind = "ExternalPaymentPayerV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static async Task<ExternalPaymentPayer?> ReadAsync(BHomePersistenceContext db, Guid transferId, CancellationToken token)
    {
        var value = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE p.id={transferId} AND h->>'recordType'={Kind}
            """).SingleOrDefaultAsync(token);
        return value is null ? null : JsonSerializer.Deserialize<ExternalPaymentPayer>(value, Json) ?? throw new PaymentException(409, "external_payer_history_invalid");
    }
}
internal sealed class ExternalPaymentPayerRepository(BHomePersistenceContext db, IPaymentRepository payments) : IExternalPaymentPayerRepository
{
    public Task<ExternalPaymentPayer?> GetAsync(Guid transferId, CancellationToken token) => ExternalPaymentPayerRecords.ReadAsync(db, transferId, token);
    public async Task<ExternalPaymentPayer?> OperationAsync(Guid actor, Guid key, CancellationToken token)
    {
        var value = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE h->>'recordType'={ExternalPaymentPayerRecords.Kind} AND h->'state'->>'operationKey'={key.ToString()}
              AND h->'state'->>'verifiedByUserId'={actor.ToString()}
            """).SingleOrDefaultAsync(token);
        return value is null ? null : JsonSerializer.Deserialize<ExternalPaymentPayer>(value, ExternalPaymentPayerRecords.Json);
    }
    public async Task<ExternalPaymentPayerContext> ContextAsync(Guid transferId, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new PaymentException(503, "external_payer_unavailable");
        var transfer = await payments.TransferAsync(transferId, token) ?? throw new PaymentException(404, "bank_transfer_not_found");
        var existing = await GetAsync(transferId, token); var fingerprint = ReceiptExcessRules.TransferFingerprint(transfer); var problems = new List<string>();
        if (existing is not null && existing.TransferFingerprint != fingerprint) throw new PaymentException(409, "external_payer_history_invalid");
        if (!await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM payments WHERE id={transferId} AND status='VERIFIED') AS \"Value\"").SingleAsync(token)) problems.Add("verified_bank_receipt_required");
        if ((await payments.AllocationAsync(transferId, token))?.PaidByUserId is not null) problems.Add("receipt_payer_already_linked");
        if ((await payments.LatestReviewAsync(transferId, token))?.Decision == "Rejected") problems.Add("bank_transfer_rejected");
        if (await ReceiptExcessRecords.ReadAsync(db, transferId, token) is not null) problems.Add("receipt_excess_already_confirmed");
        if (await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM refund_requests WHERE source_payment_id={transferId} AND status IN ('REQUESTED','APPROVED','COMPLETED')) AS \"Value\"").SingleAsync(token)) problems.Add("refund_source_requires_manual_review");
        return new(transferId, fingerprint, transfer.StatementReference, problems.ToArray(), existing, transfer.IsDevelopmentDemo);
    }
    public async Task SaveAsync(ExternalPaymentPayer payer, CancellationToken token)
    {
        var json = JsonSerializer.Serialize(new { recordType = ExternalPaymentPayerRecords.Kind, schemaVersion = 1, recordKey = payer.Id, state = payer }, ExternalPaymentPayerRecords.Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments SET history=history||jsonb_build_array({json}::jsonb) WHERE id={payer.TransferId}", token);
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = payer.VerifiedByUserId, Event = "ExternalPaymentPayerConfirmed", TargetType = "PaymentTransfer", TargetId = payer.TransferId, Succeeded = true, OccurredAt = payer.VerifiedAt });
        await db.SaveChangesAsync(token);
    }
}
