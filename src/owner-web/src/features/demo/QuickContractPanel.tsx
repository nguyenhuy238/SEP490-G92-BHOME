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
import { FilePlus2 } from 'lucide-react';
import { useMeterApi } from '../meters/useMeterApi';
import { contractError } from '../../../../../packages/client-core/src/contracts';
import { ApiError } from '../../../../../packages/client-core/src/api';

type RoomOption = {
  id: string;
  label: string;
  status?: string;
  waitingForOwnerSignature?: boolean;
};
type SeedResult = {
  contractId: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  tenantName: string;
  tenantEmail: string;
  tenantPassword: string | null;
};

export function QuickContractPanel({ businessDate }: { businessDate: string }) {
  const { request } = useMeterApi();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [result, setResult] = useState<SeedResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const key = useRef('');
  const locations = useQuery({
    queryKey: ['quick-contract-locations'],
    queryFn: ({ signal }) => request<RoomOption[]>('/api/v1/capture/locations', { signal }),
    enabled: open,
  });
  const rooms = useQuery({
    queryKey: ['quick-contract-rooms', location],
    queryFn: ({ signal }) =>
      request<RoomOption[]>(`/api/v1/capture/locations/${location}/rooms`, { signal }),
    enabled: open && !!location,
  });
  const available = (rooms.data ?? []).filter(
    (item) => item.status === 'Available' && !item.waitingForOwnerSignature,
  );

  function chooseRoom(value: string) {
    setRoom(value);
    key.current = '';
    setError('');
  }

  function close() {
    if (lock.current) return;
    setOpen(false);
    setResult(null);
    setError('');
    if (result) chooseRoom('');
  }

  async function create() {
    if (!location || !room || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    key.current ||= crypto.randomUUID();
    try {
      const created = await request<SeedResult>('/api/v1/development/onboarding-seed', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: JSON.stringify({
          locationId: location,
          roomId: room,
          expectedBusinessDate: businessDate,
        }),
      });
      setResult(created);
      await cache.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'demo-clock' });
    } catch (e) {
      const code = e instanceof ApiError ? e.problem?.code : undefined;
      const message =
        code === 'development_seed_pricing_required'
          ? 'Phòng chưa có biểu phí tiền thuê, điện và nước hợp lệ tại ngày demo.'
          : code === 'development_seed_meters_required'
            ? 'Phòng cần một công tơ điện và một công tơ nước đang hoạt động tại ngày demo.'
            : code === 'development_seed_assets_required'
              ? 'Phòng chưa có tài sản thực tế. Hãy ghi nhận tài sản cho phòng hoặc chọn phòng khác.'
              : code === 'development_seed_business_date_changed'
                ? 'Ngày demo đã thay đổi. Kiểm tra Demo Clock rồi thử lại.'
                : contractError(e);
      setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="contained"
        startIcon={<FilePlus2 size={18} />}
        onClick={() => setOpen(true)}
        sx={{ minHeight: 44, boxShadow: 3, borderRadius: 2 }}
      >
        Tạo HĐ test
      </Button>
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle>Tạo nhanh hợp đồng thử nghiệm</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {result ? (
              <>
                <Alert severity="success">Đã tạo hợp đồng và nhiệm vụ bàn giao phòng.</Alert>
                <Typography>
                  {result.locationName} · {result.roomNumber}
                </Typography>
                <TextField
                  label="Tài khoản Tenant"
                  value={result.tenantEmail}
                  slotProps={{ input: { readOnly: true } }}
                  fullWidth
                />
                {result.tenantPassword ? (
                  <TextField
                    label="Mật khẩu Tenant test"
                    value={result.tenantPassword}
                    slotProps={{ input: { readOnly: true } }}
                    fullWidth
                  />
                ) : (
                  <Alert severity="info">
                    Đây là hợp đồng đã tạo trước đó. Mật khẩu chỉ hiện ở lần tạo đầu tiên.
                  </Alert>
                )}
                <Typography variant="body2" color="text.secondary">
                  Staff thực hiện bàn giao và xác nhận điện nước trên nhiệm vụ được giao.
                </Typography>
              </>
            ) : (
              <>
                <Alert severity="warning">
                  Chỉ dùng dữ liệu demo. Hợp đồng 12 tháng từ{' '}
                  {businessDate.split('-').reverse().join('/')}, không có tiền cọc, chữ ký hay thanh
                  toán thật.
                </Alert>
                <TextField
                  select
                  fullWidth
                  label="Cơ sở"
                  value={location}
                  disabled={busy || locations.isPending}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    chooseRoom('');
                  }}
                >
                  {(locations.data ?? []).map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="Phòng trống"
                  value={available.some((item) => item.id === room) ? room : ''}
                  disabled={busy || !location || rooms.isPending}
                  onChange={(event) => chooseRoom(event.target.value)}
                >
                  {available.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                {location && rooms.isSuccess && !available.length && (
                  <Alert severity="info">Không có phòng trống tại cơ sở này.</Alert>
                )}
                {(locations.isError || rooms.isError) && (
                  <Alert severity="error">
                    Không tải được danh sách phòng. Đóng và mở lại để thử lại.
                  </Alert>
                )}
                <Typography variant="body2" color="text.secondary">
                  Chọn phòng có biểu phí hiện hành, công tơ điện, nước và tài sản thực tế. Hợp đồng
                  test sử dụng đúng tài sản và công tơ của phòng.
                </Typography>
                {error && <Alert severity="error">{error}</Alert>}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            {result ? 'Đóng' : 'Hủy'}
          </Button>
          {!result && (
            <Button
              variant="contained"
              disabled={!location || !room || busy}
              onClick={() => void create()}
            >
              {busy ? 'Đang tạo…' : 'Tạo hợp đồng test'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
