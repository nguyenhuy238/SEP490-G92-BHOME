using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Ocr;

// HTTP-independent entry point. Repository queries also scope every lookup and re-read under locks.
public sealed class CaptureService(ICaptureRepository repository, ICurrentUser user)
{
    private Task<T> Allow<T>(string[] roles, Func<Task<T>> work)
    {
        if (user.UserId is null || !roles.Any(user.IsInRole)) throw new OcrAccessException();
        return work();
    }
    private static readonly string[] Operators = [Roles.Owner, Roles.Staff];
    public Task<IReadOnlyList<NamedResource>> ChainsAsync(CancellationToken t) => Allow([Roles.Owner], () => repository.ChainsAsync(t));
    public Task<IReadOnlyList<NamedResource>> LocationsAsync(CancellationToken t) => Allow(Operators, () => repository.LocationsAsync(t));
    public Task<IReadOnlyList<NamedResource>> RoomsAsync(Guid id, CancellationToken t) => Allow(Operators, () => repository.RoomsAsync(id, t));
    public Task<IReadOnlyList<NamedResource>> StaffAsync(CancellationToken t) => Allow([Roles.Owner], () => repository.StaffAsync(t));
    public Task<IdResult> CreateStaffAsync(StaffInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.CreateStaffAsync(x, t));
    public Task<IdResult> CreateChainAsync(ChainInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.CreateChainAsync(x, t));
    public Task<IdResult> CreateLocationAsync(LocationInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.CreateLocationAsync(x, t));
    public Task<IdResult> CreateRoomAsync(RoomInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.CreateRoomAsync(x, t));
    public Task<IdResult> AssignStaffAsync(AssignmentInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.AssignStaffAsync(x, t));
    public Task<IdResult> CreateResidentAsync(ResidentInput x, CancellationToken t) => Allow(Operators, () => repository.CreateResidentAsync(x, t));
    public Task<IReadOnlyList<ResidentSummary>> ResidentsAsync(Guid id, CancellationToken t) => Allow(Operators, () => repository.ResidentsAsync(id, t));
    public Task<IdentityConfirmationResult> ConfirmIdentityAsync(Guid id, IdentityConfirmation x, CancellationToken t)
        => Allow([Roles.Staff], () => { if (!x.HumanConfirmed) throw new CaptureValidationException("human_confirmation_required"); return repository.ConfirmIdentityAsync(id, x, t); });
    public Task<IdResult> CreateMeterAsync(MeterInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.CreateMeterAsync(x, t));
    public Task<IReadOnlyList<NamedResource>> MetersAsync(Guid id, CancellationToken t) => Allow(Operators, () => repository.MetersAsync(id, t));
    public Task<IdResult> CreateTaskAsync(MeterTaskInput x, CancellationToken t) => Allow([Roles.Owner], () => repository.CreateTaskAsync(x, t));
    public Task<IReadOnlyList<MeterTaskSummary>> TasksAsync(CancellationToken t) => Allow(Operators, () => repository.TasksAsync(t));
    public Task<IdResult> UploadEvidenceAsync(Guid id, Stream stream, CancellationToken t) => Allow([Roles.Staff], () => repository.UploadEvidenceAsync(id, stream, t));
    public Task<ConfirmedReading> ConfirmMeterAsync(Guid id, MeterConfirmation x, CancellationToken t)
        => Allow([Roles.Staff], () => { if (!x.HumanConfirmed) throw new CaptureValidationException("human_confirmation_required"); return repository.ConfirmMeterAsync(id, x, t); });
    public async Task CopyEvidenceAsync(Guid id, Stream stream, CancellationToken t)
    {
        await Allow(Operators, async () => { await repository.CopyEvidenceAsync(id, stream, t); return true; });
    }
}
