import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
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
  TableContainer,
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
  missingBillingInput,
  type InvoiceListFilter,
} from '../../../../../../packages/client-core/src/invoices';
import { formatContractMoney } from '../../../../../../packages/client-core/src/contracts';
import { PageHeader, FilterToolbar, StatusChip } from '../../../components/common/PortalUI';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { useInvoiceApi } from '../useInvoiceApi';
import { OwnerInvoicePaymentPanel } from '../../payments/OwnerInvoicePaymentPanel';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

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
        subtitle="Quản lý hóa đơn theo kỳ. Kiểm tra các khoản thu trước khi phát hành và theo dõi thanh toán sau phát hành."
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setDraftStep(0);
              if (filterLocation) setLocationId(filterLocation);
              if (filterRoom) setRoomId(filterRoom);
              if (filterPeriod) setPeriod(filterPeriod);
              setCreating(true);
            }}
          >
            Lập hóa đơn nháp
          </Button>
        }
      />
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Bộ lọc hóa đơn
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Chọn cơ sở, phòng hoặc kỳ để tìm nhanh hóa đơn.
                </Typography>
              </Box>
              <Stack direction="row" sx={{ gap: 0.5 }}>
                {(filterLocation || filterRoom || filterPeriod || filterStatus) && (
                  <Button
                    size="small"
                    onClick={() => {
                      setFilterLocation('');
                      setFilterRoom('');
                      setFilterPeriod('');
                      setFilterStatus('');
                      setPage(1);
                    }}
                  >
                    Xóa lọc
                  </Button>
                )}
                <Button size="small" disabled={list.isFetching} onClick={() => void list.refetch()}>
                  Làm mới danh sách
                </Button>
              </Stack>
            </Stack>
            <FilterToolbar>
              <TextField
                select
                label="Cơ sở"
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
                label="Phòng"
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
            </FilterToolbar>
          </Stack>
        </Paper>
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
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Danh sách hóa đơn
            </Typography>
            {list.data && !list.error && (
              <Typography variant="body2" color="text.secondary">
                {list.data.totalCount} hóa đơn phù hợp với bộ lọc
              </Typography>
            )}
          </Box>
          <Button component={Link} to="/payments" variant="outlined" size="small">
            Xem thanh toán & công nợ
          </Button>
        </Stack>
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
                  disabled={!locationId}
                  helperText={!locationId ? 'Chọn cơ sở để hiển thị danh sách phòng.' : undefined}
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
                <Typography variant="body2" color="text.secondary">
                  Chọn hợp đồng đang hoặc đã có hiệu lực trong phòng để gắn hóa đơn với đúng kỳ.
                </Typography>
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
                {contracts.data?.periods.filter((c) =>
                  ['Active', 'Terminated', 'Superseded'].includes(c.contractStatus),
                ).length === 0 && (
                  <Alert severity="warning">
                    Không tìm thấy hợp đồng phù hợp. Kiểm tra lịch sử hợp đồng phòng trước khi lập
                    nháp.
                    <Button size="small" component={Link} to="/contracts">
                      Xem hợp đồng
                    </Button>
                  </Alert>
                )}
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
            {draftStep === 1 && (
              <Button
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
        <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
          {!list.error && !list.isPending && list.data?.items.length === 0 && (
            <Box sx={{ py: 5, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 600 }}>Chưa có hóa đơn.</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {filterLocation || filterRoom || filterPeriod || filterStatus
                  ? 'Không có hóa đơn khớp bộ lọc hiện tại. Xóa lọc để xem toàn bộ danh sách.'
                  : 'Lập hóa đơn nháp cho một phòng và kỳ thanh toán để bắt đầu.'}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                sx={{ mt: 2 }}
                onClick={() => {
                  if (filterLocation || filterRoom || filterPeriod || filterStatus) {
                    setFilterLocation('');
                    setFilterRoom('');
                    setFilterPeriod('');
                    setFilterStatus('');
                    setPage(1);
                  } else {
                    setDraftStep(0);
                    setCreating(true);
                  }
                }}
              >
                {filterLocation || filterRoom || filterPeriod || filterStatus
                  ? 'Xóa tất cả bộ lọc'
                  : 'Lập hóa đơn nháp'}
              </Button>
            </Box>
          )}
          {!!list.data?.items.length && (
            <TableContainer>
              <Table size="small" sx={{ minWidth: 680, '& .MuiTableCell-root': { py: 1.5 } }}>
                <TableHead sx={{ bgcolor: 'action.hover' }}>
                  <TableRow>
                    <TableCell>Cơ sở / Phòng</TableCell>
                    <TableCell>Kỳ</TableCell>
                    <TableCell>Trạng thái</TableCell>
                    <TableCell align="right">Tổng tiền</TableCell>
                    <TableCell align="right">Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {list.data.items.map((item) => (
                    <TableRow
                      key={item.id}
                      hover
                      selected={selected === item.id}
                      sx={{ '&:last-child td': { borderBottom: 0 } }}
                    >
                      <TableCell>
                        <Typography sx={{ fontWeight: 650 }} variant="body2">
                          Phòng {item.roomNumber}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.locationName}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {item.billingPeriod.slice(5, 7)}/{item.billingPeriod.slice(0, 4)}
                      </TableCell>
                      <TableCell>
                        <StatusChip label={item.status === 'Final' ? 'Đã phát hành' : 'Nháp'} />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {formatContractMoney(item.total)}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={selected === item.id ? 'contained' : 'text'}
                          onClick={() => setSelected(item.id)}
                        >
                          {selected === item.id ? 'Đang xem' : 'Xem chi tiết'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {list.data && (page > 1 || page * 20 < list.data.totalCount) && (
            <Stack
              direction="row"
              spacing={1}
              sx={{
                p: 1.5,
                alignItems: 'center',
                justifyContent: 'flex-end',
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Button
                size="small"
                disabled={page === 1 || list.isFetching}
                onClick={() => setPage(page - 1)}
              >
                Trang trước
              </Button>
              <Typography variant="body2" color="text.secondary">
                Trang {page}
              </Typography>
              <Button
                size="small"
                disabled={list.isFetching || page * 20 >= list.data.totalCount}
                onClick={() => setPage(page + 1)}
              >
                Trang sau
              </Button>
            </Stack>
          )}
        </Paper>
        <Drawer
          anchor="right"
          open={!!selected}
          onClose={() => {
            if (!busy && !confirm) {
              setSelected('');
              setError('');
            }
          }}
          slotProps={{
            paper: {
              sx: { width: { xs: '100%', sm: 'min(780px, 92vw)' }, maxWidth: '100vw' },
              'aria-label': 'Chi tiết hóa đơn',
            },
          }}
        >
          <Stack
            direction="row"
            sx={{
              px: { xs: 2, md: 3 },
              py: 1.5,
              position: 'sticky',
              top: 0,
              zIndex: 1,
              bgcolor: 'background.paper',
              borderBottom: '1px solid',
              borderColor: 'divider',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Box>
              <Typography sx={{ fontWeight: 750 }}>Chi tiết hóa đơn</Typography>
              <Typography variant="caption" color="text.secondary">
                Kiểm tra số tiền và thực hiện bước tiếp theo
              </Typography>
            </Box>
            <IconButton
              aria-label="Đóng chi tiết hóa đơn"
              disabled={busy}
              onClick={() => {
                setSelected('');
                setError('');
              }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <Box sx={{ p: { xs: 2, md: 3 } }}>
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
              <Stack spacing={2}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{
                    justifyContent: 'space-between',
                    gap: 1.5,
                    alignItems: { sm: 'flex-start' },
                  }}
                >
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      Phòng {invoice.roomNumber} · Kỳ {invoice.billingPeriod.slice(5, 7)}/
                      {invoice.billingPeriod.slice(0, 4)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {invoice.status === 'Final'
                        ? 'Đã phát hành — chi phí được giữ nguyên'
                        : 'Bản nháp · Kiểm tra dữ liệu trước khi phát hành'}
                    </Typography>
                  </Box>
                  <StatusChip label={invoice.status === 'Final' ? 'Đã phát hành' : 'Nháp'} />
                </Stack>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 1.5,
                  }}
                >
                  {[
                    ['Tổng tiền hóa đơn', formatContractMoney(invoice.total)],
                    [
                      'Ngày phát hành theo lịch',
                      invoice.scheduledFinalDate.split('-').reverse().join('/'),
                    ],
                    ['Hạn thanh toán', invoice.dueDate.split('-').reverse().join('/')],
                  ].map(([label, value], i) => (
                    <Box
                      key={label}
                      sx={{
                        p: 1.75,
                        bgcolor: 'action.hover',
                        borderRadius: 1.5,
                        minWidth: 0,
                        gridColumn: i === 0 ? '1 / -1' : undefined,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: i === 0 ? 21 : 16,
                          fontWeight: 700,
                          mt: 0.5,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
                {invoice.status === 'Draft' && invoice.missingInputs.length === 0 && (
                  <Alert severity="success">
                    Không còn đầu vào bắt buộc bị thiếu. Kiểm tra các khoản thu bên dưới trước khi
                    phát hành.
                  </Alert>
                )}
                {invoice.status === 'Final' && (
                  <Alert severity="info">
                    Hóa đơn đã phát hành. Theo dõi khoản đã thanh toán và số còn phải thu ở phần
                    thanh toán bên dưới.
                  </Alert>
                )}
                {invoice.missingInputs.length > 0 && (
                  <Alert severity="warning">
                    Còn thiếu: {invoice.missingInputs.map(missingBillingInput).join(', ')}. Tổng
                    hiện tại chưa phải số tiền chính thức.
                  </Alert>
                )}
                {invoice.status === 'Draft' ? (
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ gap: 1, alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
                  >
                    <Button
                      variant="contained"
                      disabled={busy || invoice.missingInputs.length > 0}
                      onClick={() => setConfirm(true)}
                    >
                      Phát hành hóa đơn
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void mutate(() => api.refresh(invoice.id, invoice.version))}
                    >
                      Tính lại hóa đơn nháp
                    </Button>
                    {invoice.missingInputs.length > 0 && (
                      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Button size="small" component={Link} to="/meters">
                          Kiểm tra chỉ số
                        </Button>
                        <Button size="small" component={Link} to="/pricing">
                          Kiểm tra biểu giá
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                ) : (
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    <Button variant="contained" component={Link} to="/payments">
                      Theo dõi thanh toán
                    </Button>
                    <Button
                      component={Link}
                      variant="outlined"
                      to={`/invoice-adjustments?invoiceId=${invoice.id}`}
                    >
                      Yêu cầu điều chỉnh
                    </Button>
                  </Stack>
                )}
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Các khoản thu
                  </Typography>
                  {invoice.status === 'Draft' && (
                    <Button
                      size="small"
                      component={Link}
                      to={`/invoice-adjustments?invoiceId=${invoice.id}`}
                    >
                      Xem yêu cầu điều chỉnh
                    </Button>
                  )}
                </Stack>
                <TableContainer>
                  <Table size="small" sx={{ minWidth: 710 }}>
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
                              Giá ngày {line.rateDate.split('-').reverse().join('/')} ·{' '}
                              {line.occupiedDays}/{line.periodDays} ngày
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
                                : ''}
                          </TableCell>
                          <TableCell>{formatBillingDecimal(line.rate)} đ</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {formatContractMoney(line.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'flex-end',
                    alignItems: 'baseline',
                    gap: 2,
                    py: 1,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography color="text.secondary">Tổng cộng</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {formatContractMoney(invoice.total)}
                  </Typography>
                </Stack>
                {invoice.status === 'Final' && (
                  <OwnerInvoicePaymentPanel key={invoice.id} invoiceId={invoice.id} />
                )}
              </Stack>
            )}
          </Box>
        </Drawer>
        <Dialog open={confirm} onClose={() => !busy && setConfirm(false)} fullWidth maxWidth="xs">
          <DialogTitle>Xác nhận phát hành hóa đơn</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5}>
              <Typography>
                Phòng {invoice?.roomNumber}, kỳ {invoice?.billingPeriod.slice(0, 7)}, tổng{' '}
                <Box component="span" sx={{ fontWeight: 750 }}>
                  {invoice && formatContractMoney(invoice.total)}
                </Box>
                .
              </Typography>
              <Alert severity="warning">
                Hãy kiểm tra tổng tiền và các khoản thu trước khi xác nhận. Hóa đơn đã phát hành sẽ
                được giữ nguyên; mọi thay đổi tiếp theo thực hiện qua yêu cầu điều chỉnh.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Quay lại
            </Button>
            <Button
              disabled={busy || !invoice}
              variant="contained"
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
