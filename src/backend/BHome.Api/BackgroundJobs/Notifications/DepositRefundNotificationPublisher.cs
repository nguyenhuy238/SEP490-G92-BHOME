using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher
{
    internal static IQueryable<DepositRefundNotice> DepositRefundNotices(BHomePersistenceContext context) => context.Database.SqlQuery<DepositRefundNotice>($"""
        SELECT DISTINCT r.id AS "RefundId",c.id AS "ContractId",c.owner_signer_id AS "OwnerId",person.user_id AS "BeneficiaryUserId",
          'deposit-refund:'||r.id::text||':'||(event->>'version')||':'||(event->>'action') AS "EventKey",event->>'action' AS "Action"
        FROM refund_requests r
        JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
          WHERE h->>'recordType' IN ('ExcessReceiptRefundV1','SecurityDepositRefundV1','HoldingDepositRefundV1') ORDER BY n DESC LIMIT 1) latest ON true
        JOIN contracts c ON c.id::text=latest.state->>'settlementContractId'
        JOIN residents person ON person.id=r.beneficiary_resident_id
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(latest.state->'events')='array'
          THEN latest.state->'events' ELSE '[]'::jsonb END) event
        WHERE r.source_deposit_contract_id IS NOT NULL AND r.source_payment_id IS NULL AND r.beneficiary_kind='RESIDENT'
          AND latest.state->>'classification' IN ('SecurityDepositRefundV1','HoldingDepositRefundV1')
          AND latest.state->>'beneficiaryVerified'='true'
          AND EXISTS(SELECT 1 FROM contract_residents cr WHERE cr.contract_id=c.id AND cr.resident_id=person.id)
          AND event->>'action' IN ('Requested','APPROVED','REJECTED','Completed')
          AND CASE WHEN event->>'version' ~ {"^[1-9][0-9]{0,8}$"} THEN (event->>'version')::bigint<=r.version ELSE false END
          AND (event->>'action'<>'Completed' OR (r.status='COMPLETED' AND r.executed_at IS NOT NULL
            AND r.execution_evidence_key IS NOT NULL AND length(r.execution_evidence_key)>0
            AND latest.state->'upload'->>'objectKey'=r.execution_evidence_key
            AND latest.state->'upload'->>'externalReference'=r.external_refund_reference
            AND latest.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}))
        """);

    private async Task<int> PublishDepositRefundsAsync(CancellationToken token)
    {
        var pending = await DepositRefundNotices(db).Where(n => !db.Set<NotificationPublication>().Any(p => p.EventKey == n.EventKey))
            .OrderBy(n => n.EventKey).Take(25).ToArrayAsync(token);
        var count = 0;
        foreach (var notice in pending)
            count += await Publish(notice.EventKey, async () =>
            {
                var current = await DepositRefundNotices(db).SingleOrDefaultAsync(n => n.EventKey == notice.EventKey, token);
                if (current is null) throw new InvalidOperationException("deposit_refund_notification_source_changed");
                var title = current.Action switch
                {
                    "Requested" => "Đã lập yêu cầu hoàn cọc",
                    "APPROVED" => "Yêu cầu hoàn cọc đã được duyệt, chờ thực hiện",
                    "REJECTED" => "Yêu cầu hoàn cọc đã bị từ chối",
                    _ => "Giao dịch hoàn cọc đã được xác minh thủ công"
                };
                const string summary = "Hồ sơ hoàn cọc có cập nhật. Mở hồ sơ để xem trạng thái trong phạm vi được cấp quyền.";
                var channels = current.Action == "Completed" ? new[] { "IN_APP", "PUSH", "EMAIL" } : ["IN_APP", "PUSH"];
                // The linked contract Tenant need not be the agreed recipient. Only the confirmed
                // beneficiary gets a Tenant notice; Owner retains the existing contract target.
                var recipients = new List<Intent> { new(current.OwnerId, Roles.Owner, null, "Contract", title, summary, "Contract", current.ContractId,
                    EventType: "EXCESS_PAYMENT_OR_REFUND_STATUS", Channels: channels) };
                if (current.BeneficiaryUserId is { } tenant)
                    recipients.Add(new(tenant, Roles.Tenant, null, "Payment", title, summary, "Refund", current.RefundId,
                        EventType: "EXCESS_PAYMENT_OR_REFUND_STATUS", Channels: channels));
                return recipients;
            }, token);
        return count;
    }
}

public sealed class DepositRefundNotice
{
    public Guid RefundId { get; set; }
    public Guid ContractId { get; set; }
    public Guid OwnerId { get; set; }
    public Guid? BeneficiaryUserId { get; set; }
    public string EventKey { get; set; } = "";
    public string Action { get; set; } = "";
}
