using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed partial class PaymentRepository(BHomePersistenceContext db) : IPaymentRepository
{
    public Task<bool> ProviderReferenceReceivedAsync(string reference, CancellationToken token) => db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext
        ? Task.FromResult(false) : db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM payments WHERE provider_code IN ('SEPAY:TEST','SEPAY:LIVE') AND verification_method='AUTO'
              AND upper(btrim(verification_data->'sepay'->>'bankReference'))={reference}) AS "Value"
            """).SingleAsync(token);
    public Task<bool> ManualReferenceReceivedAsync(string reference, CancellationToken token) => db is not BHome.Infrastructure.Persistence.Compact24.Compact24DbContext
        ? Task.FromResult(false) : db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM payments WHERE provider_code NOT IN ('SEPAY:TEST','SEPAY:LIVE')
              AND upper(btrim(transaction_reference))={reference}) AS "Value"
            """).SingleAsync(token);
    public Task<bool> ExternalPayerRecordedAsync(Guid transferId, CancellationToken token) => db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext
        ? db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h WHERE p.id={transferId} AND h->>'recordType'={ExternalPaymentPayerRecords.Kind}) AS \"Value\"").SingleAsync(token)
        : Task.FromResult(false);
    // Offline legacy import regression retains its historical exact-payment constraints.
    // Production composition always supplies Compact24; no schema detection or fallback.
    public bool AmountMismatchSupported => db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext;
    public async Task<T> TransactionAsync<T>(Guid? transferId, Guid? invoiceId, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        // Short manual reconciliation transactions. One lock order also protects references across rooms.
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
        if (transferId is { } transfer)
            if (!(db is Compact24DbContext ? await PaymentLedgerWrites.LockReceiptAsync(db, transfer, t) : await db.Locked<PaymentTransfer>(transfer).AnyAsync(t)))
                throw new PaymentException(404, "bank_transfer_not_found");
        if (invoiceId is { } invoice)
        {
            var roomId = (db is Compact24DbContext
                ? await db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Id == invoice).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t)
                : await db.Set<Invoice>().Where(i => i.Id == invoice).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t))
                ?? throw new PaymentException(404, "payment_invoice_not_found");
            if (db is Compact24DbContext) await PaymentLedgerWrites.LockRoomAsync(db, roomId, t);
            else await db.Locked<BHome.Domain.PropertyManagement.Room>(roomId).SingleAsync(t);
        }
        try
        {
            var result = await work(); await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: "23505" or "23514" })
        { throw new PaymentException(409, "payment_concurrent_or_duplicate_effect", error); }
        catch (PostgresException error) when (error.SqlState is "23505" or "23514" or "40001" or "40P01")
        { throw new PaymentException(409, "payment_concurrent_or_duplicate_effect"); }
    }
    public async Task<T> DepositTransactionAsync<T>(Guid transferId, Guid contractId, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        if (!(db is Compact24DbContext ? await PaymentLedgerWrites.LockReceiptAsync(db, transferId, t) : await db.Locked<PaymentTransfer>(transferId).AnyAsync(t))) throw new PaymentException(404, "bank_transfer_not_found");
        var room = (db is Compact24DbContext
            ? await (from c in PaymentObligationQueries.Contracts(db)
                     join r in db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking() on c.RoomId equals r.Id
                     where c.Id == contractId
                     select new { c.RoomId, r.LocationId }).SingleOrDefaultAsync(t)
            : await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.Id == contractId)
                .Select(c => new { c.RoomId, c.Room.LocationId }).SingleOrDefaultAsync(t))
            ?? throw new PaymentException(404, "holding_contract_not_found");
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({room.LocationId.ToString()},0))", t);
        if (db is Compact24DbContext) await PaymentLedgerWrites.LockRoomAsync(db, room.RoomId, t);
        else await db.Locked<BHome.Domain.PropertyManagement.Room>(room.RoomId).SingleAsync(t);
        try
        {
            var result = await work(); await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: "23505" or "23514" })
        { throw new PaymentException(409, "payment_concurrent_or_duplicate_effect"); }
        catch (PostgresException error) when (error.SqlState is "23505" or "23514" or "40001" or "40P01")
        { throw new PaymentException(409, "payment_concurrent_or_duplicate_effect"); }
    }
    public Task<Invoice?> InvoiceAsync(Guid id, PaymentScope scope, CancellationToken t) => db is Compact24DbContext
        ? scope.Owner || scope.Tenant ? PaymentObligationQueries.InvoiceAsync(db, id, scope.Owner ? null : scope.ActorId, t) : Task.FromResult<Invoice?>(null)
        : db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == id &&
            (scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.ActorId)), t);
    public async Task<PaymentTransfer?> TransferAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext)
            return await db.Set<PaymentTransfer>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, t);
        var payment = await PaymentLedgerQueries.ReceiptEntities(db).SingleOrDefaultAsync(x => x.Id == id, t);
        return payment is null ? null : PaymentLedgerQueries.HydrateReceipt(payment);
    }
    public async Task<PaymentTransfer?> TransferReferenceAsync(string provider, string reference, CancellationToken t)
    {
        if (db is not Compact24DbContext)
            return await db.Set<PaymentTransfer>().AsNoTracking().SingleOrDefaultAsync(x => x.ProviderIdentity == provider && x.NormalizedReference == reference, t);
        var payment = await PaymentLedgerQueries.ReceiptEntities(db).SingleOrDefaultAsync(x => x.ProviderIdentity == provider &&
            (x.VerificationData.GetProperty("compactState").GetProperty("normalizedReference").GetString() ?? "") == reference, t);
        return payment is null ? null : PaymentLedgerQueries.HydrateReceipt(payment);
    }
    public async Task<PaymentAllocation?> AllocationAsync(Guid id, CancellationToken t)
    {
        if (db is not Compact24DbContext)
            return await db.Set<PaymentAllocation>().AsNoTracking().SingleOrDefaultAsync(a => a.TransferId == id, t);
        var allocation = await PaymentLedgerWrites.Allocations(db).SingleOrDefaultAsync(a => a.TransferId == id, t);
        if (allocation is not null) await PaymentLedgerQueries.HydrateAllocationAuditAsync(db, [allocation], t);
        return allocation;
    }
    public async Task<PaymentReconciliation?> LatestReviewAsync(Guid id, CancellationToken t) => db is Compact24DbContext
        ? (await PaymentLedgerQueries.Reviews(db).Where(r => r.TransferId == id).OrderByDescending(r => r.Sequence).FirstOrDefaultAsync(t))?.ToValue()
        : await db.Set<PaymentReconciliation>().AsNoTracking().Where(r => r.TransferId == id).OrderByDescending(r => r.Sequence).FirstOrDefaultAsync(t);
    public async Task<IReadOnlyList<PaymentLedgerEntry>> HistoryAsync(Guid invoiceId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var native = await (from allocation in PaymentLedgerWrites.Allocations(db)
                                join transfer in PaymentLedgerQueries.ReceiptEntities(db) on allocation.TransferId equals transfer.Id
                                where allocation.InvoiceId == invoiceId
                                orderby allocation.AllocatedAt descending, allocation.Id
                                select new { allocation, transfer }).ToArrayAsync(t);
            var verified = await ExternalReceiptIdsAsync(native.Select(r => r.transfer.Id).Distinct().ToArray(), t);
            await PaymentLedgerQueries.HydrateAllocationAuditAsync(db, native.Select(r => r.allocation).ToArray(), t);
            return native.Select(r => new PaymentLedgerEntry(r.allocation, PaymentLedgerQueries.HydrateReceipt(r.transfer), verified.Contains(r.transfer.Id))).ToArray();
        }
        var rows = await
        (from allocation in db.Set<PaymentAllocation>().AsNoTracking()
         join transfer in db.Set<PaymentTransfer>() on allocation.TransferId equals transfer.Id
         where allocation.InvoiceId == invoiceId
         orderby allocation.AllocatedAt descending, allocation.Id
         select new PaymentLedgerEntry(allocation, transfer, false)).ToArrayAsync(t);
        var external = await ExternalReceiptIdsAsync(rows.Select(r => r.Transfer.Id).Distinct().ToArray(), t);
        return rows.Select(row => row with { ExternalPayerVerified = external.Contains(row.Transfer.Id) }).ToArray();
    }
    private async Task<HashSet<Guid>> ExternalReceiptIdsAsync(Guid[] ids, CancellationToken token)
    {
        if (!AmountMismatchSupported || ids.Length == 0) return [];
        return (await db.Database.SqlQuery<Guid>($"""
            SELECT p.id AS "Value" FROM payments p WHERE p.id=ANY({ids}) AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
              WHERE h->>'recordType'={ExternalPaymentPayerRecords.Kind})
            """).ToArrayAsync(token)).ToHashSet();
    }
    public async Task<decimal> AllocatedAsync(Guid invoiceId, CancellationToken t) => (db is Compact24DbContext ? await PaymentLedgerWrites.Allocations(db).Where(a => a.InvoiceId == invoiceId).SumAsync(a => (decimal?)a.Amount, t)
        : await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == invoiceId).SumAsync(a => (decimal?)a.Amount, t)) ?? 0m;
    public async Task<decimal> DepositAllocatedAsync(Guid contractId, CancellationToken t) => (db is Compact24DbContext ? await PaymentLedgerWrites.Allocations(db).Where(a => a.TargetDepositContractId == contractId).SumAsync(a => (decimal?)a.Amount, t)
        : await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == contractId).SumAsync(a => (decimal?)a.Amount, t)) ?? 0m;
    public Task<BHome.Domain.TenantContracts.Contract?> HoldingAsync(Guid contractId, CancellationToken t) => db is Compact24DbContext compact
        ? NativeContractSnapshot.LoadAsync(compact, contractId, t)
        : db.Set<BHome.Domain.TenantContracts.Contract>()
        .Include(c => c.Room).ThenInclude(r => r.Location).Include(c => c.Room).ThenInclude(r => r.RoomType)
        .Include(c => c.Residents).Include(c => c.Signatures).AsSplitQuery().SingleOrDefaultAsync(c => c.Id == contractId, t);
    public Task<BHome.Application.Billing.InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t) => db.FinancialsAsync(invoiceId, t);
    public Task<bool> ReferenceClaimedAsync(string reference, CancellationToken t) => db is Compact24DbContext
        ? PaymentLedgerWrites.ClaimedReferences(db).AnyAsync(c => c == reference, t)
        : db.Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == reference, t);
    public Task<bool> EligiblePayerAsync(Guid invoiceId, Guid payerId, CancellationToken t) => db is Compact24DbContext
        ? db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().AnyAsync(i => i.Id == invoiceId && i.RecipientUserIds.Contains(payerId), t)
        : db.Set<InvoiceRecipient>().AnyAsync(r => r.InvoiceId == invoiceId && r.TenantUserId == payerId, t);
    public async Task<bool> PendingReviewAsync(Guid invoiceId, CancellationToken t)
    {
        if (await ReceiptExcessRecords.PendingAsync(db, invoiceId, null, t)) return true;
        if (AmountMismatchSupported)
            return await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
                  WHERE a.target_invoice_id={invoiceId} AND (p.status<>'VERIFIED' OR
                    p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id) <>
                    (SELECT COALESCE(sum(r.requested_amount),0) FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED')
                    OR EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED'
                      AND NOT bhome24_external_refund_valid(r.id) AND NOT EXISTS(SELECT 1 FROM residents person,
                        LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
                          WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1) latest
                        WHERE person.id=r.beneficiary_resident_id AND person.user_id=a.paid_by_user_id
                          AND r.source_deposit_contract_id IS NULL AND r.executed_at IS NOT NULL
                          AND latest.state->>'classification'='ExcessReceiptRefundV1'
                          AND latest.state->'upload'->>'objectKey'=r.execution_evidence_key
                          AND latest.state->'upload'->>'externalReference'=r.external_refund_reference
                          AND latest.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}
                          AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(latest.state->'events')='array'
                            THEN latest.state->'events' ELSE '[]'::jsonb END) e WHERE e->>'action'='Completed')))))
                  OR EXISTS(SELECT 1 FROM (
                    SELECT p.id,(SELECT h->'state' FROM jsonb_array_elements(p.history) WITH ORDINALITY e(h,n)
                      WHERE h->>'recordType'='PaymentReconciliation' ORDER BY n DESC LIMIT 1) state
                    FROM payments p WHERE NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id)) latest
                    WHERE latest.state->>'invoiceId'={invoiceId.ToString()} AND latest.state->>'decision'='PendingReview') AS "Value"
                """).SingleAsync(t);
        return await db.Set<PaymentReconciliation>().AnyAsync(r => r.InvoiceId == invoiceId &&
        !db.Set<PaymentReconciliation>().Any(newer => newer.TransferId == r.TransferId && newer.Sequence > r.Sequence) &&
        (r.Decision == "PendingReview" && !db.Set<PaymentAllocation>().Any(a => a.TransferId == r.TransferId) ||
         r.Decision == "Allocated" && r.Reason == "verified_excess_payment_pending_review"), t);
    }
    public Task<PaymentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) => db is Compact24DbContext
        ? PaymentLedgerQueries.CommandAsync(db, actor, key, operation, t)
        : db.Set<PaymentCommand>().AsNoTracking().SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key && c.Operation == operation, t);
    public async Task<Guid?> ReceivingOwnerAsync(Guid locationId, CancellationToken t)
    {
        if (db is Compact24DbContext) return await PaymentObligationQueries.ReceivingOwnerAsync(db, locationId, t);
        if (locationId == Guid.Empty || !await db.Locations.AnyAsync(l => l.Id == locationId, t)) return null;
        var owners = await db.Set<Contract>().AsNoTracking().Where(c => c.Room.LocationId == locationId)
            .Select(c => c.OwnerSignerId).Distinct().Take(2).ToArrayAsync(t);
        return owners.Length == 1 ? owners[0] : null;
    }
    public async Task<string?> OwnerPaymentModeAsync(Guid ownerId, CancellationToken t)
    {
        if (db is not Compact24DbContext) return null;
        return await db.Database.SqlQuery<string>($"""
            SELECT business_profile->>'sepayPaymentMode' AS "Value" FROM users WHERE id={ownerId} AND 'Owner'=ANY(roles)
            """).SingleOrDefaultAsync(t);
    }
    public async Task SetOwnerPaymentModeAsync(Guid ownerId, string mode, string? expectedMode, CancellationToken t)
    {
        if (mode is not ("Test" or "Live")) throw new PaymentException(400, "invalid_payment_mode");
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE users SET business_profile=jsonb_set(COALESCE(business_profile,jsonb_build_object()),
                ARRAY['sepayPaymentMode'],to_jsonb(CAST({mode} AS text)),true)
            WHERE id={ownerId} AND 'Owner'=ANY(roles) AND business_profile->>'sepayPaymentMode' IS NOT DISTINCT FROM {expectedMode}
            """, t);
        if (changed != 1) throw new PaymentException(409, "payment_mode_changed");
    }
    public async Task<ReceivingBankAccount?> OwnerReceivingAccountAsync(Guid ownerId, CancellationToken t) =>
        await ReadOwnerAccount(ownerId, await OwnerPaymentModeAsync(ownerId, t), t);
    public Task<ReceivingBankAccount?> OwnerReceivingAccountForModeAsync(Guid ownerId, string mode, CancellationToken t) => ReadOwnerAccount(ownerId, mode, t);
    private async Task<ReceivingBankAccount?> ReadOwnerAccount(Guid ownerId, string? mode, CancellationToken t)
    {
        if (db is not Compact24DbContext || ownerId == Guid.Empty) return null;
        var json = await db.Database.SqlQuery<string>($"""
            SELECT COALESCE((SELECT a.value FROM jsonb_array_elements(COALESCE(u.business_profile->'receivingBankAccounts','[]'::jsonb))
                WITH ORDINALITY a(value,pos) WHERE CAST({mode} AS text) IS NULL OR
                COALESCE((a.value->>'isDevelopmentDemo')::bool,false)=({mode}='Test') ORDER BY a.pos DESC LIMIT 1),'null'::jsonb)::text AS "Value"
            FROM users u WHERE id={ownerId} AND 'Owner'=ANY(roles)
            """).SingleOrDefaultAsync(t);
        if (json is null) return null;
        var account = JsonSerializer.Deserialize<ReceivingBankAccount>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return account?.OwnerUserId == ownerId && account.LocationId == Guid.Empty ? account : null;
    }
    public async Task<ReceivingBankAccount?> ReceivingAccountForModeAsync(Guid locationId, string mode, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var owner = await ReceivingOwnerAsync(locationId, t);
            if (owner is null) return null;
            if (await OwnerReceivingAccountForModeAsync(owner.Value, mode, t) is { } shared) return shared;
            return await PaymentObligationQueries.LocationAccountAsync(db, locationId, mode, t);
        }
        return await db.Set<ReceivingBankAccount>().AsNoTracking().Where(a => a.LocationId == locationId && a.IsDevelopmentDemo == (mode == "Test"))
            .OrderByDescending(a => a.Version).FirstOrDefaultAsync(t);
    }
    public async Task SaveOwnerReceivingAccountAsync(Guid ownerId, ReceivingBankAccount account, int expectedVersion, CancellationToken t)
    {
        if (db is not Compact24DbContext || account.OwnerUserId != ownerId || account.LocationId != Guid.Empty)
            throw new PaymentException(503, "owner_receiving_account_unavailable");
        var payload = JsonSerializer.Serialize(account, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE users SET business_profile=jsonb_set(
                COALESCE(business_profile, jsonb_build_object()), ARRAY['receivingBankAccounts'],
                COALESCE(business_profile->'receivingBankAccounts', '[]'::jsonb) ||
                    jsonb_build_array(CAST({payload} AS jsonb)), true)
            WHERE id={ownerId} AND 'Owner'=ANY(roles)
              AND COALESCE((SELECT (a.value->>'version')::int FROM jsonb_array_elements(COALESCE(business_profile->'receivingBankAccounts','[]'::jsonb))
                WITH ORDINALITY a(value,pos) WHERE COALESCE((a.value->>'isDevelopmentDemo')::bool,false)={account.IsDevelopmentDemo}
                ORDER BY a.pos DESC LIMIT 1),0)={expectedVersion}
            """, t);
        if (changed != 1) throw new PaymentException(409, "receiving_account_version_changed");
    }
    public async Task<ReceivingBankAccount?> ReceivingAccountAsync(Guid locationId, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var owner = await ReceivingOwnerAsync(locationId, t);
            if (owner is null) return null;
            if (await OwnerReceivingAccountAsync(owner.Value, t) is { } shared) return shared;
            return await PaymentObligationQueries.LocationAccountAsync(db, locationId, null, t);
        }
        var legacy = await db.Set<ReceivingBankAccount>().AsNoTracking()
            .Where(a => a.LocationId == locationId).OrderByDescending(a => a.Version).FirstOrDefaultAsync(t);
        return legacy;
    }
    public Task<bool> ActiveLocationAsync(Guid locationId, CancellationToken t) => db is Compact24DbContext
        ? db.Set<BHome.Domain.Locations.Location>().AsNoTracking().AnyAsync(l => l.Id == locationId && l.IsActive, t)
        : db.Locations.AnyAsync(l => l.Id == locationId && l.IsActive, t);
    public async Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid invoiceId, CancellationToken t) => db is Compact24DbContext
        ? await db.Database.SqlQuery<PayerChoice>($"""
            SELECT r.user_id AS "UserId",COALESCE((SELECT p.display_label FROM residents p
              WHERE p.user_id=r.user_id AND p.current_room_id=i.room_id ORDER BY p.id LIMIT 1),'Kh?ch thu? ?? li?n k?t') AS "DisplayLabel"
            FROM invoices i CROSS JOIN LATERAL unnest(i.recipient_user_ids) r(user_id)
            WHERE i.id={invoiceId} ORDER BY r.user_id
            """).ToArrayAsync(t)
        : await db.Set<InvoiceRecipient>().AsNoTracking().Where(r => r.InvoiceId == invoiceId)
        .OrderBy(r => r.TenantUserId).Select(r => new PayerChoice(r.TenantUserId,
            db.Set<BHome.Domain.TenantContracts.Resident>().Where(person => person.TenantUserId == r.TenantUserId &&
                db.Set<Invoice>().Any(i => i.Id == invoiceId && i.RoomId == person.RoomId)).OrderBy(person => person.Id).Select(person => person.DisplayLabel).FirstOrDefault() ?? "Khách thuê đã liên kết")).ToArrayAsync(t);
    public async Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t)
    {
        if (db is Compact24DbContext) return await NativeTransfersAsync(query, t);
        var source = db.Set<PaymentTransfer>().AsNoTracking().Where(x =>
            (query.LocationId == null && query.RoomId == null && query.BillingPeriod == null) || db.Set<Invoice>().Any(i => i.Id ==
                (db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => (Guid?)a.InvoiceId).FirstOrDefault() ??
                 db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.InvoiceId).FirstOrDefault() ?? x.ProposedInvoiceId) &&
                (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) && (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod)));
        if (query.DepositContractId is { } deposit)
        {
            var excess = AmountMismatchSupported ? db.Database.SqlQuery<Guid>($"""
                SELECT p.id AS "Value" FROM payments p WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
                  WHERE h->>'recordType'={ReceiptExcessRecords.Kind} AND (h->'state'->'target'->>'depositContractId'={deposit.ToString()}
                    OR h->'state'->'target'->>'holdingContractId'={deposit.ToString()}))
                """) : Enumerable.Empty<Guid>().AsQueryable();
            source = AmountMismatchSupported
                ? source.Where(p => db.Set<PaymentAllocation>().Any(a => a.TransferId == p.Id && a.TargetDepositContractId == deposit) || excess.Contains(p.Id))
                : source.Where(p => db.Set<PaymentAllocation>().Any(a => a.TransferId == p.Id && a.TargetDepositContractId == deposit));
        }
        if (query.SettlementContractId is { } settlement)
        {
            var excess = AmountMismatchSupported ? db.Database.SqlQuery<Guid>($"""
                SELECT p.id AS "Value" FROM payments p WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
                  WHERE h->>'recordType'={ReceiptExcessRecords.Kind} AND h->'state'->'target'->>'settlementContractId'={settlement.ToString()})
                """) : Enumerable.Empty<Guid>().AsQueryable();
            source = AmountMismatchSupported
                ? source.Where(p => db.Set<PaymentAllocation>().Any(a => a.TransferId == p.Id && a.TargetSettlementContractId == settlement) || excess.Contains(p.Id))
                : source.Where(p => db.Set<PaymentAllocation>().Any(a => a.TransferId == p.Id && a.TargetSettlementContractId == settlement));
        }
        if (!string.IsNullOrWhiteSpace(query.PaymentStatus))
            source = query.PaymentStatus switch
            {
                "Allocated" => source.Where(x => db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id)),
                "PendingReview" => source.Where(x => !db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) &&
                    (db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == null ||
                     db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == "PendingReview")),
                "Rejected" => source.Where(x => !db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) &&
                    db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == "Rejected"),
                "ExcessRefundPending" or "ExcessRefundCompleted" => source.Where(x => !db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) &&
                    db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == query.PaymentStatus),
                _ => source.Where(_ => false)
            };
        var views = source.OrderByDescending(x => x.VerifiedAt).ThenBy(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(x => new TransferView(x.Id, x.ProviderIdentity, x.BankReference, x.Amount, x.Currency, x.OccurredAt, x.TransferDescription,
                x.StatementReference, x.VerificationReason, x.VerifiedByUserId, x.VerifiedAt, x.ProposedInvoiceId,
                db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) ? "Allocated" : db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Decision).FirstOrDefault() ?? "PendingReview",
                db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Reason).FirstOrDefault() ?? (db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) ? "verified_full_payment" : "owner_allocation_confirmation_required"),
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => a.InvoiceId).FirstOrDefault(), x.IsDevelopmentDemo,
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Sum(a => (decimal?)a.Amount) ?? 0,
                x.Amount - (db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Sum(a => (decimal?)a.Amount) ?? 0),
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => a.TargetDepositContractId).FirstOrDefault(),
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => a.TargetSettlementContractId).FirstOrDefault(),
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => a.SettlementReceivableId).FirstOrDefault(),
                x.StatementEvidenceSha256 != null && x.StatementEvidenceContentType != null && x.StatementEvidenceLength != null
                    ? new BankStatementEvidenceView(x.StatementEvidenceContentType, x.StatementEvidenceLength.Value, x.StatementEvidenceSha256) : null));
        return new(await views.ToArrayAsync(t),
            query.Page, query.PageSize, await source.CountAsync(t));
    }
    private async Task<PagedResult<TransferView>> NativeTransfersAsync(PaymentQuery query, CancellationToken t)
    {
        var allocations = PaymentLedgerWrites.Allocations(db);
        var reviews = PaymentLedgerQueries.Reviews(db);
        var source = PaymentLedgerQueries.ReceiptList(db).Where(x =>
            (query.LocationId == null && query.RoomId == null && query.BillingPeriod == null) || db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Any(i => i.Id ==
                (allocations.Where(a => a.TransferId == x.Id).Select(a => (Guid?)a.InvoiceId).FirstOrDefault() ??
                 reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.InvoiceId).FirstOrDefault() ?? x.ProposedInvoiceId) &&
                (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) && (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod)));
        if (query.DepositContractId is { } deposit)
        {
            var excess = db.Database.SqlQuery<Guid>($"""
                SELECT p.id AS "Value" FROM payments p WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
                  WHERE h->>'recordType'={ReceiptExcessRecords.Kind} AND (h->'state'->'target'->>'depositContractId'={deposit.ToString()}
                    OR h->'state'->'target'->>'holdingContractId'={deposit.ToString()}))
                """);
            source = source.Where(p => allocations.Any(a => a.TransferId == p.Id && a.TargetDepositContractId == deposit) || excess.Contains(p.Id));
        }
        if (query.SettlementContractId is { } settlement)
        {
            var excess = db.Database.SqlQuery<Guid>($"""
                SELECT p.id AS "Value" FROM payments p WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h
                  WHERE h->>'recordType'={ReceiptExcessRecords.Kind} AND h->'state'->'target'->>'settlementContractId'={settlement.ToString()})
                """);
            source = source.Where(p => allocations.Any(a => a.TransferId == p.Id && a.TargetSettlementContractId == settlement) || excess.Contains(p.Id));
        }
        if (!string.IsNullOrWhiteSpace(query.PaymentStatus))
            source = query.PaymentStatus switch
            {
                "Allocated" => source.Where(x => allocations.Any(a => a.TransferId == x.Id)),
                "PendingReview" => source.Where(x => !allocations.Any(a => a.TransferId == x.Id) &&
                    (reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == null ||
                     reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == "PendingReview")),
                "Rejected" => source.Where(x => !allocations.Any(a => a.TransferId == x.Id) &&
                    reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == "Rejected"),
                "ExcessRefundPending" or "ExcessRefundCompleted" => source.Where(x => !allocations.Any(a => a.TransferId == x.Id) &&
                    reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence)
                        .Select(r => r.Decision).FirstOrDefault() == query.PaymentStatus),
                _ => source.Where(_ => false)
            };
        var views = source.OrderByDescending(x => x.VerifiedAt).ThenBy(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(x => new TransferView(x.Id, x.ProviderIdentity, x.BankReference, x.Amount, x.Currency, x.OccurredAt, x.TransferDescription,
                x.StatementReference, x.VerificationReason, x.VerifiedByUserId, x.VerifiedAt, x.ProposedInvoiceId,
                allocations.Any(a => a.TransferId == x.Id) ? "Allocated" : reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Decision).FirstOrDefault() ?? "PendingReview",
                reviews.Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Reason).FirstOrDefault() ?? (allocations.Any(a => a.TransferId == x.Id) ? "verified_full_payment" : "owner_allocation_confirmation_required"),
                allocations.Where(a => a.TransferId == x.Id).Select(a => a.InvoiceId).FirstOrDefault(), x.IsDevelopmentDemo,
                allocations.Where(a => a.TransferId == x.Id).Sum(a => (decimal?)a.Amount) ?? 0,
                x.Amount - (allocations.Where(a => a.TransferId == x.Id).Sum(a => (decimal?)a.Amount) ?? 0),
                allocations.Where(a => a.TransferId == x.Id).Select(a => a.TargetDepositContractId).FirstOrDefault(),
                allocations.Where(a => a.TransferId == x.Id).Select(a => a.TargetSettlementContractId).FirstOrDefault(),
                allocations.Where(a => a.TransferId == x.Id).Select(a => a.SettlementReceivableId).FirstOrDefault(),
                x.StatementEvidenceSha256 != null && x.StatementEvidenceContentType != null && x.StatementEvidenceLength != null
                    ? new BankStatementEvidenceView(x.StatementEvidenceContentType, x.StatementEvidenceLength.Value, x.StatementEvidenceSha256) : null));
        return new(await views.ToArrayAsync(t),
            query.Page, query.PageSize, await source.CountAsync(t));
    }
    public async Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            var rows = PaymentLedgerQueries.Reviews(db).Where(r => r.TransferId == transferId);
            return new(await rows.OrderByDescending(r => r.Sequence).Skip((page - 1) * pageSize).Take(pageSize)
                .Select(r => new ReconciliationView(r.Sequence, r.InvoiceId, r.Decision, r.Reason, r.ActorId, r.OccurredAt)).ToArrayAsync(t), page, pageSize, await rows.CountAsync(t));
        }
        var query = db.Set<PaymentReconciliation>().AsNoTracking().Where(r => r.TransferId == transferId);
        return new(await query.OrderByDescending(r => r.Sequence).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(r => new ReconciliationView(r.Sequence, r.InvoiceId, r.Decision, r.Reason, r.ActorId, r.OccurredAt)).ToArrayAsync(t), page, pageSize, await query.CountAsync(t));
    }
    public void Add(object entity) => db.Add(entity);
    public Task AddAsync(object entity, CancellationToken token)
    {
        if (db is not Compact24DbContext) { Add(entity); return Task.CompletedTask; }
        return entity switch
        {
            PaymentTransfer receipt => PaymentLedgerWrites.AddReceiptAsync(db, receipt, token),
            PaymentCommand command => PaymentLedgerWrites.AddCommandAsync(db, command, token),
            PaymentReconciliation review => PaymentLedgerWrites.AppendReviewAsync(db, review, token),
            PaymentAllocation allocation => PaymentLedgerWrites.AddAllocationAsync(db, allocation, token),
            PaymentConfirmedEvent confirmed => PaymentLedgerWrites.AddConfirmedEventAsync(db, confirmed, token),
            ReceivingBankAccount account => PaymentObligationQueries.AddLocationAccountAsync(db, account, token),
            _ => throw new InvalidOperationException("Unsupported direct payment ledger write.")
        };
    }
    public Task AuditAsync(Guid actor, string action, Guid target, DateTimeOffset at, CancellationToken token)
    {
        if (db is not Compact24DbContext) { Audit(actor, action, target, at); return Task.CompletedTask; }
        return SecurityAuditWrites.AppendAsync(db, new(Guid.NewGuid(), actor, null, null, action, true, at, "Payment", target), token);
    }
    private IQueryable<BHome.Domain.Billing.Invoice> NativeVisibleInvoices(PaymentScope scope)
    {
        var staffLocations = db.Database.SqlQuery<Guid>($"""
            SELECT l.id AS "Value" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.staff_assignments,'[]'::jsonb)) a
            WHERE l.is_active AND COALESCE((a->>'staffUserId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)={scope.ActorId}
              AND COALESCE((a->>'startDate')::date,'0001-01-01'::date)<={scope.Today}
              AND COALESCE((a->>'endDate')::date,'0001-01-01'::date)>={scope.Today}
            """);
        var eligible = db.EligibleStaffIds(scope.Today);
        return db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Status == InvoiceStatus.Final &&
            (scope.Owner || scope.Tenant && i.RecipientUserIds.Contains(scope.ActorId) ||
             scope.Staff && eligible.Contains(scope.ActorId) && staffLocations.Contains(i.LocationId)));
    }
    private IQueryable<Invoice> VisibleInvoices(PaymentScope scope) => db.Set<Invoice>().AsNoTracking().Where(i => i.Status == InvoiceStatus.Final &&
        (scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.ActorId) ||
            scope.Staff && db.EligibleStaffIds(scope.Today).Contains(scope.ActorId) &&
            db.Locations.Any(l => l.Id == i.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a => a.LocationId == i.LocationId &&
                a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today)));
    private IQueryable<InvoiceFinancialRow> FilteredDebt(PaymentScope scope, PaymentQuery query)
    {
        var source = db is Compact24DbContext
            ? db.Financials(NativeVisibleInvoices(scope).Where(i => (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) &&
                (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod) && (query.InvoiceIds == null || query.InvoiceIds.Contains(i.Id))))
            : db.Financials(VisibleInvoices(scope).Where(i => (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) &&
                (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod) && (query.InvoiceIds == null || query.InvoiceIds.Contains(i.Id))));
        return source.Where(i => (!query.OutstandingOnly || i.Original + i.Adjustments > i.Paid) && (!query.OverdueOnly || i.Original + i.Adjustments > i.Paid && i.DueDate < scope.Today) &&
            (query.PaymentStatus == null || query.PaymentStatus == "Paid" && i.Original + i.Adjustments <= i.Paid || query.PaymentStatus == "Unpaid" && i.Original + i.Adjustments > i.Paid));
    }
    public async Task<DebtSummary> DebtSummaryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t) =>
        await FilteredDebt(scope, query).GroupBy(_ => 1).Select(g => new DebtSummary(
            g.Sum(i => Math.Max(0, i.Original + i.Adjustments - i.Paid)),
            g.Sum(i => i.DueDate < scope.Today ? Math.Max(0, i.Original + i.Adjustments - i.Paid) : 0m),
            g.Count(), g.Count(i => i.DueDate < scope.Today))).SingleOrDefaultAsync(t) ?? new(0m, 0m, 0, 0);
    private sealed record DebtPaymentMode(Guid InvoiceId, string Mode);
    public async Task<PagedResult<DebtInvoiceView>> DebtAsync(PaymentScope scope, PaymentQuery query, CancellationToken t)
    {
        var filtered = FilteredDebt(scope, query);
        var count = await filtered.CountAsync(t);
        var rows = await filtered.OrderBy(i => i.DueDate).ThenBy(i => i.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        var ids = rows.Select(i => i.Id.ToString()).ToArray();
        var modes = db is not Compact24DbContext ? new Dictionary<Guid, string>() :
            await db.Database.SqlQuery<DebtPaymentMode>($"""
                SELECT (task_data->'state'->>'obligationId')::uuid AS "InvoiceId", min(task_data->'state'->>'mode') AS "Mode"
                FROM operational_tasks WHERE task_data->>'recordType' IN ('PaymentCodeV1','PaymentObligationV1') AND task_data->'state'->>'kind'='Invoice'
                  AND task_data->'state'->>'obligationId'=ANY({ids})
                GROUP BY task_data->'state'->>'obligationId' HAVING count(DISTINCT task_data->'state'->>'mode')=1
                """).ToDictionaryAsync(i => i.InvoiceId, i => i.Mode, t);
        var rowIds = rows.Select(i => i.Id).ToArray();
        var entitled = scope.Staff && scope.Tenant && !scope.Owner
            ? db is Compact24DbContext
                ? await db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => rowIds.Contains(i.Id) && i.RecipientUserIds.Contains(scope.ActorId)).Select(i => i.Id).ToArrayAsync(t)
                : await db.Set<InvoiceRecipient>().Where(r => rowIds.Contains(r.InvoiceId) && r.TenantUserId == scope.ActorId).Select(r => r.InvoiceId).ToArrayAsync(t)
            : [];
        var items = rows.Select(i =>
        {
            var v = i.View();
            var limited = scope.Staff && !scope.Owner && (!scope.Tenant || !entitled.Contains(i.Id));
            return new DebtInvoiceView(i.Id, i.LocationId, i.RoomId, i.LocationName, i.RoomNumber, i.BillingPeriod, i.DueDate,
                limited ? null : v.EffectivePayableAmount, limited ? null : v.AllocatedPayments, v.OutstandingAmount,
                v.OutstandingAmount <= 0 ? "Paid" : "Unpaid", PaymentRules.OverdueDays(i.DueDate, scope.Today, v.OutstandingAmount),
                limited ? null : v.OriginalIssuedAmount, limited ? null : v.ApprovedAdjustmentTotal, limited ? null : v.PotentialExcessAmount,
                modes.GetValueOrDefault(i.Id));
        }).ToArray();
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<PagedResult<PaymentHistoryEntry>> PaymentHistoryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t)
    {
        if (db is Compact24DbContext) return await NativePaymentHistoryAsync(scope, query, t);
        var rows = from allocation in db.Set<PaymentAllocation>().AsNoTracking()
                   join invoice in VisibleInvoices(scope) on allocation.InvoiceId equals invoice.Id
                   join transfer in db.Set<PaymentTransfer>() on allocation.TransferId equals transfer.Id
                   where (query.LocationId == null || invoice.LocationId == query.LocationId) && (query.RoomId == null || invoice.RoomId == query.RoomId) &&
                       (query.BillingPeriod == null || invoice.BillingPeriod == query.BillingPeriod)
                   orderby allocation.AllocatedAt descending, allocation.Id
                   select new PaymentHistoryEntry(allocation.Id, invoice.Id, invoice.LocationId, invoice.RoomId, invoice.LocationName, invoice.RoomNumber, invoice.BillingPeriod,
                      allocation.Amount, transfer.OccurredAt, allocation.PaidByUserId == scope.ActorId ? "Bạn" : allocation.PaidByUserId != null ? "Khách thuê khác trong hóa đơn" : "Chưa xác định người trả",
                      transfer.VerificationSource, scope.Owner ? transfer.BankReference : null, scope.Owner ? (Guid?)allocation.VerifiedByUserId : null);
        var page = await rows.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        var allocationIds = page.Select(row => row.Id).ToArray();
        var receipts = await db.Set<PaymentAllocation>().Where(a => allocationIds.Contains(a.Id)).Select(a => new { a.Id, a.TransferId }).ToArrayAsync(t);
        var external = await ExternalReceiptIdsAsync(receipts.Where(a => a.TransferId != null).Select(a => a.TransferId!.Value).Distinct().ToArray(), t);
        var externalAllocations = receipts.Where(a => a.TransferId is { } receipt && external.Contains(receipt)).Select(a => a.Id).ToHashSet();
        return new(page.Select(row => externalAllocations.Contains(row.Id) ? row with { PaidBy = "Người trả bên ngoài (đã xác minh)" } : row).ToArray(), query.Page, query.PageSize, await rows.CountAsync(t));
    }
    private async Task<PagedResult<PaymentHistoryEntry>> NativePaymentHistoryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t)
    {
        var rows = from allocation in db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking()
                   join invoice in NativeVisibleInvoices(scope) on allocation.InvoiceId equals invoice.Id
                   join transfer in PaymentLedgerQueries.ReceiptEntities(db) on allocation.TransferId equals transfer.Id
                   where
                       (query.LocationId == null || invoice.LocationId == query.LocationId) && (query.RoomId == null || invoice.RoomId == query.RoomId) &&
                       (query.BillingPeriod == null || invoice.BillingPeriod == query.BillingPeriod)
                   orderby allocation.AllocatedAt descending, allocation.Id
                   select new
                   {
                       Entry = new PaymentHistoryEntry(allocation.Id, invoice.Id, invoice.LocationId, invoice.RoomId,
                           invoice.BillingSnapshot.GetProperty("compactState").GetProperty("locationName").GetString() ?? "",
                           invoice.BillingSnapshot.GetProperty("compactState").GetProperty("roomNumber").GetString() ?? "", invoice.BillingPeriod,
                           allocation.Amount, transfer.OccurredAt, allocation.PaidByUserId == scope.ActorId ? "Bạn" : allocation.PaidByUserId != null ? "Khách thuê khác trong hóa đơn" : "Chưa xác định người trả",
                           transfer.VerificationData.GetProperty("compactState").GetProperty("verificationSource").GetString() ?? "",
                           scope.Owner ? transfer.BankReference : null, scope.Owner ? (Guid?)(allocation.CreatedByUserId ?? Guid.Empty) : null),
                       ReceiptId = transfer.Id
                   };
        var page = await rows.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        var external = await ExternalReceiptIdsAsync(page.Select(row => row.ReceiptId).Distinct().ToArray(), t);
        return new(page.Select(row => external.Contains(row.ReceiptId) ? row.Entry with { PaidBy = "Người trả bên ngoài (đã xác minh)" } : row.Entry).ToArray(),
            query.Page, query.PageSize, await rows.CountAsync(t));
    }
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetId = target, TargetType = "Payment", Succeeded = true, OccurredAt = at });
}
