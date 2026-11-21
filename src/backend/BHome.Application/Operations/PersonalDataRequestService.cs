using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

public sealed record PersonalDataRequestEvent(Guid ActorId, DateTimeOffset OccurredAt, string Status, string? Resolution, string? Basis);
public sealed record PersonalDataRequestView(Guid Id, Guid RequestedBy, string RequesterLabel, string RequestType,
    string Description, string Status, int Version, DateTimeOffset RequestedAt, IReadOnlyList<PersonalDataRequestEvent> History);
public sealed record PersonalDataRequestCreate(string RequestType, string Description);
public sealed record PersonalDataRequestDecision(int ExpectedVersion, string Status, string Resolution, string Basis);
public interface IPersonalDataRequestRepository
{
    Task<OperationsPage<PersonalDataRequestView>> ListAsync(Guid? userId, int page, int size, CancellationToken t);
    Task<PersonalDataRequestView> CreateAsync(Guid actor, Guid id, PersonalDataRequestCreate input, DateTimeOffset now, CancellationToken t);
    Task<PersonalDataRequestView> DecideAsync(Guid actor, Guid userId, Guid id, PersonalDataRequestDecision input, DateTimeOffset now, CancellationToken t);
}

public sealed class PersonalDataRequestService(IPersonalDataRequestRepository repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new OperationsException(401, "authentication_required");
    public Task<OperationsPage<PersonalDataRequestView>> ListAsync(int page, int size, CancellationToken t)
    {
        _ = Actor;
        if (page is < 1 or > 1000000 || size is < 1 or > 100) throw OperationsException.Invalid("invalid_pagination");
        if (!user.IsInRole(Roles.Owner) && !user.IsInRole(Roles.Tenant) && !user.IsInRole(Roles.Staff)) throw OperationsException.Forbidden();
        return repository.ListAsync(user.IsInRole(Roles.Owner) ? null : Actor, page, size, t);
    }
    public Task<PersonalDataRequestView> CreateAsync(Guid id, PersonalDataRequestCreate input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Tenant) && !user.IsInRole(Roles.Staff)) throw OperationsException.Forbidden();
        if (id == Guid.Empty || input.RequestType is not ("Access" or "Correction" or "Restriction" or "Deletion") ||
            string.IsNullOrWhiteSpace(input.Description) || input.Description.Length > 2000)
            throw OperationsException.Invalid("invalid_personal_data_request");
        return repository.CreateAsync(Actor, id, input with { Description = input.Description.Trim() }, clock.GetUtcNow(), t);
    }
    public Task<PersonalDataRequestView> DecideAsync(Guid userId, Guid id, PersonalDataRequestDecision input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden();
        if (userId == Guid.Empty || id == Guid.Empty || input.ExpectedVersion < 1 || input.Status is not ("InReview" or "Resolved" or "Rejected") ||
            string.IsNullOrWhiteSpace(input.Resolution) || input.Resolution.Length > 2000 || string.IsNullOrWhiteSpace(input.Basis) || input.Basis.Length > 2000)
            throw OperationsException.Invalid("personal_data_decision_basis_required");
        return repository.DecideAsync(Actor, userId, id, input with { Resolution = input.Resolution.Trim(), Basis = input.Basis.Trim() }, clock.GetUtcNow(), t);
    }
}
