using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractExpiryProcessor(BHomePersistenceContext db, TimeProvider clock) : IBackgroundJobHandler, IContractExpiryRepository
{
    public const string JobName = "contract-expiry";
    public string Name => JobName;
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        var through = today.AddDays(30); Guid? after = null;
        while (true)
        {
            var now = clock.GetUtcNow();
            var batch = await db.Set<Contract>().AsNoTracking().Where(c =>
                (c.Kind == ContractKind.Holding ?
                    (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Active) && c.HoldingExpiryAt <= now :
                    c.Status == ContractStatus.Active && c.EndDate <= through) &&
                (after == null || c.Id.CompareTo(after.Value) > 0))
                .OrderBy(c => c.Id).Select(c => new { c.Id, c.RoomId, c.Room.LocationId }).Take(100).ToArrayAsync(t);
            if (batch.Length == 0) break;
            foreach (var item in batch)
            {
                await using var tx = await db.Database.BeginTransactionAsync(t);
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({item.LocationId.ToString()},0))", t);
                var room = await db.Locked<Room>(item.RoomId).SingleAsync(t);
                var c = await db.Set<Contract>().SingleAsync(c => c.Id == item.Id, t);
                if (c.Kind == ContractKind.Holding && c.Status is ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active && c.HoldingExpiryAt <= now)
                {
                    c.Status = ContractStatus.Expired; c.ActualEndDate = today; c.LifecycleActorId = null;
                    c.LifecycleAt = now; c.LifecycleReason = "HoldingExpired; system job; deposited funds require Owner review";
                    var deposit = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? await db.Database.SqlQuery<decimal>($"""
                        SELECT COALESCE(sum(a.amount),0) AS "Value" FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
                        WHERE a.target_deposit_contract_id={c.Id} AND p.status='VERIFIED'
                        """).SingleAsync(t) : await db.Set<DepositVerification>().Where(d => d.ContractId == c.Id).SumAsync(d => (decimal?)d.Amount,t) ?? 0;
                    if (deposit > 0 && !await db.Set<ContractSettlementReview>().AnyAsync(r => r.ContractId == c.Id && r.Decision == "PendingManualReview", t))
                        db.Add(new ContractSettlementReview { ContractId = c.Id, Decision = "PendingManualReview", Settled = false,
                            ReviewedByUserId = c.OwnerSignerId, ReviewedAt = now,
                            FinancialSnapshot = System.Text.Json.JsonSerializer.Serialize(new { verifiedDeposit = deposit, source = "SystemHoldingExpiry", automaticRefund = false }) });
                    var otherBinding = await db.Set<Contract>().AnyAsync(x => x.RoomId == c.RoomId && x.Id != c.Id && x.Status == ContractStatus.Active, t);
                    if (room.Status == RoomStatus.OnHold && !otherBinding)
                    {
                        var before = System.Text.Json.JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = c.Id });
                        room.Status = RoomStatus.Available; room.Version++;
                        db.Add(new PropertyChange { ActorId = c.OwnerSignerId, LocationId = room.LocationId, TargetId = room.Id,
                            TargetType = nameof(Room), Action = RoomTransitionSource.HoldingRelease.ToString(), Reason = "HoldingExpired",
                            Before = before, After = System.Text.Json.JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = c.Id }), OccurredAt = now });
                    }
                    db.SecurityAudit.Add(new SecurityAuditRecord { UserId = c.OwnerSignerId, Event = "HoldingExpired", TargetId = c.Id,
                        TargetType = "Contract", Succeeded = true, OccurredAt = now });
                    await db.SaveChangesAsync(t);
                }
                else if (c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.EndDate <= through)
                {
                    var stage = c.EndDate < today ? "Expired" : "Upcoming30";
                    foreach (var recipient in new[] { c.OwnerSignerId, c.TenantUserId }.Distinct())
                        if (recipient is { } user && !await db.Set<ContractExpiryNotice>().AnyAsync(n => n.ContractId == c.Id && n.EndDate == c.EndDate && n.Stage == stage && n.RecipientId == user, t))
                            db.Add(new ContractExpiryNotice { Id = Guid.NewGuid(), ContractId = c.Id, RecipientId = user,
                                EndDate = c.EndDate, Stage = stage, CreatedAt = clock.GetUtcNow() });
                    await db.SaveChangesAsync(t);
                }
                await tx.CommitAsync(t);
            }
            after = batch[^1].Id;
        }
    }
    public async Task<IReadOnlyList<ContractExpiryNoticeView>> ListAsync(Guid actor, bool owner, CancellationToken t)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        return await
        (from n in db.Set<ContractExpiryNotice>().AsNoTracking()
         join c in db.Set<Contract>() on n.ContractId equals c.Id
         where (owner ? n.RecipientId == c.OwnerSignerId : n.RecipientId == actor && c.TenantUserId == actor) && c.Status == ContractStatus.Active && c.EndDate == n.EndDate && n.Stage == (c.EndDate < today ? "Expired" : "Upcoming30")
         orderby n.CreatedAt descending, n.Id
         select new ContractExpiryNoticeView(n.Id, n.ContractId, c.Room.RoomNumber, c.Room.Location.Name, n.EndDate, n.Stage, n.CreatedAt)).Take(100).ToArrayAsync(t);
    }
}
