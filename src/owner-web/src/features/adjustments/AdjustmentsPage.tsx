import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
  adjustmentError,
  adjustmentStatus,
  signedVnd,
  type Adjustment,
  type AdjustmentDecisionInput,
  type AdjustmentFinancials,
} from '../../../../../packages/client-core/src/adjustments';
import { formatContractMoney, vnd } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { PageHeader, FilterToolbar } from '../../components/common/PortalUI';
import { useAdjustmentApi } from './useAdjustmentApi';
import { isMockMode } from '../../services/config';

export default function AdjustmentsPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader
        title="Điều chỉnh hóa đơn"
        subtitle="Owner xem xét yêu cầu và kết quả tài chính."
      />
      {isMockMode ? (
        <Alert severity="info">Bật chế độ API để sử dụng luồng điều chỉnh hóa đơn.</Alert>
      ) : (
        <OwnerAdjustmentList
          invoiceId={params.get('invoiceId') ?? ''}
          requestId={params.get('requestId') ?? ''}
        />
      )}
    </>
  );
}
export function OwnerAdjustmentList({
  invoiceId = '',
  requestId = '',
}: {
  invoiceId?: string;
  requestId?: string;
}) {
  const api = useAdjustmentApi(),
    { session } = useAuth();
  const actor = session?.userId ?? '';
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [invoice, setInvoice] = useState(invoiceId),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(requestId);
  const filter = { page, locationId: location, roomId: room, invoiceId: invoice, status };
  const list = useQuery({
    queryKey: ['adjustments', actor, filter],
    queryFn: ({ signal }) => api.list(filter, signal),
  });
  const locations = useQuery({
    queryKey: ['adjustment-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['adjustment-rooms', actor, location],
    enabled: !!location,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  return (
    <Stack spacing={2}>
      <FilterToolbar>
        <TextField
          select
          label="Cơ sở điều chỉnh"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            setRoom('');
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả cơ sở</MenuItem>
          {locations.data?.map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Phòng điều chỉnh"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả phòng</MenuItem>
          {rooms.data?.map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.label}
            </MenuItem>
          ))}
        </TextField>
        {!invoiceId && (
          <TextField
            label="Lọc theo mã hóa đơn"
            value={invoice}
            onChange={(e) => {
              setInvoice(e.target.value);
              setPage(1);
            }}
          />
        )}
        <TextField
          select
          label="Trạng thái yêu cầu"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả trạng thái</MenuItem>
          {['Pending', 'Approved', 'Rejected'].map((x) => (
            <MenuItem key={x} value={x}>
              {adjustmentStatus(x)}
            </MenuItem>
          ))}
        </TextField>
      </FilterToolbar>
      {(list.isPending || locations.isPending) && <LinearProgress />}
      {(list.error || locations.error || rooms.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void list.refetch();
                void locations.refetch();
                void rooms.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {adjustmentError(list.error || locations.error || rooms.error)}
        </Alert>
      )}
      {!list.error && !list.isPending && list.data?.items.length === 0 && (
        <Alert severity="info">Không có yêu cầu phù hợp.</Alert>
      )}
      {list.data?.items.map((x) => (
        <Paper key={x.id} sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography>
              {x.locationName} · Phòng {x.roomNumber} · {x.billingPeriod.slice(0, 7)} ·{' '}
              {x.invoiceStatus === 'Draft' ? 'Nháp' : 'Đã phát hành'}
            </Typography>
            <Typography>
              {adjustmentStatus(x.status)} · {x.chargeCode ?? 'Toàn hóa đơn'} · Giá trị khi gửi:{' '}
              {formatContractMoney(x.currentAmount)}
            </Typography>
            <Button onClick={() => setSelected(x.id)}>Xem yêu cầu điều chỉnh</Button>
          </Stack>
        </Paper>
      ))}
      <Stack direction="row" spacing={2}>
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Yêu cầu trước
        </Button>
        <Typography>Trang {page}</Typography>
        <Button
          disabled={!list.data || page * 20 >= list.data.totalCount}
          onClick={() => setPage(page + 1)}
        >
          Yêu cầu sau
        </Button>
      </Stack>
      {selected && <OwnerAdjustmentDetail key={selected} id={selected} />}
    </Stack>
  );
}
export function FinancialSummary({ value }: { value: AdjustmentFinancials }) {
  return (
    <Stack spacing={1}>
      <Typography>Tiền hóa đơn gốc: {formatContractMoney(value.originalIssuedAmount)}</Typography>
      <Typography>Điều chỉnh sau phát hành: {signedVnd(value.approvedAdjustmentTotal)}</Typography>
      <Typography>
        Nghĩa vụ hiện hành: {formatContractMoney(value.effectivePayableAmount)} · Đã xác minh:{' '}
        {formatContractMoney(value.allocatedPayments)}
      </Typography>
      <Typography>Còn phải trả: {formatContractMoney(value.outstandingAmount)}</Typography>
      {value.reviewStatus === 'PendingReview' && (
        <Alert severity="warning">
          Tiền thừa chờ xem xét: {formatContractMoney(value.potentialExcessAmount)}. Chưa hoàn tiền
          hoặc chuyển credit.
        </Alert>
      )}
    </Stack>
  );
}
export function OwnerAdjustmentDetail({ id }: { id: string }) {
  const api = useAdjustmentApi(),
    { session } = useAuth(),
    cache = useQueryClient();
  const detail = useQuery({
    queryKey: ['adjustment', session?.userId, id],
    queryFn: ({ signal }) => api.get(id, signal),
  });
  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Chi tiết yêu cầu điều chỉnh</Typography>
        {detail.isPending && <LinearProgress />}
        {detail.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void detail.refetch()}>Tải lại yêu cầu</Button>}
          >
            {adjustmentError(detail.error)}
          </Alert>
        )}
        {detail.data && (
          <>
            <Typography>
              {detail.data.locationName} · Phòng {detail.data.roomNumber} ·{' '}
              {adjustmentStatus(detail.data.status)}
            </Typography>
            <Typography>Lý do yêu cầu: {detail.data.reason}</Typography>
            <Typography>
              Khoản tranh chấp: {detail.data.chargeCode ?? 'Toàn hóa đơn'} · Khi gửi:{' '}
              {formatContractMoney(detail.data.currentAmount)} · Đề xuất:{' '}
              {detail.data.proposedAmount === null
                ? 'Chưa đề xuất'
                : formatContractMoney(detail.data.proposedAmount)}
            </Typography>
            <Typography>
              Giá trị hiện hành của khoản yêu cầu:{' '}
              {detail.data.currentChargeAmount === null
                ? 'Khoản nguồn đã thay đổi'
                : formatContractMoney(detail.data.currentChargeAmount)}
            </Typography>
            <Typography>
              Hóa đơn gốc khi gửi: {snapshotTotal(detail.data)} · Gửi lúc{' '}
              {formatInstant(detail.data.submittedAt)}
            </Typography>
            {detail.data.currentInvoice.lines.map((line) => (
              <Typography key={line.id}>
                {line.name}: {formatContractMoney(line.amount)}
                {line.calculatedAmount != null
                  ? ` · Trước correction: ${formatContractMoney(line.calculatedAmount)}`
                  : ''}
              </Typography>
            ))}
            {detail.data.financials && <FinancialSummary value={detail.data.financials} />}
            {detail.data.evidence.map((e, index) => (
              <PrivateEvidence key={e.id} requestId={id} fileId={e.id} number={index + 1} />
            ))}
            {detail.data.decision && (
              <Alert severity={detail.data.status === 'Approved' ? 'success' : 'info'}>
                {adjustmentStatus(detail.data.status)} · {detail.data.decision.reason} ·{' '}
                {formatInstant(detail.data.decision.decidedAt)} · Thay đổi{' '}
                {signedVnd(detail.data.decision.delta)}
              </Alert>
            )}
            {detail.data.status === 'Pending' && (
              <DecisionForm
                key={`${id}:${detail.data.currentInvoice.version}:${detail.data.currentFinancialVersion}`}
                value={detail.data}
                saved={async () => {
                  await Promise.all(
                    [
                      'adjustments',
                      'adjustment',
                      'invoice',
                      'invoices',
                      'invoice-payment',
                      'payment-invoices',
                      'debt-summary',
                      'payment-history',
                      'transfer-instructions',
                    ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
                  );
                }}
              />
            )}
            <Button onClick={() => void detail.refetch()}>Tải lại yêu cầu</Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}
function snapshotTotal(value: Adjustment) {
  // Read exact legacy JSON numeric tokens without passing money through binary Number.
  const match = /"Total"\s*:\s*(?:"(\d+)"|(\d+)(?:\.0+)?)/.exec(value.invoiceSnapshot);
  return match ? formatContractMoney(match[1] ?? match[2]!) : 'Không đọc được snapshot';
}
function DecisionForm({ value, saved }: { value: Adjustment; saved: () => Promise<void> }) {
  const api = useAdjustmentApi();
  const [amount, setAmount] = useState(value.proposedAmount ?? ''),
    [reason, setReason] = useState(''),
    [code, setCode] = useState(value.chargeCode ?? ''),
    [checked, setChecked] = useState(false),
    [confirm, setConfirm] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    key = useRef(crypto.randomUUID());
  const changed = () => {
    key.current = crypto.randomUUID();
    setChecked(false);
  };
  async function decide() {
    if (lock.current || confirm === null) return;
    let input: AdjustmentDecisionInput;
    try {
      input = {
        expectedVersion: value.version,
        expectedInvoiceVersion: value.currentInvoice.version,
        expectedFinancialVersion: value.currentFinancialVersion,
        correctedAmount: confirm ? vnd(amount) : null,
        chargeCode: code || null,
        reason: reason.trim(),
        humanConfirmed: checked,
      };
      if (!input.reason || !checked) throw new Error();
    } catch {
      setError('Nhập số nguyên VND, lý do và xác nhận đã kiểm tra.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.decide(value.id, confirm, input, key.current);
      setConfirm(null);
      await saved();
    } catch (e) {
      setError(adjustmentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {value.currentInvoice.status === 'Draft'
          ? 'Correction chỉ sửa giá trị khoản phí trong bản nháp; không đổi chỉ số hoặc biểu giá nguồn.'
          : 'Điều chỉnh được lưu riêng. Hóa đơn đã phát hành và payment gốc được giữ nguyên.'}
      </Alert>
      <TextField
        select
        label="Khoản phí Owner xem xét"
        value={code}
        disabled={!!value.chargeCode || busy}
        onChange={(e) => {
          setCode(e.target.value);
          changed();
        }}
      >
        <MenuItem value="">
          {value.currentInvoice.status === 'Draft' ? 'Chọn khoản phí' : 'Toàn hóa đơn'}
        </MenuItem>
        {value.currentInvoice.lines.map((l) => (
          <MenuItem key={l.id} value={l.chargeCode}>
            {l.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Giá trị sau điều chỉnh (VND)"
        value={amount}
        disabled={busy}
        onChange={(e) => {
          setAmount(e.target.value);
          changed();
        }}
      />
      <TextField
        label="Lý do quyết định"
        value={reason}
        multiline
        slotProps={{ htmlInput: { maxLength: 2000 } }}
        disabled={busy}
        onChange={(e) => {
          setReason(e.target.value);
          changed();
        }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={checked}
            disabled={busy}
            onChange={(e) => setChecked(e.target.checked)}
          />
        }
        label="Tôi đã kiểm tra hóa đơn, số dư và bằng chứng"
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={2}>
        <Button
          disabled={
            busy ||
            !checked ||
            !reason.trim() ||
            !amount ||
            (value.currentInvoice.status === 'Draft' && !code)
          }
          variant="contained"
          onClick={() => setConfirm(true)}
        >
          Phê duyệt điều chỉnh
        </Button>
        <Button disabled={busy || !checked || !reason.trim()} onClick={() => setConfirm(false)}>
          Từ chối yêu cầu
        </Button>
      </Stack>
      <Dialog open={confirm !== null} onClose={() => !busy && setConfirm(null)}>
        <DialogTitle>
          {confirm ? 'Xác nhận phê duyệt điều chỉnh?' : 'Xác nhận từ chối yêu cầu?'}
        </DialogTitle>
        <DialogContent>
          Quyết định và lịch sử sẽ được lưu. Tiền thừa nếu có sẽ chờ xem xét theo chính sách.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            Quay lại
          </Button>
          <Button disabled={busy} onClick={() => void decide()}>
            Xác nhận quyết định
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
function PrivateEvidence({
  requestId,
  fileId,
  number,
}: {
  requestId: string;
  fileId: string;
  number: number;
}) {
  const api = useAdjustmentApi();
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <Box>
      <Button
        disabled={busy || !!url}
        onClick={() => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void api
            .evidence(requestId, fileId)
            .then((blob) => setUrl(URL.createObjectURL(blob)))
            .catch((e) => setError(adjustmentError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        Xem bằng chứng {number}
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {url && (
        <Box
          component="img"
          src={url}
          alt={`Bằng chứng điều chỉnh ${number}`}
          sx={{ display: 'block', maxWidth: '100%', maxHeight: 480 }}
        />
      )}
    </Box>
  );
}
