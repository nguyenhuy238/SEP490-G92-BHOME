using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class MainInitialPaymentLedger(BHomePersistenceContext db, IPaymentRepository payments, IHoldingTestScope testScope) : IMainInitialPaymentLedger
{
    internal const string Kind = "MainInitialPaymentV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<MainInitialOrder?> ReadAsync(Guid id, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var raw = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE source_key IN ({"main-initial:" + id}, {"main-initial-room:" + id}, {"main-initial-sandbox-room:" + id})
              AND task_data->>'recordType'={Kind}
            ORDER BY (source_key={"main-initial-sandbox-room:" + id}) DESC, (source_key={"main-initial-room:" + id}) DESC
            LIMIT 1
            """).SingleOrDefaultAsync(token);
        return raw is null ? null : JsonSerializer.Deserialize<MainInitialOrder>(raw, Json);
    }
    private Task<decimal> DepositAsync(Guid id, CancellationToken t) => db.Database.SqlQuery<decimal>($"""
        SELECT COALESCE(sum(a.amount),0) AS "Value"
        FROM payment_allocations a LEFT JOIN payments p ON p.id=a.source_payment_id
        WHERE a.target_deposit_contract_id={id} AND (p.status='VERIFIED' OR a.source_deposit_contract_id IS NOT NULL)
        """).SingleAsync(t);
    private Task<decimal> RentalAsync(Guid id, CancellationToken t) => db.Database.SqlQuery<decimal>($"""
        SELECT COALESCE(sum(a.amount),0) AS "Value"
        FROM payment_allocations a JOIN payments p ON p.id=a.source_payment_id
        WHERE a.target_initial_contract_id={id} AND p.status='VERIFIED'
        """).SingleAsync(t);
    public async Task<(decimal Deposit, decimal RentAndFees)> OutstandingAsync(MainInitialOrder order, CancellationToken t)
    {
        var id = order.ContractId;
        var deposit = order.SharedDepositContractId is null ? order.RequiredDeposit : 0;
        var rental = (order.SharedRentContractId is null && order.SharedInvoiceId is null ? order.MonthlyRent : 0) + order.Charges.Sum(f => f.Amount);
        var depositPaid = await DepositAsync(id, t);
        var rentalPaid = await RentalAsync(id, t);
        if (depositPaid > deposit || rentalPaid > rental) throw new PaymentException(409, "initial_payment_excess_requires_review");
        return (deposit - depositPaid, rental - rentalPaid);
    }

    public async Task<Guid?> PendingSharedContractAsync(MainInitialOrder order, CancellationToken t)
    {
        if (order.SharedDepositContractId is { } depositId)
        {
            var deposit = await db.Set<Contract>().Where(c => c.Id == depositId).Select(c => c.RequiredDeposit).SingleAsync(t);
            if (await DepositAsync(depositId, t) < deposit) return depositId;
        }
        if (order.SharedRentContractId is { } rentId)
        {
            var source = await ReadAsync(rentId, t);
            if (source is null || (await OutstandingAsync(source, t)).RentAndFees != 0) return rentId;
        }
        return null;
    }
    public async Task<bool> SatisfiedAsync(Guid id, CancellationToken token)
    {
        var c = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, token);
        var order = await ReadAsync(id, token); if (order is null) return c is not null && !c.InitialPaymentRequired;
        return c is not null && order.SnapshotHash == c.SnapshotHash &&
            (order.RoomScopeMode != "Test" || ContractPaymentModes.IsTest(c) ||
                c.PaymentMode is null && testScope.Allows(order.LocationId)) &&
            await PendingSharedContractAsync(order, token) is null &&
            (order.SharedInvoiceId is not { } invoiceId || (await payments.FinancialsAsync(invoiceId, token)).OutstandingAmount == 0) &&
            await OutstandingAsync(order, token) == (0m, 0m);
    }
    public async Task AllocateAsync(Guid id, PaymentTransfer receipt, CancellationToken token)
    {
        var order = await ReadAsync(id, token) ?? throw new PaymentException(409, "initial_payment_order_required");
        var c = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == id, token);
        if (MainSandboxAcceptance.Read(c) is not null && !AnonymousContractSigningService.Complete(c))
            throw new PaymentException(409, "initial_payment_signatures_required");
        if (c.Kind != ContractKind.Main || c.PreviousContractId is not null || c.Status != ContractStatus.PendingActivation ||
            c.SnapshotHash != order.SnapshotHash || ContractPaymentModes.IsTest(c) != receipt.IsDevelopmentDemo)
            throw new PaymentException(409, "initial_contract_not_payable");
        if (!order.RoomScopeResolved && order.SharedDepositContractId is null && order.SharedRentContractId is null &&
            order.SharedInvoiceId is null)
        {
            var period = new DateOnly(c.StartDate.Year, c.StartDate.Month, 1);
            var otherMain = await db.Set<Contract>().AsNoTracking().Where(other => other.RoomId == c.RoomId && other.Id != id &&
                other.Kind == ContractKind.Main && (other.Status == ContractStatus.Active || other.Status == ContractStatus.PendingActivation ||
                other.Status == ContractStatus.Expired || other.Status == ContractStatus.Terminated &&
                other.StartDate >= period && other.StartDate < period.AddMonths(1))).ToArrayAsync(token);
            if (otherMain.Any(other => ContractPaymentModes.Of(other) == ContractPaymentModes.Of(c)) &&
                !await db.Set<PaymentAllocation>().AnyAsync(a => a.TargetInitialContractId == id || a.TargetDepositContractId == id, token))
                throw new PaymentException(409, "initial_room_payment_refresh_required");
        }
        if (await PendingSharedContractAsync(order, token) is not null ||
            order.SharedInvoiceId is { } invoiceId && (await payments.FinancialsAsync(invoiceId, token)).OutstandingAmount > 0)
            throw new PaymentException(409, "shared_initial_payment_outstanding");
        var (deposit, rent) = await OutstandingAsync(order, token);
        if (deposit + rent <= 0) throw new PaymentException(409, "initial_payment_already_settled");
        // No implicit allocation priority for partial/excess receipts: preserve for review.
        if (receipt.Amount != deposit + rent) throw new PaymentException(409, "initial_payment_amount_requires_review");
        if (await db.Set<PaymentAllocation>().AnyAsync(a => a.TransferId == receipt.Id, token)) throw new PaymentException(409, "receipt_already_allocated");
        if (deposit > 0) db.Add(new PaymentAllocation { TransferId = receipt.Id, TargetDepositContractId = id, Amount = deposit, AllocatedAt = receipt.VerifiedAt });
        if (rent > 0) db.Add(new PaymentAllocation { TransferId = receipt.Id, TargetInitialContractId = id, Amount = rent, AllocatedAt = receipt.VerifiedAt });
        // The common scheduler enqueues only after signatures, payment and effective-date checks pass.
    }
}
