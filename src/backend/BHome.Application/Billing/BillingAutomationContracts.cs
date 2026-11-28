using System.Text.Json.Serialization;
using BHome.Domain.Billing;
namespace BHome.Application.Billing;

public sealed record BillingAutomationWrite([property: JsonRequired] Guid LocationId, [property: JsonRequired] DateOnly EffectiveFrom,
    [property: JsonRequired] bool Enabled, [property: JsonRequired] bool AuthorizeAutomaticFinalization,
    [property: JsonRequired] int MeterDay, [property: JsonRequired] int MeterDueDay, [property: JsonRequired] int MeterDueMonthOffset,
    [property: JsonRequired] string TimeZone, [property: JsonRequired] int ExpectedVersion, [property: JsonRequired] int ExpectedBillingScheduleVersion,
    int? DraftDay = null, int? DraftMonthOffset = null, int? FinalDay = null, int? FinalMonthOffset = null,
    int? DueDay = null, int? DueMonthOffset = null,
    BillingAutomationInitialSchedule? InitialSchedule = null);
// Required for first setup; on subsequent saves the supplied values are the
// Owner's desired calculation rules and are versioned only when changed.
public sealed record BillingAutomationInitialSchedule(BillingRateDate RateDate, PartialMonthRule PartialMonth, VndRounding Rounding);
public sealed record LocationBillingScheduleWrite(
    [property: JsonRequired] int MeterDay, [property: JsonRequired] int MeterDueDay, [property: JsonRequired] int MeterDueMonthOffset,
    [property: JsonRequired] int DraftDay, [property: JsonRequired] int DraftMonthOffset,
    [property: JsonRequired] int FinalDay, [property: JsonRequired] int FinalMonthOffset,
    [property: JsonRequired] int DueDay, [property: JsonRequired] int DueMonthOffset,
    [property: JsonRequired] int ExpectedVersion, [property: JsonRequired] int ExpectedBillingScheduleVersion);
public interface IBillingAutomationSchedules
{
    Task<BillingAutomationPlan?> ForPeriodAsync(Guid locationId, DateOnly period, CancellationToken t);
    Task<IReadOnlyList<BillingAutomationPlan>> HistoryAsync(Guid locationId, CancellationToken t);
    Task<BillingAutomationPlan> SaveAsync(BillingAutomationWrite input, Guid actor, DateTimeOffset now, CancellationToken t);
    Task<bool> AuthorizedAsync(BillingAutomationPlan plan, Guid actor, DateOnly period, bool finalization, CancellationToken t);
    Task<BillingRepresentativeSelection?> RepresentativeAsync(Guid room, DateOnly period, CancellationToken t);
    Task<BillingRepresentativeSelection> SelectRepresentativeAsync(BillingRepresentativeInput input, Guid actor, DateTimeOffset now, CancellationToken t);
}
public sealed record BillingRepresentativeInput(Guid RoomId, DateOnly BillingPeriod, Guid ContractId, int ExpectedVersion);
