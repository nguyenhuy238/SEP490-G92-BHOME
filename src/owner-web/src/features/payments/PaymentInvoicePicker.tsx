import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import type { DebtInvoice } from '../../../../../packages/client-core/src/payments';
import { FilterToolbar } from '../../components/common/PortalUI';
import { OwnerTable, OwnerPagination, OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { usePaymentApi } from './usePaymentApi';

export function PaymentInvoicePicker({
  open,
  close,
  choose,
  unpaidOnly = false,
}: {
  open: boolean;
  close: () => void;
  choose: (row: DebtInvoice) => void;
  unpaidOnly?: boolean;
}) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [period, setPeriod] = useState(''),
    [paymentStatus, setPaymentStatus] = useState('Unpaid'),
    [page, setPage] = useState(1);
  const hasFilters = Boolean(location || room || period || paymentStatus !== 'Unpaid');
  const resetFilters = () => {
    setLocation('');
    setRoom('');
    setPeriod('');
    setPaymentStatus('Unpaid');
    setPage(1);
  };
  const locations = useQuery({
    queryKey: ['payment-locations', session?.userId],
    enabled: open,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['payment-rooms', session?.userId, location],
    enabled: open && !!location,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  const list = useQuery({
    queryKey: [
      'payment-invoices',
      session?.userId,
      'picker',
      location,
      room,
      period,
      paymentStatus,
      page,
    ],
    enabled: open,
    queryFn: ({ signal }) =>
      api.invoices(
        {
          locationId: location,
          roomId: room,
          billingPeriod: period ? period + '-01' : '',
          page,
          paymentStatus,
        },
        signal,
      ),
  });
  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="md"
      fullWidth
      aria-labelledby="payment-invoice-picker-title"
      sx={{
        '& .MuiDialog-paper': {
          '@media (max-width:600px)': {
            m: 0,
            width: '100%',
            maxWidth: '100%',
            height: '100%',
            maxHeight: '100%',
            borderRadius: 0,
          },
        },
      }}
    >
      <DialogTitle id="payment-invoice-picker-title">Chọn hóa đơn cần phân bổ</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Lọc theo cơ sở, phòng hoặc kỳ thanh toán rồi chọn đúng hóa đơn để tiếp tục đối soát.
          </Typography>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Tìm theo hóa đơn
            </Typography>
            {hasFilters && (
              <Button size="small" onClick={resetFilters}>
                Xóa bộ lọc
              </Button>
            )}
          </Stack>
          <FilterToolbar>
            <TextField
              size="small"
              select
              label="Trạng thái thanh toán"
              value={paymentStatus}
              onChange={(e) => {
                setPaymentStatus(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="Unpaid">Còn phải trả</MenuItem>
              {!unpaidOnly && <MenuItem value="Paid">Đã đủ tiền · đối chiếu hoàn dư</MenuItem>}
              {!unpaidOnly && <MenuItem value="">Tất cả hóa đơn</MenuItem>}
            </TextField>
            <TextField
              size="small"
              select
              label="Cơ sở"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setRoom('');
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
              size="small"
              select
              label="Phòng"
              value={room}
              disabled={!location}
              onChange={(e) => {
                setRoom(e.target.value);
                setPage(1);
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
              size="small"
              label="Kỳ hóa đơn"
              type="month"
              value={period}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPage(1);
              }}
            />
          </FilterToolbar>
          <OwnerFeedback error={locations.error || rooms.error} />
          <Typography variant="caption" color="text.secondary">
            {list.data
              ? `${list.data.totalCount} hóa đơn phù hợp · Chọn đúng phòng và kỳ thu tiền`
              : 'Đang tìm hóa đơn phù hợp'}
          </Typography>
          {!list.error && !list.isFetching && !list.data?.items.length && (
            <Alert
              severity="info"
              action={hasFilters ? <Button onClick={resetFilters}>Bỏ bộ lọc</Button> : undefined}
            >
              Chưa tìm thấy hóa đơn phù hợp. Kiểm tra lại cơ sở, phòng hoặc kỳ thanh toán.
            </Alert>
          )}
          <Stack
            spacing={1.25}
            role="list"
            aria-label="Danh sách hóa đơn đối soát trên màn hình nhỏ"
            sx={{ display: { xs: 'flex', sm: 'none' } }}
          >
            {list.isFetching && <LinearProgress aria-label="Đang tải hóa đơn" />}
            {list.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
              >
                Không thể tải danh sách hóa đơn.
              </Alert>
            )}
            {list.data?.items.map((row) => (
              <Paper
                key={row.invoiceId}
                variant="outlined"
                role="listitem"
                sx={{ p: 1.5, borderRadius: 1.5 }}
              >
                <Stack spacing={1}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {row.locationName} · Phòng {row.roomNumber}
                  </Typography>
                  <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'center' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Kỳ {row.billingPeriod.slice(0, 7)}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {formatContractMoney(row.outstandingAmount)}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Hạn thanh toán: {row.dueDate.split('-').reverse().join('/')}
                  </Typography>
                  <Button
                    fullWidth
                    variant="outlined"
                    aria-label={`Chọn hóa đơn phòng ${row.roomNumber}, kỳ ${row.billingPeriod.slice(0, 7)}`}
                    onClick={() => choose(row)}
                  >
                    Chọn hóa đơn
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
          {(list.isFetching || !!list.error || !!list.data?.items.length) && (
            <Box
              sx={{
                display: { xs: 'none', sm: 'block' },
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                overflow: 'hidden',
              }}
            >
              <OwnerTable
                rows={list.data?.items ?? []}
                id={(i) => i.invoiceId}
                select={choose}
                loading={list.isFetching}
                error={list.error}
                retry={() => void list.refetch()}
                label="Danh sách hóa đơn đối soát"
                selectLabel="Chọn hóa đơn"
                columns={[
                  { label: 'Cơ sở / Phòng', render: (i) => `${i.locationName} · ${i.roomNumber}` },
                  { label: 'Kỳ', render: (i) => i.billingPeriod.slice(0, 7) },
                  { label: 'Dư nợ', render: (i) => formatContractMoney(i.outstandingAmount) },
                  {
                    label: 'Hạn thanh toán',
                    render: (i) => i.dueDate.split('-').reverse().join('/'),
                  },
                ]}
              />
            </Box>
          )}
          <OwnerPagination
            page={page}
            total={list.data?.totalCount ?? 0}
            busy={list.isFetching}
            change={setPage}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Đóng lựa chọn hóa đơn</Button>
      </DialogActions>
    </Dialog>
  );
}
