using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Billing;

internal sealed class AdjustmentRepository(BHomeDbContext db) : IAdjustmentRepository
{
    public async Task<T> TransactionAsync<T>(Guid invoiceId, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
        var room = await db.Set<Invoice>().Where(i => i.Id == invoiceId).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t)
            ?? throw new AdjustmentException(404, "adjustment_invoice_not_found");
        await db.Set<BHome.Domain.PropertyManagement.Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\" = {room} FOR UPDATE").SingleAsync(t);
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
    private static IQueryable<InvoiceAdjustmentRequest> Detail(IQueryable<InvoiceAdjustmentRequest> query) => query.Include(r => r.Evidence).Include(r => r.Invoice).AsSplitQuery();
    public Task<InvoiceAdjustmentRequest?> RequestAsync(Guid id, InvoiceScope scope, CancellationToken t) => Detail(Visible(scope)).SingleOrDefaultAsync(r => r.Id == id, t);
    public async Task<PagedResult<InvoiceAdjustmentRequest>> ListAsync(AdjustmentQuery q, InvoiceScope scope, CancellationToken t)
    {
        var source = Visible(scope).AsNoTracking().Where(r => (q.InvoiceId == null || r.InvoiceId == q.InvoiceId) &&
            (q.LocationId == null || r.Invoice.LocationId == q.LocationId) && (q.RoomId == null || r.Invoice.RoomId == q.RoomId) && (q.Status == null || q.Status == "Pending"));
        var count = await source.CountAsync(t);
        return new(await Detail(source.OrderByDescending(r => r.SubmittedAt).ThenBy(r => r.Id).Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)).ToArrayAsync(t), q.Page, q.PageSize, count);
    }
    public Task<InvoiceAdjustmentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) => db.Set<InvoiceAdjustmentCommand>().AsNoTracking()
        .SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key && c.Operation == operation, t);
    public Task<InvoiceAdjustmentEvidence[]> EvidenceAsync(Guid[] ids, CancellationToken t) => db.Set<InvoiceAdjustmentEvidence>().Where(e => ids.Contains(e.Id)).ToArrayAsync(t);
    public void Add(object entity) => db.Add(entity);
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetId = target, TargetType = "InvoiceAdjustment", Succeeded = true, OccurredAt = at });
}
