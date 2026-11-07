using BHome.Application.Contracts;
using BHome.Application.Common;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class CompactContractHoldingLedger(BHomePersistenceContext db, TimeProvider clock) : IContractHoldingLedger
{
    public async Task<HoldingDepositApplication> ApplyAsync(Guid holdingContractId, Guid mainContractId, Guid roomId,
        Guid tenantUserId, decimal requiredDeposit, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new IntegrationUnavailableException("BF-03A Compact24 holding ledger");
        var holding = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == holdingContractId, token)
            ?? throw ContractException.Missing();
        var now = clock.GetUtcNow();
        if (holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active || holding.HoldingExpiryAt <= now ||
            holding.RoomId != roomId || holding.TenantUserId != tenantUserId || holding.PriceLockedAt is null)
            throw ContractException.Conflict("source_holding_not_convertible");
        if (await db.Set<PaymentAllocation>().AnyAsync(a => a.SourceDepositContractId == holdingContractId, token))
            throw ContractException.Conflict("holding_deposit_already_applied");
        var received = await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == holdingContractId)
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
        db.Add(allocation);
        return new(holdingContractId, roomId, tenantUserId, received, allocation.Id.ToString("N"));
    }
}
