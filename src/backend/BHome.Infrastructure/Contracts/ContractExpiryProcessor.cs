using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.TenantContracts;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractExpiryProcessor(BHomePersistenceContext db, TimeProvider clock,
    IContractHandoverRepository? handoverTasks = null) : IBackgroundJobHandler, IContractExpiryRepository
{
    public const string JobName = "contract-expiry";
    public string Name => JobName;
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        var today = clock.BusinessToday();
        var through = today.AddDays(30); Guid? after = null;
        while (true)
        {
            var now = clock.BusinessUtcNow();
            // The offline source schema predates Holding expiry metadata. Keep its Main tenancy
            // regression query translatable. Runtime Compact24 expires Holding drafts and pending
            // signing/activation records as well as Active Holding contracts.
            var due = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext
                ? db.Set<Contract>().AsNoTracking().Where(c =>
                    c.Kind == ContractKind.Holding
                        ? (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning ||
                           c.Status == ContractStatus.PendingActivation || c.Status == ContractStatus.Active) && c.HoldingExpiryAt <= now
                        : c.Status == ContractStatus.Active && c.EndDate <= through)
                : db.Set<Contract>().AsNoTracking().Where(c =>
                    c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.EndDate <= through);
            var batch = await due.Where(c => after == null || c.Id.CompareTo(after.Value) > 0)
                .OrderBy(c => c.Id).Select(c => new { c.Id, c.RoomId, c.Room.LocationId }).Take(100).ToArrayAsync(t);
            if (batch.Length == 0) break;
            foreach (var item in batch)
            {
                await using var tx = await db.Database.BeginTransactionAsync(t);
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({item.LocationId.ToString()},0))", t);
                var room = await db.Locked<Room>(item.RoomId).SingleAsync(t);
                var c = await db.Set<Contract>().Include(c => c.Room).SingleAsync(c => c.Id == item.Id, t);
                if (c.Kind == ContractKind.Holding && c.Status is ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active && c.HoldingExpiryAt <= now)
                {
                    c.Status = ContractStatus.Expired; c.ActualEndDate = today; c.LifecycleActorId = null;
                    c.LifecycleAt = now; c.LifecycleReason = "HoldingExpired; system job; deposited funds require Owner review";
                    var deposit = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? await db.Database.SqlQuery<decimal>($"""
                        SELECT COALESCE(sum(a.amount),0) AS "Value" FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
                        WHERE a.target_deposit_contract_id={c.Id} AND p.status='VERIFIED'
                        """).SingleAsync(t) : await db.Set<DepositVerification>().Where(d => d.ContractId == c.Id).SumAsync(d => (decimal?)d.Amount, t) ?? 0;
                    if (deposit > 0 && !await db.Set<ContractSettlementReview>().AnyAsync(r => r.ContractId == c.Id && r.Decision == "PendingManualReview", t))
                        db.Add(new ContractSettlementReview
                        {
                            ContractId = c.Id,
                            Decision = "PendingManualReview",
                            Settled = false,
                            ReviewedByUserId = c.OwnerSignerId,
                            ReviewedAt = now,
                            FinancialSnapshot = System.Text.Json.JsonSerializer.Serialize(new { verifiedDeposit = deposit, source = "SystemHoldingExpiry", automaticRefund = false })
                        });
                    var otherBinding = await db.Set<Contract>().AnyAsync(x => x.RoomId == c.RoomId && x.Id != c.Id && x.Status == ContractStatus.Active, t);
                    if (room.Status == RoomStatus.OnHold && !otherBinding)
                    {
                        var before = System.Text.Json.JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = c.Id });
                        room.Status = RoomStatus.Available; room.Version++;
                        db.Add(new PropertyChange
                        {
                            ActorId = c.OwnerSignerId,
                            LocationId = room.LocationId,
                            TargetId = room.Id,
                            TargetType = nameof(Room),
                            Action = RoomTransitionSource.HoldingRelease.ToString(),
                            Reason = "HoldingExpired",
                            Before = before,
                            After = System.Text.Json.JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = c.Id }),
                            OccurredAt = now
                        });
                    }
                    db.SecurityAudit.Add(new SecurityAuditRecord
                    {
                        UserId = c.OwnerSignerId,
                        Event = "HoldingExpired",
                        TargetId = c.Id,
                        TargetType = "Contract",
                        Succeeded = true,
                        OccurredAt = now
                    });
                    await db.SaveChangesAsync(t);
                }
                else if (c.Kind != ContractKind.Holding && c.Status == ContractStatus.Active && c.EndDate <= through)
                {
                    var stage = c.EndDate < today ? "Expired" : "Upcoming30";
                    foreach (var recipient in new[] { c.OwnerSignerId, c.TenantUserId }.Distinct())
                        if (recipient is { } user && !await db.Set<ContractExpiryNotice>().AnyAsync(n => n.ContractId == c.Id && n.EndDate == c.EndDate && n.Stage == stage && n.RecipientId == user, t))
                            db.Add(new ContractExpiryNotice
                            {
                                Id = Guid.NewGuid(),
                                ContractId = c.Id,
                                RecipientId = user,
                                EndDate = c.EndDate,
                                Stage = stage,
                                CreatedAt = clock.GetUtcNow()
                            });
                    // The Main contract stays Active until physical handover is
                    // reviewed/completed. Starting a move-out only when it has
                    // become Terminated would deadlock Staff inspection.
                    //
                    // Room + Location advisory locks above serialize concurrent
                    // job replays with normal Owner/Tenant contract operations.
                    // There is one ContractMoveOut per ContractId in both schemas.
                    ContractMoveOut? openedMoveOut = null;
                    if (c.Kind is ContractKind.Main or ContractKind.Renewal &&
                        c.EndDate < today &&
                        !await db.Set<Contract>().AnyAsync(next => next.PreviousContractId == c.Id &&
                            (next.Status == ContractStatus.Draft ||
                             next.Status == ContractStatus.PendingSigning ||
                             next.Status == ContractStatus.PendingActivation ||
                             next.Status == ContractStatus.Active), t) &&
                        !await db.Set<ContractMoveOut>().AnyAsync(m => m.ContractId == c.Id, t))
                    {
                        var move = new ContractMoveOut
                        {
                            ContractId = c.Id,
                            ProposedDate = c.EndDate,
                            Reason = "Hợp đồng hết hạn; hệ thống mở quy trình kiểm tra trả phòng.",
                            RequestedByUserId = c.OwnerSignerId, // Responsible owner; system origin below.
                            IsExpiry = true,
                            Status = MoveOutStatus.Approved,
                            ApprovedAt = now,
                            ApprovedByUserId = null, // NOT a human Owner approval.
                            PendingReason = "inspection_and_financial_dependencies"
                        };
                        db.Add(move);
                        openedMoveOut = move;
                        db.Add(new ContractMoveOutHistory
                        {
                            ContractId = c.Id,
                            Version = move.Version,
                            Action = "ExpiryInspectionOpenedBySystem",
                            ActorId = c.OwnerSignerId, // Historical schema requires a real user FK.
                            OccurredAt = now,
                            Snapshot = JsonSerializer.Serialize(new
                            {
                                move.Id,
                                move.ContractId,
                                move.ProposedDate,
                                Status = move.Status.ToString(),
                                move.IsExpiry,
                                Origin = "ContractExpiryJob",
                                OwnerApproved = false
                            })
                        });
                        db.SecurityAudit.Add(new SecurityAuditRecord
                        {
                            UserId = c.OwnerSignerId,
                            Event = "ContractExpiryInspectionOpenedBySystem",
                            TargetId = c.Id,
                            TargetType = "Contract",
                            Succeeded = true,
                            OccurredAt = now
                        });
                    }
                    if (handoverTasks is not null)
                    {
                        openedMoveOut ??= await db.Set<ContractMoveOut>().SingleOrDefaultAsync(m => m.ContractId == c.Id, t);
                        if (openedMoveOut is { Status: not (MoveOutStatus.Requested or MoveOutStatus.AwaitingConsent or MoveOutStatus.Rejected) })
                            await handoverTasks.EnsureMoveOutTaskAsync(c, openedMoveOut, c.OwnerSignerId, now, t);
                    }
                    await db.SaveChangesAsync(t);
                }
                await tx.CommitAsync(t);
            }
            after = batch[^1].Id;
        }
    }
    public async Task<IReadOnlyList<ContractExpiryNoticeView>> ListAsync(Guid actor, bool owner, CancellationToken t)
    {
        var today = clock.BusinessToday();
        return await
        (from n in db.Set<ContractExpiryNotice>().AsNoTracking()
         join c in db.Set<Contract>() on n.ContractId equals c.Id
         where (owner ? n.RecipientId == c.OwnerSignerId : n.RecipientId == actor && c.TenantUserId == actor) && c.Status == ContractStatus.Active && c.EndDate == n.EndDate && n.Stage == (c.EndDate < today ? "Expired" : "Upcoming30")
         orderby n.CreatedAt descending, n.Id
         select new ContractExpiryNoticeView(n.Id, n.ContractId, c.Room.RoomNumber, c.Room.Location.Name, n.EndDate, n.Stage, n.CreatedAt)).Take(100).ToArrayAsync(t);
    }
}
