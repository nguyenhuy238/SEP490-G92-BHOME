using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BHome.Application.Contracts;

public sealed record HoldingSettingsInput([Range(1, 120)] int HoldingMonths,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal DepositRentMonths,
    [Required, StringLength(12000)] string Terms, [Range(0, int.MaxValue)] int ExpectedVersion);
public sealed record HoldingSettings(Guid LocationId, int HoldingMonths,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal DepositRentMonths,
    string Terms, int Version);
public sealed record HoldingPreparation(Guid RoomId, Guid LocationId, string RoomNumber, int SettingsVersion,
    int HoldingMonths, DateOnly StartDate, DateOnly EndDate, DateTimeOffset ExpiresAt,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal MonthlyRent,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal HoldingDeposit,
    string Terms);
public interface IHoldingSettingsData
{
    Task<HoldingSettings?> GetAsync(Guid locationId, CancellationToken t);
    Task SetAsync(Guid locationId, HoldingSettingsInput input, Guid actor, DateTimeOffset now, CancellationToken t);
}
