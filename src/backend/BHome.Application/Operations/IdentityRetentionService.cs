using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

// No legal duration or start trigger has been approved. Defaults intentionally contain neither.
public sealed class IdentityRetentionOptions
{
    public string? ApprovedDecisionReference { get; set; }
    public int? RetentionDays { get; set; }
    public string? StartBasis { get; set; }
}
public sealed record IdentityRetentionPolicy(string? ApprovedDecisionReference, int? RetentionDays, string? StartBasis);
public sealed record IdentityRetentionEvent(Guid Id, string Action, Guid? HoldId, string Reason, Guid ActorId,
    DateTimeOffset At, Guid OperationKey, string Fingerprint, string SourceReference, IdentityRetentionPolicy Policy,
    string[] BlockingReasons);
public sealed record IdentityRetentionView(Guid ResidentId, string Reference, IdentityRetentionPolicy Policy,
    DateOnly? StartDate, DateOnly? ReviewAfter, string Status, bool CanDelete, string[] BlockingReasons,
    IdentityRetentionEvent[] ActiveHolds, IdentityRetentionEvent[] History);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record IdentityRetentionInput(string ExpectedReference, string Action, Guid? HoldId, string Reason, bool HumanConfirmed);
public interface IIdentityRetentionRepository
{
    Task<T> TransactionAsync<T>(Guid residentId, Func<Task<T>> work, CancellationToken token);
    Task<IdentityRetentionView> ContextAsync(Guid residentId, IdentityRetentionPolicy policy, DateOnly today, CancellationToken token);
    Task<IdentityRetentionEvent?> OperationAsync(Guid actor, Guid key, CancellationToken token);
    Task SaveAsync(Guid residentId, IdentityRetentionEvent entry, CancellationToken token);
}
public static class IdentityRetentionRules
{
    public static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    public static (DateOnly? Due, string[] Blockers) Evaluate(IdentityRetentionPolicy policy, DateOnly? start, DateOnly today, IEnumerable<string> obligations)
    {
        var blockers = obligations.ToList(); DateOnly? due = null;
        if (string.IsNullOrWhiteSpace(policy.ApprovedDecisionReference)) blockers.Add("retention_policy_unapproved");
        if (policy.RetentionDays is null or < 1) blockers.Add("retention_duration_unconfigured");
        if (policy.StartBasis is not ("LatestActualMoveOut" or "IdentityVerification")) blockers.Add("retention_start_policy_unconfigured");
        if (start is null) blockers.Add("retention_start_unavailable");
        else if (policy.RetentionDays is > 0 && policy.RetentionDays <= DateOnly.MaxValue.DayNumber - start.Value.DayNumber)
        { due = start.Value.AddDays(policy.RetentionDays.Value); if (today < due) blockers.Add("retention_period_not_elapsed"); }
        else if (policy.RetentionDays is > 0) blockers.Add("retention_period_not_elapsed");
        return (due, blockers.Distinct().Order(StringComparer.Ordinal).ToArray());
    }
}
public sealed class IdentityRetentionService(IIdentityRetentionRepository repository, ICurrentUser user,
    IdentityRetentionOptions options, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new OperationsException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden(); return id;
    }
    private IdentityRetentionPolicy Policy => new(options.ApprovedDecisionReference?.Trim(), options.RetentionDays, options.StartBasis?.Trim());
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
    public Task<IdentityRetentionView> GetAsync(Guid id, CancellationToken token)
    { _ = Owner(); return repository.ContextAsync(id, Policy, Today, token); }
    public Task<IdentityRetentionView> RecordAsync(Guid id, IdentityRetentionInput input, Guid key, CancellationToken token)
    {
        var actor = Owner();
        if (key == Guid.Empty || !input.HumanConfirmed || string.IsNullOrWhiteSpace(input.ExpectedReference) ||
            input.Action is not ("Review" or "PlaceHold" or "ReleaseHold") || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 1000 ||
            (input.Action == "ReleaseHold") != (input.HoldId is not null) || input.HoldId == Guid.Empty)
            throw OperationsException.Invalid("invalid_identity_retention_review");
        var normalized = input with { Reason = input.Reason.Trim() }; var fingerprint = IdentityRetentionRules.Hash(new { id, input = normalized });
        return repository.TransactionAsync(id, async () =>
        {
            if (await repository.OperationAsync(actor, key, token) is { } replay)
            {
                if (replay.Fingerprint != fingerprint) throw OperationsException.Conflict("identity_retention_key_conflict");
                return await repository.ContextAsync(id, Policy, Today, token);
            }
            var view = await repository.ContextAsync(id, Policy, Today, token);
            if (view.Reference != input.ExpectedReference) throw OperationsException.Conflict("identity_retention_review_changed");
            if (input.Action == "ReleaseHold" && !view.ActiveHolds.Any(h => h.Id == input.HoldId)) throw OperationsException.Conflict("identity_retention_hold_not_active");
            await repository.SaveAsync(id, new(Guid.NewGuid(), input.Action, input.HoldId, normalized.Reason, actor,
                clock.GetUtcNow(), key, fingerprint, view.Reference, view.Policy, view.BlockingReasons), token);
            return await repository.ContextAsync(id, Policy, Today, token);
        }, token);
    }
}
