using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Billing;

public sealed record TenantMeterReading(Guid Id, Guid RoomId, string RoomNumber, string LocationName, string MeterCode,
    string UtilityType, string Purpose, DateOnly ReadingDate, DateOnly? BillingPeriod,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? PreviousValue,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal ConfirmedValue,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal? Consumption,
    DateTimeOffset ConfirmedAt, string Status);
public sealed record TenantMeterReadingPage(IReadOnlyList<TenantMeterReading> Items, int Page, int PageSize, int TotalCount);
public sealed record TenantReadingEvidence(string Key, string ContentType);
public interface ITenantMeterReadings
{
    Task<TenantMeterReadingPage> ListAsync(Guid actor, int page, int size, Guid? room, DateOnly? period, CancellationToken t);
    Task<bool> CanViewAsync(Guid actor, Guid id, CancellationToken t);
    Task<TenantReadingEvidence?> EvidenceAsync(Guid actor, Guid id, CancellationToken t);
}
public sealed class TenantMeterReadingService(ITenantMeterReadings store, ICurrentUser user, IObjectStorage storage)
{
    private Guid Actor => user.UserId is { } id && user.IsInRole(Roles.Tenant) ? id : throw new InvoiceException(403, "tenant_readings_required");
    public Task<TenantMeterReadingPage> ListAsync(int page, int pageSize, Guid? roomId, DateOnly? billingPeriod, CancellationToken t)
    {
        var actor = Actor;
        if (page < 1 || pageSize is < 1 or > 100 || page > int.MaxValue / pageSize || roomId == Guid.Empty ||
            billingPeriod is { Day: not 1 }) throw new InvoiceException(400, "invalid_meter_reading_pagination");
        return store.ListAsync(actor, page, pageSize, roomId, billingPeriod, t);
    }
    public async Task<string> CopyEvidenceAsync(Guid id, Stream output, CancellationToken t)
    {
        var evidence = await store.EvidenceAsync(Actor, id, t) ?? throw new InvoiceException(404, "meter_reading_not_found");
        await storage.CopyToAsync(evidence.Key, output, t); return evidence.ContentType;
    }
}
