using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.PaymentsDebt;

// These writes share the caller's existing ledger transaction. Explicit SQL
// keeps immutable JSON and physical rows atomic even when a contract workflow
// has pending tracked changes on the same DbContext.
internal static class PaymentLedgerWrites
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static void RequireTransaction(BHomePersistenceContext db)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Payment ledger writes require the protected operation transaction.");
    }

    private static string Envelope<T>(string kind, string key, T state) =>
        JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = key, deleted = false, state }, Json);

    private static Guid StableId(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));

    internal static async Task AddReceiptAsync(BHomePersistenceContext db, PaymentTransfer value, CancellationToken token)
    {
        RequireTransaction(db);
        value.Stamp(DateTimeOffset.UtcNow, true);
        var state = JsonSerializer.Serialize(value, Json);
        var envelope = Envelope("PaymentTransfer", value.Id.ToString(), value);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,
              amount,currency,remittance_info,status,verification_method,verified_by_user_id,verified_at,verification_data,history)
            VALUES({value.Id},{value.ProviderIdentity},'legacy-unscoped',{value.BankReference},
              {"receipt:" + value.ProviderIdentity + ":" + value.NormalizedReference},{value.OccurredAt},{value.Amount},
              {value.Currency},{value.TransferDescription},'VERIFIED','MANUAL',{value.VerifiedByUserId},{value.VerifiedAt},
              jsonb_build_object('schemaVersion',1,'compactState',CAST({state} AS jsonb)),jsonb_build_array(CAST({envelope} AS jsonb)))
            """, token);
    }

    internal static async Task AddCommandAsync(BHomePersistenceContext db, PaymentCommand command, CancellationToken token)
    {
        RequireTransaction(db);
        var key = $"{command.ActorId}/{command.Key}/{command.Operation}";
        var id = StableId("PaymentCommand/" + key);
        var source = "PaymentCommand:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "PaymentCommand", deleted = false, state = command }, Json);
        var envelope = Envelope("PaymentCommand", key, command);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data,history)
            VALUES({id},'COMMAND',{source},'Pending',CAST({data} AS jsonb),jsonb_build_array(CAST({envelope} AS jsonb)))
            ON CONFLICT(id) DO UPDATE SET task_data=EXCLUDED.task_data,history=operational_tasks.history||EXCLUDED.history
            """, token);
    }

    internal static async Task AppendReviewAsync(BHomePersistenceContext db, PaymentReconciliation review, CancellationToken token)
    {
        RequireTransaction(db);
        review.Stamp(DateTimeOffset.UtcNow, true);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('compact24-sequence:PaymentReconciliation',0))", token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM payments WHERE id={review.TransferId} FOR UPDATE", token);
        if (review.Sequence == 0)
            review.Sequence = await db.Database.SqlQueryRaw<long>("""
                SELECT COALESCE(max((h->'state'->>'sequence')::bigint),0)+1 AS "Value"
                FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
                WHERE h->>'recordType'='PaymentReconciliation'
                """).SingleAsync(token);
        var envelope = Envelope("PaymentReconciliation", review.Id.ToString(), review);
        await AppendHistoryAsync(db, review.TransferId, envelope, token);
    }

    internal static async Task AddConfirmedEventAsync(BHomePersistenceContext db, PaymentConfirmedEvent value, CancellationToken token)
    {
        RequireTransaction(db);
        var key = value.AllocationId.ToString();
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "PaymentConfirmedEvent",
            state = value,
            audienceRole = (string?)null,
            category = (string?)null,
            succeeded = (bool?)null,
            sessionId = (Guid?)null,
            targetUserId = (Guid?)null
        }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
            VALUES({StableId("PaymentConfirmedEvent/" + key)},'OUTBOX',{"PaymentConfirmedEvent:" + key},
              'PaymentConfirmedEvent',CAST({data} AS jsonb),{value.OccurredAt})
            """, token);
    }

    internal static IQueryable<BHome.Domain.PaymentsDebt.PaymentAllocation> Allocations(BHomePersistenceContext db) =>
        db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking().Where(a => a.InvoiceId != null ||
            a.TargetDepositContractId != null || a.TargetSettlementContractId != null || a.TargetInitialContractId != null);

    internal static IQueryable<string> ClaimedReferences(BHomePersistenceContext db) => db.Database.SqlQueryRaw<string>("""
        SELECT COALESCE(s.data->>'normalizedReference','') AS "Value"
        FROM payments p CROSS JOIN LATERAL (
          SELECT DISTINCT ON (h.value->>'recordKey') h.value->'state' AS data,h.value->>'deleted' AS deleted
          FROM jsonb_array_elements(p.history) WITH ORDINALITY h(value,n)
          WHERE h.value->>'recordType'='BankReferenceClaim' ORDER BY h.value->>'recordKey',h.n DESC
        ) s WHERE COALESCE(s.deleted,'false')<>'true'
        """);

    internal static async Task<bool> LockReceiptAsync(BHomePersistenceContext db, Guid id, CancellationToken token) =>
        (await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM payments WHERE id={id} AND verification_data ? 'compactState' FOR UPDATE
            """).ToArrayAsync(token)).Length == 1;

    internal static async Task LockRoomAsync(BHomePersistenceContext db, Guid id, CancellationToken token)
    {
        _ = (await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM rooms WHERE id={id} FOR UPDATE").ToArrayAsync(token)).Single();
    }

    internal static async Task AddAllocationAsync(BHomePersistenceContext db, PaymentAllocation value, CancellationToken token)
    {
        RequireTransaction(db);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", token);
        await ValidateAllocationAsync(db, value, token);
        value.Stamp(DateTimeOffset.UtcNow, true);
        var reason = value.DepositOffsetApprovalId is not null ? "Owner approved source-specific deposit offset" :
            value.SourceDepositContractId is not null ? "Applied verified Holding Deposit to Main Contract" : "Verified bank receipt";
        Guid? verifier = value.VerifiedByUserId == Guid.Empty ? null : value.VerifiedByUserId;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_payment_id,source_deposit_contract_id,target_invoice_id,target_deposit_contract_id,
              target_initial_contract_id,target_settlement_contract_id,settlement_receivable_id,deposit_offset_approval_id,amount,
              operation_key,line_number,paid_by_user_id,created_by_user_id,allocated_at,reason)
            VALUES({value.Id},{value.TransferId},{value.SourceDepositContractId},{value.InvoiceId},{value.TargetDepositContractId},
              {value.TargetInitialContractId},{value.TargetSettlementContractId},{value.SettlementReceivableId},{value.DepositOffsetApprovalId},
              {value.Amount},{value.Id},1,{value.PaidByUserId},{verifier},{value.AllocatedAt},{reason})
            """, token);
        if (value.TransferId is not { } receipt) return;
        await AppendHistoryAsync(db, receipt, Envelope("PaymentAllocation", value.Id.ToString(), value), token);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE payments SET history=history||jsonb_build_array(jsonb_build_object('schemaVersion',1,'recordType','BankReferenceClaim',
              'recordKey',upper(btrim(transaction_reference)), 'state',jsonb_build_object('normalizedReference',upper(btrim(transaction_reference)),
              'allocationId',CAST({value.Id} AS uuid),'depositVerificationId',NULL::uuid))) WHERE id={receipt}
            """, token);
    }

    private static async Task AppendHistoryAsync(BHomePersistenceContext db, Guid receipt, string envelope, CancellationToken token)
    {
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE payments SET history=history||jsonb_build_array(CAST({envelope} AS jsonb)) WHERE id={receipt}
            """, token);
        if (changed != 1) throw new DbUpdateConcurrencyException("Compact24 containing record is unavailable.");
    }

    private static PostgresException Conflict() => new("Compact24 financial invariant violated.", "ERROR", "ERROR", "23514");

    private static async Task ValidateAllocationAsync(BHomePersistenceContext db, PaymentAllocation a, CancellationToken token)
    {
        // Keep the application guards in addition to the physical SQL triggers.
        // Combined initial checkout and approved offsets have specialized DB guards.
        if (a.TargetInitialContractId is not null)
        {
            if (a.TransferId is null || a.SourceDepositContractId is not null || a.InvoiceId is not null ||
                a.TargetDepositContractId is not null || a.TargetSettlementContractId is not null || a.Amount <= 0) throw Conflict();
            return;
        }
        if (a.DepositOffsetApprovalId is not null)
        {
            if (a.TransferId is not null || a.SourceDepositContractId is null || a.TargetDepositContractId is not null || a.Amount <= 0) throw Conflict();
            return;
        }
        var allocations = Allocations(db);
        if (a.TransferId is not { } receipt)
        {
            if (a.TargetSettlementContractId is not null || a.SettlementReceivableId is not null ||
                a.SourceDepositContractId is not { } source || a.TargetDepositContractId is not { } target || a.InvoiceId is not null ||
                a.Amount <= 0 || await allocations.AnyAsync(x => x.SourceDepositContractId == source, token)) throw Conflict();
            var holding = await PaymentObligationQueries.Contracts(db).SingleAsync(c => c.Id == source, token);
            var main = await PaymentObligationQueries.Contracts(db).SingleOrDefaultAsync(c => c.Id == target, token);
            var received = await allocations.Where(x => x.TargetDepositContractId == source).SumAsync(x => (decimal?)x.Amount, token) ?? 0m;
            if (holding.Kind != BHome.Domain.TenantContracts.ContractKind.Holding || holding.Status != ContractStatus.Active || main is null || main.Kind != BHome.Domain.TenantContracts.ContractKind.Main ||
                main.HoldingContractId != source || main.RoomId != holding.RoomId || main.TenantUserId != holding.TenantUserId ||
                a.Amount != Math.Min(received, main.RequiredDeposit)) throw Conflict();
            return;
        }
        if (a.SourceDepositContractId is not null ||
            (a.TargetDepositContractId is null ? 0 : 1) + (a.InvoiceId is null ? 0 : 1) + (a.TargetSettlementContractId is null ? 0 : 1) != 1 ||
            await allocations.AnyAsync(x => x.TransferId == receipt, token)) throw Conflict();
        var transfer = await PaymentLedgerQueries.ReceiptEntities(db).Where(p => p.Id == receipt)
            .Select(p => new { p.Amount, Reference = p.VerificationData.GetProperty("compactState").GetProperty("normalizedReference").GetString() ?? "" })
            .SingleAsync(token);
        var claimed = ClaimedReferences(db);
        if (a.TargetSettlementContractId is { } settlementContract)
        {
            var charges = await SettlementChargeRecords.ReadAsync<BHome.Application.Contracts.SettlementReceivable>(
                db, settlementContract, SettlementChargeRecords.ChargeKind, token);
            var charge = charges.SingleOrDefault(c => c.Id == a.SettlementReceivableId);
            var settled = await allocations.Where(x => x.TargetSettlementContractId == settlementContract &&
                x.SettlementReceivableId == a.SettlementReceivableId).SumAsync(x => (decimal?)x.Amount, token) ?? 0m;
            if (charge is null || a.Amount <= 0 || a.Amount != Math.Min(transfer.Amount, charge.Amount - settled) ||
                a.PaidByUserId is { } payer && !charge.RecipientUserIds.Contains(payer) ||
                await claimed.AnyAsync(c => c == transfer.Reference, token)) throw Conflict();
            return;
        }
        if (a.TargetDepositContractId is { } depositContractId)
        {
            // Holding signature verification still uses the contract rule model.
            // Do not replace that evidence rule with a weaker physical status check.
            var contract = await NativeContractSnapshot.LoadAsync((Compact24DbContext)db, depositContractId, token)
                ?? throw Conflict();
            var paid = await allocations.Where(x => x.TargetDepositContractId == depositContractId).SumAsync(x => (decimal?)x.Amount, token) ?? 0m;
            if (contract.Kind is not (ContractKind.Main or ContractKind.Holding) || contract.PreviousContractId is not null ||
                contract.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active) ||
                contract.Kind == ContractKind.Holding &&
                ((contract.ApprovedAt is null && !BHome.Application.Contracts.AnonymousContractSigningService.HoldingOwnerHasSigned(contract)) ||
                contract.HoldingExpiryAt is null || contract.HoldingExpiryAt <= a.AllocatedAt) || a.Amount <= 0 ||
                a.Amount != Math.Min(transfer.Amount, contract.RequiredDeposit - paid) ||
                await claimed.AnyAsync(c => c == transfer.Reference, token)) throw Conflict();
            return;
        }
        var invoice = await db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().SingleAsync(i => i.Id == a.InvoiceId, token);
        var financial = await db.Financials(db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Id == invoice.Id)).SingleAsync(token);
        if (invoice.Status != InvoiceStatus.Final || a.Amount <= 0 ||
            a.Amount != Math.Min(transfer.Amount, financial.Original + financial.Adjustments - financial.Paid) ||
            await claimed.AnyAsync(c => c == transfer.Reference, token)) throw Conflict();
    }
}
