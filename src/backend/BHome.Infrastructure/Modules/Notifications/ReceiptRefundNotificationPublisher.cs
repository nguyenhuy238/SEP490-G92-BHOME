using BHome.Domain.IdentityAccess;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed partial class NotificationEventPublisher
{
    internal static IQueryable<ReceiptRefundNotice> ReceiptRefundNotices(BHomePersistenceContext context) => context.Database.SqlQuery<ReceiptRefundNotice>($"""
        SELECT DISTINCT r.id AS "RefundId",r.requested_by_user_id AS "OwnerId",person.user_id AS "BeneficiaryUserId",
          'receipt-refund:'||r.id::text||':'||(event->>'version')||':'||(event->>'action') AS "EventKey",
          event->>'action' AS "Action"
        FROM refund_requests r JOIN payments p ON p.id=r.source_payment_id
        LEFT JOIN residents person ON person.id=r.beneficiary_resident_id
        JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
          WHERE h->>'recordType' IN ('ExcessReceiptRefundV1','SecurityDepositRefundV1','HoldingDepositRefundV1')
          ORDER BY n DESC LIMIT 1) latest ON true
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(latest.state->'events')='array'
          THEN latest.state->'events' ELSE '[]'::jsonb END) event
        WHERE r.source_payment_id IS NOT NULL AND r.source_deposit_contract_id IS NULL AND p.status='VERIFIED'
          AND latest.state->>'classification'='ExcessReceiptRefundV1'
          AND event->>'action' IN ('Requested','APPROVED','REJECTED','Completed')
          AND CASE WHEN event->>'version' ~ {"^[1-9][0-9]{0,8}$"} THEN (event->>'version')::bigint<=r.version ELSE false END
          AND ((r.beneficiary_kind='RESIDENT' AND r.beneficiary_resident_id IS NOT NULL AND (
            EXISTS(SELECT 1 FROM payment_allocations a WHERE a.source_payment_id=p.id AND a.paid_by_user_id=person.user_id)
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType' IN ('DepositReceiptAllocationV1','ReceiptExcessDispositionV1')
              AND h->'state'->>'payerResidentId'=r.beneficiary_resident_id::text)))
            OR (r.beneficiary_kind='EXTERNAL' AND r.beneficiary_resident_id IS NULL AND r.external_payer_attestation_id IS NOT NULL
              AND latest.state->>'externalPayerAttestationId'=r.external_payer_attestation_id::text
              AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='ExternalPaymentPayerV1'
                AND h->'state'->>'id'=r.external_payer_attestation_id::text)))
          AND (event->>'action'<>'Completed' OR (r.status='COMPLETED' AND r.executed_at IS NOT NULL
            AND r.execution_evidence_key IS NOT NULL AND length(r.execution_evidence_key)>0
            AND latest.state->'upload'->>'objectKey'=r.execution_evidence_key
            AND latest.state->'upload'->>'externalReference'=r.external_refund_reference
            AND latest.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}))
        """);

    private async Task<int> PublishReceiptRefundsAsync(CancellationToken token)
    {
        if (db is not Compact24DbContext) return 0;
        var pending = await ReceiptRefundNotices(db).Where(n => !db.Set<NotificationPublication>().Any(p => p.EventKey == n.EventKey))
            .OrderBy(n => n.EventKey).Take(25).ToArrayAsync(token);
        var count = 0;
        foreach (var notice in pending)
            count += await Publish(notice.EventKey, async () =>
            {
                // Re-read current payer/proof binding inside the publication transaction.
                var current = await ReceiptRefundNotices(db).SingleOrDefaultAsync(n => n.EventKey == notice.EventKey, token);
                if (current is null) throw new InvalidOperationException("receipt_refund_notification_source_changed");
                var title = current.Action switch
                {
                    "Requested" => "Đã lập yêu cầu hoàn tiền chuyển dư",
                    "APPROVED" => "Hoàn tiền chuyển dư đã được duyệt, chờ thực hiện",
                    "REJECTED" => "Yêu cầu hoàn tiền chuyển dư đã bị từ chối",
                    _ => "Hoàn tiền chuyển dư đã được xác minh thực hiện"
                };
                const string summary = "Hồ sơ hoàn tiền chuyển dư có cập nhật. Mở lịch sử hoàn tiền để xem trạng thái trong phạm vi được cấp quyền.";
                var channels = current.Action == "Completed" ? new[] { "IN_APP", "PUSH", "EMAIL" } : ["IN_APP", "PUSH"];
                var recipients = new List<Intent> { new(current.OwnerId, Roles.Owner, null, "Payment", title, summary, "Refund", current.RefundId,
                    EventType: "EXCESS_PAYMENT_OR_REFUND_STATUS", Channels: channels) };
                if (current.BeneficiaryUserId is { } tenant)
                    recipients.Add(new(tenant, Roles.Tenant, null, "Payment", title, summary, "Refund", current.RefundId,
                        EventType: "EXCESS_PAYMENT_OR_REFUND_STATUS", Channels: channels));
                return recipients;
            }, token);
        return count;
    }
}

public sealed class ReceiptRefundNotice
{
    public Guid RefundId { get; set; }
    public Guid OwnerId { get; set; }
    public Guid? BeneficiaryUserId { get; set; }
    public string EventKey { get; set; } = "";
    public string Action { get; set; } = "";
}
