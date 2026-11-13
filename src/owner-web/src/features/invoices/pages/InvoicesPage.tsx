import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Stepper,
  Step,
  StepLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  invoiceError,
  formatBillingDecimal,
  hasSettlementUsageCoverage,
  hasSettlementFixedCoverage,
  invoicePersonMonths,
  missingBillingInput,
  type InvoiceListFilter,
} from '../../../../../../packages/client-core/src/invoices';
import { formatContractMoney } from '../../../../../../packages/client-core/src/contracts';
import { PageHeader, FilterToolbar } from '../../../components/common/PortalUI';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { useInvoiceApi } from '../useInvoiceApi';
import { OwnerInvoicePaymentPanel } from '../../payments/OwnerInvoicePaymentPanel';

export default function InvoicesPage() {
  return isMockMode ? <ResourcePage kind="invoices" variant="table" /> : <LiveInvoicesPage />;
}
export function LiveInvoicesPage() {
  const [deepParams] = useSearchParams();
  const api = useInvoiceApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const cache = useQueryClient();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(deepParams.get('invoiceId') ?? '');
  const [roomId, setRoomId] = useState(''),
    [period, setPeriod] = useState(''),
    [contractId, setContractId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterLocation, setFilterLocation] = useState(''),
    [filterPeriod, setFilterPeriod] = useState(''),
    [filterStatus, setFilterStatus] = useState<'' | 'Draft' | 'Final'>('');
  const [creating, setCreating] = useState(false),
    [draftStep, setDraftStep] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const locations = useQuery({
    queryKey: ['invoice-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['invoice-rooms', actor, locationId],
    enabled: !!locationId,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${locationId}/rooms`,
        { signal },
      ),
  });
  const contracts = useQuery({
    queryKey: ['invoice-contracts', actor, roomId],
    enabled: creating && !!roomId,
    queryFn: ({ signal }) =>
      api.request<{
        periods: {
          contractId: string;
          contractStatus: string;
          from: string;
          to: string;
          occupants: { displayLabel: string }[];
        }[];
      }>(`/api/v1/rooms/${roomId}/occupancy-history`, { signal }),
  });
  const filterRooms = useQuery({
    queryKey: ['invoice-filter-rooms', actor, filterLocation],
    enabled: !!filterLocation,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${filterLocation}/rooms`,
        { signal },
      ),
  });
  const filters: InvoiceListFilter = {
    locationId: filterLocation || undefined,
    billingPeriod: filterPeriod ? filterPeriod + '-01' : undefined,
    status: filterStatus || undefined,
  };
  const list = useQuery({
    queryKey: ['invoices', actor, page, filterRoom, filters],
    queryFn: ({ signal }) => api.list(page, signal, filterRoom, filters),
  });
  const detail = useQuery({
    queryKey: ['invoice', actor, selected],
    enabled: !!selected,
    queryFn: ({ signal }) => api.get(selected, signal),
  });
  async function mutate(work: () => Promise<{ id: string }>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await work();
      setSelected(result.id);
      setCreating(false);
      setConfirm(false);
      await cache.invalidateQueries({ queryKey: ['invoices', actor] });
      await cache.invalidateQueries({ queryKey: ['invoice', actor] });
    } catch (e) {
      setError(invoiceError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const invoice = detail.data;
  return (
    <>
      <PageHeader
        title="Hóa đơn phòng"
        subtitle="Nháp → Kiểm tra chi phí → Phát hành. Số tiền do hệ thống tính từ chỉ số đã xác nhận và cấu hình Owner."
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setDraftStep(0);
              setCreating(true);
            }}
          >
            Lập hóa đơn nháp
          </Button>
        }
      />
      <Stack spacing={2}>
        <FilterToolbar>
          <TextField
            select
            label="Cơ sở lọc hóa đơn"
            value={filterLocation}
            onChange={(e) => {
              setFilterLocation(e.target.value);
              setFilterRoom('');
              setPage(1);
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
            label="Lọc danh sách hóa đơn theo phòng"
            value={filterRoom}
            onChange={(e) => {
              setFilterRoom(e.target.value);
              setPage(1);
            }}
            disabled={!filterLocation}
            helperText={!filterLocation ? 'Chọn cơ sở để lọc theo phòng' : undefined}
          >
            <MenuItem value="">Tất cả phòng</MenuItem>
            {filterRooms.data?.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="month"
            label="Kỳ hóa đơn cần lọc"
            value={filterPeriod}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(e) => {
              setFilterPeriod(e.target.value);
              setPage(1);
            }}
          />
          <TextField
            select
            label="Trạng thái hóa đơn"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value as '' | 'Draft' | 'Final');
              setPage(1);
            }}
          >
            <MenuItem value="">Tất cả trạng thái</MenuItem>
            <MenuItem value="Draft">Nháp</MenuItem>
            <MenuItem value="Final">Đã phát hành</MenuItem>
          </TextField>
          <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
            Làm mới hóa đơn
          </Button>
        </FilterToolbar>
        {(locations.error || filterRooms.error) && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  void locations.refetch();
                  if (filterLocation) void filterRooms.refetch();
                }}
              >
                Thử lại bộ lọc
              </Button>
            }
          >
            {invoiceError(locations.error || filterRooms.error)}
          </Alert>
        )}
        {list.data && !list.error && (
          <Typography variant="body2">
            {list.data.totalCount} hóa đơn trong bộ lọc · Nháp và đã phát hành được phân biệt theo
            trạng thái.
          </Typography>
        )}
        <Button component={Link} to="/payments">
          Theo dõi thanh toán và số dư
        </Button>
        <Dialog
          open={creating}
          onClose={busy ? undefined : () => setCreating(false)}
          maxWidth="sm"
          fullWidth
          aria-labelledby="invoice-draft-title"
        >
          <DialogTitle id="invoice-draft-title">Lập hóa đơn nháp</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              {!!error && <Alert severity="error">{error}</Alert>}
              <Stepper activeStep={draftStep}>
                <Step>
                  <StepLabel>Phòng và kỳ</StepLabel>
                </Step>
                <Step>
                  <StepLabel>Hợp đồng đại diện</StepLabel>
                </Step>
              </Stepper>
              <Stack spacing={2} sx={{ display: draftStep === 0 ? 'flex' : 'none', pt: 1 }}>
                <TextField
                  select
                  label="Cơ sở"
                  value={locationId}
                  onChange={(e) => {
                    setLocationId(e.target.value);
                    setRoomId('');
                    setContractId('');
                  }}
                >
                  <MenuItem value="">Chọn cơ sở</MenuItem>
                  {locations.data?.map((l) => (
                    <MenuItem value={l.id} key={l.id}>
                      {l.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Phòng"
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    setContractId('');
                  }}
                >
                  <MenuItem value="">Chọn phòng</MenuItem>
                  {rooms.data?.map((r) => (
                    <MenuItem value={r.id} key={r.id}>
                      {r.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Kỳ hóa đơn"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <Stack spacing={2} sx={{ display: draftStep === 1 ? 'flex' : 'none' }}>
                <TextField
                  select
                  label="Hợp đồng đại diện phòng trong kỳ"
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                >
                  <MenuItem value="">Chọn hợp đồng</MenuItem>
                  {contracts.data?.periods
                    .filter((c) =>
                      ['Active', 'Terminated', 'Superseded'].includes(c.contractStatus),
                    )
                    .map((c) => (
                      <MenuItem value={c.contractId} key={c.contractId}>
                        {c.from.split('-').reverse().join('/')} –{' '}
                        {c.to.split('-').reverse().join('/')} ·{' '}
                        {c.occupants.map((o) => o.displayLabel).join(', ')}
                      </MenuItem>
                    ))}
                </TextField>
                <Alert severity="info">
                  Máy chủ kiểm tra hợp đồng đại diện trong kỳ. Bản nháp có dữ liệu thiếu sẽ được giữ
                  để xem xét trước khi phát hành.
                </Alert>
              </Stack>
              {(locations.error || rooms.error || contracts.error) && (
                <Alert severity="error">
                  {invoiceError(locations.error || rooms.error || contracts.error)}
                </Alert>
              )}
              {(locations.isPending ||
                (!!locationId && rooms.isPending) ||
                (!!roomId && contracts.isPending)) && <LinearProgress />}
              <Button
                sx={{ display: draftStep === 1 ? 'inline-flex' : 'none' }}
                variant="contained"
                disabled={
                  busy ||
                  !roomId ||
                  !/^\d{4}-\d{2}$/.test(period) ||
                  !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(contractId)
                }
                onClick={() => void mutate(() => api.draft(roomId, period + '-01', contractId))}
              >
                Tạo / mở bản nháp
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setCreating(false)}>
              Hủy lập nháp
            </Button>
            {draftStep === 1 && (
              <Button disabled={busy} onClick={() => setDraftStep(0)}>
                Quay lại chọn phòng
              </Button>
            )}
            {draftStep === 0 && (
              <Button
                disabled={!roomId || !/^\d{4}-\d{2}$/.test(period)}
                variant="contained"
                onClick={() => setDraftStep(1)}
              >
                Tiếp tục chọn hợp đồng
              </Button>
            )}
          </DialogActions>
        </Dialog>
        {error && <Alert severity="error">{error}</Alert>}
        {list.isPending && <LinearProgress />}
        {list.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
          >
            {invoiceError(list.error)}
          </Alert>
        )}
        {!list.error && !list.isPending && list.data?.items.length === 0 && (
          <Alert severity="info">Chưa có hóa đơn.</Alert>
        )}
        {list.data?.items.map((item) => (
          <Paper sx={{ p: 2 }} key={item.id}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography>
                {item.locationName} · Phòng {item.roomNumber} · {item.billingPeriod.slice(0, 7)}
              </Typography>
              <Chip label={item.status === 'Final' ? 'Đã phát hành' : 'Nháp'} />
              <Typography>{formatContractMoney(item.total)}</Typography>
              <Button onClick={() => setSelected(item.id)}>Xem chi tiết</Button>
            </Stack>
          </Paper>
        ))}
        <Stack direction="row" spacing={2}>
          <Button disabled={page === 1 || list.isFetching} onClick={() => setPage(page - 1)}>
            Trang trước
          </Button>
          <Typography>Trang {page}</Typography>
          <Button
            disabled={list.isFetching || !list.data || page * 20 >= list.data.totalCount}
            onClick={() => setPage(page + 1)}
          >
            Trang sau
          </Button>
        </Stack>
        {selected && detail.isPending && <LinearProgress />}
        {detail.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void detail.refetch()}>Thử lại</Button>}
          >
            {invoiceError(detail.error)}
          </Alert>
        )}
        {invoice && (
          <Paper sx={{ p: 3, overflowX: 'auto' }}>
            <Stack spacing={2}>
              <Typography variant="h6">
                Chi tiết hóa đơn · Phòng {invoice.roomNumber} · {invoice.billingPeriod.slice(0, 7)}
              </Typography>
              <Button component={Link} to={`/invoice-adjustments?invoiceId=${invoice.id}`}>
                Yêu cầu điều chỉnh của hóa đơn
              </Button>
              <Typography>
                {invoice.status === 'Final'
                  ? 'Đã phát hành — chi phí được giữ nguyên'
                  : 'Bản nháp để kiểm tra trước khi phát hành'}
              </Typography>
              <Typography>
                Ngày phát hành theo lịch:{' '}
                {invoice.scheduledFinalDate.split('-').reverse().join('/')} · Hạn thanh toán:{' '}
                {invoice.dueDate.split('-').reverse().join('/')}
              </Typography>
              {invoice.missingInputs.length > 0 && (
                <Alert severity="warning">
                  Còn thiếu: {invoice.missingInputs.map(missingBillingInput).join(', ')}. Tổng hiện
                  tại chưa phải số tiền chính thức.
                </Alert>
              )}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['Khoản thu', 'Chỉ số trước → sau', 'Số lượng', 'Đơn giá', 'Số tiền'].map(
                      (t) => (
                        <TableCell key={t}>{t}</TableCell>
                      ),
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoice.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {line.name}
                        <Typography variant="caption" sx={{ display: 'block' }}>
                          Giá ngày {line.rateDate} · {line.occupiedDays}/{line.periodDays} ngày
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {hasSettlementFixedCoverage(line)
                          ? 'Đã loại phần ghi nhận trong khoản phải thu trả phòng'
                          : hasSettlementUsageCoverage(line)
                            ? 'Đã ghi nhận trong khoản phải thu chuyển ra'
                            : line.meterReadingId
                              ? `${formatBillingDecimal(line.previousReading ?? '')} → ${formatBillingDecimal(line.confirmedReading ?? '')}`
                              : '—'}
                      </TableCell>
                      <TableCell>
                        {formatBillingDecimal(line.quantity)}{' '}
                        {line.category === 'Electricity'
                          ? 'kWh'
                          : line.category === 'Water'
                            ? 'm³'
                            : invoicePersonMonths(line)
                              ? 'người'
                              : ''}
                        {invoicePersonMonths(line)?.prorated && (
                          <Typography variant="caption" sx={{ display: 'block' }}>
                            {invoicePersonMonths(line)?.personDays} người-ngày
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {formatBillingDecimal(line.rate)} đ
                        {invoicePersonMonths(line) ? '/người/tháng' : ''}
                      </TableCell>
                      <TableCell>{formatContractMoney(line.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="h6">Tổng: {formatContractMoney(invoice.total)}</Typography>
              {invoice.status === 'Final' && (
                <OwnerInvoicePaymentPanel key={invoice.id} invoiceId={invoice.id} />
              )}
              {invoice.status === 'Draft' && (
                <Stack direction="row" spacing={2}>
                  <Button
                    disabled={busy}
                    onClick={() => void mutate(() => api.refresh(invoice.id, invoice.version))}
                  >
                    Cập nhật đầu vào bản nháp
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy || invoice.missingInputs.length > 0}
                    onClick={() => setConfirm(true)}
                  >
                    Phát hành hóa đơn
                  </Button>
                </Stack>
              )}
            </Stack>
          </Paper>
        )}
        <Dialog open={confirm} onClose={() => !busy && setConfirm(false)}>
          <DialogTitle>Phát hành hóa đơn?</DialogTitle>
          <DialogContent>
            Phòng {invoice?.roomNumber}, kỳ {invoice?.billingPeriod.slice(0, 7)}, tổng{' '}
            {invoice && formatContractMoney(invoice.total)}. Các khoản thu sẽ được giữ nguyên sau
            phát hành.
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Quay lại
            </Button>
            <Button
              disabled={busy || !invoice}
              onClick={() =>
                invoice && void mutate(() => api.finalize(invoice.id, invoice.version))
              }
            >
              Xác nhận phát hành
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </>
  );
}
