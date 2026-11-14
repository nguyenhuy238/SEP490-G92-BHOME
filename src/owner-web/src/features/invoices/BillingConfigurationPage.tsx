import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
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
import { ConflictReload } from '../locations/components/ConflictReload';

export function BillingConfigurationPage({
  initialLocationId = '',
}: { initialLocationId?: string } = {}) {
  const api = useInvoiceApi();
  const { locationId: routeLocationId } = useParams();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [location, setLocation] = useState(routeLocationId ?? initialLocationId);
  const locations = useQuery({
    queryKey: ['billing-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  return (
    <>
      <PageHeader
        title="Giá thuê & Chính sách phí"
        subtitle="Thiết lập quy tắc tính tiền, lịch hóa đơn và biểu giá theo ngày hiệu lực cho từng cơ sở."
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
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Cơ sở áp dụng</Typography>
              <Typography variant="body2" color="text.secondary">
                Chọn cơ sở trước khi thay đổi các quy tắc và mức giá.
              </Typography>
            </Box>
            <TextField
              select
              size="small"
              label="Cơ sở cấu hình"
              value={location}
              disabled={!!initialLocationId}
              onChange={(e) => setLocation(e.target.value)}
              sx={{ minWidth: { sm: 280 }, flex: { sm: '0 1 400px' } }}
            >
              <MenuItem value="">Chọn cơ sở</MenuItem>
              {locations.data?.map((l) => (
                <MenuItem value={l.id} key={l.id}>
                  {l.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Paper>
        {!location && locations.data?.length !== 0 && (
          <Alert severity="info">
            Chọn cơ sở để xem lịch lập hóa đơn và biểu giá đang áp dụng.
          </Alert>
        )}
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
  const [editSchedule, setEditSchedule] = useState(false);
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [dismissedPolicyForm, setDismissedPolicyForm] = useState(false);
  const [notice, setNotice] = useState('');
  const scheduleAnchor = useRef<HTMLDivElement>(null);
  const policyAnchor = useRef<HTMLDivElement>(null);
  const schedule = useQuery({
    queryKey: ['billing-schedule', actor, location],
    queryFn: async ({ signal }) => (await api.schedule(location, signal)) ?? null,
  });
  const policies = useQuery({
    queryKey: ['billing-policies', actor, location, page],
    queryFn: ({ signal }) => api.policies(location, page, signal),
  });
  const [replacing, setReplacing] = useState<Policy | null>(null);
  const shouldShowPolicyForm =
    showPolicyForm || (policies.data?.totalCount === 0 && !dismissedPolicyForm);
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() =>
        ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
      );
    }
  };
  const openSchedule = () => {
    setEditSchedule(true);
    scrollTo(scheduleAnchor);
  };
  const openPolicy = (policy: Policy | null) => {
    setReplacing(policy);
    setShowPolicyForm(true);
    setDismissedPolicyForm(false);
    scrollTo(policyAnchor);
  };
  return (
    <>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
              Thiết lập để lập hóa đơn
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Cần có quy tắc hóa đơn và biểu giá của cơ sở. Chọn từng bước để xem hoặc cập nhật.
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
              <Stack
                direction="row"
                sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'center' }}
              >
                <Typography sx={{ fontWeight: 700 }}>1. Quy tắc & ngày hóa đơn</Typography>
                {schedule.isSuccess && (
                  <Chip
                    size="small"
                    color={schedule.data ? 'success' : 'warning'}
                    label={schedule.data ? 'Đã thiết lập' : 'Cần thiết lập'}
                  />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {schedule.data
                  ? `Lập nháp ngày ${schedule.data.draftDay}, phát hành ngày ${schedule.data.finalDay}, hạn ngày ${schedule.data.dueDay} theo lịch đã lưu.`
                  : 'Chọn cách tính phí, ngày lập nháp, phát hành và hạn thanh toán.'}
              </Typography>
              <Button size="small" sx={{ mt: 1 }} onClick={openSchedule}>
                {schedule.data ? 'Xem / chỉnh sửa lịch' : 'Thiết lập quy tắc'}
              </Button>
            </Box>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
              <Stack
                direction="row"
                sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'center' }}
              >
                <Typography sx={{ fontWeight: 700 }}>2. Giá thuê & các khoản phí</Typography>
                {policies.isSuccess && (
                  <Chip
                    size="small"
                    color={policies.data?.totalCount ? 'success' : 'warning'}
                    label={policies.data?.totalCount ? 'Đã có biểu giá' : 'Chưa có biểu giá'}
                  />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {policies.data?.totalCount
                  ? `Đã lưu ${policies.data.totalCount} biểu giá. Có thể tạo giá mới hoặc thay mức giá từ ngày hiệu lực.`
                  : 'Thêm giá thuê, điện, nước và các khoản phí phù hợp với cơ sở.'}
              </Typography>
              <Button size="small" sx={{ mt: 1 }} onClick={() => openPolicy(null)}>
                Thêm biểu giá
              </Button>
            </Box>
          </Box>
          {notice && (
            <Alert severity="success" onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}
        </Stack>
      </Paper>
      {schedule.isPending && <LinearProgress />}
      {schedule.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void schedule.refetch()}>Thử lại</Button>}
        >
          {invoiceError(schedule.error)}
        </Alert>
      )}
      {schedule.isSuccess && (schedule.data ? editSchedule : true) && (
        <Box ref={scheduleAnchor} sx={{ scrollMarginTop: 24 }}>
          {!!schedule.data && (
            <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
              <Button size="small" onClick={() => setEditSchedule(false)}>
                Đóng chỉnh sửa quy tắc
              </Button>
            </Stack>
          )}
          <ScheduleForm
            key={schedule.data?.version ?? 0}
            location={location}
            current={schedule.data ?? undefined}
            onSaved={() => {
              setEditSchedule(false);
              setNotice('Đã lưu quy tắc hóa đơn. Bạn có thể kiểm tra biểu giá ở bước tiếp theo.');
              void schedule.refetch();
            }}
          />
        </Box>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Biểu giá đã lưu
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Mỗi biểu giá gắn với phạm vi và ngày hiệu lực riêng.
              </Typography>
            </Box>
            {policies.data && (
              <Chip
                size="small"
                variant="outlined"
                label={`${policies.data.totalCount} biểu giá`}
              />
            )}
            <Button size="small" variant="contained" onClick={() => openPolicy(null)}>
              Thêm biểu giá
            </Button>
          </Stack>
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
            <Box
              key={p.id}
              sx={{
                py: 1.25,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 0 },
              }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', gap: 1.5 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 650 }}>{p.name}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={p.roomId ? 'Theo phòng' : 'Toàn cơ sở'}
                    />
                  </Stack>
                  <Typography
                    color="text.secondary"
                    variant="caption"
                    sx={{ display: 'block', mt: 0.5 }}
                  >
                    Hiệu lực: {p.effectiveFrom.split('-').reverse().join('/')} →{' '}
                    {p.effectiveTo
                      ? p.effectiveTo.split('-').reverse().join('/')
                      : 'Không giới hạn'}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  sx={{
                    gap: 2,
                    alignItems: 'center',
                    justifyContent: { xs: 'space-between', md: 'flex-end' },
                  }}
                >
                  <Typography sx={{ fontWeight: 750, whiteSpace: 'nowrap' }}>
                    {formatBillingDecimal(p.rate)} đ
                  </Typography>
                  <Button size="small" variant="outlined" onClick={() => openPolicy(p)}>
                    Tạo giá kế tiếp
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
          {policies.data && (page > 1 || page * 20 < policies.data.totalCount) && (
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}
            >
              <Button size="small" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <Typography variant="body2" color="text.secondary">
                Trang {page}
              </Typography>
              <Button
                size="small"
                disabled={!policies.data || page * 20 >= policies.data.totalCount}
                onClick={() => setPage(page + 1)}
              >
                Trang sau
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
      {shouldShowPolicyForm && (
        <Box ref={policyAnchor} sx={{ scrollMarginTop: 24 }}>
          <PolicyForm
            key={replacing?.id ?? 'new'}
            location={location}
            previous={replacing}
            onSaved={() => {
              setNotice(
                replacing ? 'Đã lưu phiên bản biểu giá kế tiếp.' : 'Đã thêm biểu giá cho cơ sở.',
              );
              setReplacing(null);
              setShowPolicyForm(false);
              setDismissedPolicyForm(true);
              void policies.refetch();
            }}
            onCancel={() => {
              setReplacing(null);
              setShowPolicyForm(false);
              setDismissedPolicyForm(true);
            }}
          />
        </Box>
      )}
    </>
  );
}
export function ScheduleForm({
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
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
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
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Quy tắc và lịch hóa đơn
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Các lựa chọn này được hệ thống dùng để tính tiền và xác định ngày lập, phát hành hóa
            đơn.
          </Typography>
          {current && (
            <Chip
              size="small"
              variant="outlined"
              sx={{ mt: 1 }}
              label={`Phiên bản ${current.version}`}
            />
          )}
        </Box>
        {!current && (
          <Alert severity="info">Chọn đầy đủ các quy tắc trước khi lập hóa đơn đầu tiên.</Alert>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, pt: 0.5 }}>
          01 · Cách tính tiền
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
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
        </Box>
        <Divider />
        <Box>
          <Typography sx={{ fontWeight: 700 }} variant="subtitle2">
            02 · Mốc thời gian hóa đơn
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Tháng cộng thêm tính từ tháng hóa đơn. Ngày 29–31 tự co về cuối tháng ngắn.
          </Typography>
        </Box>
        {(['draft', 'final', 'due'] as const).map((kind, i) => (
          <Box
            key={kind}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1fr)' },
              gap: 2,
            }}
          >
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
          </Box>
        ))}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button
          sx={{ alignSelf: { sm: 'flex-start' } }}
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
export function PolicyForm({
  location,
  previous: initialPrevious,
  onSaved,
  onCancel,
  mode = 'replace',
  defaultCategory = 1,
}: {
  location: string;
  previous: Policy | null;
  onSaved: () => void;
  onCancel: () => void;
  mode?: 'replace' | 'update';
  defaultCategory?: number;
}) {
  const api = useInvoiceApi();
  const [previous, setPrevious] = useState(initialPrevious);
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
  const [category, setCategory] = useState(String(previous?.category ?? defaultCategory)),
    [rate, setRate] = useState(mode === 'update' ? String(previous?.rate ?? '') : ''),
    [date, setDate] = useState(mode === 'update' ? (previous?.effectiveFrom ?? '') : ''),
    [endDate, setEndDate] = useState(mode === 'update' ? (previous?.effectiveTo ?? '') : '');
  const [name, setName] = useState(previous?.name ?? ''),
    [code, setCode] = useState(previous?.chargeCode ?? ''),
    [reason, setReason] = useState('');
  const [roomId, setRoomId] = useState(previous?.roomId ?? '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [rawError, setRawError] = useState<unknown>(null);
  const lock = useRef(false);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
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
              ? mode === 'update'
                ? api.request(`/api/v1/billing-policies/${encodeURIComponent(previous.id)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ policy: input, expectedVersion: previous.version }),
                  })
                : api.replacePolicy(previous.id, input, previous.version)
              : api.createPolicy(input)
          )
            .then(async () => {
              setRate('');
              setDate('');
              setReason('');
              await cache.invalidateQueries({ queryKey: ['billing-policies'] });
              await cache.invalidateQueries({ queryKey: ['property-setup'] });
              onSaved();
            })
            .catch((error) => {
              setRawError(error);
              setError(invoiceError(error));
            })
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {previous
            ? (mode === 'update' ? 'Chỉnh sửa giá tương lai: ' : 'Phiên bản giá kế tiếp: ') +
              previous.name
            : 'Thêm biểu giá'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Xác định phạm vi, khoản thu, đơn giá và khoảng thời gian có hiệu lực.
        </Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, pt: 0.5 }}>
          01 · Khoản thu & phạm vi
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
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
        </Box>
        <Divider />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          02 · Đơn giá & hiệu lực
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
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
            type="date"
            label="Hiệu lực đến ngày (không bắt buộc)"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        <TextField
          required
          label="Lý do / ghi chú"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helperText="Ghi rõ lý do tạo hoặc thay đổi mức giá để thuận tiện đối chiếu."
        />
        {error && <Alert severity="error">{error}</Alert>}
        {previous && (
          <ConflictReload
            error={rawError}
            reload={async () => {
              const latest = await api.request<Policy>(
                `/api/v1/billing-policies/${encodeURIComponent(previous.id)}`,
              );
              setPrevious(latest);
              setName(latest.name);
              setCode(latest.chargeCode);
              setRoomId(latest.roomId ?? '');
              setCategory(String(latest.category));
              setRate(mode === 'update' ? String(latest.rate) : '');
              setDate(mode === 'update' ? latest.effectiveFrom : '');
              setEndDate(mode === 'update' ? (latest.effectiveTo ?? '') : '');
              setReason('');
              setError('');
              setRawError(null);
            }}
          />
        )}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ justifyContent: 'flex-end' }}
        >
          <Button disabled={busy} onClick={onCancel}>
            Đóng biểu giá
          </Button>
          <Button type="submit" disabled={busy} variant="contained">
            Lưu biểu giá
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
