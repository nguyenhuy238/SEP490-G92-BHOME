import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import {
  holdingSettingsClient,
  type HoldingSettings,
  type HoldingPreparation,
} from '../../../../../../packages/client-core/src/holdingSettings';
import {
  contractClient,
  contractError,
  formatContractMoney,
} from '../../../../../../packages/client-core/src/contracts';
import { apiBaseUrl } from '../../../services/config';

export default function HoldingSettingsPage() {
  const { client } = useAuth();
  const request = useMemo(
    () =>
      createApiClient(apiBaseUrl, () => client.session?.accessToken, client.clear, client.refresh),
    [client],
  );
  const api = useMemo(() => holdingSettingsClient(request), [request]);
  const contracts = useMemo(() => contractClient(request), [request]);
  const [locations, setLocations] = useState<{ id: string; label: string }[]>([]);
  const [location, setLocation] = useState('');
  const [rooms, setRooms] = useState<{ id: string; label: string }[]>([]);
  const [room, setRoom] = useState('');
  const [settings, setSettings] = useState<HoldingSettings | null>(null);
  const [months, setMonths] = useState('');
  const [factor, setFactor] = useState('1');
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [preview, setPreview] = useState<HoldingPreparation | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    void contracts
      .locations(abort.signal)
      .then(setLocations)
      .catch((e) => {
        if (!abort.signal.aborted) setError(contractError(e));
      });
    return () => abort.abort();
  }, [contracts]);
  function changeLocation(next: string) {
    setSettings(null);
    setMonths('');
    setFactor('1');
    setTerms('');
    setRooms([]);
    setRoom('');
    setPreview(null);
    setSuccess('');
    setError('');
    setLoading(!!next);
    setLocation(next);
  }
  useEffect(() => {
    if (!location) return;
    const abort = new AbortController();
    void Promise.all([api.get(location, abort.signal), contracts.rooms(location, abort.signal)])
      .then(([value, items]) => {
        if (abort.signal.aborted) return;
        setSettings(value);
        setRooms(items);
        if (value) {
          setMonths(String(value.holdingMonths));
          setFactor(value.depositRentMonths);
          setTerms(value.terms);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(contractError(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [api, contracts, location]);
  useEffect(() => {
    if (!room || !settings) return;
    const abort = new AbortController();
    void api
      .prepare(room, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setPreview(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(contractError(e));
      });
    return () => abort.abort();
  }, [api, room, settings]);
  async function save() {
    if (lock.current || !location) return;
    const count = Number(months),
      multiplier = Number(factor);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 120 ||
      !/^\d+(\.\d{1,2})?$/.test(factor) ||
      multiplier <= 0 ||
      multiplier > 120 ||
      !terms.trim()
    ) {
      setError(
        'Nhập 1–120 tháng giữ chỗ, hệ số cọc lớn hơn 0 (tối đa 120, hai số thập phân) và điều khoản giữ chỗ.',
      );
      return;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    setPreview(null);
    try {
      await api.save(location, {
        holdingMonths: count,
        depositRentMonths: factor,
        terms: terms.trim(),
        expectedVersion: settings?.version ?? 0,
      });
      setSettings(await api.get(location));
      setSuccess(
        'Đã lưu cấu hình giữ chỗ cho cơ sở đang chọn. Các hợp đồng đã tạo được giữ nguyên.',
      );
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4">Cấu hình hợp đồng giữ chỗ</Typography>
        <Typography color="text.secondary">
          Thiết lập riêng cho từng cơ sở. Tiền giữ chỗ được tính từ giá thuê hiện hành của từng
          phòng.
        </Typography>
      </Box>
      <Paper sx={{ p: 3 }}>
        <Stack spacing={3}>
          <TextField
            select
            label="Cơ sở áp dụng"
            value={location}
            disabled={saving}
            onChange={(e) => changeLocation(e.target.value)}
          >
            <MenuItem value="">Chọn cơ sở</MenuItem>
            {locations.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
          {loading && <CircularProgress size={24} />}
          {!!error && <Alert severity="error">{error}</Alert>}
          {!!success && <Alert severity="success">{success}</Alert>}
          {location && !loading && (
            <>
              <Alert severity="info">
                Chỉ áp dụng cho {locations.find((item) => item.id === location)?.label}. Chưa có giá
                thuê phòng thì hệ thống sẽ chặn tạo hợp đồng, không tự đặt tiền cọc.
              </Alert>
              {!settings && (
                <Alert severity="warning">
                  Cơ sở này chưa có cấu hình giữ chỗ. Nhập và lưu trước khi Staff tạo hợp đồng.
                </Alert>
              )}
              <TextField
                label="Số tháng giữ chỗ"
                type="number"
                value={months}
                disabled={saving}
                onChange={(e) => setMonths(e.target.value)}
                helperText="Hạn giữ chỗ = ngày bắt đầu + số tháng lịch đã cấu hình."
              />
              <TextField
                label="Tiền giữ chỗ bằng bao nhiêu tháng tiền phòng?"
                type="number"
                value={factor}
                disabled={saving}
                onChange={(e) => setFactor(e.target.value)}
                helperText="Mặc định 1: bằng một tháng tiền thuê của phòng. Owner có thể đổi, ví dụ 0,5 hoặc 2. Thời hạn giữ chỗ độc lập với hệ số tiền cọc."
              />
              <TextField
                label="Điều khoản giữ chỗ"
                multiline
                minRows={4}
                value={terms}
                disabled={saving}
                onChange={(e) => setTerms(e.target.value)}
                helperText="Điều khoản này được chuyển vào hợp đồng giữ chỗ, không dùng điều khoản cọc thuê chính thức."
              />
              <Button variant="contained" disabled={saving} onClick={() => void save()}>
                {saving ? 'Đang lưu…' : 'Lưu cấu hình cho cơ sở này'}
              </Button>
              {settings && (
                <>
                  <TextField
                    select
                    label="Xem mức cọc theo phòng (cấu hình đã lưu)"
                    value={room}
                    onChange={(e) => {
                      setPreview(null);
                      setRoom(e.target.value);
                    }}
                  >
                    <MenuItem value="">Chọn phòng</MenuItem>
                    {rooms.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {preview && (
                    <Alert severity="success">
                      Phòng {preview.roomNumber}: giá thuê{' '}
                      {formatContractMoney(preview.monthlyRent)}/tháng · Tiền giữ chỗ{' '}
                      {formatContractMoney(preview.holdingDeposit)} · Giữ chỗ{' '}
                      {preview.holdingMonths} tháng.
                    </Alert>
                  )}
                </>
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
