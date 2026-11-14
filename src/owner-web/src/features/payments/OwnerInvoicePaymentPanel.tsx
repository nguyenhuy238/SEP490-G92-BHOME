import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
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
import { CheckCircle2, FileCheck2, Landmark, ReceiptText } from 'lucide-react';
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
import { StatusChip } from '../../components/common/PortalUI';

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
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
      <Stack spacing={2.25}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <ReceiptText size={19} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Tình trạng thanh toán
          </Typography>
        </Stack>
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
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary">
                {paymentText(state.data.paymentStatus)}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.75 }}>
                Còn phải trả:
              </Typography>
              <Typography
                sx={{
                  fontWeight: 750,
                  fontSize: { xs: 25, sm: 29 },
                  letterSpacing: '-0.04em',
                  overflowWrap: 'anywhere',
                }}
              >
                {formatContractMoney(state.data.outstandingAmount)}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 1.5,
                  mt: 1.5,
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Đã ghi nhận
                  </Typography>
                  <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                    {formatContractMoney(state.data.paidAmount)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Quá hạn
                  </Typography>
                  <Typography
                    sx={{ fontWeight: 650 }}
                    color={state.data.overdueDays > 0 ? 'error.main' : 'text.primary'}
                  >
                    {state.data.overdueDays} ngày
                  </Typography>
                </Box>
              </Box>
            </Box>
            {state.data.originalIssuedAmount !== undefined && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                {[
                  ['Tiền gốc', formatContractMoney(state.data.originalIssuedAmount)],
                  ['Điều chỉnh', signedVnd(state.data.approvedAdjustmentTotal ?? '0')],
                  ['Nghĩa vụ hiện hành', formatContractMoney(state.data.payableAmount)],
                ].map(([label, value]) => (
                  <Box
                    key={label}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1.5,
                      p: 1.25,
                      minWidth: 0,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Box>
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
            {state.data.paymentStatus === 'Paid' && !state.data.pendingReview && (
              <Alert severity="success">
                Hóa đơn này đã được hệ thống xác nhận đủ tiền. Có thể kiểm tra các khoản đã ghi nhận
                bên dưới.
              </Alert>
            )}
            {state.data.paymentStatus === 'NotIssued' && (
              <Alert severity="info">
                Hóa đơn chưa phát hành nên chưa có thao tác ghi nhận tiền cho hóa đơn này.
              </Alert>
            )}
            <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                Nội dung chuyển khoản
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {state.data.transferReference}
              </Typography>
            </Box>
            {state.data.history.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Các khoản đã ghi nhận
                </Typography>
                {state.data.history.map((item) => (
                  <Box
                    key={item.id}
                    sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
                  >
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {formatInstant(item.paidAt)}
                      </Typography>
                      <Typography color="success.main" sx={{ fontWeight: 700 }}>
                        {formatContractMoney(item.amount)}
                      </Typography>
                    </Stack>
                    <Typography variant="body2">Người trả: {item.paidBy}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.verificationSource === 'SePayTest'
                        ? 'SePay thử nghiệm xác minh'
                        : item.verificationSource === 'SePayLive'
                          ? 'SePay xác minh'
                          : item.verificationSource === 'OwnerBankStatement'
                            ? 'Owner xác minh sao kê'
                            : 'Nguồn xác minh khác'}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
            {state.data.paymentStatus !== 'NotIssued' && (
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  {state.data.paymentStatus === 'Paid'
                    ? 'Chỉ ghi nhận thêm nếu thực tế có giao dịch ngân hàng cần được kiểm tra riêng.'
                    : 'Nếu sao kê cho thấy đã nhận tiền, ghi nhận giao dịch để Owner đối soát và phân bổ. Số dư chưa thay đổi ở bước này.'}
                </Typography>
                <Button variant="outlined" fullWidth onClick={() => setRecord((value) => !value)}>
                  {record ? 'Thu gọn biểu mẫu sao kê' : 'Ghi nhận giao dịch từ sao kê'}
                </Button>
              </Stack>
            )}
            {record && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
                <RecordTransferForm
                  key={invoiceId}
                  invoiceId={invoiceId}
                  state={state.data}
                  onClose={() => setRecord(false)}
                />
              </Box>
            )}
          </>
        )}
        {instructions.isPending && <LinearProgress aria-label="Đang tải tài khoản nhận tiền" />}
        {instructions.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void instructions.refetch()}>Thử lại</Button>}
          >
            Không tải được thông tin nhận chuyển khoản: {paymentError(instructions.error)}
          </Alert>
        )}
        {instructions.data?.accountNumber && (
          <>
            <Divider />
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
              <Landmark size={19} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Thông tin nhận chuyển khoản
              </Typography>
            </Stack>
            {instructions.data.isDevelopmentDemo && (
              <Alert severity="warning">Tài khoản tổng hợp demo. Không chuyển tiền thật.</Alert>
            )}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ gap: 2, alignItems: { sm: 'center' } }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Ngân hàng BIN {instructions.data.bankIdentifier}
                </Typography>
                <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                  {instructions.data.accountHolder}
                </Typography>
                <Typography sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>
                  {instructions.data.accountNumber}
                </Typography>
              </Box>
              {instructions.data.qrImageDataUri && (
                <Box
                  component="img"
                  src={instructions.data.qrImageDataUri}
                  alt="QR chuyển khoản hóa đơn"
                  sx={{ width: 180, maxWidth: '100%', bgcolor: 'white', borderRadius: 1 }}
                />
              )}
            </Stack>
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
  const [proofExpanded, setProofExpanded] = useState(false);
  const changed = () => {
    key.current = crypto.randomUUID();
    setChecked(false);
  };
  if (saved)
    return (
      <>
        <Alert severity="success">
          Đã lưu giao dịch từ sao kê. Tiền chưa tự phân bổ vào hóa đơn; kiểm tra và xác nhận giao
          dịch bên dưới.
        </Alert>
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
      spacing={2.25}
      sx={{ minWidth: 0 }}
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
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <FileCheck2 size={19} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Đối chiếu sao kê ngân hàng
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Bước 1/2 · Nhập giao dịch thực nhận từ sao kê. Sau khi đối chiếu bằng chứng, Owner mới lưu
        để phân bổ vào hóa đơn.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
          '& .MuiTextField-root': { minWidth: 0 },
        }}
      >
        <TextField
          size="small"
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
          size="small"
          required
          label="Mã giao dịch ngân hàng"
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
            changed();
          }}
        />
        <TextField
          size="small"
          required
          label="Số tiền thực nhận VND"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            changed();
          }}
        />
        <TextField
          size="small"
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
          size="small"
          label="Nội dung chuyển khoản trên sao kê"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            changed();
          }}
        />
      </Box>
      <Button
        type="button"
        variant={proofExpanded ? 'text' : 'outlined'}
        aria-expanded={proofExpanded}
        onClick={() => setProofExpanded((value) => !value)}
        sx={{ alignSelf: 'flex-start' }}
      >
        {proofExpanded ? 'Thu gọn phần xác minh' : 'Tiếp tục: kiểm tra bằng chứng & xác nhận'}
      </Button>
      <Collapse in={proofExpanded} timeout="auto">
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Bước 2/2 · Bằng chứng đối chiếu
          </Typography>
          <TextField
            size="small"
            required
            label="Tham chiếu bằng chứng sao kê"
            value={statement}
            onChange={(e) => {
              setStatement(e.target.value);
              changed();
            }}
          />
          <TextField
            size="small"
            required
            label="Căn cứ xác minh"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              changed();
            }}
            helperText="Ghi ngắn gọn căn cứ xác minh, không nhập thông tin nhạy cảm không cần thiết."
          />
          <Box sx={{ border: '1px solid', borderColor: 'divider', p: 1.5, borderRadius: 1.5 }}>
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
            <Divider sx={{ my: 1 }} />
            <FormControlLabel
              control={
                <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              }
              label="Tôi đã đối chiếu sao kê và xác minh tiền thực nhận"
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            Lưu giao dịch chỉ ghi nhận bằng chứng thực nhận. Số dư hóa đơn sẽ cập nhật sau khi đối
            soát và phân bổ thành công.
          </Typography>
        </Stack>
      </Collapse>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, justifyContent: 'flex-end' }}>
        <Button disabled={busy} onClick={onClose} variant="outlined">
          Hủy nhập
        </Button>
        <Button type="submit" disabled={busy || !checked} variant="contained">
          Lưu giao dịch đã đối chiếu
        </Button>
      </Stack>
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const [excessOpen, setExcessOpen] = useState(false);
  const data = latest.data ?? transfer;
  const hasInvoice = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(invoiceId);
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
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, gap: 1 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>
              {data.bankReference}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatInstant(data.occurredAt)} · Nguồn {data.providerIdentity}
            </Typography>
          </Box>
          <Stack sx={{ alignItems: { xs: 'flex-start', sm: 'flex-end' } }} spacing={0.5}>
            <Typography variant="h6" sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>
              {formatContractMoney(data.amount)}
            </Typography>
            <StatusChip label={paymentText(data.status)} />
          </Stack>
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              Nội dung chuyển khoản
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {data.transferDescription || 'Không có nội dung'}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              Tham chiếu sao kê
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {data.statementReference}
            </Typography>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {data.reason === 'verified_excess_payment_pending_review'
            ? 'Đã phân bổ đủ hóa đơn từ giao dịch có tiền thừa. Xem trạng thái xử lý tại mục hoàn tiền.'
            : paymentText(data.reason)}
        </Typography>
        {data.allocatedAmount !== undefined && (
          <Typography variant="body2" sx={{ fontWeight: 650 }}>
            Đã phân bổ: {formatContractMoney(data.allocatedAmount)} · Chưa phân bổ:{' '}
            {formatContractMoney(data.unallocatedAmount ?? '0')}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          Trạng thái và số tiền phân bổ được xác nhận từ máy chủ. Việc chọn hóa đơn ở đây chưa ghi
          nhận thanh toán.
        </Typography>
        {notice && <Alert severity="info">{notice}</Alert>}
        {data.status === 'PendingReview' && (
          <Alert severity="info">
            Cần Owner đối chiếu hóa đơn và người thực trả trước khi ghi nhận số tiền phân bổ.
          </Alert>
        )}
        {data.status === 'Allocated' &&
          data.unallocatedAmount !== undefined &&
          /^0*(?:\.0+)?$/.test(data.unallocatedAmount) === false && (
            <Button variant="outlined" onClick={() => setRefundsOpen(true)}>
              Xử lý hoàn tiền thừa
            </Button>
          )}
        {refundsOpen && <RefundPanel key={transfer.id} sourceId={transfer.id} />}
        {(data.status === 'ExcessRefundPending' || data.status === 'ExcessRefundCompleted') && (
          <ReceiptExcessPanel key={`${transfer.id}:${invoiceId}`} transferId={transfer.id} />
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
          <Box
            sx={{
              bgcolor: 'action.hover',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              p: { xs: 1.5, sm: 2 },
            }}
          >
            <Stack spacing={2}>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                <CheckCircle2 size={18} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Xác minh và phân bổ giao dịch
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Bước 1/2 · Chọn hóa đơn cần nhận tiền theo nội dung sao kê.
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ gap: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Hóa đơn đối soát
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {invoiceLabel ||
                      (invoiceId
                        ? 'Đang xem hóa đơn gợi ý từ giao dịch. Kiểm tra trước khi phân bổ.'
                        : 'Chưa chọn hóa đơn để phân bổ.')}
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={busy}
                  onClick={() => setChoosing(true)}
                >
                  Chọn hóa đơn cần phân bổ
                </Button>
              </Stack>
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
              {hasInvoice ? (
                <Stack spacing={1.5}>
                  <Typography variant="caption" color="text.secondary">
                    Bước 2/2 · Kiểm tra người trả rồi xác nhận theo bằng chứng sao kê.
                  </Typography>
                  <TextField
                    size="small"
                    select
                    fullWidth
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
                  {payers.isPending && (
                    <LinearProgress aria-label="Đang tải người trả có thể chọn" />
                  )}
                  {payers.error && (
                    <Alert
                      severity="error"
                      action={<Button onClick={() => void payers.refetch()}>Thử lại</Button>}
                    >
                      {paymentError(payers.error)}
                    </Alert>
                  )}
                  <FormControlLabel
                    control={
                      <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                    }
                    label="Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng"
                  />
                  <Button
                    variant="contained"
                    disabled={busy || !!latest.error || !checked || !payers.data}
                    onClick={() => setConfirm(true)}
                    sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                  >
                    Xác nhận phân bổ tiền
                  </Button>
                </Stack>
              ) : (
                <Alert severity="info">
                  Chọn hóa đơn trước khi xác nhận người trả và phân bổ tiền.
                </Alert>
              )}
              <Divider />
              <Button
                type="button"
                size="small"
                aria-expanded={rejectOpen}
                onClick={() => setRejectOpen((value) => !value)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {rejectOpen ? 'Thu gọn lý do không phân bổ' : 'Không tìm được hóa đơn phù hợp?'}
              </Button>
              <Collapse in={rejectOpen} timeout="auto">
                <Stack spacing={1.5}>
                  <Typography variant="caption" color="text.secondary">
                    Chỉ chọn không phân bổ khi Owner đã kiểm tra bằng chứng và có lý do cụ thể.
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    label="Lý do không phân bổ"
                    value={reject}
                    onChange={(e) => {
                      setReject(e.target.value);
                      key.current = crypto.randomUUID();
                    }}
                  />
                  <Button
                    color="error"
                    variant="outlined"
                    disabled={busy || !!latest.error || !reject.trim()}
                    onClick={() => void perform(true)}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Không phân bổ giao dịch
                  </Button>
                </Stack>
              </Collapse>
            </Stack>
          </Box>
        )}
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Trường hợp cần xử lý bổ sung
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Chỉ sử dụng khi người trả không có hồ sơ trong hệ thống hoặc khi có vấn đề về tiền thừa.
          </Typography>
          <ExternalPaymentPayerPanel transferId={transfer.id} />
          {data.status === 'PendingReview' && hasInvoice && (
            <>
              <Button
                size="small"
                aria-expanded={excessOpen}
                onClick={() => setExcessOpen((value) => !value)}
                sx={{ mt: 1 }}
              >
                {excessOpen ? 'Ẩn xử lý tiền thừa' : 'Kiểm tra trường hợp phải hoàn toàn bộ tiền'}
              </Button>
              <Collapse in={excessOpen} timeout="auto" unmountOnExit>
                <ReceiptExcessPanel
                  key={`${transfer.id}:${invoiceId}`}
                  transferId={transfer.id}
                  target={{ invoiceId }}
                />
              </Collapse>
            </>
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {!!history.data?.items.length && (
          <Stack spacing={1} sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
            <Typography variant="subtitle2">Lịch sử xử lý giao dịch</Typography>
            {history.data.items.map((item) => (
              <Typography key={item.sequence} variant="body2" color="text.secondary">
                {formatInstant(item.occurredAt)} · {paymentText(item.decision)} ·{' '}
                {item.decision === 'Rejected' ? item.reason : paymentText(item.reason)}
              </Typography>
            ))}
          </Stack>
        )}
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
