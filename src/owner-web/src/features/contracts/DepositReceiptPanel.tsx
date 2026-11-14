import { useRef, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  formatContractMoney,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { paymentError, paymentText } from '../../../../../packages/client-core/src/payments';
import { ChartCard } from '../../components/common/PortalUI';
import { usePaymentApi } from '../payments/usePaymentApi';
import { RecordTransferForm } from '../payments/OwnerInvoicePaymentPanel';
import { ExternalPaymentPayerPanel } from '../payments/ExternalPaymentPayerPanel';
import { RefundPanel } from '../payments/RefundPanel';
import { ReceiptExcessPanel } from '../payments/ReceiptExcessPanel';

export function DepositReceiptPanel({
  contract,
  changed,
}: {
  contract: ContractView;
  changed: () => void;
}) {
  const api = usePaymentApi(),
    { session } = useAuth(),
    cache = useQueryClient();
  const [status, setStatus] = useState('PendingReview'),
    [page, setPage] = useState(1),
    [receipt, setReceipt] = useState('');
  const [payer, setPayer] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false),
    key = useRef({ signature: '', value: crypto.randomUUID() });
  const scope = [session?.userId, contract.id];
  const position = useQuery({
    queryKey: ['deposit-position', ...scope],
    queryFn: ({ signal }) => api.depositPosition(contract.id, signal),
  });
  const list = useQuery({
    queryKey: ['deposit-receipts', ...scope, status, page],
    queryFn: ({ signal }) =>
      api.transfers(
        {
          page,
          paymentStatus: status,
          ...(status !== 'PendingReview' ? { depositContractId: contract.id } : {}),
        },
        signal,
      ),
  });
  const transfer = useQuery({
    queryKey: ['deposit-receipt', ...scope, receipt],
    queryFn: ({ signal }) => api.transfer(receipt, signal),
    enabled: !!receipt,
  });
  const context = useQuery({
    queryKey: ['deposit-context', ...scope, receipt],
    queryFn: ({ signal }) => api.depositContext(receipt, contract.id, signal),
    enabled: !!receipt && transfer.data?.status !== 'Allocated',
  });
  const signature = JSON.stringify([contract.id, receipt, payer, context.data?.reference]);
  const checked = confirmation === signature;
  const wholeExcess =
    ['ExcessRefundPending', 'ExcessRefundCompleted'].includes(transfer.data?.status ?? '') ||
    context.data?.remaining === '0' ||
    context.data?.problems.includes('deposit_not_payable');
  const selectablePayer =
    context.data?.payers.some((p) => p.residentId === payer) ||
    (!!context.data?.externalPayer && payer === `external:${context.data.externalPayer.id}`);
  async function refresh() {
    setConfirmation('');
    await Promise.all([list.refetch(), transfer.refetch(), context.refetch(), position.refetch()]);
    changed();
  }
  async function allocate() {
    if (
      lock.current ||
      !checked ||
      !context.data ||
      context.isFetching ||
      context.data.problems.length ||
      !payer
    )
      return;
    const selected = context.data.payers.find((p) => p.residentId === payer);
    const external = context.data.externalPayer;
    if (!selected && (!external || payer !== `external:${external.id}`)) return;
    if (key.current.signature !== signature)
      key.current = { signature, value: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.allocateDeposit(
        receipt,
        {
          contractId: contract.id,
          paidByUserId: selected?.userId ?? null,
          ...(selected
            ? { paidByResidentId: selected.residentId }
            : { externalPayerAttestationId: external!.id }),
          expectedReference: context.data.reference,
          humanVerified: true,
        },
        key.current.value,
      );
      key.current = { signature: '', value: crypto.randomUUID() };
      setNotice(paymentText(result.reason));
      setStatus('Allocated');
      setPage(1);
      await cache.invalidateQueries({ queryKey: ['deposit-receipts'] });
      await refresh();
    } catch (e) {
      setError(paymentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ChartCard title="Receipt cọc và hoàn phần dư">
      <Stack spacing={2}>
        <Alert severity="info">
          Chọn receipt đã đối chiếu sao kê và đúng người thực trả. Máy chủ chỉ phân bổ phần cọc còn
          thiếu; phần dư cần yêu cầu, duyệt và bằng chứng hoàn tiền thực tế.
        </Alert>
        {position.error && <Alert severity="error">{paymentError(position.error)}</Alert>}
        {position.data && (
          <Typography>
            Tham chiếu cọc do máy chủ cấp: {position.data.transferReference} · Đã nhận{' '}
            {formatContractMoney(position.data.received)} · Còn thiếu{' '}
            {formatContractMoney(position.data.remaining)}
          </Typography>
        )}
        <Button disabled={busy || !position.data} onClick={() => setRecord(!record)}>
          Ghi nhận receipt ngân hàng
        </Button>
        {record && (
          <RecordTransferForm
            invoiceId=""
            initialDescription={position.data?.transferReference}
            depositContractId={contract.id}
            onRecorded={(id) => {
              setRecord(false);
              setStatus('PendingReview');
              setPage(1);
              setReceipt(id);
              setPayer('');
              setConfirmation('');
              void list.refetch();
            }}
            onClose={() => {
              setRecord(false);
              void list.refetch();
            }}
          />
        )}
        <TextField
          select
          label="Nhóm receipt cọc"
          value={status}
          disabled={busy}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
            setReceipt('');
            setPayer('');
            setConfirmation('');
          }}
        >
          <MenuItem value="PendingReview">Chờ phân bổ</MenuItem>
          <MenuItem value="Allocated">Đã phân bổ vào hợp đồng này</MenuItem>
          <MenuItem value="ExcessRefundPending">Phải hoàn toàn bộ receipt</MenuItem>
          <MenuItem value="ExcessRefundCompleted">Đã hoàn toàn bộ receipt</MenuItem>
        </TextField>
        {list.isFetching && <Typography>Đang tải receipt…</Typography>}
        <TextField
          select
          label="Receipt cọc trên sao kê"
          value={receipt}
          disabled={busy || list.isFetching}
          onChange={(e) => {
            setReceipt(e.target.value);
            setPayer('');
            setConfirmation('');
            setNotice('');
            setError('');
          }}
        >
          <MenuItem value="">Chọn giao dịch</MenuItem>
          {receipt && transfer.data && !list.data?.items.some((r) => r.id === receipt) && (
            <MenuItem value={receipt}>
              {transfer.data.bankReference} · {formatContractMoney(transfer.data.amount)} ·{' '}
              {transfer.data.transferDescription}
            </MenuItem>
          )}
          {list.data?.items.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.bankReference} · {formatContractMoney(r.amount)} · {r.transferDescription}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1}>
          <Button
            disabled={busy || list.isFetching || page <= 1}
            onClick={() => {
              setPage(page - 1);
              setReceipt('');
            }}
          >
            Trang trước
          </Button>
          <Button
            disabled={busy || list.isFetching || (list.data?.totalCount ?? 0) <= page * 20}
            onClick={() => {
              setPage(page + 1);
              setReceipt('');
            }}
          >
            Trang sau
          </Button>
          <Button disabled={busy || list.isFetching} onClick={() => void list.refetch()}>
            Tải lại receipt
          </Button>
        </Stack>
        {!list.isFetching && list.data?.totalCount === 0 && (
          <Typography>Chưa có receipt trong nhóm này.</Typography>
        )}
        {(error || list.error || transfer.error || context.error) && (
          <Alert severity="error">
            {error || paymentError(list.error || transfer.error || context.error)}
          </Alert>
        )}
        {notice && <Alert severity="success">{notice}</Alert>}
        {transfer.data?.isDevelopmentDemo && (
          <Alert severity="warning">Dữ liệu demo, không phải thanh toán ngân hàng thật.</Alert>
        )}
        {receipt && transfer.data?.status === 'Allocated' ? (
          <>
            <Typography>
              Đã phân bổ {formatContractMoney(transfer.data.allocatedAmount ?? '0')} · Phần dư trên
              receipt {formatContractMoney(transfer.data.unallocatedAmount ?? '0')}
            </Typography>
            {transfer.data.allocatedDepositContractId === contract.id &&
              transfer.data.unallocatedAmount !== '0' && (
                <RefundPanel sourceId={receipt} onChanged={() => void refresh()} />
              )}
          </>
        ) : (
          receipt && (
            <>
              <ExternalPaymentPayerPanel
                key={receipt}
                transferId={receipt}
                onChanged={() => {
                  setPayer('');
                  setConfirmation('');
                  void context.refetch();
                  void cache.invalidateQueries({ queryKey: ['receipt-excess-context'] });
                }}
              />
              {wholeExcess && (
                <ReceiptExcessPanel
                  key={receipt + '-whole'}
                  transferId={receipt}
                  target={
                    contract.kind === 'Holding'
                      ? { holdingContractId: contract.id }
                      : { depositContractId: contract.id }
                  }
                  onChanged={() => void refresh()}
                />
              )}
              {context.data && !wholeExcess && (
                <>
                  <Typography>Nội dung cọc: {context.data.depositReference}</Typography>
                  <Typography>
                    Thỏa thuận {formatContractMoney(context.data.required)} · Đã nhận{' '}
                    {formatContractMoney(context.data.received)} · Còn thiếu{' '}
                    {formatContractMoney(context.data.remaining)}
                  </Typography>
                  <Typography>
                    Phân bổ từ receipt này {formatContractMoney(context.data.proposedAllocation)} ·
                    Phần dư phải hoàn {formatContractMoney(context.data.excess)}
                  </Typography>
                  {context.data.problems.map((p) => (
                    <Alert key={p} severity="warning">
                      {paymentText(p)}
                    </Alert>
                  ))}
                  <TextField
                    select
                    label="Người thực trả cọc"
                    value={selectablePayer ? payer : ''}
                    disabled={busy}
                    onChange={(e) => {
                      setPayer(e.target.value);
                      setConfirmation('');
                    }}
                  >
                    <MenuItem value="">Chọn người đã đối chiếu trên sao kê</MenuItem>
                    {context.data.payers.map((p) => (
                      <MenuItem key={p.residentId} value={p.residentId}>
                        {p.label}
                        {p.userId ? '' : ' · Chưa có tài khoản'}
                      </MenuItem>
                    ))}
                    {context.data.externalPayer && (
                      <MenuItem value={`external:${context.data.externalPayer.id}`}>
                        {context.data.externalPayer.payerLabel} · Người trả bên ngoài
                      </MenuItem>
                    )}
                  </TextField>
                  <FormControlLabel
                    label="Tôi xác nhận đúng receipt, người thực trả và phần dư phải hoàn"
                    control={
                      <Checkbox
                        checked={checked}
                        disabled={busy || context.isFetching}
                        onChange={(_, value) => setConfirmation(value ? signature : '')}
                      />
                    }
                  />
                  <Button
                    disabled={
                      busy ||
                      !checked ||
                      !payer ||
                      context.isFetching ||
                      !!context.data.problems.length
                    }
                    onClick={() => void allocate()}
                  >
                    Phân bổ receipt vào cọc
                  </Button>
                  <Button
                    disabled={busy || context.isFetching}
                    onClick={() => {
                      setConfirmation('');
                      void context.refetch();
                    }}
                  >
                    Tải lại đối chiếu cọc
                  </Button>
                </>
              )}
            </>
          )
        )}
      </Stack>
    </ChartCard>
  );
}
