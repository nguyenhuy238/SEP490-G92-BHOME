using BHome.Domain.IdentityAccess;
using BHome.Application.Contracts;
using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using BHome.Infrastructure.Contracts;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher
{
    private static readonly IReadOnlyDictionary<string, string> SettlementTitles = new Dictionary<string, string>
    {
        ["Requested"] = "Có yêu cầu trả phòng",
        ["Approved"] = "Yêu cầu trả phòng đã được duyệt",
        ["Rejected"] = "Yêu cầu trả phòng đã bị từ chối",
        ["Scheduled"] = "Lịch kiểm tra trả phòng đã được cập nhật",
        ["Inspected"] = "Kết quả kiểm tra trả phòng đã được gửi",
        ["InspectionConfirmed"] = "Owner đã xác nhận kết quả kiểm tra trả phòng",
        ["ReinspectionRequired"] = "Cần kiểm tra lại hiện trạng trả phòng",
        ["PendingSettlement"] = "Quyết toán trả phòng còn chờ xử lý",
        ["Settled"] = "Owner đã xác nhận quyết toán trả phòng",
        ["Completed"] = "Hợp đồng đã hoàn tất trả phòng",
        ["ConsentOpened"] = "Cần xác nhận yêu cầu trả phòng",
        ["ConsentReady"] = "Yêu cầu trả phòng đã đủ đồng thuận",
        ["ConsentRejected"] = "Yêu cầu trả phòng không được đồng thuận",
        ["ForcedOpened"] = "Có hồ sơ trả phòng bắt buộc",
        ["ForcedInspected"] = "Đã lưu kiểm tra trả phòng bắt buộc"
    };
    private async Task<IReadOnlyList<Intent>> SettlementAudience(Guid contractId, string title, CancellationToken token)
    {
        var contract = await LoadNotificationContract(contractId, token);
        if (contract is null) return [];
        const string summary = "Hợp đồng có cập nhật về cọc hoặc trả phòng/quyết toán. Mở hợp đồng để xem trạng thái hiện tại trong phạm vi được cấp quyền.";
        var list = new List<Intent> { new(contract.OwnerSignerId, Roles.Owner, contract.Room.LocationId, "Contract", title, summary, "Contract", contract.Id) };
        // Contract settlement entitlement belongs to this linked Tenant; co-occupancy alone does
        // not grant finance visibility. Never send amounts, reasons, bank references or evidence.
        if (contract.TenantUserId is { } tenant) list.Add(new(tenant, Roles.Tenant, contract.Room.LocationId, "Contract", title, summary, "Contract", contract.Id));
        return list;
    }
    private async Task<IReadOnlyList<Intent>> MoveOutAudience(ContractMoveOutHistory change, CancellationToken token)
    {
        var title = SettlementTitles[change.Action];
        if (change.Action is "ConsentOpened" or "ConsentReady" or "ConsentRejected" or "ForcedOpened" or "ForcedInspected")
        {
            var contract = await LoadNotificationContract(change.ContractId, token);
            if (contract is null) return [];
            if (change.Action is "ForcedOpened" or "ForcedInspected" or "ConsentReady")
                return [new(contract.OwnerSignerId, Roles.Owner, contract.Room.LocationId, "Contract", title,
                    "Mở hồ sơ trả phòng để xem trạng thái và kết quả được lưu.", "Contract", contract.Id,
                    EventType: "MOVE_OUT_STATUS_CHANGED", Channels: ["IN_APP", "PUSH"])];
            var consent = JsonSerializer.Deserialize<RoomMoveOutConsent>(change.Snapshot);
            if (consent is null) return [];
            var intents = new List<Intent>();
            foreach (var member in consent.Members.Where(m => m.UserId != change.ActorId).DistinctBy(m => m.UserId))
            {
                var linked = db is Compact24DbContext compact
                    ? await compact.Set<Native.Contract>().AnyAsync(c => c.Id == member.ContractId && c.RoomId == contract.RoomId &&
                        c.Status == (short)ContractStatus.Active && compact.Set<Native.ContractResident>().Any(r => r.ContractId == c.Id && r.ResidentId == member.ResidentId), token)
                    : await db.Set<Contract>().AsNoTracking().AnyAsync(c => c.Id == member.ContractId &&
                    c.RoomId == contract.RoomId && c.Status == ContractStatus.Active &&
                    c.Residents.Any(r => r.ResidentId == member.ResidentId), token);
                if (!linked) continue;
                intents.Add(new(member.UserId, Roles.Tenant, contract.Room.LocationId, "Contract", title,
                    change.Action == "ConsentOpened" ? "Mở BHOME, vào Hợp đồng > Gia hạn & trả phòng để xác nhận yêu cầu của phòng." :
                    "Yêu cầu trả phòng đã bị từ chối. Mở hợp đồng để xem trạng thái.", "Contract", member.ContractId,
                    EventType: change.Action == "ConsentOpened" ? "MOVE_OUT_CONSENT_REQUIRED" : "MOVE_OUT_CONSENT_REJECTED",
                    Channels: ["IN_APP", "EMAIL", "PUSH"]));
            }
            return intents;
        }
        return (await SettlementAudience(change.ContractId, title, token)).Select(i => i with
        {
            EventType = change.Action == "Completed" ? "MOVE_OUT_SETTLEMENT_COMPLETED" : "MOVE_OUT_STATUS_CHANGED",
            Channels = change.Action == "Completed" ? ["IN_APP", "EMAIL"] : ["IN_APP", "PUSH"]
        }).ToArray();
    }
    private sealed record PendingMoveOut(Guid ContractId, Guid Id, DateTimeOffset OccurredAt);

    private async Task<ContractMoveOutHistory[]> PendingMoveOutHistory(Compact24DbContext compact, string[] actions, CancellationToken token)
    {
        var keys = NotificationPublications.Keys(compact);
        var rows = await compact.Database.SqlQuery<PendingMoveOut>($"""
            SELECT c.id AS "ContractId",(h->'state'->>'id')::uuid AS "Id", (h->'state'->>'occurredAt')::timestamptz AS "OccurredAt"
            FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE h->>'recordType'='ContractMoveOutHistory' AND COALESCE(h->>'deleted','false')<>'true'
              AND h->'state'->>'action'=ANY({actions})
            """).Where(h => !keys.Contains("move-out:" + h.Id.ToString())).OrderBy(h => h.OccurredAt).ThenBy(h => h.Id).Take(25).ToArrayAsync(token);
        if (rows.Length == 0) return [];
        var ids = rows.Select(r => r.Id).ToHashSet();
        return (await NativeContractMoveOutPersistence.MoveHistoryAsync(compact, rows.Select(r => r.ContractId).Distinct().ToArray(), token))
            .Where(h => ids.Contains(h.Id)).OrderBy(h => h.OccurredAt).ThenBy(h => h.Id).Take(25).ToArray();
    }

    private async Task<int> PublishSettlementAsync(CancellationToken token)
    {
        var count = 0;
        var publicationKeys = NotificationPublications.Keys(db);
        var supportedActions = SettlementTitles.Keys.ToArray();
        var changes = db is Compact24DbContext compact
            ? await PendingMoveOutHistory(compact, supportedActions, token)
            : await db.Set<ContractMoveOutHistory>().AsNoTracking()
            .Where(h => supportedActions.Contains(h.Action) && !publicationKeys.Contains("move-out:" + h.Id.ToString()))
            .OrderBy(h => h.OccurredAt).ThenBy(h => h.Id).Take(25).ToArrayAsync(token);
        foreach (var change in changes)
            count += await Publish("move-out:" + change.Id, () => MoveOutAudience(change, token), token);
        // Explicit Compact24 history sources. Offline legacy regression has no deposit/refund capability.
        if (db is not Compact24DbContext) return count;
        var notices = await db.Database.SqlQuery<SettlementNotice>($"""
            SELECT DISTINCT c.id AS "ContractId",'deposit-deduction:'||c.id::text||':'||(h->'state'->>'id') AS "EventKey",
              'Deduction' AS "Action"
            FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE h->>'recordType'='DepositDeductionV1' AND length(h->'state'->>'id')=36
            UNION ALL
            SELECT c.id AS "ContractId",'holding-cancellation:'||(review->>'id') AS "EventKey",review->>'decision' AS "Action"
            FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.settlement->'reviews','[]'::jsonb)) review
            WHERE c.contract_type='HOLDING' AND c.status={(short)ContractStatus.Cancelled} AND review->>'recordType'='ContractSettlementReview'
              AND review->>'decision' IN ('HoldingDepositForfeited','HoldingRefundRequired')
            """).Where(n => !publicationKeys.Contains(n.EventKey))
            .OrderBy(n => n.EventKey).Take(25).ToArrayAsync(token);
        foreach (var notice in notices)
        {
            var title = notice.Action switch
            {
                "Deduction" => "Owner đã ghi nhận quyết định khấu trừ cọc",
                "HoldingDepositForfeited" => "Giữ chỗ đã hủy theo yêu cầu Tenant, cọc không hoàn",
                "HoldingRefundRequired" => "Giữ chỗ đã hủy do không cung cấp được phòng, chờ xử lý hoàn cọc",
                _ => null
            };
            if (title is not null) count += await Publish(notice.EventKey, async () => (await SettlementAudience(notice.ContractId, title, token))
                .Select(i => i with { EventType = "EXCESS_PAYMENT_OR_REFUND_STATUS", Channels = ["IN_APP", "PUSH"] }).ToArray(), token);
        }
        return count + await PublishDepositRefundsAsync(token);
    }
}

public sealed class SettlementNotice
{
    public Guid ContractId { get; set; }
    public string EventKey { get; set; } = "";
    public string Action { get; set; } = "";
}
