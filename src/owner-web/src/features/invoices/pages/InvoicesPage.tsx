import { useRef, useState } from 'react';
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
  missingBillingInput,
} from '../../../../../../packages/client-core/src/invoices';
import { formatContractMoney } from '../../../../../../packages/client-core/src/contracts';
import { PageHeader } from '../../../components/common/PortalUI';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { useInvoiceApi } from '../useInvoiceApi';

export default function InvoicesPage() {
  return isMockMode ? <ResourcePage kind="invoices" variant="table" /> : <LiveInvoicesPage />;
}
export function LiveInvoicesPage() {
  const api = useInvoiceApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const cache = useQueryClient();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState('');
  const [roomId, setRoomId] = useState(''),
    [period, setPeriod] = useState(''),
    [contractId, setContractId] = useState('');
  const [locationId, setLocationId] = useState('');
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
    enabled: !!roomId,
    queryFn: ({ signal }) =>
      api.request<{
        items: { id: string; roomId: string; status: string; startDate: string; endDate: string }[];
      }>(`/api/v1/contracts?locationId=${locationId}&pageSize=100`, { signal }),
  });
  const list = useQuery({
    queryKey: ['invoices', actor, page],
    queryFn: ({ signal }) => api.list(page, signal),
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
      />
      <Stack spacing={2}>
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Lập hóa đơn nháp</Typography>
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
            <TextField
              select
              label="Hợp đồng đại diện phòng trong kỳ"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
            >
              <MenuItem value="">Chọn hợp đồng</MenuItem>
              {contracts.data?.items
                .filter(
                  (c) =>
                    c.roomId === roomId &&
                    ['Active', 'Terminated', 'Superseded'].includes(c.status),
                )
                .map((c) => (
                  <MenuItem value={c.id} key={c.id}>
                    {c.startDate} – {c.endDate} · {c.id}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              label="Hoặc nhập mã hợp đồng đại diện"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              helperText="Dùng mã hợp đồng nếu không có trong 100 kết quả đầu."
            />
            {(locations.error || rooms.error || contracts.error) && (
              <Alert severity="error">
                {invoiceError(locations.error || rooms.error || contracts.error)}
              </Alert>
            )}
            {(locations.isPending ||
              (!!locationId && rooms.isPending) ||
              (!!roomId && contracts.isPending)) && <LinearProgress />}
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
          </Stack>
        </Paper>
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
        {list.data?.items.length === 0 && <Alert severity="info">Chưa có hóa đơn.</Alert>}
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
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Trang trước
          </Button>
          <Typography>Trang {page}</Typography>
          <Button
            disabled={!list.data || page * 20 >= list.data.totalCount}
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
                        {line.meterReadingId
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
                      <TableCell>{formatContractMoney(line.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="h6">Tổng: {formatContractMoney(invoice.total)}</Typography>
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
