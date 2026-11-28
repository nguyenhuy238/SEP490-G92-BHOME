using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Billing;

internal sealed class AdjustmentRepository(BHomePersistenceContext db) : IAdjustmentRepository
{
    public async Task<T> TransactionAsync<T>(Guid invoiceId, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
        var room = await db.Set<Invoice>().Where(i => i.Id == invoiceId).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t)
            ?? throw new AdjustmentException(404, "adjustment_invoice_not_found");
        await db.Locked<BHome.Domain.PropertyManagement.Room>(room).SingleAsync(t);
        try { var result = await work(); await db.SaveChangesAsync(t); await tx.CommitAsync(t); return result; }
        catch (DbUpdateConcurrencyException) { throw new AdjustmentException(409, "adjustment_concurrent_change"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23514" })
        { throw new AdjustmentException(409, "adjustment_concurrent_change"); }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01" or "23514")
        { throw new AdjustmentException(409, "adjustment_concurrent_change"); }
    }
    public Task<Invoice?> InvoiceAsync(Guid id, InvoiceScope scope, CancellationToken t) => db.Set<Invoice>().Include(i => i.Lines).Include(i => i.Recipients).AsSplitQuery()
        .SingleOrDefaultAsync(i => i.Id == id && (scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.Actor)), t);
    private IQueryable<InvoiceAdjustmentRequest> Visible(InvoiceScope scope) => db.Set<InvoiceAdjustmentRequest>().Where(r =>
        scope.Owner || scope.Tenant && r.RequesterId == scope.Actor && r.Invoice.Recipients.Any(v => v.TenantUserId == scope.Actor));
    private static IQueryable<InvoiceAdjustmentRequest> Detail(IQueryable<InvoiceAdjustmentRequest> query) => query.Include(r => r.Evidence).Include(r => r.Invoice).Include(r => r.Decision).AsSplitQuery();
    public Task<InvoiceAdjustmentRequest?> RequestAsync(Guid id, InvoiceScope scope, CancellationToken t) => Detail(Visible(scope)).SingleOrDefaultAsync(r => r.Id == id, t);
    public async Task<PagedResult<InvoiceAdjustmentRequest>> ListAsync(AdjustmentQuery q, InvoiceScope scope, CancellationToken t)
    {
        var source = Visible(scope).AsNoTracking().Where(r => (q.InvoiceId == null || r.InvoiceId == q.InvoiceId) &&
            (q.LocationId == null || r.Invoice.LocationId == q.LocationId) && (q.RoomId == null || r.Invoice.RoomId == q.RoomId) &&
            (q.Status == null || q.Status == "Pending" && r.Decision == null || r.Decision != null && r.Decision.Outcome == q.Status));
        var count = await source.CountAsync(t);
        return new(await Detail(source.OrderByDescending(r => r.SubmittedAt).ThenBy(r => r.Id).Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)).ToArrayAsync(t), q.Page, q.PageSize, count);
    }
    public Task<InvoiceAdjustmentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) => db.Set<InvoiceAdjustmentCommand>().AsNoTracking()
        .SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key && c.Operation == operation, t);
    public Task<InvoiceAdjustmentEvidence[]> EvidenceAsync(Guid[] ids, CancellationToken t) => db.Set<InvoiceAdjustmentEvidence>().Where(e => ids.Contains(e.Id)).ToArrayAsync(t);
    public Task<InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t) => db.FinancialsAsync(invoiceId, t);
    public async Task<decimal> ChargeAdjustmentsAsync(Guid invoiceId, string chargeCode, CancellationToken t) =>
        await db.Set<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == invoiceId && d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved" && d.ChargeCode == chargeCode).SumAsync(d => (decimal?)d.Delta, t) ?? 0;
    public async Task<PagedResult<AdjustmentEffectView>> EffectsAsync(Guid invoiceId, int page, int pageSize, CancellationToken t)
    {
        var source = db.Set<InvoiceAdjustmentDecision>().AsNoTracking().Where(d => d.InvoiceId == invoiceId && d.Outcome == "Approved");
        return new(await source.OrderByDescending(d => d.Sequence).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(d => new AdjustmentEffectView(d.Id, d.InvoiceStatus.ToString(), d.ChargeCode, d.Delta, d.BeforeAmount, d.CorrectedAmount, d.DecidedAt)).ToArrayAsync(t), page, pageSize, await source.CountAsync(t));
    }
    public void Add(object entity) => db.Add(entity);
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetId = target, TargetType = "InvoiceAdjustment", Succeeded = true, OccurredAt = at });
}
