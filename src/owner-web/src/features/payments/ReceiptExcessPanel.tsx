import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import {
  paymentError,
  paymentText,
  type ReceiptExcessTarget,
} from '../../../../../packages/client-core/src/payments';
import { RefundPanel } from './RefundPanel';
import { usePaymentApi } from './usePaymentApi';

export function ReceiptExcessPicker({
  target,
  onChanged,
}: {
  target: ReceiptExcessTarget;
  onChanged?: () => void;
}) {
  const api = usePaymentApi(),
    { session } = useAuth();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('PendingReview'),
    [receipt, setReceipt] = useState('');
  const list = useQuery({
    queryKey: ['receipt-excess-picker', session?.userId, page, status],
    queryFn: ({ signal }) => api.transfers({ page, paymentStatus: status }, signal),
  });
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">Đối chiếu giao dịch phải hoàn toàn bộ</Typography>
      <TextField
        select
        label="Trạng thái giao dịch hoàn dư"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
          setReceipt('');
        }}
      >
        {['PendingReview', 'ExcessRefundPending', 'ExcessRefundCompleted'].map((value) => (
          <MenuItem key={value} value={value}>
            {paymentText(value)}
          </MenuItem>
        ))}
      </TextField>
      {list.error && <Alert severity="error">{paymentError(list.error)}</Alert>}
      <TextField
        select
        label="Giao dịch cần đối chiếu hoàn toàn bộ"
        value={receipt}
        onChange={(e) => setReceipt(e.target.value)}
      >
        <MenuItem value="">Chọn giao dịch</MenuItem>
        {list.data?.items.map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {item.bankReference} · {formatContractMoney(item.amount)} · {item.transferDescription}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={1}>
        <Button
          disabled={page <= 1 || list.isFetching}
          onClick={() => {
            setPage((v) => v - 1);
            setReceipt('');
          }}
        >
          Trang trước
        </Button>
        <Button
          disabled={(list.data?.totalCount ?? 0) <= page * 20 || list.isFetching}
          onClick={() => {
            setPage((v) => v + 1);
            setReceipt('');
          }}
        >
          Trang sau
        </Button>
        <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
          Tải lại giao dịch
        </Button>
      </Stack>
      {receipt && (
        <ReceiptExcessPanel
          key={receipt}
          transferId={receipt}
          target={target}
          onChanged={onChanged}
        />
      )}
    </Stack>
  );
}

export function ReceiptExcessPanel({
  transferId,
  target,
  onChanged,
}: {
  transferId: string;
  target?: ReceiptExcessTarget;
  onChanged?: () => void;
}) {
  const api = usePaymentApi(),
    cache = useQueryClient(),
    { session } = useAuth();
  const existing = useQuery({
    queryKey: ['receipt-excess', session?.userId, transferId],
    queryFn: ({ signal }) => api.excessDisposition(transferId, signal),
  });
  const context = useQuery({
    queryKey: ['receipt-excess-context', session?.userId, transferId, target],
    enabled: !!target && existing.isSuccess && !existing.data,
    queryFn: ({ signal }) => api.excessContext(transferId, target!, signal),
  });
  const [payer, setPayer] = useState(''),
    [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const source = JSON.stringify([transferId, target, context.data?.reference, payer, reason]);
  const checked = confirmation === source;
  const operation = useRef({ source: '', key: crypto.randomUUID() }),
    lock = useRef(false);
  async function refresh() {
    await Promise.all(
      [
        'receipt-excess',
        'receipt-excess-context',
        'receipt-excess-picker',
        'payment-transfer',
        'payment-transfers',
        'payment-reviews',
        'invoice-payment',
        'payment-invoices',
        'settlement-bank-pending',
        'settlement-bank-history',
        'financial-report',
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    );
    onChanged?.();
  }
  async function confirm() {
    if (
      lock.current ||
      !context.data ||
      context.isFetching ||
      !checked ||
      !payer ||
      !reason.trim() ||
      context.data.problems.length
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (operation.current.source !== source)
        operation.current = { source, key: crypto.randomUUID() };
      await api.confirmExcess(
        transferId,
        {
          target: context.data.target,
          expectedReference: context.data.reference,
          payerResidentId: payer.startsWith('external:') ? null : payer,
          ...(payer.startsWith('external:')
            ? { externalPayerAttestationId: payer.slice('external:'.length) }
            : {}),
          reason: reason.trim(),
          humanConfirmed: true,
        },
        operation.current.key,
      );
      setConfirmation('');
      await refresh();
    } catch (e) {
      setError(paymentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const disposition = existing.data ?? context.data?.disposition;
  const differentTarget =
    disposition &&
    target &&
    (
      [
        'invoiceId',
        'settlementContractId',
        'receivableId',
        'holdingContractId',
        'depositContractId',
      ] as const
    ).some((key) => (disposition.target[key] ?? null) !== (target[key] ?? null));
  return (
    <Stack spacing={2}>
      {(existing.isFetching || context.isFetching || busy) && <LinearProgress />}
      {(error || existing.error || context.error) && (
        <Alert
          severity="error"
          action={
            <Button disabled={busy} onClick={() => void refresh()}>
              Tải lại
            </Button>
          }
        >
          {error || paymentError(existing.error || context.error)}
        </Alert>
      )}
      {differentTarget ? (
        <Alert severity="warning">
          Giao dịch đã được xác nhận hoàn theo nghĩa vụ khác. Xem hồ sơ tại mục Thanh toán.
        </Alert>
      ) : disposition ? (
        <>
          <Alert severity="info">
            Toàn bộ {formatContractMoney(disposition.amount)} phải hoàn cho {disposition.payerLabel}
            . Xem số đã hoàn và trạng thái thực hiện bên dưới.
          </Alert>
          <RefundPanel sourceId={transferId} onChanged={() => void refresh()} />
        </>
      ) : (
        context.data && (
          <>
            <Typography variant="subtitle1">Xác nhận toàn bộ giao dịch là tiền dư</Typography>
            <Typography>
              {formatContractMoney(context.data.amount)} · Nội dung đối chiếu:{' '}
              {context.data.transferReference} · Nghĩa vụ còn phải trả:{' '}
              {formatContractMoney(context.data.outstanding)}
            </Typography>
            <Alert severity="info">
              Chỉ xác nhận sau khi đối chiếu sao kê và người thực trả. Sau đó cần lập, duyệt và ghi
              bằng chứng hoàn tiền thực tế.
            </Alert>
            {context.data.problems.map((problem) => (
              <Alert severity="warning" key={problem}>
                {paymentText(problem)}
              </Alert>
            ))}
            <TextField
              select
              label="Người thực trả nhận lại tiền"
              value={payer}
              disabled={busy}
              onChange={(e) => setPayer(e.target.value)}
            >
              <MenuItem value="">Chọn hồ sơ đã xác minh</MenuItem>
              {context.data.payers.map((p) => (
                <MenuItem key={p.residentId} value={p.residentId}>
                  {p.label}
                </MenuItem>
              ))}
              {context.data.externalPayer && (
                <MenuItem value={`external:${context.data.externalPayer.id}`}>
                  {context.data.externalPayer.payerLabel} · Người trả bên ngoài đã xác minh
                </MenuItem>
              )}
            </TextField>
            <TextField
              label="Lý do xác nhận toàn bộ tiền dư"
              multiline
              value={reason}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              onChange={(e) => setReason(e.target.value)}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={checked}
                  disabled={busy}
                  onChange={(_, value) => setConfirmation(value ? source : '')}
                />
              }
              label="Tôi đã đối chiếu nghĩa vụ đã đủ tiền và đúng người thực trả trên sao kê"
            />
            <Button
              disabled={
                busy ||
                context.isFetching ||
                !checked ||
                !payer ||
                !reason.trim() ||
                !!context.data.problems.length
              }
              onClick={() => void confirm()}
            >
              Xác nhận nghĩa vụ hoàn toàn bộ giao dịch
            </Button>
          </>
        )
      )}
    </Stack>
  );
}
