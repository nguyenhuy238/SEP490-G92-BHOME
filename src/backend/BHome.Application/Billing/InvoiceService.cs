using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.Billing;

public sealed class InvoiceService(IInvoiceRepository repository, PropertyService properties, ICurrentUser user, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new InvoiceException(401, "authentication_required");
    private bool Owner => user.IsInRole(Roles.Owner);
    private InvoiceScope Scope
    {
        get
        {
            var actor = Actor;
            if (!Owner && !user.IsInRole(Roles.Tenant)) throw new InvoiceException(403, "invoice_role_forbidden");
            return new(actor, Owner, user.IsInRole(Roles.Tenant));
        }
    }
    private void RequireOwner() { _ = Actor; if (!Owner) throw new InvoiceException(403, "invoice_owner_required"); }
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
    public async Task<BillingSchedule?> ScheduleAsync(Guid locationId, CancellationToken t)
    { RequireOwner(); return await repository.ScheduleAsync(locationId, t); }

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
    public Task<BillingSchedule> SaveScheduleAsync(BillingScheduleWrite x, CancellationToken t)
    {
        RequireOwner(); ValidateSchedule(x);
        return repository.WithLocationLockAsync(x.LocationId, async () =>
        {
            var s = await repository.ScheduleAsync(x.LocationId, t);
            if ((s?.Version ?? 0) != x.ExpectedVersion) throw new InvoiceException(409, "billing_schedule_changed");
            if (s is null) { s = new BillingSchedule { LocationId = x.LocationId }; repository.Add(s); }
            else s.Version++;
            s.RateDate = x.RateDate; s.RentSource = x.RentSource; s.PartialMonth = x.PartialMonth; s.Rounding = x.Rounding;
            s.DraftDay = x.DraftDay; s.DraftMonthOffset = x.DraftMonthOffset;
            s.FinalDay = x.FinalDay; s.FinalMonthOffset = x.FinalMonthOffset;
            s.DueDay = x.DueDay; s.DueMonthOffset = x.DueMonthOffset;
            repository.Audit(Actor, "BillingScheduleConfigured", s.Id, clock.GetUtcNow());
            return s;
        }, t);
    }

    public async Task<InvoiceView> GetAsync(Guid id, CancellationToken t) => View(await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found"));
    public async Task<PagedResult<InvoiceView>> ListAsync(int page, int pageSize, Guid? roomId, CancellationToken t)
    {
        var scope = Scope;
        if (page < 1 || pageSize is < 1 or > 100 || page > int.MaxValue / pageSize || roomId == Guid.Empty)
            throw new InvoiceException(400, "invalid_invoice_pagination");
        var result = await repository.ListAsync(scope, page, pageSize, roomId, t);
        return new(result.Items.Select(View).ToArray(), page, pageSize, result.TotalCount);
    }
    public Task<InvoiceView> GenerateAsync(DraftInvoiceInput x, CancellationToken t)
    {
        RequireOwner();
        if (x.RoomId == Guid.Empty || x.RepresentativeContractId == Guid.Empty || x.BillingPeriod == default ||
            x.BillingPeriod.Day != 1 || x.BillingPeriod.Year is < 2000 or > 9997) throw new InvoiceException(400, "invalid_invoice_period");
        return repository.WithRoomLockAsync(x.RoomId, async () =>
        {
            var existing = await repository.ForPeriodAsync(x.RoomId, x.BillingPeriod, t);
            if (existing is not null)
            {
                if (existing.RepresentativeContractId != x.RepresentativeContractId) throw new InvoiceException(409, "invoice_period_already_exists");
                return View(existing);
            }
            var room = await repository.RoomAsync(x.RoomId, t) ?? throw new InvoiceException(404, "room_not_found");
            if (!room.Location.IsActive) throw new InvoiceException(409, "billing_location_inactive");
            var schedule = await repository.ScheduleAsync(room.LocationId, t) ?? throw new InvoiceException(409, "billing_schedule_required");
            if (Today < InvoiceMath.CalendarDate(x.BillingPeriod, schedule.DraftDay, schedule.DraftMonthOffset))
                throw new InvoiceException(409, "draft_date_not_reached");
            var invoice = new Invoice { RoomId = room.Id, LocationId = room.LocationId, RoomNumber = room.RoomNumber,
                LocationName = room.Location.Name, BillingPeriod = x.BillingPeriod, RepresentativeContractId = x.RepresentativeContractId,
                CreatedByUserId = Actor, ScheduleSnapshot = JsonSerializer.Serialize(schedule),
                ScheduledFinalDate = InvoiceMath.CalendarDate(x.BillingPeriod, schedule.FinalDay, schedule.FinalMonthOffset),
                DueDate = InvoiceMath.CalendarDate(x.BillingPeriod, schedule.DueDay, schedule.DueMonthOffset) };
            await CalculateAsync(invoice, schedule, t); repository.Add(invoice);
            repository.Audit(Actor, "InvoiceDraftGenerated", invoice.Id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    public async Task<InvoiceView> RefreshAsync(Guid id, int version, CancellationToken t)
    {
        RequireOwner();
        var initial = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
        return await repository.WithRoomLockAsync(initial.RoomId, async () =>
        {
            var invoice = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
            if (invoice.Status != InvoiceStatus.Draft || invoice.Version != version) throw new InvoiceException(409, "invoice_changed_or_final");
            repository.RemoveLines(invoice);
            await CalculateAsync(invoice, JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!, t);
            foreach (var line in invoice.Lines) repository.Add(line);
            invoice.Version++; repository.Audit(Actor, "InvoiceDraftRefreshed", id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    public async Task<InvoiceView> FinalizeAsync(Guid id, int version, CancellationToken t)
    {
        RequireOwner();
        if (version < 1) throw new InvoiceException(400, "invalid_invoice_version");
        var initial = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
        return await repository.WithRoomLockAsync(initial.RoomId, async () =>
        {
            var invoice = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
            // The Room/period business key and lock make repeated/concurrent finalization a single effect.
            if (invoice.Status == InvoiceStatus.Final) return View(invoice);
            if (invoice.Version != version) throw new InvoiceException(409, "invoice_changed_or_final");
            if (Today < invoice.ScheduledFinalDate) throw new InvoiceException(409, "finalization_date_not_reached");
            var room = await repository.RoomAsync(invoice.RoomId, t) ?? throw new InvoiceException(404, "room_not_found");
            if (!room.Location.IsActive) throw new InvoiceException(409, "billing_location_inactive");
            var check = new Invoice { RoomId = invoice.RoomId, LocationId = invoice.LocationId,
                BillingPeriod = invoice.BillingPeriod, RepresentativeContractId = invoice.RepresentativeContractId };
            await CalculateAsync(check, JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!, t);
            if (check.MissingInputs.Length > 0) throw new InvoiceException(409, "confirmed_billing_inputs_required");
            static IEnumerable<InvoiceLineView> Charges(Invoice i) => View(i).Lines.Select(line => line with { Id = Guid.Empty });
            if (invoice.MissingInputs.Length > 0 || !Charges(invoice).SequenceEqual(Charges(check)) ||
                !invoice.Recipients.Select(r => r.TenantUserId).Order().SequenceEqual(check.Recipients.Select(r => r.TenantUserId).Order()))
                throw new InvoiceException(409, "draft_refresh_and_review_required");
            invoice.Status = InvoiceStatus.Final; invoice.Version++;
            invoice.FinalizedAt = clock.GetUtcNow(); invoice.FinalizedByUserId = Actor;
            repository.Audit(Actor, "InvoiceFinalized", id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    private async Task CalculateAsync(Invoice invoice, BillingSchedule schedule, CancellationToken t)
    {
        var start = invoice.BillingPeriod; var end = start.AddMonths(1).AddDays(-1);
        var occupants = await repository.OccupanciesAsync(invoice.RoomId, start, end, t);
        var representative = occupants.SingleOrDefault(o => o.Contract.Id == invoice.RepresentativeContractId)
            ?? throw new InvoiceException(409, "representative_contract_not_eligible");
        invoice.RepresentativeTenantUserId = representative.Contract.TenantUserId;
        var audience = occupants.SelectMany(o => o.TenantIds).Distinct().ToArray();
        foreach (var tenantId in audience.Where(tenantId => invoice.Recipients.All(r => r.TenantUserId != tenantId)))
            invoice.Recipients.Add(new InvoiceRecipient { InvoiceId = invoice.Id, TenantUserId = tenantId });
        var occupiedDays = Enumerable.Range(0, end.Day).Count(day => occupants.Any(o => o.Contract.StartDate <= start.AddDays(day) &&
            (o.Contract.ActualEndDate ?? o.Contract.EndDate) >= start.AddDays(day)));
        var rateDate = schedule.RateDate == BillingRateDate.PeriodStart ? start : end;
        var prices = await properties.ResolvePricesAsync(invoice.RoomId, rateDate, t);
        var missing = new List<string>();
        var used = new List<Guid>();
        foreach (var category in new[] { ChargeCategory.Rent, ChargeCategory.Electricity, ChargeCategory.Water })
            if (!(category == ChargeCategory.Rent && schedule.RentSource == BillingRentSource.RepresentativeContract) && !prices.Charges.Any(p => p.Category == category)) missing.Add("rate_" + category);
        var charges = prices.Charges.Where(p => p.Category != ChargeCategory.Rent || schedule.RentSource == BillingRentSource.RoomPolicy).ToList();
        if (schedule.RentSource == BillingRentSource.RepresentativeContract)
            charges.Add(new PolicyDto(Guid.Empty, invoice.LocationId, null, invoice.RoomId, ChargeCategory.Rent, "RENT", "Tiền thuê theo hợp đồng đại diện", ChargingMethod.FixedPerRoomPerMonth,
                representative.Contract.MonthlyRent, start, end, 0));
        foreach (var policy in charges)
        {
            BillingReading? reading = null;
            var metered = policy.Method == ChargingMethod.Metered;
            if (metered)
            {
                reading = await repository.ReadingAsync(invoice.RoomId, policy.Category == ChargeCategory.Electricity ? UtilityType.Electricity : UtilityType.Water, start, t);
                if (reading?.Reading.Consumption is null) { missing.Add("confirmed_reading_" + policy.Category); continue; }
                // Do not charge another tenancy's usage or silently skip an intermediate month.
                if (reading.Reading.PreviousValue is null) { missing.Add("baseline_" + policy.Category); continue; }
            }
            var quantity = metered ? reading!.Reading.Consumption!.Value : 1m;
            decimal amount;
            try { amount = InvoiceMath.Amount(policy.Rate, quantity, occupiedDays, end.Day, schedule.PartialMonth, schedule.Rounding, metered); }
            catch (Exception error) when (error is OverflowException or ArgumentOutOfRangeException) { throw new InvoiceException(400, "invoice_amount_out_of_range"); }
            invoice.Lines.Add(new InvoiceLine { InvoiceId = invoice.Id, Category = policy.Category, ChargeCode = policy.ChargeCode,
                Name = policy.Name, PolicyId = policy.Id == Guid.Empty ? null : policy.Id, PolicyVersion = policy.Id == Guid.Empty ? null : policy.Version,
                RateDate = rateDate, Rate = policy.Rate, Quantity = quantity, OccupiedDays = occupiedDays, PeriodDays = end.Day, Amount = amount,
                MeterReadingId = reading?.Reading.Id, PreviousReading = reading?.Reading.PreviousValue, ConfirmedReading = reading?.Reading.ConfirmedValue });
            if (policy.Id != Guid.Empty) used.Add(policy.Id);
        }
        invoice.MissingInputs = missing.Distinct().ToArray();
        invoice.Total = invoice.Lines.Sum(l => l.Amount);
        if (invoice.Total >= 1_000_000_000_000_000_000m) throw new InvoiceException(400, "invoice_amount_out_of_range");
        await repository.RecordPolicyUsageAsync(used.Distinct().ToArray(), clock.GetUtcNow(), t);
    }

    private static InvoiceView View(Invoice i) => new(i.Id, i.RoomId, i.LocationId, i.RoomNumber, i.LocationName,
        i.BillingPeriod, i.Status.ToString(), i.Version, i.Total, i.MissingInputs, i.ScheduledFinalDate, i.DueDate, i.FinalizedAt,
        i.RepresentativeTenantUserId, i.Lines.OrderBy(l => l.ChargeCode).Select(l => new InvoiceLineView(l.Id, l.Category.ToString(),
            l.ChargeCode, l.Name, l.PolicyId, l.PolicyVersion, l.RateDate, l.Rate, l.Quantity, l.OccupiedDays, l.PeriodDays,
            l.Amount, l.MeterReadingId, l.PreviousReading, l.ConfirmedReading)).ToArray());
}
