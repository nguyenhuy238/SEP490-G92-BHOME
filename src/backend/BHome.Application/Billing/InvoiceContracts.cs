using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Billing;

public sealed record BillingScheduleWrite([property: JsonRequired] Guid LocationId, [property: JsonRequired] BillingRateDate RateDate,
    [property: JsonRequired] BillingRentSource RentSource, [property: JsonRequired] PartialMonthRule PartialMonth,
    [property: JsonRequired] VndRounding Rounding, [property: JsonRequired] int DraftDay, [property: JsonRequired] int DraftMonthOffset,
    [property: JsonRequired] int FinalDay, [property: JsonRequired] int FinalMonthOffset,
    [property: JsonRequired] int DueDay, [property: JsonRequired] int DueMonthOffset, [property: JsonRequired] int ExpectedVersion);
public sealed record DraftInvoiceInput(Guid RoomId, DateOnly BillingPeriod, Guid RepresentativeContractId);
public sealed record InvoiceFinalizeInput([Range(1, int.MaxValue)] int ExpectedVersion);
public sealed record InvoiceLineView(Guid Id, string Category, string ChargeCode, string Name, Guid? PolicyId, int? PolicyVersion,
    DateOnly RateDate, [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Rate,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Quantity,
    int OccupiedDays, int PeriodDays,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    Guid? MeterReadingId,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PreviousReading,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? ConfirmedReading);
public sealed record InvoiceView(Guid Id, Guid RoomId, Guid LocationId, string RoomNumber, string LocationName,
    DateOnly BillingPeriod, string Status, int Version,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal Total,
    IReadOnlyList<string> MissingInputs, DateOnly ScheduledFinalDate, DateOnly DueDate, DateTimeOffset? FinalizedAt,
    Guid RepresentativeTenantUserId, IReadOnlyList<InvoiceLineView> Lines);
public sealed record InvoiceScope(Guid Actor, bool Owner, bool Tenant);
public sealed record BillingOccupancy(Contract Contract, IReadOnlyList<Guid> TenantIds);
public sealed record BillingReading(MeterReading Reading, DateOnly ReadingDate);
public sealed class InvoiceException(int status, string code) : Exception("Billing operation rejected.")
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
public interface IInvoiceRepository
{
    Task<BillingSchedule?> ScheduleAsync(Guid locationId, CancellationToken t);
    Task<T> WithRoomLockAsync<T>(Guid roomId, Func<Task<T>> action, CancellationToken t);
    Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> action, CancellationToken t);
    Task<Room?> RoomAsync(Guid roomId, CancellationToken t);
    Task<Invoice?> FindAsync(Guid id, InvoiceScope scope, CancellationToken t);
    Task<Invoice?> ForPeriodAsync(Guid roomId, DateOnly period, CancellationToken t);
    Task<PagedResult<Invoice>> ListAsync(InvoiceScope scope, int page, int pageSize, Guid? roomId, CancellationToken t);
    Task<IReadOnlyList<BillingOccupancy>> OccupanciesAsync(Guid roomId, DateOnly from, DateOnly to, CancellationToken t);
    Task<BillingReading?> ReadingAsync(Guid roomId, UtilityType type, DateOnly period, CancellationToken t);
    Task RecordPolicyUsageAsync(Guid[] ids, DateTimeOffset at, CancellationToken t);
    void Add(object entity);
    void Audit(Guid actor, string action, Guid invoiceId, DateTimeOffset at);
    void RemoveLines(Invoice invoice);
}
