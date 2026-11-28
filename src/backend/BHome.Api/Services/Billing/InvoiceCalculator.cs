using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.Billing;

// Builds the monthly charge lines inside the room transaction owned by InvoiceService.
// Pure formulas remain in InvoiceMath and FixedChargeCalculation.
internal static class InvoiceCalculator
{
    internal static async Task CalculateAsync(IInvoiceRepository repository, IFixedChargeCoverage? fixedCoverage, TimeProvider clock,
        Invoice invoice, BillingSchedule schedule, CancellationToken t, Guid? correctionsFor = null)
    {
        var start = invoice.BillingPeriod; var end = start.AddMonths(1).AddDays(-1);
        var occupants = await repository.OccupanciesAsync(invoice.RoomId, start, end, t);
        var representative = BillingReferenceContract.Select(occupants, start)
            ?? throw new InvoiceException(409, "no_reference_contract_for_period");
        invoice.RepresentativeContractId = representative.Contract.Id;
        schedule.PartialMonth = PartialMonthRule.FullMonth;
        invoice.RepresentativeTenantUserId = representative.Contract.TenantUserId ?? throw new InvalidOperationException("Active contract requires a Tenant account.");
        var audience = occupants.SelectMany(o => o.TenantIds).Distinct().ToArray();
        foreach (var tenantId in audience.Where(tenantId => invoice.Recipients.All(r => r.TenantUserId != tenantId)))
            invoice.Recipients.Add(new InvoiceRecipient { InvoiceId = invoice.Id, TenantUserId = tenantId });
        var occupiedDays = end.Day;
        var room = await repository.RoomAsync(invoice.RoomId, t) ?? throw new InvoiceException(404, "room_not_found");
        var people = PersonMonthOccupancy.ForRoomCapacity(room.Capacity, occupiedDays);
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
            var chargePeriod = policy.Category == ChargeCategory.Rent ? start.AddMonths(1) : start;
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
                var prior = fixedCoverage is null ? [] : await fixedCoverage.ReadAsync(invoice.RoomId, chargePeriod, policy.ChargeCode, t);
                if (prior.Count > 0 || perPerson || policy.Category == ChargeCategory.Rent)
                {
                    FixedChargeResult fixedResult;
                    try { fixedResult = FixedChargeCalculation.Calculate(chargePeriod, policy, schedule, representative.Contract.SnapshotHashOrEmpty, DateTime.DaysInMonth(chargePeriod.Year, chargePeriod.Month), prior, people); }
                    catch (Exception error) when (error is OverflowException or ArgumentOutOfRangeException) { throw new InvoiceException(400, "invoice_amount_out_of_range"); }
                    missing.AddRange(fixedResult.MissingInputs);
                    amount = fixedResult.Amount ?? 0;
                    utility = new(amount, JsonSerializer.Serialize(new { kind = "FixedChargeCoverage/v1", source = fixedResult.Source }), fixedResult.MissingInputs);
                }
            }
            invoice.Lines.Add(new InvoiceItem
            {
                InvoiceId = invoice.Id,
                Category = policy.Category,
                ChargeCode = policy.ChargeCode,
                Name = policy.Category == ChargeCategory.Rent ? $"Tiền thuê tháng {chargePeriod:MM/yyyy}" : policy.Name,
                PolicyId = policy.Id == Guid.Empty ? null : policy.Id,
                PolicyVersion = policy.Id == Guid.Empty ? null : policy.Version,
                RateDate = policy.EffectiveFrom,
                Rate = policy.Rate,
                Quantity = quantity,
                OccupiedDays = DateTime.DaysInMonth(chargePeriod.Year, chargePeriod.Month),
                PeriodDays = DateTime.DaysInMonth(chargePeriod.Year, chargePeriod.Month),
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
}
