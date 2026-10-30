import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  contractError,
  draftPayload,
  mutationKeys,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';

export function ContractDraftDialog({
  api,
  ownerId,
  onClose,
  onCreated,
}: {
  api: ContractClient;
  ownerId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    ownerSignerId: ownerId,
    requiredDeposit: '',
  });
  const [location, setLocation] = useState('');
  const [residents, setResidents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const locations = useQuery({
    queryKey: ['contract-locations', ownerId],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const rooms = useQuery({
    queryKey: ['contract-rooms', ownerId, location],
    queryFn: ({ signal }) => api.rooms(location, signal),
    enabled: !!location,
  });
  const people = useQuery({
    queryKey: ['contract-residents', ownerId, location],
    queryFn: ({ signal }) => api.residents(location, signal),
    enabled: !!location,
  });
  const eligible = (people.data ?? []).filter(
    (r) => r.roomId === values.roomId && r.verificationStatus === 1,
  );
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  async function submit() {
    if (lock.current) return;
    setError('');
    let body;
    try {
      body = draftPayload(values, residents);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const result = await api.mutate<{ id: string }>(null, '', body, keys.get('draft', body));
      keys.confirmed('draft', body);
      onCreated(result.id);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const queryError = locations.error || rooms.error || people.error;
  return (
    <Dialog open fullWidth maxWidth="md" onClose={() => !busy && onClose()}>
      <DialogTitle>Tạo nháp hợp đồng thuê</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            Bản nháp chưa giữ chỗ hoặc kích hoạt phòng. Người ở cần được Staff xác minh trước.
          </Alert>
          {queryError && (
            <Alert severity="error">
              {contractError(queryError)}
              <Button
                onClick={() => {
                  void locations.refetch();
                  if (location) {
                    void rooms.refetch();
                    void people.refetch();
                  }
                }}
              >
                Tải lại lựa chọn
              </Button>
            </Alert>
          )}
          <TextField
            select
            label="Cơ sở"
            value={location}
            disabled={busy || locations.isFetching}
            onChange={(e) => {
              setLocation(e.target.value);
              set('roomId', '');
              set('representativeResidentId', '');
              setResidents([]);
            }}
          >
            {(locations.data ?? []).map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Phòng"
            value={values.roomId ?? ''}
            disabled={busy || !location || rooms.isFetching}
            onChange={(e) => {
              set('roomId', e.target.value);
              set('representativeResidentId', '');
              setResidents([]);
            }}
          >
            {(rooms.data ?? []).map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="subtitle2">Người ở đã xác minh</Typography>
          {eligible.map((r) => (
            <FormControlLabel
              key={r.id}
              label={r.displayLabel}
              control={
                <Checkbox
                  checked={residents.includes(r.id)}
                  disabled={busy}
                  onChange={(_, checked) => {
                    setResidents((ids) =>
                      checked ? [...ids, r.id] : ids.filter((i) => i !== r.id),
                    );
                    if (!checked && values.representativeResidentId === r.id)
                      set('representativeResidentId', '');
                  }}
                />
              }
            />
          ))}
          {!!values.roomId && !eligible.length && (
            <Alert severity="warning">
              Phòng chưa có người ở đã xác minh. Hoàn tất tiếp nhận trên mobile trước khi lập hợp
              đồng.
            </Alert>
          )}
          <TextField
            select
            label="Người đại diện"
            value={values.representativeResidentId ?? ''}
            disabled={busy}
            onChange={(e) => set('representativeResidentId', e.target.value)}
          >
            {eligible
              .filter((r) => residents.includes(r.id))
              .map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.displayLabel}
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label="UUID tài khoản Tenant ký hợp đồng"
            value={values.tenantUserId ?? ''}
            disabled={busy}
            onChange={(e) => set('tenantUserId', e.target.value.trim())}
            helperText="Tài khoản Tenant có sẵn; mã tài khoản khác mã hồ sơ người ở. Máy chủ kiểm tra vai trò và trạng thái."
          />
          <TextField
            label="UUID tài khoản Owner ký hợp đồng"
            value={values.ownerSignerId ?? ''}
            disabled={busy}
            onChange={(e) => set('ownerSignerId', e.target.value.trim())}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {['startDate', 'endDate'].map((name, i) => (
              <TextField
                key={name}
                fullWidth
                label={i ? 'Ngày hết hạn' : 'Ngày bắt đầu'}
                type="date"
                slotProps={{ inputLabel: { shrink: true } }}
                value={values[name] ?? ''}
                disabled={busy}
                onChange={(e) => set(name, e.target.value)}
              />
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {['monthlyRent', 'requiredDeposit'].map((name, i) => (
              <TextField
                key={name}
                fullWidth
                label={i ? 'Cọc yêu cầu (VND)' : 'Tiền thuê tháng (VND)'}
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 18 } }}
                value={values[name] ?? ''}
                disabled={busy}
                onChange={(e) => set(name, e.target.value)}
              />
            ))}
          </Stack>
          <TextField
            label="Điều khoản đã thống nhất"
            multiline
            minRows={4}
            slotProps={{ htmlInput: { maxLength: 12000 } }}
            value={values.terms ?? ''}
            disabled={busy}
            onChange={(e) => set('terms', e.target.value)}
          />
          <TextField
            label="UUID hợp đồng giữ chỗ (nếu có)"
            value={values.holdingContractId ?? ''}
            disabled={busy}
            onChange={(e) => set('holdingContractId', e.target.value.trim())}
            helperText="Chỉ áp dụng khi hợp đồng giữ chỗ và phân bổ cọc đã được backend hỗ trợ; không tự chuyển cọc."
          />
          {!!error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Đóng
        </Button>
        <Button
          variant="contained"
          disabled={busy || !!queryError || !eligible.length}
          onClick={() => void submit()}
        >
          {busy ? 'Đang lưu…' : 'Lưu bản nháp'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
