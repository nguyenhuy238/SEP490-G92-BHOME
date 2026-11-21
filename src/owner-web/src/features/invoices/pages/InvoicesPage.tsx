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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
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
import { PageHeader, FilterToolbar, StatusChip } from '../../../components/common/PortalUI';
import { OwnerTable, OwnerPagination } from '../../../components/common/OwnerWorkspace';
import { isMockMode } from '../../../services/config';
import { useInvoiceApi } from '../useInvoiceApi';
import { OwnerInvoicePaymentPanel } from '../../payments/OwnerInvoicePaymentPanel';

export default function InvoicesPage() {
  return isMockMode ? <DemoInvoicesPage /> : <LiveInvoicesPage />;
}

type InvoiceStatus = '' | 'Draft' | 'Final';

function InvoiceStatusFilters({
  value,
  onChange,
}: {
  value: InvoiceStatus;
  onChange: (value: InvoiceStatus) => void;
}) {
  const options: { value: InvoiceStatus; label: string }[] = [
    { value: '', label: 'Tất cả' },
    { value: 'Draft', label: 'Bản nháp' },
    { value: 'Final', label: 'Đã phát hành' },
  ];
  return (
    <Stack
      direction="row"
      role="group"
      aria-label="Lọc nhanh trạng thái hóa đơn"
      useFlexGap
      sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
        Xem:
      </Typography>
      {options.map((option) => (
        <Button
          key={option.value}
          size="small"
          variant={value === option.value ? 'contained' : 'outlined'}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          sx={{ minHeight: { xs: 44, sm: 36 } }}
        >
          {option.label}
        </Button>
      ))}
    </Stack>
  );
}

type DemoInvoice = {
  id: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  status: 'Draft' | 'Final';
  total: string;
  paid: string;
  missingInputs: string[];
  lines: { name: string; amount: string; quantity: string }[];
  dueDate: string;
};

const demoInvoiceSamples: DemoInvoice[] = [
  {
    id: 'demo-invoice-101',
    locationName: 'BHOME Thanh Xuân',
    roomNumber: 'A101',
    billingPeriod: '2026-11-01',
    status: 'Draft',
    total: '3785000',
    paid: '0',
    missingInputs: ['Chỉ số nước chưa xác nhận'],
    lines: [
      { name: 'Tiền thuê phòng', amount: '3500000', quantity: '1 tháng' },
      { name: 'Điện', amount: '185000', quantity: '50 kWh' },
      { name: 'Phí dịch vụ', amount: '100000', quantity: '1 tháng' },
    ],
    dueDate: '2026-11-25',
  },
  {
    id: 'demo-invoice-102',
    locationName: 'BHOME Thanh Xuân',
    roomNumber: 'A102',
    billingPeriod: '2026-11-01',
    status: 'Draft',
    total: '4268000',
    paid: '0',
    missingInputs: [],
    lines: [
      { name: 'Tiền thuê phòng', amount: '3900000', quantity: '1 tháng' },
      { name: 'Điện', amount: '222000', quantity: '60 kWh' },
      { name: 'Nước', amount: '46000', quantity: '2 m³' },
      { name: 'Phí dịch vụ', amount: '100000', quantity: '1 tháng' },
    ],
    dueDate: '2026-11-25',
  },
  {
    id: 'demo-invoice-103',
    locationName: 'BHOME Thanh Xuân',
    roomNumber: 'A103',
    billingPeriod: '2026-10-01',
    status: 'Final',
    total: '4054000',
    paid: '3000000',
    missingInputs: [],
    lines: [
      { name: 'Tiền thuê phòng', amount: '3800000', quantity: '1 tháng' },
      { name: 'Điện và nước', amount: '254000', quantity: 'Theo chỉ số đã chốt' },
    ],
    dueDate: '2026-10-25',
  },
];

/**
 * A self-contained preview of the actual invoice workflow. Never calls the API,
 * publishes real invoices, or alters the demo repository's financial ledger.
 */
export function DemoInvoicesPage() {
  const [params] = useSearchParams();
  const [invoices, setInvoices] = useState(demoInvoiceSamples);
  const [selectedId, setSelectedId] = useState(params.get('invoiceId') ?? '');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState<'' | 'Draft' | 'Final'>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoom, setNewRoom] = useState('A104');
  const [newPeriod, setNewPeriod] = useState('2026-11');
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const [detailFeedback, setDetailFeedback] = useState('');
  const selected = invoices.find((item) => item.id === selectedId);
  const filtered = invoices.filter(
    (item) =>
      (!month || item.billingPeriod.startsWith(month)) &&
      (!status || item.status === status) &&
      (!search ||
        `${item.roomNumber} ${item.locationName}`.toLowerCase().includes(search.toLowerCase())),
  );
  const clearFilters = () => {
    setSearch('');
    setMonth('');
    setStatus('');
  };
  return (
    <>
      <PageHeader
        title="Hóa đơn phòng"
        subtitle="Tìm hóa đơn, kiểm tra các khoản thu và thực hiện bước tiếp theo theo từng trạng thái."
        actions={
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Lập hóa đơn nháp
          </Button>
        }
      />
      <Stack spacing={2}>
        <Typography variant="caption" color="text.secondary">
          Dữ liệu demo · Không phát hành, gửi thông báo hoặc ghi công nợ thật.
        </Typography>
        {notice && (
          <Alert severity="success" onClose={() => setNotice('')}>
            {notice}
          </Alert>
        )}
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            sx={{ gap: 1.5, alignItems: { md: 'center' } }}
          >
            <TextField
              size="small"
              label="Tìm theo phòng hoặc cơ sở"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ flex: 2 }}
            />
            <TextField
              size="small"
              type="month"
              label="Kỳ hóa đơn cần lọc"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: 1 }}
            />
            <Button size="small" onClick={clearFilters} disabled={!search && !month && !status}>
              Xóa lọc
            </Button>
          </Stack>
          <InvoiceStatusFilters value={status} onChange={setStatus} />
        </Stack>
        {filtered.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 700 }}>Chưa có hóa đơn.</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Không có bản mẫu phù hợp với bộ lọc. Xóa lọc để xem tất cả.
            </Typography>
            <Button variant="outlined" sx={{ mt: 1.5 }} onClick={clearFilters}>
              Xóa bộ lọc
            </Button>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ minWidth: 0, borderRadius: 2 }}>
            <OwnerTable
              label="Danh sách hóa đơn demo"
              rows={filtered}
              id={(item) => item.id}
              select={(item) => {
                setSelectedId(item.id);
                setDetailFeedback('');
              }}
              columns={[
                {
                  label: 'Phòng / Cơ sở',
                  render: (item) => (
                    <Box>
                      <Typography sx={{ fontWeight: 700 }}>Phòng {item.roomNumber}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.locationName}
                      </Typography>
                    </Box>
                  ),
                },
                { label: 'Kỳ', render: (item) => item.billingPeriod.slice(0, 7) },
                {
                  label: 'Tình trạng',
                  render: (item) => (
                    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                      <StatusChip label={item.status === 'Final' ? 'Đã phát hành' : 'Bản nháp'} />
                      {item.status === 'Draft' && (
                        <Typography
                          variant="caption"
                          color={item.missingInputs.length ? 'warning.dark' : 'success.main'}
                        >
                          {item.missingInputs.length ? 'Thiếu dữ liệu' : 'Đủ dữ liệu'}
                        </Typography>
                      )}
                    </Stack>
                  ),
                },
                {
                  label: 'Số tiền',
                  render: (item) => (
                    <Box>
                      <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatContractMoney(item.total)}
                      </Typography>
                      {item.status === 'Draft' && (
                        <Typography variant="caption" color="text.secondary">
                          Tạm tính
                        </Typography>
                      )}
                    </Box>
                  ),
                },
              ]}
            />
          </Paper>
        )}
        <Drawer
          anchor="right"
          open={!!selectedId}
          onClose={() => setSelectedId('')}
          slotProps={{
            paper: {
              sx: { width: { xs: '100%', sm: 'min(720px, 92vw)' }, maxWidth: '100vw' },
              'aria-label': 'Chi tiết hóa đơn demo',
            },
          }}
        >
          <Stack
            direction="row"
            sx={{
              px: 2.5,
              py: 1.5,
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Chi tiết hóa đơn</Typography>
              <Typography variant="caption" color="text.secondary">
                Bản xem thử · Không ghi dữ liệu thật
              </Typography>
            </Box>
            <IconButton aria-label="Đóng chi tiết hóa đơn demo" onClick={() => setSelectedId('')}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
            {detailFeedback && (
              <Alert severity="info" onClose={() => setDetailFeedback('')}>
                {detailFeedback}
              </Alert>
            )}
            {!selected ? (
              <Alert severity="info">Không tìm thấy hóa đơn mẫu này. Hãy chọn từ danh sách.</Alert>
            ) : (
              <>
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Phòng {selected.roomNumber} · Kỳ {selected.billingPeriod.slice(0, 7)}
                  </Typography>
                  <StatusChip label={selected.status === 'Draft' ? 'Bản nháp' : 'Đã phát hành'} />
                </Stack>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary">
                    {selected.status === 'Draft' ? 'Tổng tạm tính' : 'Tổng đã phát hành'}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 750 }}>
                    {formatContractMoney(selected.total)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Hạn thanh toán: {selected.dueDate.split('-').reverse().join('/')}
                  </Typography>
                </Paper>
                {selected.status === 'Draft' ? (
                  <>
                    {selected.missingInputs.length > 0 ? (
                      <Alert severity="warning">
                        Còn thiếu: {selected.missingInputs.join(', ')}. Phải xử lý trước khi phát
                        hành.
                      </Alert>
                    ) : (
                      <Alert severity="success">
                        Đủ dữ liệu mẫu. Hãy kiểm tra khoản thu trước khi xác nhận.
                      </Alert>
                    )}
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        variant="contained"
                        disabled={selected.missingInputs.length > 0}
                        onClick={() => setConfirm(true)}
                      >
                        Phát hành hóa đơn
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() =>
                          setDetailFeedback(
                            'Đang xem dữ liệu minh họa. Tính lại hóa đơn thật chỉ khả dụng khi kết nối backend.',
                          )
                        }
                      >
                        Tính lại bản nháp
                      </Button>
                      {selected.missingInputs.length > 0 && (
                        <>
                          <Button size="small" component={Link} to="/meters">
                            Kiểm tra chỉ số
                          </Button>
                          <Button size="small" component={Link} to="/pricing">
                            Kiểm tra biểu giá
                          </Button>
                        </>
                      )}
                    </Stack>
                  </>
                ) : (
                  <>
                    <Stack spacing={0.5}>
                      <Typography variant="body2" color="text.secondary">
                        Đã thanh toán
                      </Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        {formatContractMoney(selected.paid)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Còn phải thu (mẫu)
                      </Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        {formatContractMoney(
                          String(Number(selected.total) - Number(selected.paid)),
                        )}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                      <Button variant="contained" component={Link} to="/payments">
                        Theo dõi thanh toán
                      </Button>
                      <Button variant="outlined" component={Link} to="/invoice-adjustments">
                        Xem điều chỉnh
                      </Button>
                    </Stack>
                  </>
                )}
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Chi tiết các khoản thu (mẫu)
                </Typography>
                <TableContainer>
                  <Table size="small" aria-label="Các khoản thu của hóa đơn demo">
                    <TableHead>
                      <TableRow>
                        <TableCell>Khoản thu</TableCell>
                        <TableCell>Số lượng</TableCell>
                        <TableCell align="right">Thành tiền</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selected.lines.map((line) => (
                        <TableRow key={line.name}>
                          <TableCell>{line.name}</TableCell>
                          <TableCell>{line.quantity}</TableCell>
                          <TableCell align="right">{formatContractMoney(line.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Stack>
        </Drawer>
        <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Lập hóa đơn nháp (demo)</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="info">
                Bản nháp tạo tại đây chỉ tồn tại trong lần xem trang này.
              </Alert>
              <TextField
                select
                label="Phòng"
                value={newRoom}
                onChange={(event) => setNewRoom(event.target.value)}
              >
                <MenuItem value="A104">Phòng A104</MenuItem>
                <MenuItem value="A105">Phòng A105</MenuItem>
              </TextField>
              <TextField
                label="Kỳ hóa đơn"
                type="month"
                value={newPeriod}
                onChange={(event) => setNewPeriod(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button
              variant="contained"
              disabled={!/^\d{4}-\d{2}$/.test(newPeriod)}
              onClick={() => {
                const id = `demo-${newRoom}-${newPeriod}`;
                if (!invoices.some((item) => item.id === id)) {
                  setInvoices((items) => [
                    {
                      id,
                      locationName: 'BHOME Thanh Xuân',
                      roomNumber: newRoom,
                      billingPeriod: newPeriod + '-01',
                      status: 'Draft',
                      total: '0',
                      paid: '0',
                      missingInputs: ['Chưa có dữ liệu tính phí'],
                      lines: [],
                      dueDate: newPeriod + '-25',
                    },
                    ...items,
                  ]);
                }
                clearFilters();
                setSelectedId(id);
                setDetailFeedback('');
                setCreateOpen(false);
                setNotice('Đã tạo bản nháp mô phỏng. Chưa phát sinh dữ liệu hoặc hóa đơn thật.');
              }}
            >
              Tạo nháp mẫu
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Xác nhận phát hành (mô phỏng)</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5}>
              <Typography>
                {selected
                  ? `Phòng ${selected.roomNumber} · ${formatContractMoney(selected.total)}`
                  : ''}
              </Typography>
              <Alert severity="warning">
                Đây chỉ là mô phỏng giao diện. Không gửi hóa đơn hoặc thay đổi công nợ thật.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(false)}>Quay lại</Button>
            <Button
              variant="contained"
              disabled={
                !selected || selected.status !== 'Draft' || selected.missingInputs.length > 0
              }
              onClick={() => {
                if (!selected || selected.status !== 'Draft' || selected.missingInputs.length > 0)
                  return;
                setInvoices((items) =>
                  items.map((item) =>
                    item.id === selected.id ? { ...item, status: 'Final' } : item,
                  ),
                );
                setConfirm(false);
                setNotice(
                  'Đã mô phỏng phát hành. Không có email, thông báo hoặc công nợ thật được tạo.',
                );
              }}
            >
              Xác nhận mô phỏng
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </>
  );
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
  const [creating, setCreating] = useState(false);
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
        subtitle="Kiểm tra chi phí theo hợp đồng và chỉ số đã xác nhận trước khi phát hành."
        actions={
          <Stack spacing={0.5} sx={{ alignItems: { sm: 'flex-end' } }}>
            <Button
              variant="contained"
              onClick={() => {
                if (filterLocation) setLocationId(filterLocation);
                if (filterRoom) setRoomId(filterRoom);
                if (filterPeriod) setPeriod(filterPeriod);
                setCreating(true);
              }}
            >
              Lập hóa đơn nháp
            </Button>
            <Typography variant="caption" color="text.secondary">
              Kiểm tra bản nháp trước khi phát hành chính thức.
            </Typography>
          </Stack>
        }
      />
      <Stack spacing={2}>
        <Stack spacing={1.25}>
          <InvoiceStatusFilters
            value={filterStatus}
            onChange={(value) => {
              setFilterStatus(value);
              setPage(1);
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Bản nháp: còn có thể cập nhật đầu vào · Đã phát hành: xem công nợ và thanh toán.
          </Typography>
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
            <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
              Làm mới hóa đơn
            </Button>
            {(filterLocation || filterRoom || filterPeriod || filterStatus) && (
              <Button
                onClick={() => {
                  setFilterLocation('');
                  setFilterRoom('');
                  setFilterPeriod('');
                  setFilterStatus('');
                  setPage(1);
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
          </FilterToolbar>
        </Stack>
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
              <Typography variant="body2" color="text.secondary">
                Chọn cơ sở, phòng và kỳ cần lập nháp, sau đó chọn hợp đồng phù hợp. Bạn có thể kiểm
                tra các khoản thu trước khi phát hành.
              </Typography>
              <Stack spacing={2} sx={{ pt: 1 }}>
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
                  helperText={!locationId ? 'Chọn cơ sở trước khi chọn phòng' : undefined}
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
                  onChange={(e) => {
                    setPeriod(e.target.value);
                    setContractId('');
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  select
                  label="Hợp đồng đại diện phòng trong kỳ"
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  disabled={!roomId || !/^\d{4}-\d{2}$/.test(period) || contracts.isFetching}
                  helperText={!roomId ? 'Chọn phòng để tải hợp đồng' : undefined}
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
                  </Alert>
                )}
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
          <DialogActions sx={{ flexWrap: 'wrap' }}>
            <Button disabled={busy} onClick={() => setCreating(false)}>
              Hủy
            </Button>
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
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 700 }}>
              {filterLocation || filterRoom || filterPeriod || filterStatus
                ? 'Không tìm thấy hóa đơn phù hợp'
                : 'Chưa có hóa đơn.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {filterLocation || filterRoom || filterPeriod || filterStatus
                ? 'Không có hóa đơn phù hợp với bộ lọc hiện tại.'
                : 'Lập bản nháp theo phòng và kỳ thanh toán. Sau đó kiểm tra chỉ số, biểu giá và từng khoản thu trước khi phát hành.'}
            </Typography>
            <Button
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
                  setCreating(true);
                }
              }}
            >
              {filterLocation || filterRoom || filterPeriod || filterStatus
                ? 'Xóa bộ lọc'
                : 'Lập hóa đơn nháp'}
            </Button>
            {!filterLocation && !filterRoom && !filterPeriod && !filterStatus && (
              <Stack
                direction="row"
                useFlexGap
                sx={{ mt: 1, gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}
              >
                <Button size="small" component={Link} to="/meters">
                  Kiểm tra chỉ số
                </Button>
                <Button size="small" component={Link} to="/pricing">
                  Kiểm tra biểu giá
                </Button>
              </Stack>
            )}
          </Paper>
        )}
        {!!list.data?.items.length && !list.error && (
          <Paper variant="outlined" sx={{ minWidth: 0 }}>
            <OwnerTable
              label="Danh sách hóa đơn"
              rows={list.data.items}
              id={(item) => item.id}
              select={(item) => setSelected(item.id)}
              loading={list.isFetching}
              columns={[
                {
                  label: 'Phòng / Cơ sở',
                  render: (item) => (
                    <>
                      <Typography sx={{ fontWeight: 650 }}>Phòng {item.roomNumber}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.locationName}
                      </Typography>
                    </>
                  ),
                },
                {
                  label: 'Kỳ hóa đơn',
                  render: (item) =>
                    item.type === 'AD_HOC' ? 'Hóa đơn riêng' : item.billingPeriod.slice(0, 7),
                },
                {
                  label: 'Trạng thái',
                  render: (item) => (
                    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                      <StatusChip label={item.status === 'Final' ? 'Đã phát hành' : 'Bản nháp'} />
                      {item.status === 'Draft' && item.missingInputs?.length > 0 && (
                        <Typography variant="caption" color="warning.dark">
                          Thiếu dữ liệu
                        </Typography>
                      )}
                    </Stack>
                  ),
                },
                {
                  label: 'Tổng tiền',
                  render: (item) => (
                    <>
                      <Typography sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                        {formatContractMoney(item.total)}
                      </Typography>
                      {item.status === 'Draft' && (
                        <Typography variant="caption" color="text.secondary">
                          Tạm tính
                        </Typography>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </Paper>
        )}
        {list.data && !list.error && (
          <OwnerPagination
            page={page}
            total={list.data.totalCount}
            change={setPage}
            busy={list.isFetching}
          />
        )}
        <Drawer
          anchor="right"
          open={!!selected}
          onClose={() => {
            if (busy || confirm) return;
            setSelected('');
            setError('');
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
              alignItems: 'center',
              justifyContent: 'space-between',
              px: { xs: 2, md: 3 },
              py: 1.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              zIndex: 1,
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
              Chi tiết hóa đơn
            </Typography>
            <IconButton
              aria-label="Đóng chi tiết hóa đơn"
              disabled={busy || confirm}
              onClick={() => {
                setSelected('');
                setError('');
              }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <Box sx={{ p: { xs: 2, md: 3 }, minWidth: 0, overflowWrap: 'anywhere' }}>
            {selected && detail.isPending && <LinearProgress />}
            {detail.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void detail.refetch()}>Thử lại</Button>}
              >
                {invoiceError(detail.error)}
              </Alert>
            )}
            {error && !creating && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {invoice && !detail.error && (
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  useFlexGap
                  spacing={1}
                  sx={{
                    alignItems: { sm: 'center' },
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
                    Phòng {invoice.roomNumber} · Kỳ {invoice.billingPeriod.slice(0, 7)}
                  </Typography>
                  <StatusChip label={invoice.status === 'Final' ? 'Đã phát hành' : 'Bản nháp'} />
                </Stack>
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
                <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {invoice.status === 'Final' ? 'Tổng đã phát hành' : 'Tổng tạm tính'}
                  </Typography>
                  <Typography
                    variant="h5"
                    sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatContractMoney(invoice.total)}
                  </Typography>
                </Box>
                {invoice.missingInputs.length > 0 && (
                  <Alert severity="warning">
                    Còn thiếu: {invoice.missingInputs.map(missingBillingInput).join(', ')}. Tổng
                    hiện tại chưa phải số tiền chính thức.
                  </Alert>
                )}
                {invoice.status === 'Draft' ? (
                  <>
                    {invoice.missingInputs.length > 0 && (
                      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Button component={Link} to="/meters" size="small">
                          Kiểm tra chỉ số
                        </Button>
                        <Button component={Link} to="/pricing" size="small">
                          Kiểm tra biểu giá
                        </Button>
                      </Stack>
                    )}
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      sx={{ gap: 1, flexWrap: 'wrap' }}
                    >
                      <Button
                        variant="contained"
                        disabled={busy || invoice.missingInputs.length > 0 || !!detail.error}
                        onClick={() => setConfirm(true)}
                      >
                        Phát hành hóa đơn
                      </Button>
                      <Button
                        variant="outlined"
                        disabled={busy}
                        onClick={() => void mutate(() => api.refresh(invoice.id, invoice.version))}
                      >
                        Cập nhật đầu vào bản nháp
                      </Button>
                    </Stack>
                  </>
                ) : (
                  <>
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                      <Button variant="contained" component={Link} to="/payments">
                        Theo dõi thanh toán
                      </Button>
                      <Button
                        variant="outlined"
                        component={Link}
                        to={`/invoice-adjustments?invoiceId=${invoice.id}`}
                      >
                        Yêu cầu điều chỉnh
                      </Button>
                    </Stack>
                  </>
                )}
                <TableContainer>
                  <Table size="small" aria-label="Các khoản thu hóa đơn" sx={{ minWidth: 600 }}>
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
                </TableContainer>
                <Typography
                  variant="h2"
                  component="div"
                  sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                >
                  {invoice.status === 'Final' ? 'Tổng đã phát hành' : 'Tổng tạm tính'}:{' '}
                  {formatContractMoney(invoice.total)}
                </Typography>
                {invoice.status === 'Final' && (
                  <OwnerInvoicePaymentPanel key={invoice.id} invoiceId={invoice.id} />
                )}
              </Stack>
            )}
          </Box>
        </Drawer>
        <Dialog
          open={confirm}
          onClose={() => !busy && setConfirm(false)}
          fullWidth
          maxWidth="xs"
          aria-labelledby="invoice-finalize-title"
        >
          <DialogTitle id="invoice-finalize-title">Xác nhận phát hành hóa đơn</DialogTitle>
          <DialogContent>
            {error && (
              <Alert severity="error" sx={{ mb: 1 }}>
                {error}
                {error.includes('yêu cầu điều chỉnh') && (
                  <Button component={Link} to="/invoice-adjustments" size="small" sx={{ ml: 1 }}>
                    Xử lý yêu cầu điều chỉnh
                  </Button>
                )}
              </Alert>
            )}
            <Stack spacing={1.5}>
              <Typography>
                Phòng {invoice?.roomNumber}, kỳ {invoice?.billingPeriod.slice(0, 7)}, tổng{' '}
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {invoice && formatContractMoney(invoice.total)}
                </Box>
                .
              </Typography>
              <Alert severity="warning">
                Các khoản thu sẽ được giữ nguyên sau phát hành. Hãy kiểm tra đầy đủ trước khi xác
                nhận; thay đổi tiếp theo thực hiện qua yêu cầu điều chỉnh.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Quay lại
            </Button>
            <Button
              variant="contained"
              disabled={
                busy ||
                !invoice ||
                invoice.status !== 'Draft' ||
                invoice.missingInputs.length > 0 ||
                !!detail.error
              }
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
