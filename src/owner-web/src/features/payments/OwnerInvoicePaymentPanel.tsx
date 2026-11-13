import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  formatContractMoney,
  dateOnly,
  vnd,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import {
  paymentError,
  paymentText,
  type BankTransfer,
  type InvoicePayment,
} from '../../../../../packages/client-core/src/payments';
import { usePaymentApi } from './usePaymentApi';
import { signedVnd } from '../../../../../packages/client-core/src/adjustments';
import { RefundPanel } from './RefundPanel';
import { ReceiptExcessPanel } from './ReceiptExcessPanel';
import { ExternalPaymentPayerPanel } from './ExternalPaymentPayerPanel';
import { PaymentInvoicePicker } from './PaymentInvoicePicker';

export function OwnerInvoicePaymentPanel({ invoiceId }: { invoiceId: string }) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [record, setRecord] = useState(false);
  const state = useQuery({
    queryKey: ['invoice-payment', actor, invoiceId],
    queryFn: ({ signal }) => api.payment(invoiceId, signal),
  });
  const instructions = useQuery({
    queryKey: ['transfer-instructions', actor, invoiceId],
    queryFn: ({ signal }) => api.instructions(invoiceId, signal),
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Thanh toán & Đối soát</Typography>
        {state.isPending && <LinearProgress />}
        {state.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void state.refetch()}>Thử lại</Button>}
          >
            {paymentError(state.error)}
          </Alert>
        )}
        {state.data && (
          <>
            <Typography>
              {paymentText(state.data.paymentStatus)} · Còn phải trả:{' '}
              {formatContractMoney(state.data.outstandingAmount)}
            </Typography>
            <Typography>
              Đã ghi nhận: {formatContractMoney(state.data.paidAmount)} · Quá hạn:{' '}
              {state.data.overdueDays} ngày
            </Typography>
            <Typography>Nội dung chuyển khoản: {state.data.transferReference}</Typography>
            {state.data.originalIssuedAmount !== undefined && (
              <Typography>
                Tiền gốc: {formatContractMoney(state.data.originalIssuedAmount)} · Điều chỉnh:{' '}
                {signedVnd(state.data.approvedAdjustmentTotal ?? '0')} · Nghĩa vụ hiện hành:{' '}
                {formatContractMoney(state.data.payableAmount)}
              </Typography>
            )}
            {state.data.reviewStatus === 'PendingReview' && (
              <Alert severity="warning">
                Tiền thừa chờ xem xét:{' '}
                {formatContractMoney(state.data.potentialExcessAmount ?? '0')}. Owner cần đối chiếu
                người thực trả và ghi bằng chứng hoàn tiền thực tế.
              </Alert>
            )}
            {state.data.pendingReview && state.data.reviewStatus !== 'PendingReview' && (
              <Alert severity="info">
                Có giao dịch đang chờ đối soát. Số dư chỉ thay đổi sau phân bổ được xác minh.
              </Alert>
            )}
            {state.data.history.map((item) => (
              <Typography key={item.id}>
                {formatInstant(item.paidAt)} · {formatContractMoney(item.amount)} · Người trả:{' '}
                {item.paidBy} ·{' '}
                {item.verificationSource === 'SePayTest'
                  ? 'SePay thử nghiệm xác minh'
                  : item.verificationSource === 'SePayLive'
                    ? 'SePay xác minh'
                    : item.verificationSource === 'OwnerBankStatement'
                      ? 'Owner xác minh sao kê'
                      : 'Nguồn xác minh khác'}
              </Typography>
            ))}
            {state.data.paymentStatus !== 'NotIssued' && (
              <Button onClick={() => setRecord(true)}>Ghi nhận giao dịch từ sao kê</Button>
            )}
            {record && (
              <RecordTransferForm
                key={invoiceId}
                invoiceId={invoiceId}
                state={state.data}
                onClose={() => setRecord(false)}
              />
            )}
          </>
        )}
        {instructions.error && <Alert severity="error">{paymentError(instructions.error)}</Alert>}
        {instructions.data?.accountNumber && (
          <>
            {instructions.data.isDevelopmentDemo && (
              <Alert severity="warning">Tài khoản tổng hợp demo. Không chuyển tiền thật.</Alert>
            )}
            <Typography>
              Ngân hàng BIN {instructions.data.bankIdentifier} · {instructions.data.accountHolder} ·{' '}
              {instructions.data.accountNumber}
            </Typography>
            {instructions.data.qrImageDataUri && (
              <Box
                component="img"
                src={instructions.data.qrImageDataUri}
                alt="QR chuyển khoản hóa đơn"
                sx={{ width: 240, maxWidth: '100%', bgcolor: 'white' }}
              />
            )}
          </>
        )}
        {instructions.data && !instructions.data.accountNumber && (
          <Alert severity="info">
            {paymentText(
              instructions.data.availability === 'NotIssued'
                ? 'NotIssuedInstructions'
                : instructions.data.availability,
            )}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
export function RecordTransferForm({
  invoiceId,
  state,
  onClose,
  initialDescription,
  onRecorded,
  depositContractId,
}: {
  invoiceId: string;
  state?: InvoicePayment;
  onClose: () => void;
  initialDescription?: string;
  onRecorded?: (receiptId: string) => void;
  depositContractId?: string;
}) {
  const api = usePaymentApi();
  const cache = useQueryClient();
  const lock = useRef(false);
  const key = useRef(crypto.randomUUID());
  const [provider, setProvider] = useState(''),
    [reference, setReference] = useState(''),
    [amount, setAmount] = useState(state?.outstandingAmount ?? ''),
    [occurred, setOccurred] = useState(''),
    [description, setDescription] = useState(state?.transferReference ?? initialDescription ?? '');
  const [statement, setStatement] = useState(''),
    [reason, setReason] = useState(''),
    [checked, setChecked] = useState(false),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [saved, setSaved] = useState<BankTransfer | null>(null);
  const changed = () => {
    key.current = crypto.randomUUID();
    setChecked(false);
  };
  if (saved)
    return (
      <>
        <Alert severity="success">Đã lưu giao dịch đã đối chiếu sao kê.</Alert>
        {onRecorded ? (
          <Button onClick={() => onRecorded(saved.id)}>Đối chiếu receipt cọc vừa lưu</Button>
        ) : (
          <ReconcileTransfer transfer={saved} initialInvoiceId={invoiceId} />
        )}
        <Button onClick={onClose}>Đóng biểu mẫu</Button>
      </>
    );
  return (
    <Stack
      component="form"
      spacing={2}
      onSubmit={(event) => {
        event.preventDefault();
        if (lock.current) return;
        let instant: string;
        try {
          vnd(amount, true);
          dateOnly(occurred.slice(0, 10));
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(occurred)) throw new Error();
          instant = new Date(occurred + ':00+07:00').toISOString();
        } catch {
          setError('Nhập số nguyên VND và ngày giờ sao kê theo giờ Việt Nam.');
          return;
        }
        lock.current = true;
        setBusy(true);
        setError('');
        void api
          .register(
            {
              providerIdentity: provider,
              bankReference: reference,
              amount,
              currency: 'VND',
              occurredAt: instant,
              transferDescription: description,
              statementReference: statement,
              verificationReason: reason,
              proposedInvoiceId: invoiceId || null,
              ...(depositContractId ? { proposedDepositContractId: depositContractId } : {}),
              humanVerified: checked,
              isDevelopmentDemo: demo,
            },
            key.current,
          )
          .then(async (result) => {
            setSaved(result);
            await cache.invalidateQueries({ queryKey: ['payment-transfers'] });
          })
          .catch((e) => setError(paymentError(e)))
          .finally(() => {
            lock.current = false;
            setBusy(false);
          });
      }}
    >
      <Typography variant="subtitle1">Đối chiếu sao kê ngân hàng</Typography>
      <TextField
        required
        label="Ngân hàng / nguồn sao kê"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value.toUpperCase());
          changed();
        }}
        helperText="Mã định danh nguồn sao kê, không nhập thông tin đăng nhập ngân hàng."
      />
      <TextField
        required
        label="Mã giao dịch ngân hàng"
        value={reference}
        onChange={(e) => {
          setReference(e.target.value);
          changed();
        }}
      />
      <TextField
        required
        label="Số tiền thực nhận VND"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          changed();
        }}
      />
      <TextField
        required
        type="datetime-local"
        label="Thời gian giao dịch (giờ Việt Nam)"
        value={occurred}
        onChange={(e) => {
          setOccurred(e.target.value);
          changed();
        }}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="Nội dung chuyển khoản trên sao kê"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          changed();
        }}
      />
      <TextField
        required
        label="Tham chiếu bằng chứng sao kê"
        value={statement}
        onChange={(e) => {
          setStatement(e.target.value);
          changed();
        }}
      />
      <TextField
        required
        label="Căn cứ xác minh"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          changed();
        }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={demo}
            onChange={(e) => {
              setDemo(e.target.checked);
              changed();
            }}
          />
        }
        label="Dữ liệu tổng hợp Development/Testing"
      />
      <FormControlLabel
        control={<Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />}
        label="Tôi đã đối chiếu sao kê và xác minh tiền thực nhận"
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" disabled={busy || !checked} variant="contained">
        Lưu giao dịch đã đối chiếu
      </Button>
      <Button disabled={busy} onClick={onClose}>
        Hủy nhập
      </Button>
    </Stack>
  );
}
export function ReconcileTransfer({
  transfer,
  initialInvoiceId = '',
}: {
  transfer: BankTransfer;
  initialInvoiceId?: string;
}) {
  const api = usePaymentApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId || transfer.proposedInvoiceId || ''),
    [payer, setPayer] = useState(''),
    [reject, setReject] = useState(''),
    [checked, setChecked] = useState(false);
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  const key = useRef(crypto.randomUUID());
  const payers = useQuery({
    queryKey: ['payment-payers', actor, invoiceId],
    enabled: /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(invoiceId),
    queryFn: ({ signal }) => api.payers(invoiceId, signal),
  });
  const latest = useQuery({
    queryKey: ['payment-transfer', actor, transfer.id],
    queryFn: ({ signal }) => api.transfer(transfer.id, signal),
  });
  const history = useQuery({
    queryKey: ['payment-reviews', actor, transfer.id],
    queryFn: ({ signal }) => api.reviews(transfer.id, signal),
  });
  const [refundsOpen, setRefundsOpen] = useState(false);
  const [choosing, setChoosing] = useState(false),
    [invoiceLabel, setInvoiceLabel] = useState('');
  const data = latest.data ?? transfer;
  async function perform(rejection = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (rejection) await api.reject(transfer.id, reject, key.current);
      else {
        const result = await api.allocate(transfer.id, invoiceId, payer || null, key.current);
        setNotice(paymentText(result.reason));
      }
      setConfirm(false);
      setChecked(false);
      key.current = crypto.randomUUID();
      await Promise.all(
        [
          ['invoice-payment'],
          ['transfer-instructions'],
          ['payment-transfers'],
          ['payment-transfer'],
          ['payment-reviews'],
          ['payment-invoices'],
          ['payment-history'],
          ['debt-summary'],
        ].map((queryKey) => cache.invalidateQueries({ queryKey })),
      );
    } catch (e) {
      setError(paymentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography>
          {data.bankReference} · {formatContractMoney(data.amount)} · {paymentText(data.status)}
        </Typography>
        <Typography variant="body2">
          Ngày giao dịch: {formatInstant(data.occurredAt)} · Nguồn {data.providerIdentity}
        </Typography>
        <Typography variant="body2">
          Nội dung: {data.transferDescription || 'Không có nội dung'} · Sao kê:{' '}
          {data.statementReference}
        </Typography>
        <Typography>
          {data.reason === 'verified_excess_payment_pending_review'
            ? 'Đã phân bổ đủ hóa đơn từ giao dịch có tiền thừa. Xem trạng thái xử lý tại mục hoàn tiền.'
            : paymentText(data.reason)}
        </Typography>
        {data.allocatedAmount !== undefined && (
          <Typography>
            Đã phân bổ: {formatContractMoney(data.allocatedAmount)} · Chưa phân bổ:{' '}
            {formatContractMoney(data.unallocatedAmount ?? '0')}
          </Typography>
        )}
        {notice && <Alert severity="info">{notice}</Alert>}
        <ExternalPaymentPayerPanel transferId={transfer.id} />
        {data.status === 'Allocated' &&
          data.unallocatedAmount !== undefined &&
          /^0*(?:\.0+)?$/.test(data.unallocatedAmount) === false && (
            <Button onClick={() => setRefundsOpen(true)}>Xử lý hoàn tiền thừa</Button>
          )}
        {refundsOpen && <RefundPanel key={transfer.id} sourceId={transfer.id} />}
        {(data.status === 'ExcessRefundPending' ||
          data.status === 'ExcessRefundCompleted' ||
          (data.status === 'PendingReview' && invoiceId)) && (
          <ReceiptExcessPanel
            key={`${transfer.id}:${invoiceId}`}
            transferId={transfer.id}
            target={data.status === 'PendingReview' ? { invoiceId } : undefined}
          />
        )}
        {(latest.error || history.error) && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  void latest.refetch();
                  void history.refetch();
                }}
              >
                Thử lại
              </Button>
            }
          >
            {paymentError(latest.error || history.error)}
          </Alert>
        )}
        {data.status === 'PendingReview' && (
          <>
            <Typography>
              {invoiceLabel ||
                (invoiceId
                  ? 'Đang xem hóa đơn gợi ý từ giao dịch. Kiểm tra trước khi phân bổ.'
                  : 'Chưa chọn hóa đơn để phân bổ.')}
            </Typography>
            <Button disabled={busy} onClick={() => setChoosing(true)}>
              Chọn hóa đơn cần phân bổ
            </Button>
            {choosing && (
              <PaymentInvoicePicker
                open
                close={() => setChoosing(false)}
                choose={(i) => {
                  setInvoiceId(i.invoiceId);
                  setInvoiceLabel(
                    `${i.locationName} · Phòng ${i.roomNumber} · ${i.billingPeriod.slice(0, 7)}`,
                  );
                  setPayer('');
                  setChecked(false);
                  setChoosing(false);
                  key.current = crypto.randomUUID();
                }}
              />
            )}
            <TextField
              select
              label="Người thực trả đã xác minh"
              value={payer}
              onChange={(e) => {
                setPayer(e.target.value);
                setChecked(false);
                key.current = crypto.randomUUID();
              }}
            >
              <MenuItem value="">Chưa xác định người trả</MenuItem>
              {payers.data?.map((p) => (
                <MenuItem key={p.userId} value={p.userId}>
                  {p.displayLabel}
                </MenuItem>
              ))}
            </TextField>
            {payers.error && <Alert severity="error">{paymentError(payers.error)}</Alert>}
            <FormControlLabel
              control={
                <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              }
              label="Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng"
            />
            <Button
              variant="contained"
              disabled={busy || !checked || !payers.data}
              onClick={() => setConfirm(true)}
            >
              Xác nhận phân bổ tiền
            </Button>
            <TextField
              label="Lý do không phân bổ"
              value={reject}
              onChange={(e) => {
                setReject(e.target.value);
                key.current = crypto.randomUUID();
              }}
            />
            <Button disabled={busy || !reject.trim()} onClick={() => void perform(true)}>
              Không phân bổ giao dịch
            </Button>
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {history.data?.items.map((item) => (
          <Typography key={item.sequence} variant="body2">
            {formatInstant(item.occurredAt)} · {paymentText(item.decision)} ·{' '}
            {item.decision === 'Rejected' ? item.reason : paymentText(item.reason)}
          </Typography>
        ))}
        <Dialog open={confirm} onClose={() => !busy && setConfirm(false)}>
          <DialogTitle>Xác nhận đối soát giao dịch?</DialogTitle>
          <DialogContent>
            Ghi nhận {formatContractMoney(data.amount)} từ sao kê cho hóa đơn đã chọn. Hệ thống sẽ
            kiểm tra số dư và chống ghi có trùng. Nếu thiếu tiền, chỉ ghi nhận số đã nhận và giữ dư
            nợ. Nếu thừa tiền, chỉ phân bổ tối đa dư nợ; phần thừa chờ Owner xử lý, chưa tự hoàn.
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Quay lại
            </Button>
            <Button disabled={busy} onClick={() => void perform()}>
              Xác nhận đối soát
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Paper>
  );
}
