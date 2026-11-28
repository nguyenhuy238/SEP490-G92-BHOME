using BHome.Application.Common;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Billing;

public sealed class InvoiceService(IInvoiceRepository repository, ICurrentUser user, TimeProvider clock, IBillingAutomationSchedules? automation = null,
    IFixedChargeCoverage? fixedCoverage = null, IPaymentCodeRegistry? paymentCodes = null, SePayOptions? sepay = null)
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
    private DateOnly Today => clock.BusinessToday();
    public async Task<BillingSchedule?> ScheduleAsync(Guid locationId, CancellationToken t)
    { RequireOwner(); return await repository.ScheduleAsync(locationId, t); }

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
    public async Task<TenantInvoicePeriodView> CurrentTenantPeriodAsync(CancellationToken t)
    {
        var actor = Actor;
        if (!user.IsInRole(Roles.Tenant)) throw new InvoiceException(403, "invoice_role_forbidden");
        var today = Today;
        var period = new DateOnly(today.Year, today.Month, 1);
        var current = await repository.ListAsync(new(actor, false, true), 1, 1, null, t, new(BillingPeriod: period));
        if (current.TotalCount > 0) return new(period, today, true, []);
        var dates = new SortedSet<DateOnly>();
        foreach (var location in await repository.TenantBillingLocationIdsAsync(actor, t))
        {
            var schedule = await repository.ScheduleForPeriodAsync(location, period, t);
            if (schedule is not null)
                dates.Add(InvoiceMath.CalendarDate(period, schedule.DraftDay, schedule.DraftMonthOffset));
        }
        return new(period, today, false, dates.ToArray());
    }
    public Task<InvoiceView> GenerateAsync(DraftInvoiceInput x, CancellationToken t, Guid? expectedAutomationPlanId = null)
    {
        RequireOwner();
        if (x.RoomId == Guid.Empty || x.BillingPeriod == default ||
            x.BillingPeriod.Day != 1 || x.BillingPeriod.Year is < 2000 or > 9997) throw new InvoiceException(400, "invalid_invoice_period");
        return repository.WithRoomLockAsync(x.RoomId, async () =>
        {
            var existing = await repository.ForPeriodAsync(x.RoomId, x.BillingPeriod, t);
            if (existing is not null)
            {
                return View(existing);
            }
            var room = await repository.RoomAsync(x.RoomId, t) ?? throw new InvoiceException(404, "room_not_found");
            if (!room.Location.IsActive) throw new InvoiceException(409, "billing_location_inactive");
            var plan = automation is null ? null : await automation.ForPeriodAsync(room.LocationId, x.BillingPeriod, t);
            var eligible = await repository.OccupanciesAsync(x.RoomId, x.BillingPeriod, x.BillingPeriod.AddMonths(1).AddDays(-1), t);
            var reference = BillingReferenceContract.Select(eligible, x.BillingPeriod)
                ?? throw new InvoiceException(409, "no_reference_contract_for_period");
            if (expectedAutomationPlanId is { } expected)
            {
                if (plan?.Id != expected || !await automation!.AuthorizedAsync(plan, Actor, x.BillingPeriod, false, t)) throw new InvoiceException(409, "automation_authorization_changed");
            }
            var schedule = plan is null ? await repository.ScheduleForPeriodAsync(room.LocationId, x.BillingPeriod, t) ?? throw new InvoiceException(409, "billing_schedule_required") : BillingAutomationService.Calendar(plan);
            schedule.PartialMonth = PartialMonthRule.FullMonth;
            if (Today < InvoiceMath.CalendarDate(x.BillingPeriod, schedule.DraftDay, schedule.DraftMonthOffset))
                throw new InvoiceException(409, "draft_date_not_reached");
            var invoice = new Invoice
            {
                RoomId = room.Id,
                LocationId = room.LocationId,
                RoomNumber = room.RoomNumber,
                LocationName = room.Location.Name,
                BillingPeriod = x.BillingPeriod,
                RepresentativeContractId = reference.Contract.Id,
                CreatedByUserId = Actor,
                AutomationPlanId = expectedAutomationPlanId,
                ScheduleSnapshot = JsonSerializer.Serialize(schedule),
                ScheduledFinalDate = InvoiceMath.CalendarDate(x.BillingPeriod, schedule.FinalDay, schedule.FinalMonthOffset),
                DueDate = InvoiceMath.CalendarDate(x.BillingPeriod, schedule.DueDay, schedule.DueMonthOffset)
            };
            await InvoiceCalculator.CalculateAsync(repository, fixedCoverage, clock, invoice, schedule, t); repository.Add(invoice);
            repository.Audit(Actor, "InvoiceDraftGenerated", invoice.Id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    private async Task ScheduledAuthority(Invoice invoice, Guid? expected, CancellationToken t)
    {
        if (expected is null) return;
        var plan = automation is null ? null : await automation.ForPeriodAsync(invoice.LocationId, invoice.BillingPeriod, t);
        if (plan?.Id != expected || !await automation!.AuthorizedAsync(plan, Actor, invoice.BillingPeriod, true, t)) throw new InvoiceException(409, "automation_authorization_changed");
        var stored = JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!;
        var effective = BillingAutomationService.Calendar(plan);
        stored.PartialMonth = effective.PartialMonth = PartialMonthRule.FullMonth;
        if (BillingAutomationService.CalendarKey(stored) != BillingAutomationService.CalendarKey(effective)) throw new InvoiceException(409, "automation_calendar_conflict");
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
            var schedule = JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!;
            schedule.PartialMonth = PartialMonthRule.FullMonth;
            if (expectedAutomationPlanId is not null)
            {
                if (await repository.HasPendingAdjustmentsAsync(id, t)) throw new InvoiceException(409, "invoice_adjustment_pending");
                var check = new Invoice { RoomId = invoice.RoomId, LocationId = invoice.LocationId, BillingPeriod = invoice.BillingPeriod, RepresentativeContractId = invoice.RepresentativeContractId };
                await InvoiceCalculator.CalculateAsync(repository, fixedCoverage, clock, check, schedule, t, id);
                if (check.MissingInputs.Contains("draft_correction_source_changed")) throw new InvoiceException(409, "approved_draft_requires_review");
                if (invoice.RepresentativeContractId == check.RepresentativeContractId && Charges(invoice).SequenceEqual(Charges(check)) && invoice.MissingInputs.Order().SequenceEqual(check.MissingInputs.Order()) && check.Recipients.All(r => invoice.Recipients.Any(old => old.TenantUserId == r.TenantUserId))) return View(invoice);
                repository.RemoveLines(invoice);
                foreach (var line in check.Lines) { line.InvoiceId = id; invoice.Lines.Add(line); repository.Add(line); }
                foreach (var recipient in check.Recipients.Where(r => invoice.Recipients.All(old => old.TenantUserId != r.TenantUserId))) invoice.Recipients.Add(new() { InvoiceId = id, TenantUserId = recipient.TenantUserId });
                invoice.RepresentativeContractId = check.RepresentativeContractId;
                invoice.RepresentativeTenantUserId = check.RepresentativeTenantUserId;
                invoice.ScheduleSnapshot = JsonSerializer.Serialize(schedule);
                invoice.Total = check.Total; invoice.MissingInputs = check.MissingInputs; invoice.Version++; repository.Audit(Actor, "InvoiceDraftScheduledRefresh", id, clock.GetUtcNow()); return View(invoice);
            }
            repository.RemoveLines(invoice);
            await InvoiceCalculator.CalculateAsync(repository, fixedCoverage, clock, invoice, schedule, t);
            invoice.ScheduleSnapshot = JsonSerializer.Serialize(schedule);
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
            // Both Owner-initiated and delegated finalization must wait for an
            // explicit Owner decision on every pending Tenant adjustment.
            if (await repository.HasPendingAdjustmentsAsync(invoice.Id, t))
                throw new InvoiceException(409, "invoice_adjustment_pending");
            var room = await repository.RoomAsync(invoice.RoomId, t) ?? throw new InvoiceException(404, "room_not_found");
            if (!room.Location.IsActive) throw new InvoiceException(409, "billing_location_inactive");
            var check = new Invoice
            {
                RoomId = invoice.RoomId,
                LocationId = invoice.LocationId,
                BillingPeriod = invoice.BillingPeriod,
                RepresentativeContractId = invoice.RepresentativeContractId
            };
            await InvoiceCalculator.CalculateAsync(repository, fixedCoverage, clock, check, JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot)!, t, invoice.Id);
            if (check.MissingInputs.Length > 0) throw new InvoiceException(409, "confirmed_billing_inputs_required");
            if (invoice.RepresentativeContractId != check.RepresentativeContractId || invoice.MissingInputs.Length > 0 || !Charges(invoice).SequenceEqual(Charges(check)) ||
                !invoice.Recipients.Select(r => r.TenantUserId).Order().SequenceEqual(check.Recipients.Select(r => r.TenantUserId).Order()))
                throw new InvoiceException(409, "draft_refresh_and_review_required");
            // Publish only after a unique, persisted SePay payment memo has been issued.
            // This runs inside the same location/room transaction as Final, so a failed
            // registration cannot leave a publicly payable invoice with a legacy memo.
            if (paymentCodes is not null) await paymentCodes.FreezeAsync(invoice.Id, invoice.LocationId, t);
            if (sepay?.Enabled == true && (paymentCodes is null ||
                await paymentCodes.IssueAsync("Invoice", invoice.Id, invoice.LocationId, t) is null))
                throw new InvoiceException(409, "invoice_payment_code_unavailable");
            invoice.Status = InvoiceStatus.Final; invoice.Version++;
            var now = clock.BusinessUtcNow();
            invoice.FinalizedAt = now.AddTicks(-(now.Ticks % 10)); invoice.FinalizedByUserId = Actor;
            invoice.AutomationFinalizationPlanId = expectedAutomationPlanId;
            repository.Add(new InvoiceIssuedEvent { InvoiceId = id, OwnerUserId = Actor, AutomationPlanId = expectedAutomationPlanId, OccurredAt = invoice.FinalizedAt.Value });
            repository.Audit(Actor, "InvoiceFinalized", id, clock.GetUtcNow()); return View(invoice);
        }, t);
    }

    internal static InvoiceView View(Invoice i) => new(i.Id, i.RoomId, i.LocationId, i.RoomNumber, i.LocationName,
        i.BillingPeriod, i.Status.ToString(), i.Version, i.Total, i.MissingInputs, i.ScheduledFinalDate, i.DueDate, i.FinalizedAt,
        i.RepresentativeTenantUserId, i.Lines.OrderBy(l => l.ChargeCode).Select(l => new InvoiceLineView(l.Id, l.Category.ToString(),
            l.ChargeCode, l.Name, l.PolicyId, l.PolicyVersion, l.RateDate, l.Rate, l.Quantity, l.OccupiedDays, l.PeriodDays,
            l.Amount, l.MeterReadingId, l.PreviousReading, l.ConfirmedReading, l.CalculatedAmount, l.CorrectionRequestId, l.UtilityCalculationSnapshot)).ToArray(), i.Type);
}
