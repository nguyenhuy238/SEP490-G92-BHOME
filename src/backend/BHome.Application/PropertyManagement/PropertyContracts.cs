using System.ComponentModel.DataAnnotations;
using System.Linq.Expressions;
using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public sealed class LocationQuery
{
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    [StringLength(200)] public string? Search { get; set; }
    public bool? IsActive { get; set; }
}

public sealed class PropertyQuery
{
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    public Guid? LocationId { get; set; }
    public Guid? RoomTypeId { get; set; }
    public Guid? RoomId { get; set; }
    [StringLength(200)] public string? Search { get; set; }
    public bool? IsActive { get; set; }
    public RoomStatus? RoomStatus { get; set; }
    public AssetStatus? AssetStatus { get; set; }
    public ChargeCategory? ChargeCategory { get; set; }
    public DateOnly? EffectiveOn { get; set; }
}

public sealed record ChainDto(Guid Id, string Name, int Version);
public sealed record ChainWrite([Required, StringLength(150)] string Name,
    [Range(1, int.MaxValue)] int Version, [StringLength(500)] string Reason = "");

public sealed record LocationWrite(
    [Required, StringLength(200, MinimumLength = 2)] string Name,
    [Required, StringLength(1000)] string Address, bool IsActive = true, int Version = 0,
    [StringLength(500)] string Reason = "");
public sealed record RoomTypeWrite(Guid LocationId, [Required, StringLength(100)] string Name,
    [StringLength(2000)] string? Description, [Range(1, 32767)] int DefaultCapacity,
    [Range(typeof(decimal), "0.01", "999999.99")] decimal? AreaM2,
    string[] Amenities, bool IsActive = true, int Version = 0, [StringLength(500)] string Reason = "");
public sealed record RoomWrite(Guid LocationId, Guid RoomTypeId,
    [Required, StringLength(50)] string RoomNumber, [StringLength(30)] string? Floor,
    [Range(1, 32767)] int Capacity, RoomStatus Status = RoomStatus.Available,
    int Version = 0, [StringLength(500)] string Reason = "");
public sealed record AssetWrite(Guid LocationId, Guid? RoomId, [StringLength(200)] string? CommonArea,
    [StringLength(80)] string? Code, [Required, StringLength(150)] string Name,
    [Required, StringLength(80)] string Category, [Required, StringLength(1000)] string Condition,
    AssetStatus Status = AssetStatus.Active, int Version = 0, [StringLength(500)] string Reason = "");
public sealed record PolicyWrite(Guid LocationId, Guid? RoomTypeId, Guid? RoomId,
    ChargeCategory Category, [Required, StringLength(80)] string ChargeCode,
    [Required, StringLength(150)] string Name, ChargingMethod Method,
    [property: System.Text.Json.Serialization.JsonRequired]
    [Range(typeof(decimal), "0", "99999999999999.9999")] decimal Rate,
    DateOnly EffectiveFrom, DateOnly? EffectiveTo, [StringLength(500)] string Reason = "");
public sealed record PolicyReplacement(PolicyWrite Policy, [Range(1, int.MaxValue)] int ExpectedVersion);
public sealed record PolicyUpdate(PolicyWrite Policy, [Range(1, int.MaxValue)] int ExpectedVersion);
public sealed record PolicyEnd(DateOnly EffectiveTo, [Range(1, int.MaxValue)] int Version,
    [Required, StringLength(500)] string Reason);

public sealed record LocationDto(Guid Id, Guid? ChainId, string Name, string Address, bool IsActive, int Version);
public sealed record RoomTypeDto(Guid Id, Guid LocationId, string Name, string? Description,
    int DefaultCapacity, decimal? AreaM2, string[] Amenities, bool IsActive, int Version);
public sealed record RoomDto(Guid Id, Guid LocationId, Guid? RoomTypeId, string RoomNumber,
    string? Floor, int Capacity, RoomStatus Status, int Version);
public sealed record AssetDto(Guid Id, Guid LocationId, Guid? RoomId, string? CommonArea,
    string? Code, string Name, string Category, string Condition, AssetStatus Status, int Version);
public sealed record PolicyDto(Guid Id, Guid LocationId, Guid? RoomTypeId, Guid? RoomId,
    ChargeCategory Category, string ChargeCode, string Name, ChargingMethod Method, decimal Rate,
    DateOnly EffectiveFrom, DateOnly? EffectiveTo, int Version, DateTimeOffset? FirstUsedAt = null);
public sealed record ResolvedPrices(Guid RoomId, DateOnly EffectiveOn, IReadOnlyList<PolicyDto> Charges,
    IReadOnlyList<string> MissingRequiredCharges);

public sealed class PropertyException(int status, string code) : Exception("Property operation rejected.")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public interface IPropertyRepository
{
    Task<Chain?> GetSystemChainAsync(CancellationToken token);
    Task<T?> FindAsync<T>(Guid id, CancellationToken token) where T : AuditableEntity;
    Task<bool> AnyAsync<T>(Expression<Func<T, bool>> predicate, CancellationToken token) where T : class;
    Task<PagedResult<TDto>> ListAsync<T, TDto>(Expression<Func<T, bool>> predicate,
        Expression<Func<T, TDto>> projection, PropertyQuery query, Guid? staffId, DateOnly today,
        CancellationToken token) where T : AuditableEntity;
    Task<IReadOnlyList<BillingPolicy>> ApplicablePoliciesAsync(Room room, DateOnly date, CancellationToken token);
    Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> operation, CancellationToken token);
    Task<bool> HasResidentsAsync(Guid roomId, CancellationToken token);
    void Add<T>(T entity) where T : class;
    void Audit(PropertyChange change);
}
