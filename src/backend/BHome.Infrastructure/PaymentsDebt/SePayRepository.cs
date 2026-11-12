using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class SePayRepository(Compact24DbContext db, IPaymentRepository payments, IBackgroundJobQueue jobs,
    SePayOptions options, TimeProvider clock) : ISePayRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token) => payments.TransactionAsync(null, null, work, token);
    public Task<Guid> ReceiveAsync(SePayTransaction transaction, CancellationToken token) => TransactionAsync(async () =>
    {
        var identity = ReceiptExcessRules.Hash(new[] { options.Mode, transaction.Gateway.ToUpperInvariant(), transaction.AccountNumber, transaction.Id });
        var key = "sepay-event:" + identity;
        var previous = await db.Database.SqlQuery<string>($"SELECT task_data::text AS \"Value\" FROM operational_tasks WHERE source_key={key}").SingleOrDefaultAsync(token);
        if (previous is not null)
        {
            var received = JsonSerializer.Deserialize<SePayEvent>(previous, Json)!;
            if (received.Mode != options.Mode || received.Transaction != transaction) throw new PaymentException(409, "sepay_event_identity_conflict");
            return received.Id;
        }
        var id = Guid.NewGuid();
        var data = JsonSerializer.Serialize(new SePayEvent(id, options.Mode, transaction, "Pending", null, null), Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,assigned_at,task_data)
            VALUES({id},'COMMAND',{key},'Pending',{clock.GetUtcNow()},CAST({data} AS jsonb)||jsonb_build_object('recordType','SePayEventV1'))
            """, token);
        await jobs.EnqueueAsync(new("sepay-reconcile", id.ToString(), JsonSerializer.Serialize(new { EventId = id })), token);
        return id;
    }, token);
    public async Task<SePayEvent> EventAsync(Guid id, CancellationToken token)
    {
        var data = await db.Database.SqlQuery<string>($"""
            SELECT task_data::text AS "Value" FROM operational_tasks WHERE id={id} AND task_type='COMMAND' AND task_data->>'recordType'='SePayEventV1'
            """).SingleAsync(token);
        return JsonSerializer.Deserialize<SePayEvent>(data, Json)!;
    }
    public async Task<PaymentCode?> ResolveAsync(string code, CancellationToken token)
    {
        var data = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks WHERE source_key={"payment-code:" + code}
              AND task_data->>'recordType'='PaymentCodeV1' AND task_data->'state'->>'mode'={options.Mode}
            """).SingleOrDefaultAsync(token);
        return data is null ? null : JsonSerializer.Deserialize<PaymentCode>(data, Json);
    }
    public async Task LockTargetAsync(PaymentCode code, CancellationToken token)
    {
        var roomId = code.Kind == "Invoice"
            ? await db.Set<Invoice>().Where(i => i.Id == code.ObligationId).Select(i => i.RoomId).SingleAsync(token)
            : await db.Set<BHome.Domain.TenantContracts.Contract>().Where(c => c.Id == code.ObligationId).Select(c => c.RoomId).SingleAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({code.LocationId.ToString()},0))", token);
        await db.Locked<BHome.Domain.PropertyManagement.Room>(roomId).SingleAsync(token);
    }
    public Task<Invoice?> InvoiceAsync(Guid id, CancellationToken token) => db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, token);
    public Task<bool> DemoInvoiceAsync(Guid id, CancellationToken token) =>
        (from i in db.Set<Invoice>()
         join c in db.Set<BHome.Domain.TenantContracts.Contract>() on i.RepresentativeContractId equals c.Id
         where i.Id == id
         select c.IsDevelopmentDemo).SingleAsync(token);
    public async Task AddReceiptAsync(SePayEvent received, PaymentTransfer receipt, CancellationToken token)
    {
        receipt.Stamp(clock.GetUtcNow(), true);
        var snapshot = JsonSerializer.Serialize(receipt, Json);
        var proof = JsonSerializer.Serialize(new { eventId = received.Id, mode = received.Mode, providerTransactionId = received.Transaction.Id }, Json);
        var history = JsonSerializer.Serialize(new[] { new { schemaVersion = 1, recordType = "SePayVerificationV1", state = new { eventId = received.Id, mode = received.Mode, verifiedAt = receipt.VerifiedAt } } }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,
              verification_method,verified_at,remittance_info,verification_data,history)
            VALUES({receipt.Id},{receipt.ProviderIdentity},{received.Mode + ":" + received.Transaction.Gateway.ToUpperInvariant() + ":" + received.Transaction.AccountNumber},
              {receipt.BankReference},{"receipt:" + receipt.ProviderIdentity + ":" + receipt.NormalizedReference},{receipt.OccurredAt},{receipt.Amount},'VND','VERIFIED',
              'AUTO',{receipt.VerifiedAt},{receipt.TransferDescription},jsonb_build_object('schemaVersion',1,'compactState',CAST({snapshot} AS jsonb),'sepay',CAST({proof} AS jsonb)),CAST({history} AS jsonb))
            """, token);
    }
    public Task FinishAsync(SePayEvent received, string status, string reason, Guid? receipt, CancellationToken token)
    {
        var data = JsonSerializer.Serialize(received with { Status = status, Reason = reason, TransferId = receipt }, Json);
        var history = JsonSerializer.Serialize(new[] { new { action = status, reason, occurredAt = clock.GetUtcNow(), transferId = receipt } }, Json);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET status={status},task_data=CAST({data} AS jsonb)||jsonb_build_object('recordType','SePayEventV1'),
              history=history||CAST({history} AS jsonb) WHERE id={received.Id} AND task_data->>'recordType'='SePayEventV1'
            """, token);
    }
    public async Task<PagedResult<SePayEventView>> EventsAsync(int page, int pageSize, CancellationToken token)
    {
        if (page < 1 || pageSize is < 1 or > 100 || page > int.MaxValue / pageSize) throw new PaymentException(400, "invalid_payment_query");
        var count = await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM operational_tasks WHERE task_data->>'recordType'='SePayEventV1'").SingleAsync(token);
        var values = await db.Database.SqlQuery<SePayEventView>($"""
            SELECT id AS "Id",task_data->>'mode' AS "Mode",status AS "Status",task_data->>'reason' AS "Reason",
              (task_data->>'transferId')::uuid AS "TransferId",assigned_at AS "ReceivedAt"
            FROM operational_tasks WHERE task_data->>'recordType'='SePayEventV1' ORDER BY assigned_at DESC,id LIMIT {pageSize} OFFSET {(page - 1) * pageSize}
            """).ToArrayAsync(token);
        return new(values, page, pageSize, count);
    }
}
