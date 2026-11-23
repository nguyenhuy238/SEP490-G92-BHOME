using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class SePayRepository(BHomePersistenceContext db, IPaymentRepository payments, IBackgroundJobQueue jobs,
    SePayOptions options, TimeProvider clock, ISettlementReceivablesRepository? settlementRecords = null) : ISePayRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token) => payments.TransactionAsync(null, null, work, token);
    public Task<Guid> ReceiveAsync(SePayTransaction transaction, CancellationToken token) => TransactionAsync(async () =>
    {
        if (db is not Compact24DbContext) throw new PaymentException(503, "sepay_storage_unavailable");
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
        await jobs.EnqueueAsync(new("sepay-reconcile-" + options.Mode.ToLowerInvariant(), id.ToString(), JsonSerializer.Serialize(new { EventId = id })), token);
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
        var contractId = code.Kind == "Settlement" ?
            (await SettlementAsync(code.ObligationId, token)
                ?? throw new PaymentException(404, "settlement_receivable_not_found")).ContractId : code.ObligationId;
        var roomId = code.Kind == "Invoice"
            ? await db.Set<Invoice>().Where(i => i.Id == code.ObligationId).Select(i => i.RoomId).SingleAsync(token)
            : await db.Set<BHome.Domain.TenantContracts.Contract>().Where(c => c.Id == contractId).Select(c => c.RoomId).SingleAsync(token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({code.LocationId.ToString()},0))", token);
        await db.Locked<BHome.Domain.PropertyManagement.Room>(roomId).SingleAsync(token);
    }
    public Task<Invoice?> InvoiceAsync(Guid id, CancellationToken token) => db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, token);
    public Task<bool> DemoInvoiceAsync(Guid id, CancellationToken token) =>
        (from i in db.Set<Invoice>()
         join c in db.Set<BHome.Domain.TenantContracts.Contract>() on i.RepresentativeContractId equals c.Id
         where i.Id == id
         select c.PaymentMode == "Test" || c.PaymentMode == null && c.IsDevelopmentDemo).SingleAsync(token);
    private sealed record SePaySettlementRow(Guid ContractId, Guid LocationId, SettlementReceivable Charge);
    public async Task<SePaySettlementTarget?> SettlementAsync(Guid receivableId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var json = await db.Database.SqlQuery<string>($"""
            SELECT jsonb_build_object('contractId',c.id,'locationId',r.location_id,
                'charge',item.value->'state')::text AS "Value"
            FROM contracts c JOIN rooms r ON r.id=c.room_id
            CROSS JOIN LATERAL jsonb_array_elements(c.history) item(value)
            WHERE item.value->>'recordType'='SettlementReceivableV1'
              AND item.value->'state'->>'id'={receivableId.ToString()}
            """).SingleOrDefaultAsync(token);
        if (json is null) return null;
        var source = JsonSerializer.Deserialize<SePaySettlementRow>(json, Json)
            ?? throw new PaymentException(409, "settlement_ledger_integrity_failed");
        if (source.Charge.Id != receivableId || source.Charge.ContractId != source.ContractId)
            throw new PaymentException(409, "settlement_ledger_integrity_failed");
        var paid = await db.Set<PaymentAllocation>().Where(a =>
            a.TargetSettlementContractId == source.ContractId && a.SettlementReceivableId == receivableId)
            .SumAsync(a => (decimal?)a.Amount, token) ?? 0;
        if (paid < 0 || paid > source.Charge.Amount)
            throw new PaymentException(409, "settlement_ledger_integrity_failed");
        var latest = await db.Database.SqlQuery<string>($"""
            SELECT (h.value->'state')::text AS "Value" FROM contracts c
              CROSS JOIN LATERAL jsonb_array_elements(c.history) WITH ORDINALITY h(value,pos)
            WHERE c.id={source.ContractId} AND h.value->>'recordType'='MoveOutChargeProposalV1'
            ORDER BY h.pos DESC LIMIT 1
            """).SingleOrDefaultAsync(token);
        var allowed = false;
        var blocker = "owner_approved_move_out_settlement_required";
        if (latest is not null)
        {
            var proposal = JsonSerializer.Deserialize<MoveOutChargeProposal>(latest, Json)
                ?? throw new PaymentException(409, "move_out_proposal_integrity_failed");
            // Reconciliation for older Tenant confirmations is appended as a
            // separate immutable event. Read its overlay so that a real signed
            // provider webhook is authorized by the exact same current consent
            // and net receivable as the Tenant-facing transfer instructions.
            var feedback = settlementRecords is null ? null :
                await settlementRecords.ProposalFeedbackAsync(source.ContractId, proposal.Id, token);
            var settlement = feedback?.Settlement;
            allowed = feedback?.Confirmed == true && settlement?.Status == "Payable" &&
                settlement.PayableReceivableId == receivableId &&
                settlement.CreatedReceivableIds.Contains(receivableId) &&
                settlementRecords is not null &&
                (string.IsNullOrWhiteSpace(proposal.PhysicalReference)
                    ? feedback.VerifiedPhysicalReference : proposal.PhysicalReference) is { Length: > 0 } physicalReference &&
                physicalReference == (await settlementRecords.ProposalSourceAsync(source.ContractId, token)).PhysicalReference;
            blocker = "move_out_proposal_reconfirmation_required";
        }
        else
        {
            // Legacy Owner-reviewed settlement has no Tenant proposal workflow.
            var closed = await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS (SELECT 1 FROM contracts c
                  CROSS JOIN LATERAL jsonb_array_elements(c.history) h
                  WHERE c.id={source.ContractId} AND h->>'recordType'='SettlementFinancialCloseV1') AS "Value"
                """).SingleAsync(token);
            allowed = closed;
        }
        if (allowed && settlementRecords is not null)
        {
            var context = await settlementRecords.ContextAsync(source.ContractId, token);
            allowed = context.View.AvailableDeposit == 0 &&
                context.View.Receivables.Count(r => r.Outstanding > 0) == 1 &&
                context.View.Invoices?.Any(i => i.Outstanding > 0) != true;
            if (!allowed) blocker = "move_out_settlement_balance_changed";
        }
        return new(source.ContractId, source.LocationId, source.Charge, source.Charge.Amount - paid,
            allowed, allowed ? null : blocker);
    }
    public async Task AddReceiptAsync(SePayEvent received, PaymentTransfer receipt, CancellationToken token)
    {
        receipt.Stamp(clock.GetUtcNow(), true);
        var snapshot = JsonSerializer.Serialize(receipt, Json);
        var proof = JsonSerializer.Serialize(new { eventId = received.Id, mode = received.Mode, providerTransactionId = received.Transaction.Id, bankReference = received.Transaction.ReferenceCode }, Json);
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
        if (db is not Compact24DbContext) throw new PaymentException(503, "sepay_storage_unavailable");
        var count = await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM operational_tasks WHERE task_data->>'recordType'='SePayEventV1'").SingleAsync(token);
        var values = await db.Database.SqlQuery<SePayEventView>($"""
            SELECT e.id AS "Id",e.task_data->>'mode' AS "Mode",
              CASE WHEN e.status='Pending' AND j.status='Failed' THEN 'ManualReview' ELSE e.status END AS "Status",
              CASE WHEN e.status='Pending' AND j.status='Failed' THEN 'sepay_technical_retry_exhausted' ELSE e.task_data->>'reason' END AS "Reason",
              (e.task_data->>'transferId')::uuid AS "TransferId",e.assigned_at AS "ReceivedAt"
            FROM operational_tasks e LEFT JOIN operational_tasks j ON j.task_type='SYSTEM_JOB'
              AND j.task_data->>'name'='sepay-reconcile-'||lower(e.task_data->>'mode') AND j.task_data->'payload'->>'EventId'=e.id::text
            WHERE e.task_data->>'recordType'='SePayEventV1' ORDER BY e.assigned_at DESC,e.id LIMIT {pageSize} OFFSET {(page - 1) * pageSize}
            """).ToArrayAsync(token);
        return new(values, page, pageSize, count);
    }
}
