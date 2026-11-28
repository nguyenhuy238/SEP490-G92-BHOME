using BHome.Application.Contracts;
using BHome.Application.Common;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using BHome.Infrastructure.PaymentsDebt;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;

namespace BHome.Infrastructure.Contracts;

internal sealed class CompactContractHoldingLedger(BHomePersistenceContext db, TimeProvider clock) : IContractHoldingLedger
{
    private PaymentAllocation? prepared;
    public async Task<HoldingDepositApplication> ApplyAsync(Guid holdingContractId, Guid mainContractId, Guid roomId,
        Guid? tenantUserId, decimal requiredDeposit, CancellationToken token)
    {
        if (db is not Compact24DbContext compact) throw new IntegrationUnavailableException("BF-03A Compact24 holding ledger");
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Holding conversion requires a protected transaction.");
        prepared = null;
        var holding = await NativeContractSnapshot.LoadAsync(compact, holdingContractId, token)
            ?? throw ContractException.Missing();
        var now = clock.GetUtcNow();
        if (holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active || holding.HoldingExpiryAt <= now ||
            holding.RoomId != roomId || holding.TenantUserId != tenantUserId || holding.PriceLockedAt is null)
            throw ContractException.Conflict("source_holding_not_convertible");
        if (await PaymentLedgerWrites.Allocations(db).AnyAsync(a => a.SourceDepositContractId == holdingContractId, token))
            throw ContractException.Conflict("holding_deposit_already_applied");
        var received = await PaymentLedgerWrites.Allocations(db).Where(a => a.TargetDepositContractId == holdingContractId)
            .SumAsync(a => (decimal?)a.Amount, token) ?? 0m;
        if (received != holding.RequiredDeposit || received > requiredDeposit)
            throw ContractException.Conflict("holding_deposit_cannot_be_applied");
        if (received == 0)
            return new(holdingContractId, roomId, tenantUserId, 0, $"holding:{holdingContractId:N}:no-deposit");
        var allocation = new PaymentAllocation
        {
            SourceDepositContractId = holdingContractId,
            TargetDepositContractId = mainContractId,
            Amount = received,
            PaidByUserId = tenantUserId,
            VerifiedByUserId = holding.ActivatedByUserId ?? throw ContractException.Conflict("holding_activation_evidence_required"),
            AllocatedAt = now
        };
        prepared = allocation;
        return new(holdingContractId, roomId, tenantUserId, received, allocation.Id.ToString("N"));
    }

    public async Task PersistAsync(HoldingDepositApplication application, Guid mainContractId, CancellationToken token)
    {
        if (application.AppliedAmount == 0) return;
        var allocation = prepared;
        prepared = null;
        if (allocation is null || allocation.Id.ToString("N") != application.AllocationReference ||
            allocation.SourceDepositContractId != application.HoldingContractId || allocation.TargetDepositContractId != mainContractId ||
            allocation.Amount != application.AppliedAmount || allocation.PaidByUserId != application.TenantUserId ||
            db.Database.CurrentTransaction is null) throw ContractException.Conflict("invalid_holding_deposit_allocation");
        // The Main Contract is now staged. Flush its parent/roster before writing
        // the FK-bound allocation, still in the same locked conversion transaction.
        await db.SaveChangesAsync(token);
        await PaymentLedgerWrites.AddAllocationAsync(db, allocation, token);
    }
}
