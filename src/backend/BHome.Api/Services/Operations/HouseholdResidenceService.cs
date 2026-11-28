using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

public sealed partial class OperationsService
{
    public Task<ResidenceTrackingPage> ResidenceTrackingAsync(ResidenceTrackingQuery query, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Staff)) throw OperationsException.Forbidden();
        Validate(query); Page(query.Page, query.PageSize);
        if (query.LocationId == Guid.Empty || query.Filter is not ("All" or "Pending" or "AwaitingReview" or "Completed" or "Overdue"))
            throw OperationsException.Invalid("invalid_residence_filter");
        query.Search = string.IsNullOrWhiteSpace(query.Search) ? null : query.Search.Trim();
        return repository.ResidenceTrackingAsync(Actor, Today, query, t);
    }

    public async Task<ResidenceTaskView> ConfigureResidenceAsync(Guid contractId, Guid residentId,
        ResidenceTrackingSettings input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden();
        Validate(input);
        var current = await ResidenceAsync(contractId, residentId, t);
        if (string.IsNullOrWhiteSpace(input.Reason) || string.IsNullOrWhiteSpace(input.ExpectedReference) ||
            input.RegistrationExpiresOn < (current.ActualResidenceFrom ?? current.ResidenceFrom))
            throw OperationsException.Invalid("invalid_residence_state");
        return await repository.ConfigureResidenceAsync(Actor, contractId, residentId, input with { Reason = input.Reason.Trim() }, Now, t);
    }

    public async Task<ResidenceTaskView> UploadHouseholdResidenceEvidenceAsync(Guid contractId, Guid residentId,
        Guid[] residentIds, Stream input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Tenant)) throw OperationsException.Forbidden();
        if (residentIds.Length is < 1 or > 100 || !residentIds.Contains(residentId) || residentIds.Any(id => id == Guid.Empty) ||
            residentIds.Distinct().Count() != residentIds.Length) throw OperationsException.Invalid("invalid_residence_members");
        var targets = new List<ResidenceEvidenceTarget>();
        ResidenceTaskView? primary = null;
        foreach (var id in residentIds.Order())
        {
            var member = await repository.ResidenceAsync(contractId, id, Actor, t) ?? throw OperationsException.Missing();
            if (id == residentId) primary = member;
            targets.Add(new(id, member.Reference!));
        }
        var content = await ReadImageAsync(input, t);
        var type = files.ValidateImage(content);
        var scope = primary ?? throw OperationsException.Missing();
        var key = BHome.Application.Storage.PrivateImageKeys.Evidence(scope.LocationId, scope.RoomId,
            "residence-household", contractId, Guid.NewGuid());
        await files.PutAsync(key, content, type, t);
        try
        {
            var results = await repository.AttachHouseholdEvidenceAsync(Actor, contractId, targets.ToArray(), new(key, type, content.LongLength), Now, t);
            return results.Single(r => r.ResidentId == residentId);
        }
        catch
        {
            await files.DeleteAsync(key, CancellationToken.None);
            throw;
        }
    }
}
