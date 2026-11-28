using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BHome.Application.Contracts;

public sealed record HoldingSettingsInput([Required, StringLength(12000, MinimumLength = 1)] string Terms,
    [Range(0, int.MaxValue)] int ExpectedVersion);
public sealed record HoldingSettings(Guid OwnerUserId, int HoldingMonths,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal DepositRentMonths,
    string Terms, int Version, DateTimeOffset UpdatedAt, Guid UpdatedByUserId);
public sealed record HoldingPreparation(Guid RoomId, Guid LocationId, string RoomNumber, int SettingsVersion,
    int HoldingMonths, DateOnly StartDate, DateOnly EndDate, DateTimeOffset ExpiresAt,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal MonthlyRent,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal HoldingDeposit,
    string Terms);
public interface IHoldingSettingsData
{
    Task<HoldingSettings?> GetForOwnerAsync(Guid ownerUserId, CancellationToken t);
    Task<IReadOnlyList<HoldingSettings>> HistoryForOwnerAsync(Guid ownerUserId, CancellationToken t);
    Task<HoldingSettings?> GetForLocationAsync(Guid locationId, CancellationToken t);
    Task SetForOwnerAsync(Guid ownerUserId, HoldingSettingsInput input, Guid actor, DateTimeOffset now, CancellationToken t);
}
