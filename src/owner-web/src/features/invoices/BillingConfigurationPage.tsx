import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  invoiceError,
  formatBillingDecimal,
  type BillingSchedule,
  type Policy,
  type PolicyInput,
} from '../../../../../packages/client-core/src/invoices';
import { PageHeader } from '../../components/common/PortalUI';
import { useInvoiceApi } from './useInvoiceApi';

export function BillingConfigurationPage({
  initialLocationId = '',
}: { initialLocationId?: string } = {}) {
  const api = useInvoiceApi();
  const { locationId: routeLocationId } = useParams();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [location, setLocation] = useState(routeLocationId ?? '');
  const locations = useQuery({
    queryKey: ['billing-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  return (
    <>
      <PageHeader
        title="Giá thuê & Chính sách phí"
        subtitle="Cấu hình giá theo ngày hiệu lực và các quy tắc lập hóa đơn của cơ sở."
      />
      <Stack spacing={2}>
        {locations.isPending && <LinearProgress />}
        {locations.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void locations.refetch()}>Thử lại</Button>}
          >
            {invoiceError(locations.error)}
          </Alert>
        )}
        {locations.data?.length === 0 && <Alert severity="info">Chưa có cơ sở.</Alert>}
        <TextField
          select
          label="Cơ sở cấu hình"
          value={location}
          disabled={!!initialLocationId}
          onChange={(e) => setLocation(e.target.value)}
        >
          <MenuItem value="">Chọn cơ sở</MenuItem>
          {locations.data?.map((l) => (
            <MenuItem value={l.id} key={l.id}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
        {location && <LocationBilling key={location + actor} location={location} />}
      </Stack>
    </>
  );
}
function LocationBilling({ location }: { location: string }) {
  const api = useInvoiceApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [page, setPage] = useState(1);
  const schedule = useQuery({
    queryKey: ['billing-schedule', actor, location],
    queryFn: async ({ signal }) => (await api.schedule(location, signal)) ?? null,
  });
  const policies = useQuery({
    queryKey: ['billing-policies', actor, location, page],
    queryFn: ({ signal }) => api.policies(location, page, signal),
  });
  const [replacing, setReplacing] = useState<Policy | null>(null);
  return (
    <>
      {schedule.isPending && <LinearProgress />}
      {schedule.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void schedule.refetch()}>Thử lại</Button>}
        >
          {invoiceError(schedule.error)}
        </Alert>
      )}
      {schedule.isSuccess && (
        <ScheduleForm
          key={schedule.data?.version ?? 0}
          location={location}
          current={schedule.data ?? undefined}
          onSaved={() => void schedule.refetch()}
        />
      )}
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Biểu giá đã lưu</Typography>
          {policies.isPending && <LinearProgress />}
          {policies.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void policies.refetch()}>Thử lại</Button>}
            >
              {invoiceError(policies.error)}
            </Alert>
          )}
          {policies.data?.items.length === 0 && (
            <Alert severity="info">
              Chưa có biểu giá. Thêm giá thuê, điện và nước để lập hóa đơn.
            </Alert>
          )}
          {policies.data?.items.map((p) => (
            <Stack
              key={p.id}
              direction="row"
              sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Typography>
                {p.name} · {formatBillingDecimal(p.rate)} đ · {p.effectiveFrom} →{' '}
                {p.effectiveTo ?? 'Không hạn'} · {p.roomId ? 'Phòng' : 'Cơ sở'}
              </Typography>
              <Button onClick={() => setReplacing(p)}>Tạo giá kế tiếp</Button>
            </Stack>
          ))}
          <Stack direction="row">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Trang trước
            </Button>
            <Button
              disabled={!policies.data || page * 20 >= policies.data.totalCount}
              onClick={() => setPage(page + 1)}
            >
              Trang sau
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <PolicyForm
        key={replacing?.id ?? 'new'}
        location={location}
        previous={replacing}
        onSaved={() => {
          setReplacing(null);
          void policies.refetch();
        }}
        onCancel={() => setReplacing(null)}
      />
    </>
  );
}
function ScheduleForm({
  location,
  current,
  onSaved,
}: {
  location: string;
  current?: BillingSchedule;
  onSaved: () => void;
}) {
  const api = useInvoiceApi();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [
        'rateDate',
        'rentSource',
        'partialMonth',
        'rounding',
        'draftDay',
        'draftMonthOffset',
        'finalDay',
        'finalMonthOffset',
        'dueDay',
        'dueMonthOffset',
      ].map((key) => [key, current ? String(current[key as keyof BillingSchedule]) : '']),
    ),
  );
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const choice = (key: string, label: string, options: string[]) => (
    <TextField
      key={key}
      select
      required
      label={label}
      value={values[key]}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
    >
      <MenuItem value="">Chọn quy tắc</MenuItem>
      {options.map((text, i) => (
        <MenuItem key={text} value={String(i)}>
          {text}
        </MenuItem>
      ))}
    </TextField>
  );
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          setNotice('');
          const input = {
            locationId: location,
            version: current?.version ?? 0,
            ...Object.fromEntries(
              Object.entries(values).map(([key, value]) => [key, Number(value)]),
            ),
          } as BillingSchedule;
          void api
            .saveSchedule(input)
            .then(() => {
              setNotice('Đã lưu cấu hình.');
              onSaved();
            })
            .catch((e) => setError(invoiceError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Typography variant="h6">Quy tắc và lịch hóa đơn</Typography>
        {!current && (
          <Alert severity="info">Chọn đầy đủ các quy tắc trước khi lập hóa đơn đầu tiên.</Alert>
        )}
        {choice('rentSource', 'Nguồn tiền thuê cả phòng', [
          'Biểu giá của phòng / cơ sở',
          'Tiền thuê của hợp đồng đại diện',
        ])}
        {choice('rateDate', 'Mốc áp dụng giá trong kỳ', ['Ngày đầu tháng', 'Ngày cuối tháng'])}
        {choice('partialMonth', 'Phí cố định khi ở không đủ tháng', [
          'Thu cả tháng',
          'Theo số ngày phòng có khách / số ngày tháng',
        ])}
        {choice('rounding', 'Làm tròn từng khoản VND', [
          'Làm tròn .5 lên',
          'Làm tròn .5 về số chẵn',
        ])}
        <Typography variant="body2">
          Tháng cộng thêm tính từ tháng hóa đơn. Ngày 29–31 tự co về cuối tháng ngắn.
        </Typography>
        {(['draft', 'final', 'due'] as const).map((kind, i) => (
          <Stack key={kind} direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required
              label={`Ngày ${['lập nháp', 'phát hành', 'hạn thanh toán'][i]}`}
              type="number"
              value={values[kind + 'Day']}
              onChange={(e) => setValues((v) => ({ ...v, [kind + 'Day']: e.target.value }))}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
            />
            {choice(kind + 'MonthOffset', 'Tháng cộng thêm', [
              'Trong tháng hóa đơn',
              'Tháng kế tiếp',
              'Sau hai tháng',
            ])}
          </Stack>
        ))}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button
          type="submit"
          variant="contained"
          disabled={busy || Object.values(values).some((value) => value === '')}
        >
          Lưu quy tắc hóa đơn
        </Button>
      </Stack>
    </Paper>
  );
}
function PolicyForm({
  location,
  previous,
  onSaved,
  onCancel,
}: {
  location: string;
  previous: Policy | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const rooms = useQuery({
    queryKey: ['policy-rooms', session?.userId, location],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${encodeURIComponent(location)}/rooms`,
        { signal },
      ),
  });
  const [category, setCategory] = useState(String(previous?.category ?? 1)),
    [rate, setRate] = useState(''),
    [date, setDate] = useState(''),
    [endDate, setEndDate] = useState('');
  const [name, setName] = useState(previous?.name ?? ''),
    [code, setCode] = useState(previous?.chargeCode ?? ''),
    [reason, setReason] = useState('');
  const [roomId, setRoomId] = useState(previous?.roomId ?? '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current) return;
          if (!/^\d{1,14}(\.\d{1,4})?$/.test(rate)) {
            setError(
              'Nhập giá không âm, tối đa 4 chữ số thập phân, không có dấu phân cách hàng nghìn.',
            );
            return;
          }
          lock.current = true;
          setBusy(true);
          setError('');
          const cat = Number(category);
          const input: PolicyInput = {
            locationId: location,
            roomId: roomId || null,
            category: cat,
            chargeCode: cat === 3 ? code : ['RENT', 'ELECTRICITY', 'WATER'][cat],
            name,
            method: cat === 1 || cat === 2 ? 1 : 0,
            rate,
            effectiveFrom: date,
            effectiveTo: endDate || null,
            reason,
          };
          void (
            previous
              ? api.replacePolicy(previous.id, input, previous.version)
              : api.createPolicy(input)
          )
            .then(async () => {
              setRate('');
              setDate('');
              setReason('');
              await cache.invalidateQueries({ queryKey: ['billing-policies'] });
              onSaved();
            })
            .catch((error) => setError(invoiceError(error)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Typography variant="h6">
          {previous ? 'Phiên bản giá kế tiếp: ' + previous.name : 'Thêm biểu giá'}
        </Typography>
        <TextField
          select
          label="Phạm vi biểu giá"
          value={roomId}
          disabled={!!previous}
          onChange={(e) => setRoomId(e.target.value)}
        >
          <MenuItem value="">Toàn cơ sở</MenuItem>
          {(rooms.data ?? []).map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {item.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Khoản thu"
          value={category}
          disabled={!!previous}
          onChange={(e) => setCategory(e.target.value)}
        >
          {['Tiền thuê', 'Điện / kWh', 'Nước / m³', 'Phí dịch vụ / tháng'].map((text, i) => (
            <MenuItem key={text} value={String(i)}>
              {text}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          required
          label="Tên khoản thu"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {category === '3' && (
          <TextField
            required
            label="Mã phí dịch vụ"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        )}
        <TextField
          required
          label="Đơn giá VND"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
        <TextField
          required
          type="date"
          label="Hiệu lực từ ngày"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          required
          label="Lý do / ghi chú"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <TextField
          type="date"
          label="Hiệu lực đến ngày (không bắt buộc)"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          type="submit"
          disabled={busy}
          variant="contained"
        >
          Lưu biểu giá
        </Button>
        {previous && (
          <Button disabled={busy} onClick={onCancel}>
            Hủy tạo giá kế tiếp
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
