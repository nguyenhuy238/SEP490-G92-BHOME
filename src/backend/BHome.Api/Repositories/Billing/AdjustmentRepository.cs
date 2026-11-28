using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

internal sealed class AdjustmentRepository(BHomePersistenceContext db) : IAdjustmentRepository
{
    private Dictionary<Guid, (Invoice Invoice, int Version)>? nativeInvoices;
    private readonly List<InvoiceAdjustmentRequest> nativeRequests = [];
    private readonly List<InvoiceAdjustmentDecision> nativeDecisions = [];
    private readonly List<InvoiceAdjustmentCommand> nativeCommands = [];
    private readonly List<InvoiceAdjustmentEvent> nativeEvents = [];
    private readonly List<SecurityAuditRecord> nativeAudits = [];

    public async Task<T> TransactionAsync<T>(Guid invoiceId, Func<Task<T>> work, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
        var room = (db is Compact24DbContext native
            ? await native.Set<Native.Invoice>().AsNoTracking().Where(i => i.Id == invoiceId).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t)
            : await db.Set<Invoice>().Where(i => i.Id == invoiceId).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(t))
            ?? throw new AdjustmentException(404, "adjustment_invoice_not_found");
        if (db is Compact24DbContext compact)
            await compact.Set<Native.Room>().FromSqlInterpolated($"SELECT * FROM rooms WHERE id={room} FOR UPDATE").AsNoTracking().SingleAsync(t);
        else await db.Locked<BHome.Domain.PropertyManagement.Room>(room).SingleAsync(t);
        try
        {
            if (db is Compact24DbContext) nativeInvoices = [];
            var result = await work();
            if (db is Compact24DbContext context)
            {
                foreach (var (invoice, version) in nativeInvoices!.Values)
                {
                    if (invoice.Version == version) continue;
                    await NativeInvoicePersistence.SaveAsync(context, invoice, version, false, t);
                    foreach (var line in invoice.Lines.Where(l => nativeDecisions.Any(d => d.RequestId == l.CorrectionRequestId)))
                        await NativeInvoicePersistence.CorrectDraftLineAsync(context, line, t);
                }
                foreach (var request in nativeRequests)
                {
                    await NativeAdjustmentPersistence.InsertRequestAsync(context, request, t);
                    foreach (var evidence in request.Evidence)
                        if (await NativeAdjustmentPersistence.SaveEvidenceAsync(context, evidence, false, t) != 1)
                            throw new DbUpdateConcurrencyException("Adjustment evidence could not be linked.");
                }
                foreach (var decision in nativeDecisions)
                    await NativeAdjustmentPersistence.InsertDecisionAsync(context, decision, t);
                foreach (var command in nativeCommands)
                    await NativeAdjustmentPersistence.InsertCommandAsync(context, command, t);
                foreach (var @event in nativeEvents)
                    await NativeAdjustmentPersistence.WriteEventAsync(context, @event, t);
                foreach (var audit in nativeAudits)
                    await NativeAdjustmentPersistence.WriteAuditAsync(context, audit, t);
            }
            else await db.SaveChangesAsync(t);
            await tx.CommitAsync(t);
            return result;
        }
        catch (DbUpdateConcurrencyException) { throw new AdjustmentException(409, "adjustment_concurrent_change"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23514" })
        { throw new AdjustmentException(409, "adjustment_concurrent_change"); }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01" or "23514" or "23505")
        { throw new AdjustmentException(409, "adjustment_concurrent_change"); }
        finally
        {
            nativeInvoices = null; nativeRequests.Clear(); nativeDecisions.Clear();
            nativeCommands.Clear(); nativeEvents.Clear(); nativeAudits.Clear();
        }
    }
    public async Task<Invoice?> InvoiceAsync(Guid id, InvoiceScope scope, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var invoice = (await NativeInvoicePersistence.ReadAsync(compact,
                NativeInvoicePersistence.Visible(compact, scope).Where(i => i.Id == id), t)).SingleOrDefault();
            if (invoice is null || nativeInvoices is null) return invoice;
            if (nativeInvoices.TryGetValue(id, out var existing)) return existing.Invoice;
            nativeInvoices.Add(id, (invoice, invoice.Version));
            return invoice;
        }
        return await db.Set<Invoice>().Include(i => i.Lines).Include(i => i.Recipients).AsSplitQuery()
            .SingleOrDefaultAsync(i => i.Id == id && (scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.Actor)), t);
    }
    private IQueryable<InvoiceAdjustmentRequest> Visible(InvoiceScope scope) => db.Set<InvoiceAdjustmentRequest>().Where(r =>
        scope.Owner || scope.Tenant && r.RequesterId == scope.Actor && r.Invoice.Recipients.Any(v => v.TenantUserId == scope.Actor));
    private static IQueryable<InvoiceAdjustmentRequest> Detail(IQueryable<InvoiceAdjustmentRequest> query) => query.Include(r => r.Evidence).Include(r => r.Invoice).Include(r => r.Decision).AsSplitQuery();
    public async Task<InvoiceAdjustmentRequest?> RequestAsync(Guid id, InvoiceScope scope, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
            return (await NativeAdjustmentPersistence.ReadAsync(compact,
                NativeAdjustmentPersistence.Visible(compact, scope).Where(r => r.Id == id), t)).SingleOrDefault();
        return await Detail(Visible(scope)).SingleOrDefaultAsync(r => r.Id == id, t);
    }
    public async Task<PagedResult<InvoiceAdjustmentRequest>> ListAsync(AdjustmentQuery q, InvoiceScope scope, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var invoices = compact.Set<Native.Invoice>().AsNoTracking();
            var rows = NativeAdjustmentPersistence.Visible(compact, scope)
                .Where(r => q.InvoiceId == null || r.InvoiceId == q.InvoiceId)
                .Where(r => invoices.Any(i => i.Id == r.InvoiceId &&
                    (q.LocationId == null || i.LocationId == q.LocationId) && (q.RoomId == null || i.RoomId == q.RoomId)));
            if (q.Status == "Pending") rows = rows.Where(r => r.DecisionSnapshot == null);
            else if (q.Status is { } outcome)
                rows = rows.Where(r => r.DecisionSnapshot != null && r.DecisionSnapshot.Value.GetProperty("outcome").GetString() == outcome);
            var total = await rows.CountAsync(t);
            var items = await NativeAdjustmentPersistence.ReadAsync(compact, rows.OrderByDescending(r => r.RequestedAt)
                .ThenBy(r => r.Id).Skip((q.Page - 1) * q.PageSize).Take(q.PageSize), t);
            return new(items, q.Page, q.PageSize, total);
        }
        var source = Visible(scope).AsNoTracking().Where(r => (q.InvoiceId == null || r.InvoiceId == q.InvoiceId) &&
            (q.LocationId == null || r.Invoice.LocationId == q.LocationId) && (q.RoomId == null || r.Invoice.RoomId == q.RoomId) &&
            (q.Status == null || q.Status == "Pending" && r.Decision == null || r.Decision != null && r.Decision.Outcome == q.Status));
        var count = await source.CountAsync(t);
        return new(await Detail(source.OrderByDescending(r => r.SubmittedAt).ThenBy(r => r.Id).Skip((q.Page - 1) * q.PageSize).Take(q.PageSize)).ToArrayAsync(t), q.Page, q.PageSize, count);
    }
    public Task<InvoiceAdjustmentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) =>
        db is Compact24DbContext compact ? NativeAdjustmentPersistence.CommandAsync(compact, actor, key, operation, t) :
            db.Set<InvoiceAdjustmentCommand>().AsNoTracking().SingleOrDefaultAsync(c => c.ActorId == actor && c.Key == key && c.Operation == operation, t);
    public async Task<InvoiceAdjustmentEvidence[]> EvidenceAsync(Guid[] ids, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
            return (await NativeAdjustmentPersistence.EvidenceRows(compact).Where(e => ids.Contains(e.Id)).ToArrayAsync(t))
                .Select(NativeAdjustmentPersistence.ReadEvidence).ToArray();
        return await db.Set<InvoiceAdjustmentEvidence>().Where(e => ids.Contains(e.Id)).ToArrayAsync(t);
    }
    public Task<InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t) => db.FinancialsAsync(invoiceId, t);
    public async Task<decimal> ChargeAdjustmentsAsync(Guid invoiceId, string chargeCode, CancellationToken t) =>
        (db is Compact24DbContext
            ? await db.FinalApprovedDecisions().Where(d => d.InvoiceId == invoiceId && d.ChargeCode == chargeCode).SumAsync(d => (decimal?)d.Delta, t)
            : await db.Set<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == invoiceId && d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved" && d.ChargeCode == chargeCode).SumAsync(d => (decimal?)d.Delta, t)) ?? 0;
    public async Task<PagedResult<AdjustmentEffectView>> EffectsAsync(Guid invoiceId, int page, int pageSize, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var rows = compact.Set<Native.InvoiceAdjustment>().AsNoTracking().Where(r => r.InvoiceId == invoiceId &&
                r.DecisionSnapshot != null && r.DecisionSnapshot.Value.GetProperty("outcome").GetString() == "Approved");
            var total = await rows.CountAsync(t);
            var selected = await rows.OrderByDescending(r => r.DecisionSnapshot!.Value.GetProperty("sequence").GetInt64())
                .Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(t);
            return new(selected.Select(r => NativeAdjustmentPersistence.ReadDecision(r)!)
                .Select(d => new AdjustmentEffectView(d.Id, d.InvoiceStatus.ToString(), d.ChargeCode, d.Delta,
                    d.BeforeAmount, d.CorrectedAmount, d.DecidedAt)).ToArray(), page, pageSize, total);
        }
        var source = db.Set<InvoiceAdjustmentDecision>().AsNoTracking().Where(d => d.InvoiceId == invoiceId && d.Outcome == "Approved");
        return new(await source.OrderByDescending(d => d.Sequence).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(d => new AdjustmentEffectView(d.Id, d.InvoiceStatus.ToString(), d.ChargeCode, d.Delta, d.BeforeAmount, d.CorrectedAmount, d.DecidedAt)).ToArrayAsync(t), page, pageSize, await source.CountAsync(t));
    }
    public void Add(object entity)
    {
        if (nativeInvoices is not null)
        {
            switch (entity)
            {
                case InvoiceAdjustmentRequest request: nativeRequests.Add(request); return;
                case InvoiceAdjustmentDecision decision: nativeDecisions.Add(decision); return;
                case InvoiceAdjustmentCommand command: nativeCommands.Add(command); return;
                case InvoiceAdjustmentEvent @event: nativeEvents.Add(@event); return;
                default: throw new InvalidOperationException("Unsupported adjustment record.");
            }
        }
        db.Add(entity);
    }
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at)
    {
        var audit = new SecurityAuditRecord
        { UserId = actor, Event = action, TargetId = target, TargetType = "InvoiceAdjustment", Succeeded = true, OccurredAt = at };
        if (nativeInvoices is not null) nativeAudits.Add(audit);
        else db.SecurityAudit.Add(audit);
    }
}
