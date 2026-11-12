import { Alert, Button, Stack, Typography } from '@mui/material';
import type {
  ContractView,
  HoldingDepositStatus,
} from '../../../../../packages/client-core/src/contracts';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { ChartCard } from '../../components/common/PortalUI';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { RefundPanel } from '../payments/RefundPanel';
import { ReceiptExcessPicker } from '../payments/ReceiptExcessPanel';
export function HoldingDepositPanel({
  contract: c,
  changed,
}: {
  contract: ContractView;
  changed: () => void;
}) {
  const q = useOwnerQuery<HoldingDepositStatus>(
    ['holding-deposit', c.id],
    `/api/v1/contracts/${c.id}/holding-deposit`,
  );
  function reload() {
    void q.refetch();
    changed();
  }
  return (
    <ChartCard title="Cọc giữ chỗ và thời hạn">
      <Stack spacing={2}>
        <OwnerFeedback busy={q.isFetching} error={q.error} />
        <Typography>
          Hết hạn:{' '}
          {c.holdingExpiresAt
            ? new Date(c.holdingExpiresAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
            : 'Chưa có'}{' '}
          · Duyệt: {c.approvedAt ? 'Đã duyệt' : 'Chưa duyệt'}
        </Typography>
        {q.data && (
          <>
            <Typography>
              Yêu cầu {formatContractMoney(q.data.required)} · Đã xác minh{' '}
              {formatContractMoney(q.data.verified)} · Còn thiếu{' '}
              {formatContractMoney(q.data.remaining)}
            </Typography>
            {q.data.requiresManualReview && (
              <Alert severity="warning">Cọc cần Owner đối chiếu trước khi tiếp tục.</Alert>
            )}
            {q.data.disposition && (
              <Alert
                severity={q.data.disposition.status === 'RefundCompleted' ? 'success' : 'info'}
              >
                {q.data.disposition.cause === 'TenantVoluntary'
                  ? `Tenant tự nguyện hủy · Cọc không hoàn: ${formatContractMoney(q.data.disposition.forfeitedAmount)}`
                  : `Owner không cung cấp được phòng · Phải hoàn: ${formatContractMoney(q.data.disposition.refundRequired)} · Đã hoàn: ${formatContractMoney(q.data.disposition.refunded)} · Đang giữ cho yêu cầu hoàn: ${formatContractMoney(q.data.disposition.reserved)}`}
              </Alert>
            )}
          </>
        )}
        <Typography>
          Phân bổ receipt cọc và hoàn phần dư tại khung Receipt cọc của hợp đồng này.
        </Typography>
        {q.data?.disposition?.cause === 'OwnerCannotProvideRoom' && (
          <RefundPanel sourceId={c.id} sourceKind="HoldingDeposit" onChanged={reload} />
        )}
        {c.convertedMainContractId && (
          <Typography>Hợp đồng thuê đã chuyển đổi: {c.convertedMainContractId}</Typography>
        )}
        <ReceiptExcessPicker target={{ holdingContractId: c.id }} onChanged={reload} />
        <Button disabled={q.isFetching} onClick={reload}>
          Tải lại cọc giữ chỗ
        </Button>
      </Stack>
    </ChartCard>
  );
}
