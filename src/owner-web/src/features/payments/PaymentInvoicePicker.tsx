import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
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
}: {
  open: boolean;
  close: () => void;
  choose: (row: DebtInvoice) => void;
}) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [period, setPeriod] = useState(''),
    [paymentStatus, setPaymentStatus] = useState('Unpaid'),
    [page, setPage] = useState(1);
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
      maxWidth="lg"
      fullWidth
      aria-labelledby="payment-invoice-picker-title"
    >
      <DialogTitle id="payment-invoice-picker-title">Chọn hóa đơn cần phân bổ</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FilterToolbar>
            <TextField
              select
              label="Tình trạng tiền hóa đơn đối chiếu"
              value={paymentStatus}
              onChange={(e) => {
                setPaymentStatus(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="Unpaid">Còn phải trả</MenuItem>
              <MenuItem value="Paid">Đã đủ tiền · đối chiếu hoàn dư</MenuItem>
              <MenuItem value="">Tất cả hóa đơn</MenuItem>
            </TextField>
            <TextField
              select
              label="Cơ sở hóa đơn"
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
              select
              label="Phòng hóa đơn"
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
              label="Kỳ cần đối soát"
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
          <OwnerTable
            rows={list.data?.items ?? []}
            id={(i) => i.invoiceId}
            select={choose}
            loading={list.isFetching}
            error={list.error}
            retry={() => void list.refetch()}
            label="Hóa đơn còn dư nợ"
            selectLabel="Chọn hóa đơn"
            columns={[
              { label: 'Cơ sở / Phòng', render: (i) => `${i.locationName} · ${i.roomNumber}` },
              { label: 'Kỳ', render: (i) => i.billingPeriod.slice(0, 7) },
              { label: 'Dư nợ', render: (i) => formatContractMoney(i.outstandingAmount) },
              { label: 'Hạn thanh toán', render: (i) => i.dueDate.split('-').reverse().join('/') },
            ]}
          />
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
