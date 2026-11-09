import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
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
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import {
  paymentError,
  paymentText,
  type BankAccount,
} from '../../../../../packages/client-core/src/payments';
import { PageHeader } from '../../components/common/PortalUI';
import { usePaymentApi } from './usePaymentApi';
import {
  OwnerInvoicePaymentPanel,
  ReconcileTransfer,
  RecordTransferForm,
} from './OwnerInvoicePaymentPanel';

export function PaymentManagementPage({ debtOnly = false }: { debtOnly?: boolean }) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const cache = useQueryClient();
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [period, setPeriod] = useState(''),
    [status, setStatus] = useState(''),
    [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(''),
    [transferPage, setTransferPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [recordUnmatched, setRecordUnmatched] = useState(false);
  const filter = {
    page,
    locationId: location,
    roomId: room,
    billingPeriod: period ? period + '-01' : '',
    paymentStatus: status,
    overdueOnly: overdue,
  };
  const locations = useQuery({
    queryKey: ['payment-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['payment-rooms', actor, location],
    enabled: !!location,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  const invoices = useQuery({
    queryKey: ['payment-invoices', actor, debtOnly, filter],
    queryFn: ({ signal }) => (debtOnly ? api.debts(filter, signal) : api.invoices(filter, signal)),
  });
  const transfers = useQuery({
    queryKey: ['payment-transfers', actor, location, transferPage],
    enabled: !debtOnly,
    queryFn: ({ signal }) => api.transfers({ page: transferPage, locationId: location }, signal),
  });
  const history = useQuery({
    queryKey: ['payment-history', actor, { ...filter, page: historyPage }],
    queryFn: ({ signal }) => api.history({ ...filter, page: historyPage }, signal),
  });
  return (
    <>
      <PageHeader
        title={debtOnly ? 'Công nợ phòng' : 'Thanh toán & Đối soát'}
        subtitle="Số dư dùng chung trên hóa đơn phòng. Owner xác minh sao kê; không sửa số tiền hóa đơn Final."
      />
      <Stack spacing={2}>
        <Button
          disabled={invoices.isFetching || history.isFetching}
          onClick={() =>
            void cache.invalidateQueries({
              predicate: (q) =>
                [
                  'payment-invoices',
                  'payment-history',
                  'payment-transfers',
                  'invoice-payment',
                ].includes(String(q.queryKey[0])),
            })
          }
        >
          Làm mới đối soát và công nợ
        </Button>
        {!debtOnly && (
          <Button onClick={() => setRecordUnmatched(true)}>
            Ghi nhận giao dịch chưa xác định hóa đơn
          </Button>
        )}
        {recordUnmatched && (
          <Paper sx={{ p: 2 }}>
            <RecordTransferForm invoiceId="" onClose={() => setRecordUnmatched(false)} />
          </Paper>
        )}
        <TextField
          select
          label="Cơ sở thanh toán"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            setRoom('');
            setPage(1);
            setTransferPage(1);
            setHistoryPage(1);
          }}
        >
          <MenuItem value="">Tất cả cơ sở</MenuItem>
          {locations.data?.map((l) => (
            <MenuItem key={l.id} value={l.id}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Phòng cần theo dõi"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setPage(1);
            setHistoryPage(1);
          }}
        >
          <MenuItem value="">Tất cả phòng</MenuItem>
          {rooms.data?.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="month"
          label="Kỳ hóa đơn cần lọc"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setPage(1);
            setHistoryPage(1);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {!debtOnly && (
          <TextField
            select
            label="Trạng thái thanh toán"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
              setHistoryPage(1);
            }}
          >
            <MenuItem value="">Tất cả</MenuItem>
            <MenuItem value="Unpaid">Chưa thanh toán</MenuItem>
            <MenuItem value="Paid">Đã thanh toán</MenuItem>
          </TextField>
        )}
        <FormControlLabel
          control={
            <Checkbox
              checked={overdue}
              onChange={(e) => {
                setOverdue(e.target.checked);
                setPage(1);
                setHistoryPage(1);
              }}
            />
          }
          label="Chỉ hóa đơn quá hạn"
        />
        {(locations.error || rooms.error) && (
          <Alert severity="error">{paymentError(locations.error || rooms.error)}</Alert>
        )}
        {invoices.isPending && <LinearProgress />}
        {invoices.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void invoices.refetch()}>Thử lại</Button>}
          >
            {paymentError(invoices.error)}
          </Alert>
        )}
        {invoices.data?.items.length === 0 && (
          <Alert severity="info">Không có hóa đơn phù hợp bộ lọc.</Alert>
        )}
        {invoices.data && <Typography>{invoices.data.totalCount} hóa đơn trong bộ lọc</Typography>}
        {invoices.data?.items.map((invoice) => (
          <Paper key={invoice.invoiceId} sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Typography>
                {invoice.locationName} · Phòng {invoice.roomNumber} ·{' '}
                {invoice.billingPeriod.slice(0, 7)}
              </Typography>
              <Typography>
                {paymentText(invoice.paymentStatus)} · Còn phải trả{' '}
                {formatContractMoney(invoice.outstandingAmount)} · Quá hạn {invoice.overdueDays}{' '}
                ngày
              </Typography>
              <Typography>
                Hạn thanh toán: {invoice.dueDate.split('-').reverse().join('/')}
              </Typography>
              <Button onClick={() => setSelected(invoice.invoiceId)}>Mở thanh toán hóa đơn</Button>
            </Stack>
          </Paper>
        ))}
        <Stack direction="row" spacing={2}>
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Trang trước
          </Button>
          <Typography>Trang {page}</Typography>
          <Button
            disabled={!invoices.data || page * 20 >= invoices.data.totalCount}
            onClick={() => setPage(page + 1)}
          >
            Trang sau
          </Button>
        </Stack>
        {selected && <OwnerInvoicePaymentPanel key={selected} invoiceId={selected} />}
        {!debtOnly && location && <ReceivingAccountForm locationId={location} />}
        {!debtOnly && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Giao dịch ngân hàng đã ghi nhận</Typography>
              {transfers.isPending && <LinearProgress />}
              {transfers.error && (
                <Alert
                  severity="error"
                  action={<Button onClick={() => void transfers.refetch()}>Thử lại</Button>}
                >
                  {paymentError(transfers.error)}
                </Alert>
              )}
              {transfers.data?.items.length === 0 && <Typography>Chưa có giao dịch.</Typography>}
              {transfers.data?.items.map((transfer) => (
                <ReconcileTransfer key={transfer.id} transfer={transfer} />
              ))}
              <Stack direction="row">
                <Button
                  disabled={transferPage === 1}
                  onClick={() => setTransferPage(transferPage - 1)}
                >
                  Giao dịch trước
                </Button>
                <Button
                  disabled={!transfers.data || transferPage * 20 >= transfers.data.totalCount}
                  onClick={() => setTransferPage(transferPage + 1)}
                >
                  Giao dịch sau
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Lịch sử thanh toán đã xác minh</Typography>
            {history.isPending && <LinearProgress />}
            {history.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void history.refetch()}>Thử lại</Button>}
              >
                {paymentError(history.error)}
              </Alert>
            )}
            {history.data?.items.length === 0 && (
              <Typography>Chưa có thanh toán đã phân bổ.</Typography>
            )}
            {history.data?.items.map((item) => (
              <Typography key={item.id}>
                {item.locationName} · {item.roomNumber} · {item.billingPeriod.slice(0, 7)} ·{' '}
                {formatInstant(item.paidAt)} · {formatContractMoney(item.amount)} · Tham chiếu{' '}
                {item.bankReference}
              </Typography>
            ))}
            <Stack direction="row" spacing={1}>
              <Button
                disabled={historyPage === 1 || history.isFetching}
                onClick={() => setHistoryPage(historyPage - 1)}
              >
                Lịch sử trước
              </Button>
              <Typography>
                Trang lịch sử {historyPage} · {history.data?.totalCount ?? 0} thanh toán
              </Typography>
              <Button
                disabled={
                  history.isFetching || !history.data || historyPage * 20 >= history.data.totalCount
                }
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                Lịch sử sau
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Stack>
    </>
  );
}
function ReceivingAccountForm({ locationId }: { locationId: string }) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const account = useQuery({
    queryKey: ['receiving-account', actor, locationId],
    queryFn: ({ signal }) => api.account(locationId, signal),
  });
  return (
    <>
      {account.isPending && <LinearProgress />}
      {account.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void account.refetch()}>Thử lại</Button>}
        >
          {paymentError(account.error)}
        </Alert>
      )}
      {account.isSuccess && (
        <AccountEditor
          key={locationId + ':' + (account.data?.version ?? 0)}
          current={account.data}
          locationId={locationId}
          saved={() => void account.refetch()}
        />
      )}
    </>
  );
}
function AccountEditor({
  current,
  locationId,
  saved,
}: {
  current: BankAccount | null;
  locationId: string;
  saved: () => void;
}) {
  const api = usePaymentApi();
  const [bank, setBank] = useState(current?.bankIdentifier ?? ''),
    [number, setNumber] = useState(current?.accountNumber ?? ''),
    [holder, setHolder] = useState(current?.accountHolder ?? '');
  const [enabled, setEnabled] = useState(current?.enabled ?? false),
    [demo, setDemo] = useState(current?.isDevelopmentDemo ?? false),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void api
            .saveAccount({
              locationId,
              bankIdentifier: bank,
              accountNumber: number,
              accountHolder: holder,
              enabled,
              isDevelopmentDemo: demo,
              version: current?.version ?? 0,
            })
            .then(saved)
            .catch((e) => setError(paymentError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Typography variant="h6">Tài khoản nhận tiền của cơ sở</Typography>
        <TextField
          required
          label="BIN ngân hàng (6 số)"
          value={bank}
          onChange={(e) => {
            setBank(e.target.value);
            setChecked(false);
          }}
        />
        <TextField
          required
          label="Số tài khoản nhận tiền"
          value={number}
          onChange={(e) => {
            setNumber(e.target.value);
            setChecked(false);
          }}
        />
        <TextField
          required
          label="Chủ tài khoản (in hoa không dấu)"
          value={holder}
          onChange={(e) => {
            setHolder(e.target.value.toUpperCase());
            setChecked(false);
          }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setChecked(false);
              }}
            />
          }
          label="Bật hướng dẫn nhận tiền"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={demo}
              onChange={(e) => {
                setDemo(e.target.checked);
                setChecked(false);
              }}
            />
          }
          label="Tài khoản tổng hợp Development/Testing"
        />
        <FormControlLabel
          control={<Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />}
          label="Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận"
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" disabled={busy || !checked}>
          Lưu tài khoản nhận tiền
        </Button>
      </Stack>
    </Paper>
  );
}
