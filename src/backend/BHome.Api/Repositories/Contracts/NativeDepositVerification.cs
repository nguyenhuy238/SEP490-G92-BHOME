using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal static class NativeDepositVerification
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record ReceiptState(Guid Id, Guid ContractId, string BankTransactionReference, decimal Amount,
        string VerificationReason, Guid VerifiedByUserId, DateTimeOffset VerifiedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    internal static async Task<DepositVerification?> FindAsync(Compact24DbContext db, string reference, CancellationToken t)
    {
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (h.value->'state')::text AS "Value" FROM payments p
            CROSS JOIN LATERAL jsonb_array_elements(p.history) h(value)
            WHERE h.value->>'recordType'='DepositVerification' AND COALESCE(h.value->>'deleted','false')<>'true'
                AND h.value->'state'->>'bankTransactionReference'={reference}
            """).SingleOrDefaultAsync(t);
        if (json is null) return null;
        var s = JsonSerializer.Deserialize<ReceiptState>(json, Json) ?? throw new InvalidOperationException("Invalid deposit receipt state.");
        return DepositVerification.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt, s.ContractId, s.BankTransactionReference,
            s.Amount, s.VerificationReason, s.VerifiedByUserId, s.VerifiedAt);
    }

    internal static async Task AppendAsync(Compact24DbContext db, DepositVerification value, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Deposit verification requires the ledger transaction.");
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        var reference = value.BankTransactionReference.Trim().ToUpperInvariant();
        if (await PaymentLedgerWrites.ClaimedReferences(db).AnyAsync(r => r == reference, t))
            throw new DbUpdateException("Compact24 persistence rejected a write.", new Npgsql.PostgresException("Bank reference already allocated.", "ERROR", "ERROR", "23514"));
        value.Stamp(DateTimeOffset.UtcNow, true);
        var state = new ReceiptState(value.Id, value.ContractId, value.BankTransactionReference, value.Amount,
            value.VerificationReason, value.VerifiedByUserId, value.VerifiedAt, value.CreatedAt, value.UpdatedAt);
        var envelope = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "DepositVerification",
            recordKey = value.Id.ToString(),
            deleted = false,
            state
        }, Json);
        var claim = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "BankReferenceClaim",
            recordKey = reference,
            state = new { normalizedReference = reference, allocationId = (Guid?)null, depositVerificationId = value.Id }
        }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,
                verification_method,verified_by_user_id,verified_at,verification_data,history)
            VALUES({value.Id},'LEGACY_DEPOSIT','legacy-unscoped',{reference},{"deposit:" + reference},{value.VerifiedAt},{value.Amount},
                'VND','VERIFIED','MANUAL',{value.VerifiedByUserId},{value.VerifiedAt},
                jsonb_build_object('schemaVersion',1,'origin','ContractDepositVerification'),jsonb_build_array(CAST({envelope} AS jsonb)))
            """, t);
        var allocationId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("depositAllocation/" + value.Id)).AsSpan(0, 16));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,
                created_by_user_id,allocated_at,reason)
            VALUES({allocationId},{value.Id},{value.ContractId},{value.Amount},{value.Id},1,{value.VerifiedByUserId},{value.VerifiedAt},{value.VerificationReason})
            """, t);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments SET history=history||jsonb_build_array(CAST({claim} AS jsonb)) WHERE id={value.Id}", t);
    }
}
