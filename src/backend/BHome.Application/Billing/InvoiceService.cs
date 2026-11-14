using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.Billing;

public sealed class InvoiceService(IInvoiceRepository repository, ICurrentUser user, TimeProvider clock, IBillingAutomationSchedules? automation = null,
    IFixedChargeCoverage? fixedCoverage = null)
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
            s.RateDate = x.RateDate; s.RentSource = BillingRentSource.RepresentativeContract; s.PartialMonth = x.PartialMonth; s.Rounding = x.Rounding;
            s.DraftDay = x.DraftDay; s.DraftMonthOffset = x.DraftMonthOffset;
            s.FinalDay = x.FinalDay; s.FinalMonthOffset = x.FinalMonthOffset;
            s.DueDay = x.DueDay; s.DueMonthOffset = x.DueMonthOffset;
            repository.Audit(Actor, "BillingScheduleConfigured", s.Id, clock.GetUtcNow());
            return s;
        }, t);
    }

    public async Task<InvoiceView> GetAsync(Guid id, CancellationToken t) => View(await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found"));
    public async Task<PagedResult<InvoiceView>> ListAsync(int page, int pageSize, Guid? roomId, CancellationToken t, InvoiceListFilter? filter = null)
    {
        var scope = Scope;
        if (page < 1 || pageSize is < 1 or > 100 || page > int.MaxValue / pageSize || roomId == Guid.Empty)
            throw new InvoiceException(400, "invalid_invoice_pagination");
        if (filter is not null && (filter.LocationId == Guid.Empty ||
            filter.Status is { } status && !Enum.IsDefined(status) ||
            filter.BillingPeriod is { } period && (period.Day != 1 || period.Year is < 2000 or > 9997)))
            throw new InvoiceException(400, "invalid_invoice_filter");
        var result = await repository.ListAsync(scope, page, pageSize, roomId, t, filter);
        return new(result.Items.Select(View).ToArray(), page, pageSize, result.TotalCount);
    }
    public Task<InvoiceView> GenerateAsync(DraftInvoiceInput x, CancellationToken t, Guid? expectedAutomationPlanId = null)
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
            var plan = automation is null ? null : await automation.ForPeriodAsync(room.LocationId, x.BillingPeriod, t);
            if (expectedAutomationPlanId is { } expected)
            {
                if (plan?.Id != expected || !await automation!.AuthorizedAsync(plan, Actor, x.BillingPeriod, false, t)) throw new InvoiceException(409, "automation_authorization_changed");
                var selection = await automation.RepresentativeAsync(x.RoomId, x.BillingPeriod, t);
                var eligible = await repository.OccupanciesAsync(x.RoomId, x.BillingPeriod, x.BillingPeriod.AddMonths(1).AddDays(-1), t);
                if (selection is null && eligible.Count != 1 || selection is not null && selection.ContractId != x.RepresentativeContractId) throw new InvoiceException(409, "representative_selection_required");
            }
            var schedule = plan is null ? await repository.ScheduleAsync(room.LocationId, t) ?? throw new InvoiceException(409, "billing_schedule_required") : BillingAutomationService.Calendar(plan);
            if (Today < InvoiceMath.CalendarDate(x.BillingPeriod, schedule.DraftDay, schedule.DraftMonthOffset))
                throw new InvoiceException(409, "draft_date_not_reached");
            var invoice = new Invoice
            {
                RoomId = room.Id,
                LocationId = room.LocationId,
                RoomNumber = room.RoomNumber,
                LocationName = room.Location.Name,
                BillingPeriod = x.BillingPeriod,
                RepresentativeContractId = x.RepresentativeContractId,
                CreatedByUserId = Actor,
                AutomationPlanId = expectedAutomationPlanId,
                ScheduleSnapshot = JsonSerializer.Serialize(schedule),
                ScheduledFinalDate = InvoiceMath.CalendarDate(x.BillingPeriod, schedule.FinalDay, schedule.FinalMonthOffset),
                DueDate = InvoiceMath.CalendarDate(x.BillingPeriod, schedule.DueDay, schedule.DueMonthOffset)
            };
            await CalculateAsync(invoice, schedule, t); repository.Add(invoice);
            repository.Audit(Actor, "InvoiceDraftGenerated", invoice.Id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    private async Task ScheduledAuthority(Invoice invoice, Guid? expected, CancellationToken t)
    {
        if (expected is null) return;
        var plan = automation is null ? null : await automation.ForPeriodAsync(invoice.LocationId, invoice.BillingPeriod, t);
        if (plan?.Id != expected || !await automation!.AuthorizedAsync(plan, Actor, invoice.BillingPeriod, true, t)) throw new InvoiceException(409, "automation_authorization_changed");
        if (BillingAutomationService.CalendarKey(JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!) != BillingAutomationService.CalendarKey(BillingAutomationService.Calendar(plan))) throw new InvoiceException(409, "automation_calendar_conflict");
        if (await repository.HasPendingAdjustmentsAsync(invoice.Id, t)) throw new InvoiceException(409, "invoice_adjustment_pending");
    }
    private static IEnumerable<InvoiceLineView> Charges(Invoice i) => View(i).Lines.Select(line => line with { Id = Guid.Empty });
    public async Task<InvoiceView> RefreshAsync(Guid id, int version, CancellationToken t, Guid? expectedAutomationPlanId = null)
    {
        RequireOwner();
        var initial = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
        return await repository.WithRoomLockAsync(initial.RoomId, async () =>
        {
            var invoice = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
            if (invoice.Status != InvoiceStatus.Draft || invoice.Version != version) throw new InvoiceException(409, "invoice_changed_or_final");
            await ScheduledAuthority(invoice, expectedAutomationPlanId, t);
            if (expectedAutomationPlanId is not null)
            {
                if ((await repository.DraftCorrectionsAsync(id, t)).Count > 0) throw new InvoiceException(409, "approved_draft_requires_review");
                var check = new Invoice { RoomId = invoice.RoomId, LocationId = invoice.LocationId, BillingPeriod = invoice.BillingPeriod, RepresentativeContractId = invoice.RepresentativeContractId };
                await CalculateAsync(check, JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!, t, id);
                if (Charges(invoice).SequenceEqual(Charges(check)) && invoice.MissingInputs.Order().SequenceEqual(check.MissingInputs.Order()) && check.Recipients.All(r => invoice.Recipients.Any(old => old.TenantUserId == r.TenantUserId))) return View(invoice);
                repository.RemoveLines(invoice);
                foreach (var line in check.Lines) { line.InvoiceId = id; invoice.Lines.Add(line); repository.Add(line); }
                foreach (var recipient in check.Recipients.Where(r => invoice.Recipients.All(old => old.TenantUserId != r.TenantUserId))) invoice.Recipients.Add(new() { InvoiceId = id, TenantUserId = recipient.TenantUserId });
                invoice.Total = check.Total; invoice.MissingInputs = check.MissingInputs; invoice.Version++; repository.Audit(Actor, "InvoiceDraftScheduledRefresh", id, clock.GetUtcNow()); return View(invoice);
            }
            repository.RemoveLines(invoice);
            await CalculateAsync(invoice, JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!, t);
            foreach (var line in invoice.Lines) repository.Add(line);
            invoice.Version++; repository.Audit(Actor, "InvoiceDraftRefreshed", id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    public async Task<InvoiceView> FinalizeAsync(Guid id, int version, CancellationToken t, Guid? expectedAutomationPlanId = null)
    {
        RequireOwner();
        if (version < 1) throw new InvoiceException(400, "invalid_invoice_version");
        var initial = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
        return await repository.WithRoomLockAsync(initial.RoomId, async () =>
        {
            var invoice = await repository.FindAsync(id, Scope, t) ?? throw new InvoiceException(404, "invoice_not_found");
            // The Room/period business key and lock make repeated/concurrent finalization a single effect.
            if (invoice.Status == InvoiceStatus.Final) return View(invoice);
            await ScheduledAuthority(invoice, expectedAutomationPlanId, t);
            if (invoice.Version != version) throw new InvoiceException(409, "invoice_changed_or_final");
            if (Today < invoice.ScheduledFinalDate) throw new InvoiceException(409, "finalization_date_not_reached");
            var room = await repository.RoomAsync(invoice.RoomId, t) ?? throw new InvoiceException(404, "room_not_found");
            if (!room.Location.IsActive) throw new InvoiceException(409, "billing_location_inactive");
            var check = new Invoice
            {
                RoomId = invoice.RoomId,
                LocationId = invoice.LocationId,
                BillingPeriod = invoice.BillingPeriod,
                RepresentativeContractId = invoice.RepresentativeContractId
            };
            await CalculateAsync(check, JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!, t, invoice.Id);
            if (check.MissingInputs.Length > 0) throw new InvoiceException(409, "confirmed_billing_inputs_required");
            if (invoice.MissingInputs.Length > 0 || !Charges(invoice).SequenceEqual(Charges(check)) ||
                !invoice.Recipients.Select(r => r.TenantUserId).Order().SequenceEqual(check.Recipients.Select(r => r.TenantUserId).Order()))
                throw new InvoiceException(409, "draft_refresh_and_review_required");
            invoice.Status = InvoiceStatus.Final; invoice.Version++;
            var now = clock.GetUtcNow();
            invoice.FinalizedAt = now.AddTicks(-(now.Ticks % 10)); invoice.FinalizedByUserId = Actor;
            invoice.AutomationFinalizationPlanId = expectedAutomationPlanId;
            repository.Add(new InvoiceIssuedEvent { InvoiceId = id, OwnerUserId = Actor, AutomationPlanId = expectedAutomationPlanId, OccurredAt = invoice.FinalizedAt.Value });
            repository.Audit(Actor, "InvoiceFinalized", id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    private async Task CalculateAsync(Invoice invoice, BillingSchedule schedule, CancellationToken t, Guid? correctionsFor = null)
    {
        var start = invoice.BillingPeriod; var end = start.AddMonths(1).AddDays(-1);
        var occupants = await repository.OccupanciesAsync(invoice.RoomId, start, end, t);
        var representative = occupants.SingleOrDefault(o => o.Contract.Id == invoice.RepresentativeContractId)
            ?? throw new InvoiceException(409, "representative_contract_not_eligible");
        invoice.RepresentativeTenantUserId = representative.Contract.TenantUserId ?? throw new InvalidOperationException("Active contract requires a Tenant account.");
        var audience = occupants.SelectMany(o => o.TenantIds).Distinct().ToArray();
        foreach (var tenantId in audience.Where(tenantId => invoice.Recipients.All(r => r.TenantUserId != tenantId)))
            invoice.Recipients.Add(new InvoiceRecipient { InvoiceId = invoice.Id, TenantUserId = tenantId });
        var occupiedDays = Enumerable.Range(0, end.Day).Count(day => occupants.Any(o => o.Contract.StartDate <= start.AddDays(day) &&
            (o.Contract.ActualEndDate ?? o.Contract.EndDate) >= start.AddDays(day)));
        var people = PersonMonthOccupancy.Read(start, occupants.Select(o => o.Contract));
        var missing = new List<string>();
        if (occupants.Any(o => !o.ContactsComplete)) missing.Add("occupant_account_email_required");
        var charges = ContractBillingPrices.Read(representative.Contract, invoice.LocationId, missing);
        foreach (var occupancy in occupants.Where(o => o.Contract.Id != representative.Contract.Id))
        {
            var other = ContractBillingPrices.Read(occupancy.Contract, invoice.LocationId, missing);
            if (!ContractBillingPrices.Equivalent(charges, other)) missing.Add("room_contract_price_conflict");
        }
        foreach (var policy in charges)
        {
            BillingReading? reading = null;
            var metered = policy.Method == ChargingMethod.Metered;
            if (metered)
            {
                reading = await repository.ReadingAsync(invoice.RoomId, policy.Category == ChargeCategory.Electricity ? UtilityType.Electricity : UtilityType.Water, start, t);
                if (reading?.MissingInputs is { Count: > 0 }) { missing.AddRange(reading.MissingInputs); continue; }
                if (reading is null || (reading.BillableConsumption ?? reading.Reading.Consumption) is null) { missing.Add("confirmed_reading_" + policy.Category); continue; }
                // Do not charge another tenancy's usage or silently skip an intermediate month.
                if ((reading.BillablePrevious ?? reading.Reading.PreviousValue) is null) { missing.Add("baseline_" + policy.Category); continue; }
            }
            var perPerson = policy.Method == ChargingMethod.FixedPerPersonPerMonth;
            var quantity = metered ? (reading!.BillableConsumption ?? reading.Reading.Consumption)!.Value : perPerson ? people.ResidentCount : 1m;
            decimal amount;
            try { amount = perPerson ? 0 : InvoiceMath.Amount(policy.Rate, quantity, occupiedDays, end.Day, schedule.PartialMonth, schedule.Rounding, metered); }
            catch (Exception error) when (error is OverflowException or ArgumentOutOfRangeException) { throw new InvoiceException(400, "invoice_amount_out_of_range"); }
            UtilityCalculation? utility = null;
            if (metered && reading!.FullyCovered)
            {
                amount = 0;
                utility = new(0, JsonSerializer.Serialize(new { kind = "CoveredBySettlement/v1", coverage = reading.CoverageSnapshot }), []);
            }
            else if (metered)
            {
                if (reading!.AlreadyBilledQuantity > 0 && !UtilityIncrementCalculation.FlatPolicyMatches(reading.PreviousPricingSnapshot, policy.Id, policy.Version, policy.Rate, schedule.Rounding))
                    missing.Add("utility_increment_policy_changed");
                utility = new(amount, ContractBillingPrices.FlatSnapshot(policy, schedule, quantity, amount), []);
            }
            else if (!metered && (fixedCoverage is not null || perPerson))
            {
                if (perPerson && fixedCoverage is null) missing.Add("fixed_charge_coverage_unavailable");
                var prior = fixedCoverage is null ? [] : await fixedCoverage.ReadAsync(invoice.RoomId, start, policy.ChargeCode, t);
                if (prior.Count > 0 || perPerson)
                {
                    FixedChargeResult fixedResult;
                    try { fixedResult = FixedChargeCalculation.Calculate(start, policy, schedule, representative.Contract.SnapshotHash, occupiedDays, prior, people); }
                    catch (Exception error) when (error is OverflowException or ArgumentOutOfRangeException) { throw new InvoiceException(400, "invoice_amount_out_of_range"); }
                    missing.AddRange(fixedResult.MissingInputs);
                    amount = fixedResult.Amount ?? 0;
                    utility = new(amount, JsonSerializer.Serialize(new { kind = "FixedChargeCoverage/v1", source = fixedResult.Source }), fixedResult.MissingInputs);
                }
            }
            invoice.Lines.Add(new InvoiceLine
            {
                InvoiceId = invoice.Id,
                Category = policy.Category,
                ChargeCode = policy.ChargeCode,
                Name = policy.Name,
                PolicyId = policy.Id == Guid.Empty ? null : policy.Id,
                PolicyVersion = policy.Id == Guid.Empty ? null : policy.Version,
                RateDate = policy.EffectiveFrom,
                Rate = policy.Rate,
                Quantity = quantity,
                OccupiedDays = occupiedDays,
                PeriodDays = end.Day,
                Amount = amount,
                UtilityCalculationSnapshot = utility?.Snapshot,
                MeterReadingId = reading?.FullyCovered == true ? null : reading?.Reading.Id,
                PreviousReading = reading?.FullyCovered == true ? null : reading?.BillablePrevious ?? reading?.Reading.PreviousValue,
                ConfirmedReading = reading?.FullyCovered == true ? null : reading?.Reading.ConfirmedValue
            });
        }
        foreach (var correction in (await repository.DraftCorrectionsAsync(correctionsFor ?? invoice.Id, t)).GroupBy(d => d.ChargeCode).Select(g => g.OrderByDescending(d => d.Sequence).First()))
        {
            var line = invoice.Lines.SingleOrDefault(l => l.ChargeCode == correction.ChargeCode);
            if (line is null || AdjustmentRules.SourceFingerprint(line) != correction.SourceFingerprint)
            { missing.Add("draft_correction_source_changed"); continue; }
            line.CalculatedAmount = line.Amount; line.Amount = correction.CorrectedAmount!.Value; line.CorrectionRequestId = correction.RequestId;
        }
        invoice.MissingInputs = missing.Distinct().ToArray();
        invoice.Total = invoice.Lines.Sum(l => l.Amount);
        if (invoice.Total >= 1_000_000_000_000_000_000m) throw new InvoiceException(400, "invoice_amount_out_of_range");
        await repository.RecordPolicyUsageAsync(charges.Where(c => c.Id != Guid.Empty).Select(c => c.Id).Distinct().ToArray(), clock.GetUtcNow(), t);
    }

    internal static InvoiceView View(Invoice i) => new(i.Id, i.RoomId, i.LocationId, i.RoomNumber, i.LocationName,
        i.BillingPeriod, i.Status.ToString(), i.Version, i.Total, i.MissingInputs, i.ScheduledFinalDate, i.DueDate, i.FinalizedAt,
        i.RepresentativeTenantUserId, i.Lines.OrderBy(l => l.ChargeCode).Select(l => new InvoiceLineView(l.Id, l.Category.ToString(),
            l.ChargeCode, l.Name, l.PolicyId, l.PolicyVersion, l.RateDate, l.Rate, l.Quantity, l.OccupiedDays, l.PeriodDays,
            l.Amount, l.MeterReadingId, l.PreviousReading, l.ConfirmedReading, l.CalculatedAmount, l.CorrectionRequestId, l.UtilityCalculationSnapshot)).ToArray());
}
