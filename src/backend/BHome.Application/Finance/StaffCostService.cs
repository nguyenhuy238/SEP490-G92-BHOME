using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record StaffCostLocation(Guid LocationId, string LocationName);
public sealed record StaffCostCandidate(Guid EmploymentId, Guid StaffId, string StaffName,
    DateOnly StartDate, DateOnly? EndDate, string? SalaryType, string? BaseRate,
    IReadOnlyList<StaffCostLocation> Locations, bool Recorded);
public sealed record StaffCostShare(Guid LocationId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount);
public sealed record StaffCostInput(Guid EmploymentId, DateOnly Period, string Category,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Total,
    StaffCostShare[] Shares, string Note);
public interface IStaffCostRepository
{
    Task<IReadOnlyList<StaffCostCandidate>> CandidatesAsync(DateOnly period, CancellationToken token);
    Task<IReadOnlyList<Guid>> RecordAsync(StaffCostInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token);
}
public sealed class StaffCostService(IStaffCostRepository repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        return id;
    }
    private void ValidatePeriod(DateOnly period)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
        if (period == default || period.Day != 1 || period > today || period.Year >= 9999)
            throw new FinanceException(400, "invalid_staff_cost_period");
    }
    public Task<IReadOnlyList<StaffCostCandidate>> CandidatesAsync(DateOnly period, CancellationToken token)
    {
        _ = Owner(); ValidatePeriod(period);
        return repository.CandidatesAsync(period, token);
    }
    public Task<IReadOnlyList<Guid>> RecordAsync(StaffCostInput input, Guid key, CancellationToken token)
    {
        var actor = Owner(); ValidatePeriod(input.Period);
        if (key == Guid.Empty || input.EmploymentId == Guid.Empty ||
            input.Category is not ("Lương" or "Thưởng" or "Phụ cấp" or "Chi phí nhân sự khác") ||
            input.Total <= 0 || input.Total >= 1_000_000_000_000_000_000m || decimal.Truncate(input.Total) != input.Total ||
            input.Shares is not { Length: > 0 and <= 100 } ||
            input.Shares.Any(s => s is null || s.LocationId == Guid.Empty || s.Amount <= 0 || s.Amount > input.Total || decimal.Truncate(s.Amount) != s.Amount) ||
            input.Shares.Select(s => s.LocationId).Distinct().Count() != input.Shares.Length ||
            input.Shares.Sum(s => s.Amount) != input.Total || string.IsNullOrWhiteSpace(input.Note) || input.Note.Length > 1000)
            throw new FinanceException(400, "invalid_staff_cost_allocation");
        return repository.RecordAsync(input, key, actor, clock.GetUtcNow(), token);
    }
}
