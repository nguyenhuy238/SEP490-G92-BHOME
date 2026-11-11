using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Operations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class IdentityRetentionRepository(Compact24DbContext db, IContractSettlementLedger ledger) : IIdentityRetentionRepository
{
    private const string Kind = "IdentityRetentionReviewV1";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<T> TransactionAsync<T>(Guid residentId, Func<Task<T>> work, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", token);
        if (!await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM residents WHERE id={residentId} FOR UPDATE").AnyAsync(token)) throw OperationsException.Missing();
        var result = await work(); await transaction.CommitAsync(token); return result;
    }
    public async Task<IdentityRetentionEvent?> OperationAsync(Guid actor, Guid key, CancellationToken token)
    {
        var text = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM residents r CROSS JOIN LATERAL jsonb_array_elements(r.history) h
            WHERE h->>'recordType'={Kind} AND h->'state'->>'actorId'={actor.ToString()} AND h->'state'->>'operationKey'={key.ToString()}
            """).SingleOrDefaultAsync(token);
        return text is null ? null : JsonSerializer.Deserialize<IdentityRetentionEvent>(text, Json) ?? throw OperationsException.Conflict("identity_retention_history_invalid");
    }
    public async Task<IdentityRetentionView> ContextAsync(Guid id, IdentityRetentionPolicy policy, DateOnly today, CancellationToken token)
    {
        // Native safe metadata only. IdentityData/HMAC/CCCD fields are never selected or decrypted here.
        var person = await db.Database.SqlQuery<RetentionPerson>($"""
            SELECT r.id AS "Id",r.current_room_id AS "RoomId",r.user_id AS "UserId",r.verified_at AS "VerifiedAt",
              COALESCE((SELECT jsonb_agg(h ORDER BY n) FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
                WHERE h->>'recordType'={Kind}),'[]'::jsonb)::text AS "HistoryJson"
            FROM residents r WHERE r.id={id}
            """).SingleOrDefaultAsync(token) ?? throw OperationsException.Missing();
        using var history = JsonDocument.Parse(person.HistoryJson);
        var events = history.RootElement.EnumerateArray().Where(h => h.TryGetProperty("recordType", out var k) && k.GetString() == Kind)
            .Select(h => h.GetProperty("state").Deserialize<IdentityRetentionEvent>(Json) ?? throw OperationsException.Conflict("identity_retention_history_invalid")).ToArray();
        if (events.Select(e => e.Id).Distinct().Count() != events.Length || events.Any(e => e.Action is not ("PlaceHold" or "ReleaseHold" or "Review")))
            throw OperationsException.Conflict("identity_retention_history_invalid");
        var released = events.Where(e => e.Action == "ReleaseHold").Select(e => e.HoldId).ToHashSet();
        var holds = events.Where(e => e.Action == "PlaceHold" && !released.Contains(e.Id)).ToArray();
        var blockers = new List<string>(); var sources = new List<object>();
        if (person.RoomId is not null) blockers.Add("current_residence");
        if (holds.Length > 0) blockers.Add("identity_retention_hold_active");
        var contracts = await db.Set<Contract>().AsNoTracking().Where(c => c.Residents.Any(r => r.ResidentId == id)).OrderBy(c => c.Id)
            .Select(c => new { c.Id, c.Status, c.Kind }).ToArrayAsync(token);
        foreach (var contract in contracts)
        {
            if (contract.Status is ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active)
            { blockers.Add("contract_not_closed"); sources.Add(contract); continue; }
            if (contract.Kind == ContractKind.Holding)
            {
                var money = await db.Database.SqlQuery<decimal>($"SELECT COALESCE(sum(amount),0) AS \"Value\" FROM payment_allocations WHERE target_deposit_contract_id={contract.Id}").SingleAsync(token);
                // Retention of historical forfeiture/application/refund evidence still needs the approved policy scope.
                if (money != 0) blockers.Add("holding_financial_records_require_review");
                sources.Add(new { contract.Id, contract.Status, Money = money });
            }
            else if (ledger is IContractSettlementDetails details)
            {
                var summary = await details.SummaryAsync(contract.Id, token);
                if (!summary.Resolved) blockers.Add("financial_obligations_require_review");
                sources.Add(new { contract.Id, contract.Status, summary.Reference, summary.Resolved });
            }
            else blockers.Add("financial_ledger_unavailable");
        }
        var residence = await db.Database.SqlQuery<RetentionResidence>($"""
            SELECT max(actual_move_out_date) AS "LastMoveOut",bool_or(actual_residence_from IS NOT NULL AND actual_move_out_date IS NULL) AS "OpenResidence"
            FROM contract_residents WHERE resident_id={id}
            """).SingleAsync(token);
        if (residence.OpenResidence == true) blockers.Add("residence_not_closed");
        var pending = await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM refund_requests WHERE beneficiary_resident_id={id} AND status IN ('REQUESTED','APPROVED')) AS \"Value\"").SingleAsync(token)
            || await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingAsync(db, null, null, token, id)
            || await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.PendingDepositAsync(db, [], token, id);
        if (pending) blockers.Add("refund_pending");
        DateOnly? start = policy.StartBasis switch
        {
            "LatestActualMoveOut" => residence.LastMoveOut,
            "IdentityVerification" when person.VerifiedAt is { } at => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(at, "Asia/Ho_Chi_Minh").DateTime),
            _ => null
        };
        var evaluation = IdentityRetentionRules.Evaluate(policy, start, today, blockers);
        var reference = "RETENTION-" + IdentityRetentionRules.Hash(new
        {
            id,
            person.RoomId,
            person.UserId,
            person.VerifiedAt,
            person.HistoryJson,
            policy,
            today,
            residence,
            pending,
            sources,
            evaluation.Blockers
        });
        return new(id, reference, policy, start, evaluation.Due, evaluation.Blockers.Length == 0 ? "ReadyForPolicyReview" : "Restricted",
            false, evaluation.Blockers, holds, events);
    }
    public async Task SaveAsync(Guid residentId, IdentityRetentionEvent entry, CancellationToken token)
    {
        var json = JsonSerializer.Serialize(new { recordType = Kind, schemaVersion = 1, state = entry }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE residents SET history=history||jsonb_build_array({json}::jsonb) WHERE id={residentId}", token);
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = entry.ActorId,
            Event = "IdentityRetention" + entry.Action,
            TargetType = "Resident",
            TargetId = residentId,
            Succeeded = true,
            OccurredAt = entry.At
        });
        await db.SaveChangesAsync(token);
    }
}
public sealed class RetentionPerson
{
    public Guid Id { get; set; }
    public Guid? RoomId { get; set; }
    public Guid? UserId { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public string HistoryJson { get; set; } = "[]";
}
public sealed class RetentionResidence
{
    public DateOnly? LastMoveOut { get; set; }
    public bool? OpenResidence { get; set; }
}
