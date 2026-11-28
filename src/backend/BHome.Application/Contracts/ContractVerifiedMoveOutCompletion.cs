using System.Text.Json;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private async Task VerifyFinalMoveOutReadingsAsync(Contract contract, HandoverSnapshot observed,
        DateOnly endDate, CancellationToken token)
    {
        var readings = await repository.FinalReadingsAsync(contract.Id, contract.RoomId, endDate, token);
        foreach (var expected in new[] { observed.Electricity, observed.Water })
        {
            var reading = readings.SingleOrDefault(r => r.Id == expected.Id && r.UtilityType == expected.UtilityType &&
                r.Value == expected.Value && r.EvidenceId == expected.EvidenceId &&
                r.EvidenceHash == expected.EvidenceHash)
                ?? throw ContractException.Conflict("confirmed_final_readings_required");
            using var bytes = new MemoryStream();
            await storage.CopyToAsync(reading.EvidenceObjectKey, bytes, token);
            if (FileHash(bytes) != reading.EvidenceHash)
                throw ContractException.Conflict("inspection_evidence_integrity_failed");
        }
    }

    // A signed SePay settlement webhook is not by itself permission to vacate a
    // room. The Owner's *priced* proposal, the Tenant's immutable acceptance,
    // Staff's unchanged final inspection and today's fully paid ledger are all
    // mandatory. This path never executes for ordinary invoices or deposits.
    // No HTTP user identity is present on a webhook, so the authorizing Owner is
    // taken from that verified proposal, and the system action is audited.
    public async Task<bool> TryCompleteAfterVerifiedSettlementAsync(Guid contractId, Guid receivableId,
        CancellationToken token)
    {
        if (settlementRecords is null || contractId == Guid.Empty || receivableId == Guid.Empty)
            return false;

        var before = await repository.FindAsync(contractId, token);
        if (before is null) return false;
        if (before.Status == ContractStatus.Terminated)
            return (await repository.MoveOutAsync(contractId, token))?.Status == MoveOutStatus.Completed;
        if (before.Status != ContractStatus.Active) return false;

        return await repository.InTransactionAsync(before.RoomId, async () =>
        {
            var contract = await repository.FindAsync(contractId, token);
            var move = await repository.MoveOutAsync(contractId, token);
            if (contract?.Status == ContractStatus.Terminated && move?.Status == MoveOutStatus.Completed)
                return true;
            if (contract is null || contract.Status != ContractStatus.Active ||
                contract.Kind is not (ContractKind.Main or ContractKind.Renewal) ||
                move?.Status != MoveOutStatus.Inspected || move.InspectedAt is null ||
                move.ApprovedAt is null || move.ElectricityReadingId is null || move.WaterReadingId is null)
                return false;

            var source = await settlementRecords.ProposalSourceAsync(contractId, token);
            var proposal = await settlementRecords.LatestProposalAsync(contractId, token);
            if (proposal is null || proposal.ContractId != contractId ||
                proposal.OwnerUserId != contract.OwnerSignerId || !source.StaffInspectionReady ||
                source.Context.HasLegacyDeductions || source.Context.View.AvailableDeposit != 0 ||
                source.Context.View.Receivables.Any(r => r.Outstanding != 0) ||
                source.Context.View.Invoices?.Any(i => i.Outstanding != 0) == true)
                return false;

            var feedback = await settlementRecords.ProposalFeedbackAsync(contractId, proposal.Id, token);
            var settlement = feedback?.Settlement;
            var pinnedPhysical = string.IsNullOrWhiteSpace(proposal.PhysicalReference)
                ? feedback?.VerifiedPhysicalReference : proposal.PhysicalReference;
            if (feedback?.Confirmed != true || feedback.ContractId != contractId ||
                !proposal.RecipientUserIds.Contains(feedback.TenantUserId) ||
                settlement is null || !MoveOutProposalSettlementRules.IsQuotedPayable(settlement, receivableId) ||
                source.Context.View.Receivables.All(row => row.Charge.Id != receivableId) ||
                string.IsNullOrWhiteSpace(pinnedPhysical) || pinnedPhysical != source.PhysicalReference)
                return false;

            var inspection = (await repository.FinalInspectionsAsync(contractId, token)).FirstOrDefault();
            if (inspection is null || inspection.Id != proposal.InspectionId ||
                inspection.Version != proposal.InspectionVersion ||
                inspection.OwnerDecision is not (null or "Confirmed") ||
                inspection.StaffId != move.InspectedByUserId)
                return false;
            var observed = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
            var inspectionDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
                move.InspectedAt.Value, "Asia/Ho_Chi_Minh").DateTime);
            if (observed is null || observed.Date != inspectionDate || observed.Date < move.ProposedDate ||
                observed.Date > Today || observed.Electricity.Id != move.ElectricityReadingId ||
                observed.Water.Id != move.WaterReadingId)
                return false;

            // Preserve the same private evidence and exact reading-hash checks
            // as the manual Owner 'complete' operation. No QR/client assertion
            // can bypass this integrity gate.
            await VerifyFinalMoveOutReadingsAsync(contract, observed, observed.Date, token);

            if (handoverInventory is not null && inspection.OwnerDecision is null)
            {
                await handoverInventory.SynchronizeAfterVerifiedSettlementAsync(contract.RoomId, contractId,
                    inspection.Version, observed, proposal.OwnerUserId, token);
                await handoverInventory.MarkForReviewAfterVerifiedSettlementAsync(contract.RoomId, contractId,
                    inspection.Version, proposal.OwnerUserId, token);
            }

            var otherActive = await repository.HasOtherActiveContractsAsync(contract.RoomId, contractId, token);
            // Another Tenant must never be displaced. A room deliberately made
            // unavailable for maintenance stays unavailable, not bookable.
            var targetRoomStatus = otherActive ? RoomStatus.Occupied :
                contract.Room.Status == RoomStatus.Occupied ? RoomStatus.Available : contract.Room.Status;
            ChangeRoomStatus(contract, targetRoomStatus, RoomTransitionSource.ContractTermination,
                otherActive, proposal.OwnerUserId, "AutomaticMoveOutAfterVerifiedSePaySettlement");
            contract.Status = ContractStatus.Terminated;
            contract.ActualEndDate = observed.Date;
            move.Status = MoveOutStatus.Completed;
            move.PendingReason = "";
            move.SettlementDecision = "OwnerApprovedTenantAcceptedSePayVerified";
            move.SettlementApprovedByUserId = proposal.OwnerUserId;
            move.SettlementApprovedAt = clock.GetUtcNow();
            move.SettlementLedgerReference = source.Context.View.Reference;
            move.Version++;
            MoveOutEvent(move, "Completed", authorizedOwner: proposal.OwnerUserId);
            foreach (var resident in contract.Residents) resident.ResidenceTo = observed.Date;
            await repository.CloseResidenceAsync(contract, observed.Date, proposal.OwnerUserId,
                clock.GetUtcNow(), token);
            repository.AuditAnonymous("ContractMoveOutAutoCompletedAfterVerifiedPayment", contractId,
                clock.GetUtcNow());
            return true;
        }, token);
    }
}
