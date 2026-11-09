using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Application.PropertyManagement;

public sealed record SharedDocument(Guid Id, string Resource, Guid FamilyId, int Edition, int Version,
    string Name, string Description, string Status, string ManagementScope, Guid CreatedBy,
    DateTimeOffset CreatedAt, Guid UpdatedBy, DateTimeOffset UpdatedAt,
    [property: JsonConverter(typeof(ExactSetupDataConverter))] JsonElement Data);
public sealed record SharedWrite(string Name, string Description, JsonElement Data, int ExpectedVersion = 0);
public sealed record SharedVersion(int ExpectedVersion);
public sealed record SharedDuplicate(string Name, int ExpectedVersion);
public sealed record SharedPage(IReadOnlyList<SharedDocument> Items, long Total, int Page, int PageSize);
public interface ISharedConfigurationStore
{
    Task<T> TransactionAsync<T>(Guid[] locations, Func<Task<T>> work, CancellationToken t);
    Task<SharedDocument?> GetAsync(Guid id, string resource, CancellationToken t);
    Task<SharedPage> ListAsync(string resource, string search, string status, int page, int pageSize, CancellationToken t);
    Task<IReadOnlyList<SharedDocument>> FamilyAsync(Guid family, string resource, CancellationToken t);
    Task<IReadOnlyList<SharedDocument>> HistoryAsync(Guid id, CancellationToken t);
    Task<bool> NameExistsAsync(string resource, string name, Guid family, CancellationToken t);
    Task SaveAsync(SharedDocument document, int expected, CancellationToken t);
}
