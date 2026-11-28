using System.Text.Json.Serialization;
using BHome.Application.Billing;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BHome.IntegrationTests;

// Historical calendar writer: test-only, not discoverable in production API.
[ApiController, Route("test-probe/billing-schedules"), Authorize(Roles = Roles.Owner)]
public sealed class LegacyBillingScheduleFixtureController(IInvoiceRepository repository, ICurrentUser user, TimeProvider clock) : ControllerBase
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new InvoiceException(401, "authentication_required");
    private void RequireOwner() { _ = Actor; if (!user.IsInRole(Roles.Owner)) throw new InvoiceException(403, "invoice_owner_required"); }
    private static void ValidateSchedule(BillingScheduleWrite x)
    {
        if (x.LocationId == Guid.Empty || x.ExpectedVersion < 0 || !Enum.IsDefined(x.RateDate) || !Enum.IsDefined(x.RentSource) ||
            !Enum.IsDefined(x.PartialMonth) || !Enum.IsDefined(x.Rounding)) throw new InvoiceException(400, "invalid_billing_schedule");
        try
        {
            // Check both short and long months; day 29–31 clamps to the month's last day.
            foreach (var period in new[] { new DateOnly(2027, 2, 1), new DateOnly(2028, 2, 1), new DateOnly(2026, 12, 1) })
                if (InvoiceMath.CalendarDate(period, x.DraftDay, x.DraftMonthOffset) > InvoiceMath.CalendarDate(period, x.FinalDay, x.FinalMonthOffset) ||
                    InvoiceMath.CalendarDate(period, x.FinalDay, x.FinalMonthOffset) > InvoiceMath.CalendarDate(period, x.DueDay, x.DueMonthOffset))
                    throw new InvoiceException(400, "invalid_billing_calendar_order");
        }
        catch (ArgumentOutOfRangeException) { throw new InvoiceException(400, "invalid_billing_schedule"); }
    }
    [HttpPut]
    public Task<BillingSchedule> SaveScheduleAsync(BillingScheduleWrite x, CancellationToken t)
    {
        RequireOwner(); ValidateSchedule(x);
        return repository.WithLocationLockAsync(x.LocationId, async () =>
        {
            var s = await repository.ScheduleAsync(x.LocationId, t);
            if ((s?.Version ?? 0) != x.ExpectedVersion) throw new InvoiceException(409, "billing_schedule_changed");
            if (s is null) { s = new BillingSchedule { LocationId = x.LocationId }; repository.Add(s); }
            else s.Version++;
            s.RateDate = x.RateDate; s.RentSource = BillingRentSource.RepresentativeContract; s.PartialMonth = x.PartialMonth; s.Rounding = x.Rounding;
            s.DraftDay = x.DraftDay; s.DraftMonthOffset = x.DraftMonthOffset;
            s.FinalDay = x.FinalDay; s.FinalMonthOffset = x.FinalMonthOffset;
            s.DueDay = x.DueDay; s.DueMonthOffset = x.DueMonthOffset;
            repository.Audit(Actor, "BillingScheduleConfigured", s.Id, clock.GetUtcNow());
            return s;
        }, t);
    }

}

public sealed record BillingScheduleWrite([property: JsonRequired] Guid LocationId, [property: JsonRequired] BillingRateDate RateDate,
    [property: JsonRequired] BillingRentSource RentSource, [property: JsonRequired] PartialMonthRule PartialMonth,
    [property: JsonRequired] VndRounding Rounding, [property: JsonRequired] int DraftDay, [property: JsonRequired] int DraftMonthOffset,
    [property: JsonRequired] int FinalDay, [property: JsonRequired] int FinalMonthOffset,
    [property: JsonRequired] int DueDay, [property: JsonRequired] int DueMonthOffset, [property: JsonRequired] int ExpectedVersion);
