using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed partial class SettlementReceivablesRepository
{
    public async Task<FinalFixedChargeContext> FinalFixedAsync(Guid id, CancellationToken token)
    {
        var context = await ContextAsync(id, token); var missing = new List<string>();
        var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).Include(c => c.Residents).SingleAsync(c => c.Id == id, token);
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == id).OrderByDescending(i => i.Version).FirstOrDefaultAsync(token);
        var snapshot = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        var end = snapshot?.Date ?? contract.ActualEndDate ?? contract.EndDate;
        var period = new DateOnly(end.Year, end.Month, 1); var through = period.AddMonths(1).AddDays(-1);
        var invoice = await db.Set<Invoice>().AsNoTracking().SingleOrDefaultAsync(i => i.RoomId == contract.RoomId && i.BillingPeriod == period, token);
        BillingSchedule? schedule = null;
        if (!string.IsNullOrWhiteSpace(invoice?.ScheduleSnapshot))
            try { schedule = JsonSerializer.Deserialize<BillingSchedule>(invoice.ScheduleSnapshot); } catch (JsonException) { missing.Add("billing_schedule_snapshot_invalid"); }
        else schedule = await db.Set<BillingSchedule>().AsNoTracking().SingleOrDefaultAsync(s => s.LocationId == contract.Room.LocationId, token);
        if (schedule is not null && (schedule.LocationId != contract.Room.LocationId || schedule.Version < 1 ||
            !Enum.IsDefined(schedule.RentSource) || !Enum.IsDefined(schedule.RateDate) || !Enum.IsDefined(schedule.PartialMonth) || !Enum.IsDefined(schedule.Rounding)))
        { schedule = null; missing.Add("billing_schedule_snapshot_invalid"); }
        var pricingContract = invoice?.RepresentativeContractId is { } representative ?
            await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).SingleAsync(c => c.Id == representative, token) : contract;
        if (string.IsNullOrWhiteSpace(pricingContract.SnapshotHash)) missing.Add("signed_contract_snapshot_required");
        var occupancies = await new InvoiceRepository(db).OccupanciesAsync(contract.RoomId, period, through, token);
        foreach (var occupancy in occupancies.Where(o => o.Contract.Id == id)) occupancy.Contract.ActualEndDate = end;
        // Do not invent a personal share of the Room rent while other tenancies
        // continue. Its ordinary Room invoice remains the source of that debt.
        if (occupancies.Any(o => o.Contract.Id != id && (o.Contract.ActualEndDate ?? o.Contract.EndDate) > end))
            missing.Add("room_billing_period_still_open");
        if (occupancies.Count == 0 || occupancies.Any(o => !o.ContactsComplete)) missing.Add("occupant_account_email_required");
        var occupiedDays = Enumerable.Range(0, through.Day).Count(day => occupancies.Any(o => o.Contract.StartDate <= period.AddDays(day) &&
            (o.Contract.ActualEndDate ?? o.Contract.EndDate) >= period.AddDays(day)));
        if (occupiedDays == 0) missing.Add("fixed_charge_occupancy_required");
        var recipients = occupancies.SelectMany(o => o.TenantIds).Distinct().Order().ToArray();
        var charges = ContractBillingPrices.Read(pricingContract, contract.Room.LocationId, missing);
        foreach (var occupancy in occupancies.Where(o => o.Contract.Id != pricingContract.Id))
        {
            var other = ContractBillingPrices.Read(occupancy.Contract, contract.Room.LocationId, missing);
            if (!ContractBillingPrices.Equivalent(charges, other)) missing.Add("room_contract_price_conflict");
        }
        return new(context, contract.Room.LocationId, period, end, schedule, pricingContract.MonthlyRent, pricingContract.SnapshotHash,
            occupiedDays, recipients, missing.Distinct().ToArray(), charges,
            PersonMonthOccupancy.Read(period, occupancies.Select(o => o.Contract)));
    }
}
