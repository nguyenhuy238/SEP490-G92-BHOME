using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed partial class SettlementReceivablesRepository
{
    public async Task<MoveOutChargeProposalSource> ProposalSourceAsync(Guid id, CancellationToken token)
    {
        var context = await ContextAsync(id, token);
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking()
            .Where(i => i.ContractId == id).OrderByDescending(i => i.Version).FirstOrDefaultAsync(token);
        var move = await db.Set<ContractMoveOut>().AsNoTracking()
            .SingleOrDefaultAsync(m => m.ContractId == id, token);
        // Staff's successful final submission atomically moves the request to
        // Inspected and persists the matching inspection. An Owner review is
        // a separate financial gate and is NOT required to send a proposal.
        var staffInspectionReady = inspection is not null && move is
        {
            Status: MoveOutStatus.Inspected,
            InspectedAt: not null,
            InspectedByUserId: not null
        } && inspection.StaffId == move.InspectedByUserId &&
            inspection.InspectedAt >= move.InspectedAt;
        var baseline = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.BaselineSnapshot);
        var observed = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        // The comparison snapshot may include later accepted asset changes. Photos
        // labeled as Move-In must instead come from the actual confirmed Move-In
        // handover, never a fabricated or unverified opening attachment.
        var openingHandover = baseline is null ? null : await db.Set<ContractHandover>().AsNoTracking()
            .SingleOrDefaultAsync(h => h.ContractId == inspection!.BaselineContractId &&
                h.Status == ContractHandoverStatus.Confirmed, token);
        var openingPhotos = openingHandover is null ? null :
            JsonSerializer.Deserialize<HandoverSnapshot>(openingHandover.Snapshot);
        var existing = context.View.Receivables.Select(row => row.Charge.SourceKey).ToHashSet(StringComparer.Ordinal);
        // A proposal is a request for Tenant review. The Owner may explicitly
        // price any inspected item with a written reason, even when the opening
        // baseline is missing or Staff marked it good. No liability is inferred
        // from the comparison and no ledger entry is created at this stage.
        var available = staffInspectionReady && !context.HasLegacyDeductions;
        var items = new List<MoveOutChargeProposalItem>();
        var openingAssets = (baseline?.Assets ?? []).ToDictionary(asset => asset.Id);
        var moveInAssets = (openingPhotos?.Assets ?? []).ToDictionary(asset => asset.Id);

        foreach (var asset in observed?.Assets ?? [])
        {
            var opening = openingAssets.GetValueOrDefault(asset.Id);
            // Individual physical-item photos are attached to this asset group
            // and are valid private evidence for its proposal/Owner review.
            var proofs = (asset.EvidenceIds ?? [])
                .Concat((observed?.PhysicalItemEvidence ?? [])
                    .Where(item => item.AssetId == asset.Id).SelectMany(item => item.EvidenceIds))
                .Distinct().ToArray();
            items.Add(new("Asset", asset.Id, null, null, asset.Name,
                opening is null ? null : DescribeAsset(opening), DescribeAsset(asset),
                available && asset.Checked &&
                !existing.Contains($"damage:{id:N}:{asset.Id:N}"), proofs,
                moveInAssets.GetValueOrDefault(asset.Id)?.EvidenceIds ?? []));
        }

        var openingChecks = (baseline?.RoomChecks ?? []).ToDictionary(check => check.Code);
        var moveInChecks = (openingPhotos?.RoomChecks ?? []).ToDictionary(check => check.Code);
        foreach (var check in observed?.RoomChecks ?? [])
        {
            var opening = openingChecks.GetValueOrDefault(check.Code);
            var proofs = check.EvidenceIds ?? [];
            items.Add(new("RoomCheck", null, check.Code, null,
                HandoverRoomChecklist.Labels.GetValueOrDefault(check.Code, check.Code),
                opening is null ? null : DescribeCheck(opening), DescribeCheck(check),
                available && HandoverRoomChecklist.RequiredCodes.Contains(check.Code) &&
                !existing.Contains($"damage:{id:N}:{check.Code}"), proofs,
                moveInChecks.GetValueOrDefault(check.Code)?.EvidenceIds ?? []));
        }

        var openingKey = baseline?.AccessItems?.SingleOrDefault(item => item.Type == "RoomKey");
        var returnedKey = observed?.AccessItems?.SingleOrDefault(item => item.Type == "RoomKey");
        if (returnedKey is not null)
        {
            var proofs = observed?.KeyEvidenceIds ?? [];
            items.Add(new("Access", null, null, "RoomKey", "Chìa khóa phòng",
                openingKey is null ? null : $"{openingKey.Quantity} chiếc; {openingKey.Notes}",
                $"{returnedKey.Quantity} chiếc; {returnedKey.Notes}",
                available &&
                !existing.Contains($"damage:{id:N}:access_room_key"), proofs,
                openingPhotos?.AccessItems?.Any(item => item.Type == "RoomKey") == true
                    ? openingPhotos.KeyEvidenceIds ?? [] : []));
        }

        var physical = new
        {
            inspection?.Id,
            inspection?.Version,
            inspection?.OwnerDecision,
            inspection?.NoAdditionalCharges,
            move?.Status,
            move?.InspectedAt,
            move?.InspectedByUserId,
            OpeningHandoverVersion = openingHandover?.Version,
            OpeningHandoverSnapshot = openingHandover?.Snapshot,
            inspection?.BaselineSnapshot,
            inspection?.ObservedSnapshot
        };
        var physicalReference = "PHYSICAL-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(physical)));
        // Keep the historical proposal reference stable for offers already sent
        // before an automated settlement was introduced.
        var hash = SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            context.View.Reference,
            inspection?.Id,
            inspection?.Version,
            inspection?.OwnerDecision,
            inspection?.NoAdditionalCharges,
            move?.Status,
            move?.InspectedAt,
            move?.InspectedByUserId,
            OpeningHandoverVersion = openingHandover?.Version,
            OpeningHandoverSnapshot = openingHandover?.Snapshot,
            inspection?.BaselineSnapshot,
            inspection?.ObservedSnapshot
        }));
        return new(context, items.ToArray(), "PROPOSAL-" + Convert.ToHexString(hash),
            staffInspectionReady, openingPhotos is null ? null : openingHandover!.ContractId, physicalReference);
    }

    private static string DescribeAsset(HandoverAsset asset) =>
        $"Tình trạng: {asset.ObservedCondition}; đã giao: {asset.HandedOverQuantity?.ToString() ?? "chưa xác minh"}; " +
        $"kiểm kê: {asset.ObservedQuantity?.ToString() ?? "chưa xác minh"}; " +
        $"hư hỏng: {asset.DamagedQuantity?.ToString() ?? "chưa xác minh"}; " +
        $"thiếu: {asset.MissingQuantity?.ToString() ?? "chưa xác minh"}; {asset.Notes}";

    private static string DescribeCheck(HandoverRoomCheck check) =>
        string.IsNullOrWhiteSpace(check.Notes) ? check.Status : $"{check.Status}: {check.Notes}";

    public Task<MoveOutChargeProposal?> ProposalOperationAsync(Guid actor, Guid key, CancellationToken token) =>
        ProposalOperationByActorAsync<MoveOutChargeProposal>(actor, key, SettlementChargeRecords.ProposalKind, "ownerUserId", token);

    public async Task<MoveOutChargeProposalFeedback?> ProposalFeedbackOperationAsync(Guid actor, Guid key, CancellationToken token)
    {
        var original = await ProposalOperationByActorAsync<MoveOutChargeProposalFeedback>(actor, key,
            SettlementChargeRecords.ProposalFeedbackKind, "tenantUserId", token);
        return original is null ? null :
            await OverlayProposalSettlementAsync(original, token);
    }

    private async Task<T?> ProposalOperationByActorAsync<T>(Guid actor, Guid key, string kind,
        string actorField, CancellationToken token)
    {
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE h->>'recordType'={kind} AND h->'state'->>'operationKey'={key.ToString()}
              AND h->'state'->>{actorField}={actor.ToString()}
            """).SingleOrDefaultAsync(token);
        return json is null ? default : JsonSerializer.Deserialize<T>(json, SettlementChargeRecords.Json);
    }

    public async Task<MoveOutChargeProposal?> LatestProposalAsync(Guid id, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        // AppendAsync preserves proposal order in contracts.history. Timestamps
        // can tie when the clock is fixed (or two revisions arrive together),
        // so Guid ordering must never decide which proposal Tenant sees.
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (entry.value->'state')::text AS "Value"
            FROM contracts c CROSS JOIN LATERAL
                jsonb_array_elements(c.history) WITH ORDINALITY AS entry(value, position)
            WHERE c.id={id} AND entry.value->>'recordType'={SettlementChargeRecords.ProposalKind}
            ORDER BY entry.position DESC LIMIT 1
            """).SingleOrDefaultAsync(token);
        return json is null ? null : JsonSerializer.Deserialize<MoveOutChargeProposal>(json,
            SettlementChargeRecords.Json) ?? throw ContractException.Conflict("move_out_proposal_integrity_failed");
    }

    public async Task<MoveOutChargeProposalFeedback?> ProposalFeedbackAsync(Guid id, Guid proposalId, CancellationToken token)
    {
        var responses = (await SettlementChargeRecords.ReadAsync<MoveOutChargeProposalFeedback>(db, id,
            SettlementChargeRecords.ProposalFeedbackKind, token)).Where(reply => reply.ProposalId == proposalId).ToArray();
        if (responses.Length > 1) throw ContractException.Conflict("move_out_proposal_feedback_integrity_failed");
        var original = responses.SingleOrDefault();
        return original is null ? null : await OverlayProposalSettlementAsync(original, token);
    }

    private async Task<MoveOutChargeProposalFeedback> OverlayProposalSettlementAsync(
        MoveOutChargeProposalFeedback original, CancellationToken token)
    {
        var reconciliations = (await SettlementChargeRecords.ReadAsync<MoveOutChargeProposalSettlementResolution>(
            db, original.ContractId, SettlementChargeRecords.ProposalSettlementKind, token))
            .Where(x => x.FeedbackId == original.Id && x.ProposalId == original.ProposalId).ToArray();
        if (reconciliations.Length > 1)
            throw ContractException.Conflict("move_out_proposal_reconciliation_integrity_failed");
        return reconciliations.Length == 0 ? original : original with
        {
            Settlement = reconciliations[0].Settlement,
            VerifiedPhysicalReference = reconciliations[0].PhysicalReference
        };
    }

    public async Task SaveProposalSettlementResolutionAsync(MoveOutChargeProposalSettlementResolution reconciliation,
        CancellationToken token)
    {
        await AppendAsync(reconciliation.ContractId, reconciliation.Id,
            SettlementChargeRecords.ProposalSettlementKind, reconciliation,
            reconciliation.TenantUserId, reconciliation.ReconciledAt, token,
            "MoveOutChargeProposalSettlementReconciled");
        await db.SaveChangesAsync(token);
    }

    public async Task SaveProposalAsync(MoveOutChargeProposal proposal, CancellationToken token)
    {
        await AppendAsync(proposal.ContractId, proposal.Id, SettlementChargeRecords.ProposalKind,
            proposal, proposal.OwnerUserId, proposal.SentAt, token, "MoveOutChargeProposalSent");
        await db.SaveChangesAsync(token);
        var location = await LocationAsync(proposal.ContractId, token);
        var writer = new BHome.Infrastructure.Modules.Notifications.CompactNotificationWriter((Compact24DbContext)db, clock);
        foreach (var recipient in proposal.RecipientUserIds)
            await writer.Emit(recipient, "Tenant", location, "move-out-proposal:" + proposal.Id,
                "CONTRACT_STATUS_CHANGED", "Contract", "Có đề xuất quyết toán trả phòng",
                "Owner đã gửi các khoản dự kiến và số dư tiền cọc để bạn xem và phản hồi.",
                "Contract", proposal.ContractId, token, channels: ["IN_APP"]);
    }

    public async Task SaveProposalFeedbackAsync(MoveOutChargeProposalFeedback feedback, CancellationToken token)
    {
        await AppendAsync(feedback.ContractId, feedback.Id, SettlementChargeRecords.ProposalFeedbackKind,
            feedback, feedback.TenantUserId, feedback.RespondedAt, token,
            feedback.Confirmed ? "MoveOutChargeProposalAccepted" : "MoveOutChargeProposalDisputed");
        await db.SaveChangesAsync(token);
        var contract = await db.Set<Contract>().AsNoTracking().Where(c => c.Id == feedback.ContractId)
            .Select(c => new { c.OwnerSignerId, c.Room.LocationId }).SingleAsync(token);
        var writer = new BHome.Infrastructure.Modules.Notifications.CompactNotificationWriter((Compact24DbContext)db, clock);
        await writer.Emit(contract.OwnerSignerId, "Owner", contract.LocationId,
            "move-out-proposal-response:" + feedback.Id, "CONTRACT_STATUS_CHANGED", "Contract",
            feedback.Confirmed ? "Tenant đã đồng ý đề xuất trả phòng" : "Tenant phản hồi đề xuất trả phòng",
            "Tenant đã gửi phản hồi cho các khoản dự kiến. Mở trang trả phòng để xem chi tiết.",
            "Contract", feedback.ContractId, token, channels: ["IN_APP"]);
    }
}
