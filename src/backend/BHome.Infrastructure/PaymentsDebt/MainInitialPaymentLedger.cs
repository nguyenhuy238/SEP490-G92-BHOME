using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class MainInitialPaymentLedger(BHomePersistenceContext db) : IMainInitialPaymentLedger
{
    internal const string Kind = "MainInitialPaymentV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<MainInitialOrder?> ReadAsync(Guid id, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var raw = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE source_key={"main-initial:" + id} AND task_data->>'recordType'={Kind}
            """).SingleOrDefaultAsync(token);
        return raw is null ? null : JsonSerializer.Deserialize<MainInitialOrder>(raw, Json);
    }
    internal async Task<decimal> DepositAsync(Guid id, CancellationToken t) =>
        await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == id).SumAsync(a => (decimal?)a.Amount, t) ?? 0;
    internal async Task<decimal> RentalAsync(Guid id, CancellationToken t) =>
        await db.Set<PaymentAllocation>().Where(a => a.TargetInitialContractId == id).SumAsync(a => (decimal?)a.Amount, t) ?? 0;
    public async Task<bool> SatisfiedAsync(Guid id, CancellationToken token)
    {
        var c = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, token);
        var order = await ReadAsync(id, token); if (order is null) return c is not null && !c.InitialPaymentRequired;
        return c is not null && order.SnapshotHash == c.SnapshotHash &&
            await DepositAsync(id, token) >= order.RequiredDeposit && await RentalAsync(id, token) == order.MonthlyRent + order.Charges.Sum(f => f.Amount);
    }
    public async Task AllocateAsync(Guid id, PaymentTransfer receipt, CancellationToken token)
    {
        var order = await ReadAsync(id, token) ?? throw new PaymentException(409, "initial_payment_order_required");
        var c = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == id, token);
        if (c.Kind != ContractKind.Main || c.PreviousContractId is not null || c.Status != ContractStatus.PendingActivation ||
            c.SnapshotHash != order.SnapshotHash || c.IsDevelopmentDemo != receipt.IsDevelopmentDemo)
            throw new PaymentException(409, "initial_contract_not_payable");
        var deposit = Math.Max(0, order.RequiredDeposit - await DepositAsync(id, token));
        var rent = Math.Max(0, order.MonthlyRent + order.Charges.Sum(f => f.Amount) - await RentalAsync(id, token));
        if (deposit + rent <= 0) throw new PaymentException(409, "initial_payment_already_settled");
        // No implicit allocation priority for partial/excess receipts: preserve for review.
        if (receipt.Amount != deposit + rent) throw new PaymentException(409, "initial_payment_amount_requires_review");
        if (await db.Set<PaymentAllocation>().AnyAsync(a => a.TransferId == receipt.Id, token)) throw new PaymentException(409, "receipt_already_allocated");
        if (deposit > 0) db.Add(new PaymentAllocation { TransferId = receipt.Id, TargetDepositContractId = id, Amount = deposit, AllocatedAt = receipt.VerifiedAt });
        if (rent > 0) db.Add(new PaymentAllocation { TransferId = receipt.Id, TargetInitialContractId = id, Amount = rent, AllocatedAt = receipt.VerifiedAt });
    }
}
