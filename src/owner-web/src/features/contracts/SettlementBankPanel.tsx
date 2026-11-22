import { TextField } from '../../components/common/ValidatedForm';
import { ConfirmActionButton } from '../../components/common/ConfirmActionButton';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
  type SettlementBankResult,
  type SettlementReceivables,
} from '../../../../../packages/client-core/src/contracts';
import { paymentClient } from '../../../../../packages/client-core/src/payments';
import { RefundPanel } from '../payments/RefundPanel';
import { ReceiptExcessPanel } from '../payments/ReceiptExcessPanel';
import { ExternalPaymentPayerPanel } from '../payments/ExternalPaymentPayerPanel';

export function SettlementBankPanel({
  api,
  data,
  saved,
}: {
  api: ContractClient;
  data: SettlementReceivables;
  saved: () => Promise<void>;
}) {
  const bank = useMemo(() => paymentClient(api.transport), [api]);
  const [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1);
  const transfers = useQuery({
    queryKey: ['settlement-bank-pending', data.contractId, page],
    queryFn: ({ signal }) => bank.transfers({ page, paymentStatus: 'PendingReview' }, signal),
  });
  const history = useQuery({
    queryKey: ['settlement-bank-history', data.contractId, historyPage, data.reference],
    queryFn: ({ signal }) =>
      bank.transfers({ page: historyPage, settlementContractId: data.contractId }, signal),
  });
  const [target, setTarget] = useState(''),
    [transfer, setTransfer] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const confirmationSource = JSON.stringify([data.reference, target, transfer]);
  const checked = confirmation === confirmationSource;
  const setChecked = (value: boolean) => setConfirmation(value ? confirmationSource : null);
  const [result, setResult] = useState<SettlementBankResult | null>(null),
    [refund, setRefund] = useState('');
  const instructions = useQuery({
    queryKey: ['settlement-bank-reference', data.contractId, target, data.reference],
    queryFn: ({ signal }) => api.settlementTransferInstructions(data.contractId, target, signal),
    enabled: !!target,
  });
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  const sourceUnavailable =
    transfers.isFetching || !!transfers.error || instructions.isFetching || !!instructions.error;
  async function allocate() {
    if (lock.current || sourceUnavailable || !target || !transfer || !checked) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    const body = {
      expectedReference: data.reference,
      transferId: transfer,
      paidByUserId: null,
      humanConfirmed: checked,
    };
    try {
      const value = await api.allocateSettlementBank(
        data.contractId,
        target,
        body,
        keys.get(target, body),
      );
      keys.confirmed(target, body);
      setResult(value);
      setChecked(false);
      setTransfer('');
      setTarget('');
      await transfers.refetch();
      await history.refetch();
      await saved();
    } catch (e) {
      setError(contractError(e));
      if ((e as { status?: number })?.status === 409) {
        setChecked(false);
        await transfers.refetch();
        await history.refetch();
        await saved();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">Đối soát tiền ngân hàng cho khoản phải thu</Typography>
      <Alert severity="info">
        Chọn khoản tiền đã được xác minh từ sao kê tại mục Thanh toán. Đối chiếu nội dung chuyển
        khoản, giao dịch trùng, số còn nợ và phần tiền dư cần hoàn. Khoản dư chỉ có thể hoàn khi đã
        xác minh được người nhận đủ điều kiện.
      </Alert>
      {(error || transfers.error || history.error || instructions.error) && (
        <Alert severity="error">
          {error || contractError(transfers.error || history.error || instructions.error)}
        </Alert>
      )}
      <TextField
        select
        label="Khoản phải thu nhận tiền"
        value={target}
        disabled={busy}
        onChange={(e) => {
          setTarget(e.target.value);
          setChecked(false);
        }}
      >
        {data.receivables.map((r) => (
          <MenuItem key={r.charge.id} value={r.charge.id}>
            {r.charge.description} · {formatContractMoney(r.outstanding)}
          </MenuItem>
        ))}
      </TextField>
      {instructions.data && (
        <Typography>
          Nội dung chuyển khoản cần đối chiếu: {instructions.data.transferReference}
        </Typography>
      )}
      <TextField
        select
        label="Tiền ngân hàng đã xác minh"
        value={transfer}
        disabled={busy}
        onChange={(e) => {
          setTransfer(e.target.value);
          setChecked(false);
        }}
      >
        {(transfers.data?.items ?? []).map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.bankReference} · {formatContractMoney(t.amount)} · {t.transferDescription}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={1}>
        <Button disabled={page <= 1 || transfers.isFetching} onClick={() => setPage((v) => v - 1)}>
          Giao dịch trước
        </Button>
        <Button
          disabled={(transfers.data?.totalCount ?? 0) <= page * 20 || transfers.isFetching}
          onClick={() => setPage((v) => v + 1)}
        >
          Giao dịch sau
        </Button>
        <Button disabled={transfers.isFetching} onClick={() => void transfers.refetch()}>
          Tải lại tiền ngân hàng
        </Button>
      </Stack>
      <FormControlLabel
        control={
          <Checkbox checked={checked} disabled={busy} onChange={(_, value) => setChecked(value)} />
        }
        label="Tôi đã kiểm tra giao dịch ngân hàng và khoản phải thu theo sao kê"
      />
      <ConfirmActionButton
        title="Đối soát tiền ngân hàng"
        description="Xác nhận đúng sao kê, nội dung chuyển khoản và khoản phải thu. Kết quả phân bổ sẽ được máy chủ đối chiếu lại; phần dư phải được xử lý riêng."
        confirmationKey={JSON.stringify([data.reference, target, transfer, checked])}
        disabled={
          busy ||
          sourceUnavailable ||
          !checked ||
          !transfer ||
          !target ||
          data.receivables.find((r) => r.charge.id === target)?.status === 'Paid'
        }
        onConfirm={allocate}
      >
        Xác nhận phân bổ tiền ngân hàng
      </ConfirmActionButton>
      {transfer && target && (
        <ReceiptExcessPanel
          key={`${transfer}:${target}`}
          transferId={transfer}
          target={{ settlementContractId: data.contractId, receivableId: target }}
          onChanged={() => void saved()}
        />
      )}
      {transfer && <ExternalPaymentPayerPanel key={transfer} transferId={transfer} />}
      {result && (
        <Alert severity={result.status === 'Allocated' ? 'success' : 'warning'}>
          {result.status === 'Allocated'
            ? `Đã phân bổ ${formatContractMoney(result.allocatedAmount)}; chưa phân bổ ${formatContractMoney(result.unallocatedAmount)}.`
            : 'Giao dịch được giữ chờ đối chiếu, chưa ghi giảm nợ.'}
        </Alert>
      )}
      <Typography variant="subtitle1">Giao dịch đã phân bổ và hoàn dư</Typography>
      <Typography variant="body2">
        Phần ngoài phân bổ chưa trừ số đã hoàn. Mở hồ sơ hoàn dư để xem số đã hoàn và số còn khả
        dụng.
      </Typography>
      {(history.data?.items ?? []).map((t) => (
        <Stack key={t.id} spacing={1}>
          <Typography>
            {t.bankReference} · Đã phân bổ {formatContractMoney(t.allocatedAmount ?? '0')} · Chưa
            phân bổ {formatContractMoney(t.unallocatedAmount ?? '0')}
          </Typography>
          {t.status === 'Allocated' && !/^0(?:\.0+)?$/.test(t.unallocatedAmount ?? '0') && (
            <Button onClick={() => setRefund(t.id)}>Xem hoàn dư giao dịch {t.bankReference}</Button>
          )}
          {(t.status === 'ExcessRefundPending' || t.status === 'ExcessRefundCompleted') && (
            <ReceiptExcessPanel transferId={t.id} onChanged={() => void saved()} />
          )}
        </Stack>
      ))}
      <Stack direction="row" spacing={1}>
        <Button disabled={historyPage <= 1} onClick={() => setHistoryPage((v) => v - 1)}>
          Lịch sử trước
        </Button>
        <Button
          disabled={(history.data?.totalCount ?? 0) <= historyPage * 20}
          onClick={() => setHistoryPage((v) => v + 1)}
        >
          Lịch sử sau
        </Button>
      </Stack>
      {refund && <RefundPanel sourceId={refund} onChanged={() => void saved()} />}
    </Stack>
  );
}
