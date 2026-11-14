import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  businessToday,
  contractError,
  dateOnly,
} from '../../../../../packages/client-core/src/contracts';
import { useMeterApi } from './useMeterApi';

type Option = { id: string; label: string; parentId?: string };
type Assignment = { staffUserId: string; startDate: string; endDate: string };

export function InitialMeterTask({
  location,
  room,
  created,
}: {
  location: string;
  room: string;
  created: (id: string) => void;
}) {
  const api = useMeterApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [meter, setMeter] = useState('');
  const [readingDate, setReadingDate] = useState(businessToday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const options = useQuery({
    queryKey: ['initial-meter-options', session?.userId, location],
    enabled: open && !!location,
    queryFn: async ({ signal }) => {
      const [meters, assignments, staff] = await Promise.all([
        api.request<Option[]>(`/api/v1/capture/locations/${location}/meters`, { signal }),
        api.request<Assignment[]>(`/api/v1/staff-location-assignments?locationId=${location}`, {
          signal,
        }),
        api.request<Option[]>('/api/v1/capture/staff', { signal }),
      ]);
      return { meters, assignments, staff };
    },
  });
  const today = businessToday();
  const responsible = options.data?.assignments.filter(
    (a) => a.startDate <= today && a.endDate >= today,
  );
  const staffLabels = responsible
    ?.map((a) => options.data?.staff.find((s) => s.id === a.staffUserId)?.label)
    .filter(Boolean);
  const meters = options.data?.meters.filter((m) => m.parentId === room) ?? [];

  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const date = dateOnly(readingDate);
      const result = await api.request<{ id: string }>('/api/v1/capture/meter-tasks', {
        method: 'POST',
        body: JSON.stringify({
          meterId: meter,
          purpose: 0,
          readingDate: date,
          billingPeriod: null,
        }),
      });
      setOpen(false);
      setNotice(
        'Đã tạo nhiệm vụ ghi chỉ số ban đầu. Staff phụ trách cơ sở mở nhiệm vụ để chụp và xác nhận.',
      );
      void cache.invalidateQueries({ queryKey: ['meter-tasks'] });
      created(result.id);
    } catch (e) {
      const failure = e as { status?: number; code?: string };
      setError(
        failure.status === 409
          ? 'Công tơ đã có nhiệm vụ ban đầu hoặc dữ liệu đã thay đổi. Tải lại danh sách để kiểm tra trước khi tạo lại.'
          : e instanceof Error && !failure.status
            ? e.message
            : contractError(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Stack spacing={1}>
      <Button
        variant="contained"
        disabled={!location || !room}
        onClick={() => {
          setMeter('');
          setError('');
          setNotice('');
          setReadingDate(businessToday());
          setOpen(true);
        }}
      >
        Giao nhiệm vụ ghi chỉ số ban đầu
      </Button>
      {(!location || !room) && (
        <Typography variant="body2">Chọn cơ sở và phòng để giao nhiệm vụ ban đầu.</Typography>
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        fullWidth
        maxWidth="sm"
        aria-labelledby="initial-meter-title"
      >
        <DialogTitle id="initial-meter-title">Giao nhiệm vụ ghi chỉ số ban đầu</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              select
              label="Công tơ ghi chỉ số ban đầu"
              value={meter}
              disabled={busy || options.isPending}
              onChange={(e) => setMeter(e.target.value)}
            >
              {meters.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.label}
                </MenuItem>
              ))}
            </TextField>
            {options.data && !meters.length && (
              <Alert severity="warning">
                Phòng chưa có công tơ. Cấu hình công tơ trước khi giao nhiệm vụ.
              </Alert>
            )}
            <TextField
              type="date"
              label="Ngày ghi chỉ số ban đầu"
              value={readingDate}
              disabled={busy}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(e) => setReadingDate(e.target.value)}
            />
            {!!staffLabels?.length && (
              <Typography>Staff phụ trách cơ sở · {staffLabels.join(', ')}</Typography>
            )}
            {options.data && !staffLabels?.length && (
              <Alert severity="warning">
                Chưa có Staff đang hoạt động được phân công cơ sở. Cập nhật phân công trước khi giao
                nhiệm vụ.
              </Alert>
            )}
            <Typography variant="body2">
              Staff chụp ảnh và xác nhận chỉ số thực tế trong nhiệm vụ này.
            </Typography>
            {options.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void options.refetch()}>Thử lại</Button>}
              >
                {contractError(options.error)}
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            Đóng
          </Button>
          <Button
            disabled={
              busy ||
              !readingDate ||
              !meters.some((m) => m.id === meter) ||
              !staffLabels?.length ||
              !!options.error
            }
            onClick={() => void submit()}
          >
            {busy ? 'Đang tạo…' : 'Tạo nhiệm vụ ban đầu'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
