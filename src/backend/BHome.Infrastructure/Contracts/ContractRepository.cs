using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractRepository(BHomeDbContext db) : IContractRepository
{
    public Task FlushAsync(CancellationToken t) => db.SaveChangesAsync(t);
    public async Task<T> InTransactionAsync<T>(Guid roomId, Func<Task<T>> work, CancellationToken t)
    {
        // All contract writes lock the same authoritative Room row. This serializes activation, renewal,
        // payment allocation and move-out across API instances; constraints also protect direct writers.
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        try
        {
            if (!await db.Set<Room>().FromSqlInterpolated($"SELECT * FROM \"Rooms\" WHERE \"Id\" = {roomId} FOR UPDATE").AnyAsync(t))
                throw ContractException.Missing();
            var value = await work();
            await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return value;
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23P01" or "23514" })
        { throw ContractException.Conflict("contract_concurrent_or_duplicate_operation"); }
        catch (PostgresException e) when (e.SqlState is "40001" or "40P01")
        { throw ContractException.Conflict("contract_concurrent_operation_retry"); }
    }
    public Task<Contract?> FindAsync(Guid id, CancellationToken t) => db.Set<Contract>().Include(c => c.Room).ThenInclude(r => r.Location)
        .Include(c => c.Residents).Include(c => c.Signatures).AsSplitQuery().SingleOrDefaultAsync(c => c.Id == id, t);
    public Task<Room?> RoomAsync(Guid id, CancellationToken t) => db.Set<Room>().Include(r => r.Location).SingleOrDefaultAsync(r => r.Id == id, t);
    public async Task<IReadOnlyList<Resident>> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t)
        => await db.Set<Resident>().Where(r => r.RoomId == roomId && ids.Contains(r.Id)).ToArrayAsync(t);
    public Task<bool> ActiveUserInRoleAsync(Guid id, string role, CancellationToken t) =>
        (from u in db.Users
         join ur in db.UserRoles on u.Id equals ur.UserId
         join r in db.Roles on ur.RoleId equals r.Id
         where u.Id == id && u.IsActive && r.Name == role
         select u.Id).AnyAsync(t);
    public Task<bool> ConflictsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t) =>
        db.Set<Contract>().AnyAsync(c => c.RoomId == roomId && c.Id != exceptId && c.Status == ContractStatus.Active && c.StartDate <= to && c.EndDate >= from, t);
    public Task<bool> OpenRenewalAsync(Guid contractId, CancellationToken t) => db.Set<Contract>().AnyAsync(c => c.PreviousContractId == contractId &&
        (c.Status == ContractStatus.Draft || c.Status == ContractStatus.PendingSigning || c.Status == ContractStatus.PendingActivation), t);
    public async Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t) =>
        await db.Set<DepositVerification>().Where(d => d.ContractId == contractId).SumAsync(d => (decimal?)d.Amount, t) ?? 0;
    public Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t) =>
        db.Set<DepositVerification>().SingleOrDefaultAsync(d => d.BankTransactionReference == reference, t);
    public Task<ContractMoveOut?> MoveOutAsync(Guid contractId, CancellationToken t) => db.Set<ContractMoveOut>().SingleOrDefaultAsync(m => m.ContractId == contractId, t);
    public async Task<IReadOnlyList<ContractInspectionEvidence>> InspectionEvidenceAsync(Guid contractId, CancellationToken t) =>
        await db.Set<ContractInspectionEvidence>().Where(e => e.ContractId == contractId).Take(5).ToArrayAsync(t);
    public async Task<IReadOnlyList<ContractSettlementReview>> SettlementReviewsAsync(Guid contractId, CancellationToken t) =>
        await db.Set<ContractSettlementReview>().AsNoTracking().Where(r => r.ContractId == contractId).OrderByDescending(r => r.ReviewedAt).ThenBy(r => r.Id).Take(100).ToArrayAsync(t);
    public Task<bool> ValidFinalReadingAsync(Guid readingId, Guid contractId, Guid roomId, UtilityType type, DateOnly readingDate, CancellationToken t) =>
        (from r in db.Set<MeterReading>()
         join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
         join meter in db.Set<Meter>() on r.MeterId equals meter.Id
         join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
         where r.Id == readingId && task.ContractId == contractId && meter.RoomId == roomId && meter.IsActive && meter.UtilityType == type &&
             task.ReadingDate == readingDate && task.Status == MeterTaskStatus.Completed && task.Purpose == ReadingPurpose.Final &&
             evidence.IsUploaded && evidence.IsLinked && r.ConfirmedAt != default
         select r.Id).AnyAsync(t);
    public Task<ContractOperation?> OperationAsync(Guid actorId, Guid key, string operation, CancellationToken t) =>
        db.Set<ContractOperation>().SingleOrDefaultAsync(o => o.ActorId == actorId && o.Key == key && o.Operation == operation, t);
    public void Add(object entity) => db.Add(entity);
    public void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actorId, Event = action, TargetId = targetId, TargetType = "Contract", Succeeded = true, OccurredAt = at });
}
