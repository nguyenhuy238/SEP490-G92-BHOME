using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class PaymentRepository(BHomePersistenceContext db) : IPaymentRepository
{
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
            if (!await db.Locked<PaymentTransfer>(transfer).AnyAsync(t))
                throw new PaymentException(404, "bank_transfer_not_found");
        if (invoiceId is { } invoice)
        {
            var roomId = await db.Set<Invoice>().Where(i => i.Id == invoice).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t)
                ?? throw new PaymentException(404, "payment_invoice_not_found");
            await db.Locked<BHome.Domain.PropertyManagement.Room>(roomId).SingleAsync(t);
        }
        try
        {
            var result = await work(); await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: "23505" or "23514" })
        { throw new PaymentException(409, "payment_concurrent_or_duplicate_effect"); }
        catch (PostgresException error) when (error.SqlState is "23505" or "23514" or "40001" or "40P01")
        { throw new PaymentException(409, "payment_concurrent_or_duplicate_effect"); }
    }
    public Task<Invoice?> InvoiceAsync(Guid id, PaymentScope scope, CancellationToken t) => db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == id &&
        (scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.ActorId)), t);
    public Task<PaymentTransfer?> TransferAsync(Guid id, CancellationToken t) => db.Set<PaymentTransfer>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, t);
    public Task<PaymentTransfer?> TransferReferenceAsync(string provider, string reference, CancellationToken t) => db.Set<PaymentTransfer>().AsNoTracking()
        .SingleOrDefaultAsync(x => x.ProviderIdentity == provider && x.NormalizedReference == reference, t);
    public Task<PaymentAllocation?> AllocationAsync(Guid id, CancellationToken t) => db.Set<PaymentAllocation>().AsNoTracking().SingleOrDefaultAsync(a => a.TransferId == id, t);
    public Task<PaymentReconciliation?> LatestReviewAsync(Guid id, CancellationToken t) => db.Set<PaymentReconciliation>().AsNoTracking().Where(r => r.TransferId == id)
        .OrderByDescending(r => r.Sequence).FirstOrDefaultAsync(t);
    public async Task<IReadOnlyList<PaymentLedgerEntry>> HistoryAsync(Guid invoiceId, CancellationToken t) => await
        (from allocation in db.Set<PaymentAllocation>().AsNoTracking()
         join transfer in db.Set<PaymentTransfer>() on allocation.TransferId equals transfer.Id
         where allocation.InvoiceId == invoiceId
         orderby allocation.AllocatedAt descending, allocation.Id
         select new PaymentLedgerEntry(allocation, transfer)).ToArrayAsync(t);
    public async Task<decimal> AllocatedAsync(Guid invoiceId, CancellationToken t) => await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == invoiceId).SumAsync(a => (decimal?)a.Amount, t) ?? 0m;
    public Task<BHome.Application.Billing.InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t) => db.FinancialsAsync(invoiceId, t);
    public Task<bool> ReferenceClaimedAsync(string reference, CancellationToken t) => db.Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == reference, t);
    public Task<bool> EligiblePayerAsync(Guid invoiceId, Guid payerId, CancellationToken t) => db.Set<InvoiceRecipient>().AnyAsync(r => r.InvoiceId == invoiceId && r.TenantUserId == payerId, t);
    public async Task<bool> PendingReviewAsync(Guid invoiceId, CancellationToken t)
    {
        if (AmountMismatchSupported)
            return await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
                  WHERE a.target_invoice_id={invoiceId} AND (p.status<>'VERIFIED' OR
                    p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id) <>
                    (SELECT COALESCE(sum(r.requested_amount),0) FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED')
                    OR EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED'
                      AND NOT EXISTS(SELECT 1 FROM residents person,
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
    public Task<PaymentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) => db.Set<PaymentCommand>().AsNoTracking().SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key && c.Operation == operation, t);
    public Task<ReceivingBankAccount?> ReceivingAccountAsync(Guid locationId, CancellationToken t) => db.Set<ReceivingBankAccount>().AsNoTracking().Where(a => a.LocationId == locationId).OrderByDescending(a => a.Version).FirstOrDefaultAsync(t);
    public Task<bool> ActiveLocationAsync(Guid locationId, CancellationToken t) => db.Locations.AnyAsync(l => l.Id == locationId && l.IsActive, t);
    public async Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid invoiceId, CancellationToken t) => await db.Set<InvoiceRecipient>().AsNoTracking().Where(r => r.InvoiceId == invoiceId)
        .OrderBy(r => r.TenantUserId).Select(r => new PayerChoice(r.TenantUserId,
            db.Set<BHome.Domain.TenantContracts.Resident>().Where(person => person.TenantUserId == r.TenantUserId &&
                db.Set<Invoice>().Any(i => i.Id == invoiceId && i.RoomId == person.RoomId)).OrderBy(person => person.Id).Select(person => person.DisplayLabel).FirstOrDefault() ?? "Khách thuê đã liên kết")).ToArrayAsync(t);
    public async Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t)
    {
        var source = db.Set<PaymentTransfer>().AsNoTracking().Where(x =>
            (query.LocationId == null && query.RoomId == null && query.BillingPeriod == null) || db.Set<Invoice>().Any(i => i.Id ==
                (db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => (Guid?)a.InvoiceId).FirstOrDefault() ??
                 db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.InvoiceId).FirstOrDefault() ?? x.ProposedInvoiceId) &&
                (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) && (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod)));
        var views = source.OrderByDescending(x => x.VerifiedAt).ThenBy(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(x => new TransferView(x.Id, x.ProviderIdentity, x.BankReference, x.Amount, x.Currency, x.OccurredAt, x.TransferDescription,
                x.StatementReference, x.VerificationReason, x.VerifiedByUserId, x.VerifiedAt, x.ProposedInvoiceId,
                db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) ? "Allocated" : db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Decision).FirstOrDefault() ?? "PendingReview",
                db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Reason).FirstOrDefault() ?? (db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) ? "verified_full_payment" : "owner_allocation_confirmation_required"),
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => (Guid?)a.InvoiceId).FirstOrDefault(), x.IsDevelopmentDemo,
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Sum(a => (decimal?)a.Amount) ?? 0,
                x.Amount - (db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Sum(a => (decimal?)a.Amount) ?? 0)));
        return new(await views.ToArrayAsync(t),
            query.Page, query.PageSize, await source.CountAsync(t));
    }
    public async Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t)
    {
        var query = db.Set<PaymentReconciliation>().AsNoTracking().Where(r => r.TransferId == transferId);
        return new(await query.OrderByDescending(r => r.Sequence).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(r => new ReconciliationView(r.Sequence, r.InvoiceId, r.Decision, r.Reason, r.ActorId, r.OccurredAt)).ToArrayAsync(t), page, pageSize, await query.CountAsync(t));
    }
    public void Add(object entity) => db.Add(entity);
    private IQueryable<Invoice> VisibleInvoices(PaymentScope scope) => db.Set<Invoice>().AsNoTracking().Where(i => i.Status == InvoiceStatus.Final &&
        (scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.ActorId) ||
            scope.Staff && db.Locations.Any(l => l.Id == i.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a => a.LocationId == i.LocationId &&
                a.StaffUserId == scope.ActorId && a.StartDate <= scope.Today && a.EndDate >= scope.Today)));
    public async Task<PagedResult<DebtInvoiceView>> DebtAsync(PaymentScope scope, PaymentQuery query, CancellationToken t)
    {
        var source = db.Financials(VisibleInvoices(scope).Where(i => (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) &&
            (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod) && (query.InvoiceIds == null || query.InvoiceIds.Contains(i.Id))));
        var filtered = source.Where(i => (!query.OutstandingOnly || i.Original + i.Adjustments > i.Paid) && (!query.OverdueOnly || i.Original + i.Adjustments > i.Paid && i.DueDate < scope.Today) &&
            (query.PaymentStatus == null || query.PaymentStatus == "Paid" && i.Original + i.Adjustments <= i.Paid || query.PaymentStatus == "Unpaid" && i.Original + i.Adjustments > i.Paid));
        var count = await filtered.CountAsync(t);
        var rows = await filtered.OrderBy(i => i.DueDate).ThenBy(i => i.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        var entitled = scope.Staff && scope.Tenant && !scope.Owner
            ? await db.Set<InvoiceRecipient>().Where(r => rows.Select(i => i.Id).Contains(r.InvoiceId) && r.TenantUserId == scope.ActorId).Select(r => r.InvoiceId).ToArrayAsync(t)
            : [];
        var items = rows.Select(i =>
        {
            var v = i.View();
            var limited = scope.Staff && !scope.Owner && (!scope.Tenant || !entitled.Contains(i.Id));
            return new DebtInvoiceView(i.Id, i.LocationId, i.RoomId, i.LocationName, i.RoomNumber, i.BillingPeriod, i.DueDate,
                limited ? null : v.EffectivePayableAmount, limited ? null : v.AllocatedPayments, v.OutstandingAmount,
                v.OutstandingAmount <= 0 ? "Paid" : "Unpaid", PaymentRules.OverdueDays(i.DueDate, scope.Today, v.OutstandingAmount),
                limited ? null : v.OriginalIssuedAmount, limited ? null : v.ApprovedAdjustmentTotal, limited ? null : v.PotentialExcessAmount);
        }).ToArray();
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<PagedResult<PaymentHistoryEntry>> PaymentHistoryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t)
    {
        var rows = from allocation in db.Set<PaymentAllocation>().AsNoTracking()
                   join invoice in VisibleInvoices(scope) on allocation.InvoiceId equals invoice.Id
                   join transfer in db.Set<PaymentTransfer>() on allocation.TransferId equals transfer.Id
                   where (query.LocationId == null || invoice.LocationId == query.LocationId) && (query.RoomId == null || invoice.RoomId == query.RoomId) &&
                       (query.BillingPeriod == null || invoice.BillingPeriod == query.BillingPeriod)
                   orderby allocation.AllocatedAt descending, allocation.Id
                   select new PaymentHistoryEntry(allocation.Id, invoice.Id, invoice.LocationId, invoice.RoomId, invoice.LocationName, invoice.RoomNumber, invoice.BillingPeriod,
                      allocation.Amount, transfer.OccurredAt, allocation.PaidByUserId == scope.ActorId ? "Bạn" : allocation.PaidByUserId != null ? "Khách thuê khác trong hóa đơn" : "Chưa xác định người trả",
                      transfer.VerificationSource, scope.Owner ? transfer.BankReference : null, scope.Owner ? (Guid?)allocation.VerifiedByUserId : null);
        return new(await rows.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArrayAsync(t), query.Page, query.PageSize, await rows.CountAsync(t));
    }
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetId = target, TargetType = "Payment", Succeeded = true, OccurredAt = at });
}
