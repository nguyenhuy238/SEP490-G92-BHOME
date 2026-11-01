using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class PaymentRepository(BHomeDbContext db) : IPaymentRepository
{
    public async Task<T> TransactionAsync<T>(Guid? transferId, Guid? invoiceId, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        // Short manual reconciliation transactions. One lock order also protects references across rooms.
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
        if (transferId is { } transfer)
            if (!await db.Set<PaymentTransfer>().FromSqlInterpolated($"SELECT * FROM \"PaymentTransfers\" WHERE \"Id\" = {transfer} FOR UPDATE").AnyAsync(t))
                throw new PaymentException(404, "bank_transfer_not_found");
        if (invoiceId is { } invoice)
        {
            var roomId = await db.Set<Invoice>().Where(i => i.Id == invoice).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t)
                ?? throw new PaymentException(404, "payment_invoice_not_found");
            await db.Set<BHome.Domain.PropertyManagement.Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\" = {roomId} FOR UPDATE").SingleAsync(t);
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
    public Task<bool> ReferenceClaimedAsync(string reference, CancellationToken t) => db.Set<BankReferenceClaim>().AnyAsync(c => c.NormalizedReference == reference, t);
    public Task<bool> EligiblePayerAsync(Guid invoiceId, Guid payerId, CancellationToken t) => db.Set<InvoiceRecipient>().AnyAsync(r => r.InvoiceId == invoiceId && r.TenantUserId == payerId, t);
    public Task<bool> PendingReviewAsync(Guid invoiceId, CancellationToken t) => db.Set<PaymentReconciliation>().AnyAsync(r => r.InvoiceId == invoiceId && r.Decision == "PendingReview" &&
        !db.Set<PaymentReconciliation>().Any(newer => newer.TransferId == r.TransferId && newer.Sequence > r.Sequence) &&
        !db.Set<PaymentAllocation>().Any(a => a.TransferId == r.TransferId), t);
    public Task<PaymentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) => db.Set<PaymentCommand>().AsNoTracking().SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key && c.Operation == operation, t);
    public Task<ReceivingBankAccount?> ReceivingAccountAsync(Guid locationId,CancellationToken t)=>db.Set<ReceivingBankAccount>().AsNoTracking().Where(a=>a.LocationId==locationId).OrderByDescending(a=>a.Version).FirstOrDefaultAsync(t);
    public Task<bool> ActiveLocationAsync(Guid locationId,CancellationToken t)=>db.Locations.AnyAsync(l=>l.Id==locationId && l.IsActive,t);
    public async Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid invoiceId,CancellationToken t)=>await db.Set<InvoiceRecipient>().AsNoTracking().Where(r=>r.InvoiceId==invoiceId)
        .OrderBy(r=>r.TenantUserId).Select(r=>new PayerChoice(r.TenantUserId,
            db.Set<BHome.Domain.TenantContracts.Resident>().Where(person=>person.TenantUserId==r.TenantUserId &&
                db.Set<Invoice>().Any(i=>i.Id==invoiceId && i.RoomId==person.RoomId)).OrderBy(person=>person.Id).Select(person=>person.DisplayLabel).FirstOrDefault()??"Khách thuê đã liên kết")).ToArrayAsync(t);
    public async Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t)
    {
        var source = db.Set<PaymentTransfer>().AsNoTracking().Where(x =>
            (query.LocationId == null && query.RoomId == null && query.BillingPeriod == null) || db.Set<Invoice>().Any(i => i.Id == x.ProposedInvoiceId &&
                (query.LocationId == null || i.LocationId == query.LocationId) && (query.RoomId == null || i.RoomId == query.RoomId) && (query.BillingPeriod == null || i.BillingPeriod == query.BillingPeriod)));
        var views = source.OrderByDescending(x => x.VerifiedAt).ThenBy(x => x.Id).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(x => new TransferView(x.Id, x.ProviderIdentity, x.BankReference, x.Amount, x.Currency, x.OccurredAt, x.TransferDescription,
                x.StatementReference, x.VerificationReason, x.VerifiedByUserId, x.VerifiedAt, x.ProposedInvoiceId,
                db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) ? "Allocated" : db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Decision).FirstOrDefault() ?? "PendingReview",
                db.Set<PaymentAllocation>().Any(a => a.TransferId == x.Id) ? "verified_full_payment" : db.Set<PaymentReconciliation>().Where(r => r.TransferId == x.Id).OrderByDescending(r => r.Sequence).Select(r => r.Reason).FirstOrDefault() ?? "owner_allocation_confirmation_required",
                db.Set<PaymentAllocation>().Where(a => a.TransferId == x.Id).Select(a => (Guid?)a.InvoiceId).FirstOrDefault(), x.IsDevelopmentDemo));
        return new(await views.ToArrayAsync(t),
            query.Page, query.PageSize, await source.CountAsync(t));
    }
    public async Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t)
    {
        var query = db.Set<PaymentReconciliation>().AsNoTracking().Where(r => r.TransferId == transferId);
        return new(await query.OrderByDescending(r => r.Sequence).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(r => new ReconciliationView(r.Sequence, r.InvoiceId, r.Decision, r.Reason, r.ActorId, r.OccurredAt)).ToArrayAsync(t),page,pageSize,await query.CountAsync(t));
    }
    public void Add(object entity) => db.Add(entity);
    private IQueryable<Invoice> VisibleInvoices(PaymentScope scope)=>db.Set<Invoice>().AsNoTracking().Where(i=>i.Status==InvoiceStatus.Final &&
        (scope.Owner || scope.Tenant && i.Recipients.Any(r=>r.TenantUserId==scope.ActorId) ||
            scope.Staff && db.Locations.Any(l=>l.Id==i.LocationId && l.IsActive) && db.StaffLocationAssignments.Any(a=>a.LocationId==i.LocationId &&
                a.StaffUserId==scope.ActorId && a.StartDate<=scope.Today && a.EndDate>=scope.Today)));
    public async Task<PagedResult<DebtInvoiceView>> DebtAsync(PaymentScope scope,PaymentQuery query,CancellationToken t)
    {
        var source=VisibleInvoices(scope).Where(i=>(query.LocationId==null||i.LocationId==query.LocationId)&&(query.RoomId==null||i.RoomId==query.RoomId)&&
            (query.BillingPeriod==null||i.BillingPeriod==query.BillingPeriod)).Select(i=>new {i.Id,i.LocationId,i.RoomId,i.LocationName,i.RoomNumber,i.BillingPeriod,i.DueDate,i.Total,
                Paid=db.Set<PaymentAllocation>().Where(a=>a.InvoiceId==i.Id).Sum(a=>(decimal?)a.Amount)??0m});
        var filtered=source.Where(i=>(!query.OutstandingOnly || i.Total>i.Paid)&&(!query.OverdueOnly || i.Total>i.Paid && i.DueDate<scope.Today)&&
            (query.PaymentStatus==null||query.PaymentStatus=="Paid"&&i.Total<=i.Paid||query.PaymentStatus=="Unpaid"&&i.Total>i.Paid));
        var count=await filtered.CountAsync(t);
        var rows=await filtered.OrderBy(i=>i.DueDate).ThenBy(i=>i.Id).Skip((query.Page-1)*query.PageSize).Take(query.PageSize).ToArrayAsync(t);
        var items=rows.Select(i=>new DebtInvoiceView(i.Id,i.LocationId,i.RoomId,i.LocationName,i.RoomNumber,i.BillingPeriod,i.DueDate,
            scope.Staff&&!scope.Owner&&!scope.Tenant?null:i.Total,scope.Staff&&!scope.Owner&&!scope.Tenant?null:i.Paid,i.Total-i.Paid,
            i.Total<=i.Paid?"Paid":"Unpaid",PaymentRules.OverdueDays(i.DueDate,scope.Today,i.Total-i.Paid))).ToArray();
        return new(items,query.Page,query.PageSize,count);
    }
    public async Task<PagedResult<PaymentHistoryEntry>> PaymentHistoryAsync(PaymentScope scope,PaymentQuery query,CancellationToken t)
    {
        var rows=from allocation in db.Set<PaymentAllocation>().AsNoTracking()
                 join invoice in VisibleInvoices(scope) on allocation.InvoiceId equals invoice.Id
                 join transfer in db.Set<PaymentTransfer>() on allocation.TransferId equals transfer.Id
                 where (query.LocationId==null||invoice.LocationId==query.LocationId)&&(query.RoomId==null||invoice.RoomId==query.RoomId)&&
                     (query.BillingPeriod==null||invoice.BillingPeriod==query.BillingPeriod)
                 orderby allocation.AllocatedAt descending,allocation.Id
                 select new PaymentHistoryEntry(allocation.Id,invoice.Id,invoice.LocationId,invoice.RoomId,invoice.LocationName,invoice.RoomNumber,invoice.BillingPeriod,
                    allocation.Amount,transfer.OccurredAt,allocation.PaidByUserId==scope.ActorId?"Bạn":allocation.PaidByUserId!=null?"Khách thuê khác trong hóa đơn":"Chưa xác định người trả",
                    transfer.VerificationSource,scope.Owner?transfer.BankReference:null,scope.Owner?(Guid?)allocation.VerifiedByUserId:null);
        return new(await rows.Skip((query.Page-1)*query.PageSize).Take(query.PageSize).ToArrayAsync(t),query.Page,query.PageSize,await rows.CountAsync(t));
    }
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetId = target, TargetType = "Payment", Succeeded = true, OccurredAt = at });
}
