using BHome.Application.PaymentsDebt;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Cryptography;
using System.Text;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    internal async Task NativeLedgerWritesPreserveAtomicityAndSnapshots()
    {
        var w = await Setup();
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var repository = scope.ServiceProvider.GetRequiredService<IPaymentRepository>();
        var service = new PaymentService(repository, new User(w.Owner, Roles.Owner), TimeProvider.System);
        var registerKey = Guid.NewGuid();
        var allocationKey = Guid.NewGuid();
        var input = Input(w);
        var receipt = await service.RegisterAsync(input, registerKey, default);
        var request = new PaymentMatchInput(w.Invoice, w.Tenants[0], true);
        var allocated = await service.AllocateAsync(receipt.Id, request, allocationKey, default);
        Assert.Equal("Allocated", allocated.Status);
        Assert.Equal(allocated, await service.AllocateAsync(receipt.Id, request, allocationKey, default));
        Assert.DoesNotContain(db.ChangeTracker.Entries(), e => e.Entity is PaymentTransfer or PaymentAllocation or
            PaymentCommand or PaymentReconciliation or PaymentConfirmedEvent);
        var allocation = (await repository.AllocationAsync(receipt.Id, default))!;
        var review = (await repository.LatestReviewAsync(receipt.Id, default))!;
        Assert.Equal(w.Invoice, allocation.InvoiceId);
        Assert.Equal(w.Tenants[0], allocation.PaidByUserId);
        Assert.Equal(w.Owner, allocation.VerifiedByUserId);
        Assert.Equal("Allocated", review.Decision);
        Assert.Equal(allocation.Id, (await repository.CommandAsync(w.Owner, allocationKey, "allocate", default))!.ResultId);
        Assert.Equal(receipt.Id, (await repository.CommandAsync(w.Owner, registerKey, "register", default))!.ResultId);
        var key = $"{w.Owner}/{allocationKey}/allocate";
        var commandId = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes("PaymentCommand/" + key)).AsSpan(0, 16));
        Assert.True(await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE id={commandId} AND task_type='COMMAND'
              AND task_data->>'recordType'='PaymentCommand' AND task_data->'state'->>'resultId'={allocation.Id.ToString()}
              AND history->0->>'recordKey'={key}) AS "Value"
            """).SingleAsync());
        Assert.True(await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM payments p
              WHERE p.id={receipt.Id} AND p.status='VERIFIED' AND p.verification_method='MANUAL'
                AND p.verification_data->'compactState'->>'normalizedReference'=upper(btrim(p.transaction_reference))
                AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='PaymentAllocation'
                  AND h->>'recordKey'={allocation.Id.ToString()} AND h->'state'->>'invoiceId'={w.Invoice.ToString()})
                AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='BankReferenceClaim'
                  AND h->'state'->>'allocationId'={allocation.Id.ToString()} AND h->>'recordKey'=upper(btrim(p.transaction_reference)))
                AND (SELECT count(*) FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='PaymentReconciliation')=2)
              AS "Value"
            """).SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE record_kind='OUTBOX'
              AND event_key={"PaymentConfirmedEvent:" + allocation.Id}
              AND (event_data->'state'->>'paidAmount')::numeric=100000
              AND (event_data->'state'->>'outstandingAmount')::numeric=0
            """).SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE record_kind='AUDIT'
              AND notification_type='InvoicePaymentAllocated' AND related_entity_id={allocation.Id}
            """).SingleAsync());

        var failed = new PaymentTransfer
        {
            ProviderIdentity = "SYNTHETIC-BANK", BankReference = "ROLLBACK-" + Guid.NewGuid(),
            Amount = 1, OccurredAt = PaymentRules.Timestamp(DateTimeOffset.UtcNow),
            VerifiedAt = PaymentRules.Timestamp(DateTimeOffset.UtcNow), VerifiedByUserId = w.Owner
        };
        failed.NormalizedReference = PaymentRules.NormalizeReference(failed.BankReference);
        var failedKey = Guid.NewGuid();
        await Assert.ThrowsAsync<InvalidOperationException>(() => repository.TransactionAsync<Guid>(null, null, async () =>
        {
            await repository.AddAsync(failed, default);
            await repository.AddAsync(new PaymentReconciliation
            {
                TransferId = failed.Id, ActorId = w.Owner, OccurredAt = failed.VerifiedAt
            }, default);
            await repository.AddAsync(new PaymentCommand
            {
                ActorId = w.Owner, Key = failedKey, Operation = "register", ResultId = failed.Id,
                Fingerprint = new string('A', 64), CreatedAt = failed.VerifiedAt
            }, default);
            throw new InvalidOperationException("Synthetic transaction rollback");
        }, default));
        Assert.Null(await repository.TransferAsync(failed.Id, default));
        Assert.Null(await repository.CommandAsync(w.Owner, failedKey, "register", default));
        Assert.Null(db.Database.CurrentTransaction);
        Assert.DoesNotContain(db.ChangeTracker.Entries(), e => e.Entity is PaymentTransfer or PaymentAllocation or PaymentReconciliation or PaymentCommand);
    }
}
