using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher
{
    private static readonly IReadOnlyDictionary<string, string> SettlementTitles = new Dictionary<string, string>
    {
        ["Requested"] = "Có yêu cầu trả phòng",
        ["Approved"] = "Yêu cầu trả phòng đã được duyệt",
        ["Rejected"] = "Yêu cầu trả phòng đã bị từ chối",
        ["Scheduled"] = "Lịch kiểm tra trả phòng đã được cập nhật",
        ["Inspected"] = "Biên bản trả phòng đã được gửi",
        ["InspectionConfirmed"] = "Biên bản trả phòng đã được Owner xác nhận",
        ["ReinspectionRequired"] = "Cần kiểm tra lại biên bản trả phòng",
        ["PendingSettlement"] = "Quyết toán trả phòng còn chờ xử lý",
        ["Settled"] = "Owner đã xác nhận quyết toán trả phòng",
        ["Completed"] = "Hợp đồng đã hoàn tất trả phòng"
    };
    private async Task<IReadOnlyList<Intent>> SettlementAudience(Guid contractId, string title, CancellationToken token)
    {
        var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == contractId, token);
        if (contract is null) return [];
        const string summary = "Hợp đồng có cập nhật về cọc hoặc trả phòng/quyết toán. Mở hợp đồng để xem trạng thái hiện tại trong phạm vi được cấp quyền.";
        var list = new List<Intent> { new(contract.OwnerSignerId, Roles.Owner, contract.Room.LocationId, "Contract", title, summary, "Contract", contract.Id) };
        // Contract settlement entitlement belongs to this linked Tenant; co-occupancy alone does
        // not grant finance visibility. Never send amounts, reasons, bank references or evidence.
        if (contract.TenantUserId is { } tenant) list.Add(new(tenant, Roles.Tenant, contract.Room.LocationId, "Contract", title, summary, "Contract", contract.Id));
        return list;
    }
    private async Task<int> PublishSettlementAsync(CancellationToken token)
    {
        var count = 0;
        var supportedActions = SettlementTitles.Keys.ToArray();
        var changes = await db.Set<ContractMoveOutHistory>().AsNoTracking()
            .Where(h => supportedActions.Contains(h.Action) && !db.Set<NotificationPublication>().Any(p => p.EventKey == "move-out:" + h.Id.ToString()))
            .OrderBy(h => h.OccurredAt).ThenBy(h => h.Id).Take(25).ToArrayAsync(token);
        foreach (var change in changes)
            count += await Publish("move-out:" + change.Id, async () => (await SettlementAudience(change.ContractId, SettlementTitles[change.Action], token))
                .Select(i => i with
                {
                    EventType = change.Action == "Completed" ? "MOVE_OUT_SETTLEMENT_COMPLETED" : "MOVE_OUT_STATUS_CHANGED",
                    Channels = change.Action == "Completed" ? ["IN_APP", "EMAIL"] : ["IN_APP", "PUSH"]
                }).ToArray(), token);
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
            UNION ALL
            SELECT c.id AS "ContractId",'deposit-refund:'||r.id::text||':'||(event->>'version')||':'||(event->>'action') AS "EventKey",
              'Refund'||CASE event->>'action' WHEN 'APPROVED' THEN 'Approved' WHEN 'REJECTED' THEN 'Rejected' ELSE event->>'action' END AS "Action"
            FROM refund_requests r
            JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
              WHERE h->>'recordType' IN ('SecurityDepositRefundV1','HoldingDepositRefundV1') ORDER BY n DESC LIMIT 1) latest ON true
            JOIN contracts c ON c.id::text=latest.state->>'settlementContractId'
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(latest.state->'events')='array'
              THEN latest.state->'events' ELSE '[]'::jsonb END) event
            WHERE r.source_deposit_contract_id IS NOT NULL AND r.source_payment_id IS NULL
              AND latest.state->>'classification' IN ('SecurityDepositRefundV1','HoldingDepositRefundV1') AND latest.state->>'beneficiaryVerified'='true'
              AND event->>'action' IN ('Requested','APPROVED','REJECTED','Completed')
              AND event->>'version' ~ '^[1-9][0-9]*$'
              AND (event->>'action'<>'Completed' OR (r.status='COMPLETED' AND r.executed_at IS NOT NULL
                AND latest.state->'upload'->>'objectKey'=r.execution_evidence_key
                AND latest.state->'upload'->>'externalReference'=r.external_refund_reference
                AND latest.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}))
            """).Where(n => !db.Set<NotificationPublication>().Any(p => p.EventKey == n.EventKey))
            .OrderBy(n => n.EventKey).Take(25).ToArrayAsync(token);
        foreach (var notice in notices)
        {
            var title = notice.Action switch
            {
                "Deduction" => "Owner đã ghi nhận quyết định khấu trừ cọc",
                "HoldingDepositForfeited" => "Giữ chỗ đã hủy theo yêu cầu Tenant, cọc không hoàn",
                "HoldingRefundRequired" => "Giữ chỗ đã hủy do không cung cấp được phòng, chờ xử lý hoàn cọc",
                "RefundRequested" => "Đã lập yêu cầu hoàn cọc",
                "RefundApproved" => "Yêu cầu hoàn cọc đã được duyệt, chờ thực hiện",
                "RefundRejected" => "Yêu cầu hoàn cọc đã bị từ chối",
                "RefundCompleted" => "Giao dịch hoàn cọc đã được xác minh thủ công",
                _ => null
            };
            if (title is not null) count += await Publish(notice.EventKey, async () => (await SettlementAudience(notice.ContractId, title, token))
                .Select(i => i with { EventType = "EXCESS_PAYMENT_OR_REFUND_STATUS", Channels = notice.Action == "RefundCompleted" ? ["IN_APP", "PUSH", "EMAIL"] : ["IN_APP", "PUSH"] }).ToArray(), token);
        }
        return count;
    }
}

public sealed class SettlementNotice
{
    public Guid ContractId { get; set; }
    public string EventKey { get; set; } = "";
    public string Action { get; set; } = "";
}
