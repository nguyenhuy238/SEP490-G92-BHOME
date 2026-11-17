using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

// The existing versioned setup document supplies effective-date history and optimistic locking.
// Each generated expense retains a separate immutable amount/period snapshot.
public sealed record RecurringExpenseWrite(Guid LocationId, string Name,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    // Legacy JSON property. Callers may omit dayOfMonth (deserializes to 0),
    // since startsOn alone now determines the due day for newly created rules.
    string Frequency, int DayOfMonth, DateOnly StartsOn, DateOnly? EndsOn,
    bool Active, int ExpectedVersion = 0, DateOnly? EffectiveFrom = null);
public sealed record RecurringExpenseView(Guid Id, Guid LocationId, string Name,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Frequency, int DayOfMonth, DateOnly StartsOn, DateOnly? EndsOn, bool Active,
    int Version, DateOnly EffectiveFrom);
public sealed record RecurringExpenseRuleData(string Name, decimal Amount, string Frequency,
    int DayOfMonth, DateOnly StartsOn, DateOnly? EndsOn, bool Active, DateOnly EffectiveFrom);

public sealed class RecurringExpenseService(ISetupWorkspaceStore store, ICurrentUser user, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static int RequestedDay(RecurringExpenseWrite input) =>
        input.DayOfMonth == 0 ? input.StartsOn.Day : input.DayOfMonth;
    private Guid Owner()
    {
        if (user.UserId is not { } actor || actor == Guid.Empty)
            throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner))
            throw new FinanceException(403, "finance_owner_required");
        return actor;
    }
    private DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
    private static RecurringExpenseView View(SetupDocument document)
    {
        var value = document.Data.Deserialize<RecurringExpenseRuleData>(Json)!;
        return new(document.Id, document.LocationId, value.Name, value.Amount, value.Frequency,
            value.DayOfMonth, value.StartsOn, value.EndsOn, value.Active, document.Version, value.EffectiveFrom);
    }
    // Stable ID inside the existing SetupWorkspaceStore gives POST the same
    // transaction/unique-PK semantics as SaveAsync, without introducing a table.
    // Include actor and Location to keep independent clients/Owners isolated.
    public static Guid CreateId(Guid locationId, Guid actor, Guid idempotencyKey) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"finance-recurring-rule:{locationId:N}:{actor:N}:{idempotencyKey:N}")).AsSpan(0, 16));
    private static void Validate(RecurringExpenseWrite input)
    {
        if (input is null || input.LocationId == Guid.Empty || input.ExpectedVersion < 0 ||
            string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 200 ||
            input.Amount <= 0 || input.Amount >= 1_000_000_000_000_000_000m ||
            decimal.Truncate(input.Amount) != input.Amount ||
            input.Frequency is not ("MONTHLY" or "QUARTERLY" or "YEARLY") ||
            input.DayOfMonth is < 0 or > 31 ||
            input.StartsOn == default || input.StartsOn.Year < 2000 ||
            input.EndsOn is { } end && end < input.StartsOn ||
            input.EffectiveFrom is { } effective && effective < input.StartsOn)
            throw new FinanceException(400, "invalid_recurring_expense");
    }
    public async Task<IReadOnlyList<RecurringExpenseView>> ListAsync(Guid locationId, CancellationToken token)
    {
        _ = Owner();
        if (locationId == Guid.Empty) throw new FinanceException(400, "invalid_finance_filter");
        return (await store.ListAsync(locationId, "RecurringExpenseRule", token)).Select(View).ToArray();
    }
    public async Task<RecurringExpenseView> CreateAsync(RecurringExpenseWrite input, Guid idempotencyKey, CancellationToken token)
    {
        var actor = Owner(); Validate(input);
        if (idempotencyKey == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        if (input.ExpectedVersion != 0 || input.EffectiveFrom is { } date && date != input.StartsOn)
            throw new FinanceException(400, "invalid_recurring_expense");
        // A date and an independent recurrence day are contradictory. Accept
        // omitted dayOfMonth from new clients, or an explicitly matching value
        // from clients that still send the legacy property.
        if (RequestedDay(input) != input.StartsOn.Day)
            throw new FinanceException(400, "recurring_day_must_match_start");
        return await store.TransactionAsync(input.LocationId, async () =>
        {
            var data = new RecurringExpenseRuleData(input.Name.Trim(), input.Amount, input.Frequency,
                input.StartsOn.Day, input.StartsOn, input.EndsOn, input.Active, input.StartsOn);
            var id = CreateId(input.LocationId, actor, idempotencyKey);
            var existing = await store.GetAsync(id, "RecurringExpenseRule", token);
            if (existing is not null)
            {
                var original = (await store.HistoryAsync(id, "RecurringExpenseRule", token))
                    .OrderBy(revision => revision.Version).FirstOrDefault() ?? existing;
                var originalData = original.Data.Deserialize<RecurringExpenseRuleData>(Json);
                if (original.LocationId != input.LocationId || originalData != data)
                    throw new FinanceException(409, "idempotency_payload_mismatch");
                // If the same rule was later edited, return the existing identity
                // and latest state rather than creating another monthly charge.
                return View(existing);
            }
            return View(await store.SaveAsync(id, input.LocationId, "RecurringExpenseRule",
                input.Active ? "Active" : "Inactive", data, 0, actor, token));
        }, token);
    }
    public async Task<RecurringExpenseView> UpdateAsync(Guid id, RecurringExpenseWrite input, CancellationToken token)
    {
        var actor = Owner(); Validate(input);
        if (id == Guid.Empty || input.EffectiveFrom is null || input.EffectiveFrom < Today)
            throw new FinanceException(400, "recurring_effective_date_required");
        return await store.TransactionAsync(input.LocationId, async () =>
        {
            var previous = await store.GetAsync(id, "RecurringExpenseRule", token)
                ?? throw new FinanceException(404, "recurring_expense_not_found");
            var prior = View(previous);
            if (prior.LocationId != input.LocationId) throw new FinanceException(404, "recurring_expense_not_found");
            if (prior.Version != input.ExpectedVersion) throw new FinanceException(409, "recurring_expense_version_changed");
            if (input.StartsOn != prior.StartsOn || input.EffectiveFrom <= prior.EffectiveFrom)
                throw new FinanceException(409, "recurring_expense_history_immutable");
            // A historic rule might have startsOn=Jan 1, dayOfMonth=31. Do
            // not silently reschedule that existing obligation when editing
            // its price/name. New clients omit dayOfMonth; old clients may
            // echo the saved day or send the new startsOn-derived day.
            if (input.DayOfMonth != 0 && input.DayOfMonth != input.StartsOn.Day &&
                input.DayOfMonth != prior.DayOfMonth)
                throw new FinanceException(400, "recurring_day_must_match_start");
            var data = new RecurringExpenseRuleData(input.Name.Trim(), input.Amount, input.Frequency,
                prior.DayOfMonth, input.StartsOn, input.EndsOn, input.Active, input.EffectiveFrom.Value);
            return View(await store.SaveAsync(id, input.LocationId, "RecurringExpenseRule",
                input.Active ? "Active" : "Inactive", data, input.ExpectedVersion, actor, token));
        }, token);
    }
}
