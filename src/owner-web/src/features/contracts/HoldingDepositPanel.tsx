import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type {
  ContractView,
  HoldingDepositStatus,
} from '../../../../../packages/client-core/src/contracts';
import {
  formatContractMoney,
  mutationKeys,
} from '../../../../../packages/client-core/src/contracts';
import { paymentText } from '../../../../../packages/client-core/src/payments';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { ChartCard, ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { usePaymentApi } from '../payments/usePaymentApi';
import { RecordTransferForm } from '../payments/OwnerInvoicePaymentPanel';
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
  const [transfer, setTransfer] = useState(''),
    [checked, setChecked] = useState(false),
    [confirm, setConfirm] = useState(false),
    [record, setRecord] = useState(false);
  const [reason, setReason] = useState('');
  const action = useOwnerAction();
  const payments = usePaymentApi();
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const bank = useOwnerQuery<{
    bankReference: string;
    amount: string;
    status: string;
    transferDescription: string;
  }>(
    ['holding-transfer', transfer],
    `/api/v1/payment-transactions/${transfer}`,
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(transfer),
  );
  return (
    <ChartCard title="Cọc giữ chỗ và thời hạn">
      <Stack spacing={2}>
        <OwnerFeedback
          busy={q.isFetching || action.busy}
          error={action.error || q.error || bank.error}
          notice={action.notice}
        />
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
        {!['Cancelled', 'Expired', 'Converted'].includes(c.status) && (
          <>
            <Button onClick={() => setRecord(!record)}>Ghi nhận giao dịch sao kê</Button>
            {record && <RecordTransferForm invoiceId="" onClose={() => setRecord(false)} />}
            <TextField
              label="Mã giao dịch đã lưu trên hệ thống"
              value={transfer}
              onChange={(e) => {
                setTransfer(e.target.value);
                setChecked(false);
              }}
            />
            {bank.data && (
              <Alert severity="info">
                {bank.data.bankReference} · {formatContractMoney(bank.data.amount)} ·{' '}
                {paymentText(bank.data.status)} · Nội dung: {bank.data.transferDescription}
              </Alert>
            )}
            <FormControlLabel
              label="Đã đối chiếu giao dịch, nội dung và người trả cọc của hợp đồng này"
              control={<Checkbox checked={checked} onChange={(_, v) => setChecked(v)} />}
            />
            <Button
              disabled={
                action.busy ||
                !checked ||
                !bank.data ||
                bank.isFetching ||
                !!bank.error ||
                !c.tenantUserId ||
                !c.approvedAt ||
                ['Expired', 'Cancelled', 'Converted'].includes(c.status)
              }
              onClick={() => setConfirm(true)}
            >
              Phân bổ giao dịch vào cọc giữ chỗ
            </Button>
            {reason && <Alert severity="info">{paymentText(reason)}</Alert>}
          </>
        )}
        {q.data?.disposition?.cause === 'OwnerCannotProvideRoom' && (
          <RefundPanel
            sourceId={c.id}
            sourceKind="HoldingDeposit"
            onChanged={() => {
              void q.refetch();
              changed();
            }}
          />
        )}
        {c.convertedMainContractId && (
          <Typography>Hợp đồng thuê đã chuyển đổi: {c.convertedMainContractId}</Typography>
        )}
        <ReceiptExcessPicker
          target={{ holdingContractId: c.id }}
          onChanged={() => {
            void q.refetch();
            changed();
          }}
        />
        <ConfirmDialog
          open={confirm}
          title="Phân bổ cọc ngân hàng đã xác minh"
          busy={action.busy}
          error={action.error}
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            void action
              .run(async () => {
                const input = { transfer, contractId: c.id, payer: c.tenantUserId };
                const result = await payments.allocateHolding(
                  transfer,
                  c.id,
                  c.tenantUserId!,
                  keys.get('allocate-holding', input),
                );
                keys.confirmed('allocate-holding', input);
                setReason(result.reason);
              })
              .then((ok) => {
                if (ok) {
                  setConfirm(false);
                  setChecked(false);
                  changed();
                }
              })
          }
        >
          Máy chủ sẽ kiểm tra tham chiếu, số tiền và người trả trước khi ghi nhận cọc.
        </ConfirmDialog>
      </Stack>
    </ChartCard>
  );
}
