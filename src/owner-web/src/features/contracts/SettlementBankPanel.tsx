import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
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
    [transfer, setTransfer] = useState(''),
    [payer, setPayer] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const confirmationSource = JSON.stringify([data.reference, target, transfer, payer]);
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
  async function allocate() {
    if (lock.current || !target || !transfer || !checked) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    const body = {
      expectedReference: data.reference,
      transferId: transfer,
      paidByUserId: payer || null,
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
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">Đối soát tiền ngân hàng cho khoản phải thu</Typography>
      <Alert severity="info">
        Chọn khoản tiền đã được xác minh từ sao kê tại mục Thanh toán. Backend kiểm tra nội dung
        chuyển khoản, giao dịch trùng, số còn nợ và giữ tiền dư để hoàn cho người thực trả.
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
      <TextField
        select
        label="Người thực chuyển tiền"
        value={payer}
        disabled={busy}
        onChange={(e) => {
          setPayer(e.target.value);
          setChecked(false);
        }}
      >
        <MenuItem value="">
          Chưa xác định tài khoản người trả; tiền dư cần xác minh trước khi hoàn
        </MenuItem>
        {(data.payers ?? []).map((p) => (
          <MenuItem key={p.userId} value={p.userId}>
            {p.displayLabel}
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        control={
          <Checkbox checked={checked} disabled={busy} onChange={(_, value) => setChecked(value)} />
        }
        label="Tôi đã kiểm tra giao dịch thực nhận, khoản đích và người thực trả trên sao kê"
      />
      <Button
        disabled={
          busy ||
          !checked ||
          !transfer ||
          !target ||
          data.receivables.find((r) => r.charge.id === target)?.status === 'Paid'
        }
        onClick={() => void allocate()}
      >
        Xác nhận phân bổ tiền ngân hàng
      </Button>
      {transfer && target && (
        <ReceiptExcessPanel
          key={`${transfer}:${target}`}
          transferId={transfer}
          target={{ settlementContractId: data.contractId, receivableId: target }}
          onChanged={() => void saved()}
        />
      )}
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
