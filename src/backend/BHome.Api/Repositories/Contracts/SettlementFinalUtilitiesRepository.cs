using BHome.Application.Common;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal sealed partial class SettlementReceivablesRepository
{
    public async Task<FinalUtilityContext> FinalUtilityAsync(Guid id, UtilityType type, CancellationToken token)
    {
        var context = await ContextAsync(id, token);
        var inspection = await NativeSettlementReads.InspectionAsync(db, id, token);
        var snapshot = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        var observed = type == UtilityType.Electricity ? snapshot?.Electricity : snapshot?.Water;
        var effectiveDate = observed?.Date ?? clock.BusinessToday();
        var period = new DateOnly(effectiveDate.Year, effectiveDate.Month, 1);
        var missing = new List<string>(); BillableMeterPoint? final = null;
        var meterId = Guid.Empty; var confirmedAt = DateTimeOffset.MinValue;
        if (observed is null) missing.Add("final_meter_readings_required");
        else
        {
            var row = (await NativeSettlementReads.MeterProofsAsync(db, context.View.RoomId, [observed.Id], token))
                .Where(p => p.Task.ContractId == id && p.Task.Purpose == ReadingPurpose.Final && p.Task.ReadingDate == observed.Date && p.UtilityType == type)
                .Select(p => new { reading = p.Reading, p.Task.ReadingDate, p.Evidence.Id, p.Evidence.ImageHash, p.Evidence.Length }).SingleOrDefault();
            if (row is null || row.reading.ConfirmedValue != observed.Value || row.Id != observed.EvidenceId || row.ImageHash != observed.EvidenceHash)
                missing.Add("inspection_snapshot_invalid");
            else
            {
                meterId = row.reading.MeterId; confirmedAt = row.reading.ConfirmedAt;
                final = new(row.reading.Id, row.Id, row.ReadingDate, row.reading.ConfirmedValue, row.ImageHash, row.Length, "ConfirmedFinal", inspection!.Id);
            }
        }
        var position = final is null ? new MeterCoveragePosition(null, 0, null, false, []) :
            await MeterBillingCoverage.ReadAsync(db, context.View.RoomId, meterId, period, final, confirmedAt, token);
        missing.AddRange(position.MissingInputs);
        Guid[] liabilityContracts = [id];
        if (position.Baseline is { } liabilityStart && final is { } liabilityEnd && inspection is not null)
        {
            // Utility liability follows the measured interval. Someone who left
            // during that interval retains the historical Room entitlement; a new
            // arrival after the inspection must not inherit it.
            var roster = await (from member in db.Set<Native.ContractResident>().AsNoTracking()
                                join tenancy in db.Set<Native.Contract>() on member.ContractId equals tenancy.Id
                                join resident in db.Set<Native.Resident>() on member.ResidentId equals resident.Id
                                join account in db.Users on resident.UserId equals (Guid?)account.Id into accounts
                                from account in accounts.DefaultIfEmpty()
                                where tenancy.RoomId == context.View.RoomId && tenancy.ActivatedAt != null && tenancy.ActivatedAt <= inspection.InspectedAt &&
                                  tenancy.StartDate <= liabilityEnd.Date && (tenancy.ActualEndDate ?? tenancy.EndDate) >= liabilityStart.Date &&
                                  (tenancy.Status == (short)ContractStatus.Active || tenancy.Id == id || tenancy.Status == (short)ContractStatus.Superseded ||
                                    tenancy.Status == (short)ContractStatus.Terminated && tenancy.ActualEndDate >= liabilityStart.Date) &&
                                  member.ResidenceFrom <= liabilityEnd.Date && (member.ResidenceTo == null || member.ResidenceTo >= liabilityStart.Date)
                                select new { ContractId = tenancy.Id, TenantUserId = resident.UserId, Email = account == null ? null : account.Email }).ToArrayAsync(token);
            liabilityContracts = roster.Select(r => r.ContractId).Append(id).Distinct().ToArray();
            if (roster.Length == 0 || roster.Any(r => r.TenantUserId is null || string.IsNullOrWhiteSpace(r.Email) ||
                !new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(r.Email))) missing.Add("occupant_account_email_required");
            context = context with { RecipientUserIds = roster.Where(r => r.TenantUserId != null).Select(r => r.TenantUserId!.Value).Distinct().Order().ToArray() };
        }
        var invoice = await NativeSettlementReads.PeriodicInvoiceAsync(db, context.View.RoomId, period, token);
        var invoiceSchedule = invoice?.ScheduleSnapshot;
        BillingSchedule? schedule = null;
        if (!string.IsNullOrWhiteSpace(invoiceSchedule))
            try { schedule = JsonSerializer.Deserialize<BillingSchedule>(invoiceSchedule); } catch (JsonException) { missing.Add("billing_schedule_snapshot_invalid"); }
        else
        {
            var locationId = await LocationAsync(id, token);
            schedule = await new InvoiceRepository(db).ScheduleForPeriodAsync(locationId, period, token);
        }
        if (schedule is not null && (schedule.LocationId != await LocationAsync(id, token) || schedule.Version < 1 ||
            !Enum.IsDefined(schedule.RateDate) || !Enum.IsDefined(schedule.RentSource) || !Enum.IsDefined(schedule.PartialMonth) || !Enum.IsDefined(schedule.Rounding)))
        { missing.Add("billing_schedule_snapshot_invalid"); schedule = null; }
        var existing = context.View.Receivables.SingleOrDefault(r => r.Charge.Utility?.MeterId == meterId && r.Charge.Utility.Final.ReadingId == final?.ReadingId)?.Charge.Id;
        IReadOnlyList<PolicyDto>? charges = null;
        if (!position.FullyCovered)
        {
            var pricingContract = await NativeSettlementReads.ContractAsync(db, invoice == null ? id : invoice.RepresentativeContractId, token) ?? throw ContractException.Missing();
            var locationId = await LocationAsync(id, token);
            charges = ContractBillingPrices.Read(pricingContract, locationId, missing);
            var otherIds = liabilityContracts.Where(contractId => contractId != pricingContract.Id).ToArray();
            foreach (var otherId in otherIds)
            {
                var otherContract = await NativeSettlementReads.ContractAsync(db, otherId, token) ?? throw ContractException.Missing();
                var otherCharges = ContractBillingPrices.Read(otherContract, locationId, missing);
                if (!ContractBillingPrices.Equivalent(charges, otherCharges)) missing.Add("room_contract_price_conflict");
            }
        }
        return new(context, meterId, type, period, position.Baseline, final, position.AlreadyBilledQuantity, position.PreviousPricingSnapshot,
            schedule, existing, missing.Distinct().ToArray(), position.FullyCovered, charges);
    }
}
