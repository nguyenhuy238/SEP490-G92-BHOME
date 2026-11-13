using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Application.PropertyManagement;

public sealed record SharedDocument(Guid Id, string Resource, Guid FamilyId, int Edition, int Version,
    string Name, string Description, string Status, string ManagementScope, Guid CreatedBy,
    DateTimeOffset CreatedAt, Guid UpdatedBy, DateTimeOffset UpdatedAt,
    [property: JsonConverter(typeof(ExactSetupDataConverter))] JsonElement Data);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedWrite(string Name, string Description, [property: JsonRequired] JsonElement Data, int ExpectedVersion = 0);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedVersion(int ExpectedVersion);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedDuplicate(string Name, int ExpectedVersion);
public sealed record SharedPage(IReadOnlyList<SharedDocument> Items, long Total, int Page, int PageSize);
public interface ISharedConfigurationStore
{
    Task<T> TransactionAsync<T>(Guid[] locations, Func<Task<T>> work, CancellationToken t, bool validateActiveLocations = true);
    Task<SharedDocument?> GetAsync(Guid id, string resource, CancellationToken t);
    Task<SharedPage> ListAsync(string resource, string search, string status, int page, int pageSize, CancellationToken t);
    Task<IReadOnlyList<SharedDocument>> FamilyAsync(Guid family, string resource, CancellationToken t);
    Task<IReadOnlyList<SharedDocument>> HistoryAsync(Guid id, CancellationToken t);
    Task<bool> NameExistsAsync(string resource, string name, Guid family, CancellationToken t);
    Task SaveAsync(SharedDocument document, int expected, CancellationToken t);
    Task<IReadOnlyList<PolicyDto>> PoliciesAsync(Guid location, CancellationToken t);
    Task<IReadOnlyList<PolicyDto>> SetupCopyPoliciesAsync(Guid location, CancellationToken t);
    Task<SharedOperation?> OperationAsync(Guid actor, string kind, Guid key, CancellationToken t);
    Task<SharedUsage> ApplicationsAsync(Guid family, int page, int pageSize, CancellationToken t);
    Task<bool> HasApplicationAsync(Guid family, Guid location, CancellationToken t);
    Task<bool> LocationCodeExistsAsync(string code, Guid? exceptLocation, CancellationToken t);
    Task SaveOperationAsync(SharedOperation operation, CancellationToken t);
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SharedApply(Guid LocationId, int ExpectedVersion, string ConflictStrategy = "Reject", string TargetState = "", Guid? RoomId = null, bool IncludeOptionalItems = true);
public sealed record ConfigurationPlan(Guid SourceId, Guid TargetLocationId, string TargetState, bool CanProceed, string[] Changes, string[] Conflicts, string[] UnsupportedReferences);
public sealed record SharedOperation(Guid Id, string Kind, Guid Key, string Fingerprint, Guid ActorId, DateTimeOffset AppliedAt,
    Guid SourceId, Guid? SourceLocationId, Guid FamilyId, int SourceVersion, int SourceEdition, string Resource,
    Guid TargetLocationId, string Status, Guid[] CreatedReferences, ConfigurationSourceReference[]? SourceReferences = null,
    string? SourceState = null, string? TargetState = null);
public sealed record ConfigurationSourceReference(Guid Id, int Version, string Kind);
public sealed record SharedUsage(IReadOnlyList<SharedOperation> Items, long Total, long LocationsUsing, int Page, int PageSize);
