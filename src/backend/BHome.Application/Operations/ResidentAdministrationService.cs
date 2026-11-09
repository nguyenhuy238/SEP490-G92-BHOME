using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Operations;

public sealed class ResidentAdministrationQuery
{
    public Guid? LocationId { get; set; }
    public Guid? RoomId { get; set; }
    public string? Search { get; set; }
    public int? VerificationStatus { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}
public sealed record ResidentTenancy(Guid ContractId, string Status, string Role, DateOnly ResidenceFrom, DateOnly? ResidenceTo);
public sealed record ResidentAdministrationView(Guid Id, Guid LocationId, Guid RoomId, string RoomNumber,
    string DisplayLabel, string ResidentType, string VerificationStatus, DateTimeOffset? ConfirmedAt,
    Guid? TenantUserId, string? ContactEmail, string? ContactPhone, string Version,
    IReadOnlyList<ResidentTenancy> Tenancies);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ResidentLabelUpdate([Required, StringLength(150, MinimumLength = 1)] string DisplayLabel,
    [Required, StringLength(64, MinimumLength = 64)] string Version, [Required, StringLength(500)] string Reason);
public interface IResidentAdministrationRepository
{
    Task<OperationsPage<ResidentAdministrationView>> ListAsync(ResidentAdministrationQuery query, CancellationToken t);
    Task<ResidentAdministrationView?> GetAsync(Guid id, CancellationToken t);
    Task<ResidentAdministrationView> UpdateLabelAsync(Guid actor, Guid id, ResidentLabelUpdate input, DateTimeOffset now, CancellationToken t);
}
// Administration exposes workspace labels and linked-account contact details, never raw OCR identity.
public sealed class ResidentAdministrationService(IResidentAdministrationRepository repository, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new OperationsException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw OperationsException.Forbidden();
        return id;
    }
    public Task<OperationsPage<ResidentAdministrationView>> ListAsync(ResidentAdministrationQuery query, CancellationToken t)
    {
        _ = Owner();
        if (query.Page < 1 || query.PageSize is < 1 or > 100 || (long)(query.Page - 1) * query.PageSize > int.MaxValue ||
            query.LocationId == Guid.Empty || query.RoomId == Guid.Empty || query.Search?.Length > 200 || query.VerificationStatus is < 0 or > 2)
            throw OperationsException.Invalid("invalid_resident_query");
        return repository.ListAsync(query, t);
    }
    public async Task<ResidentAdministrationView> GetAsync(Guid id, CancellationToken t)
    {
        _ = Owner(); return await repository.GetAsync(id, t) ?? throw OperationsException.Missing();
    }
    public Task<ResidentAdministrationView> UpdateAsync(Guid id, ResidentLabelUpdate input, CancellationToken t)
    {
        var actor = Owner();
        if (string.IsNullOrWhiteSpace(input.DisplayLabel) || input.DisplayLabel.Trim().Length > 150 ||
            input.Version?.Length != 64 || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 500)
            throw OperationsException.Invalid("invalid_resident_label");
        return repository.UpdateLabelAsync(actor, id, input with { DisplayLabel = input.DisplayLabel.Trim(), Reason = input.Reason.Trim() }, clock.GetUtcNow(), t);
    }
}
