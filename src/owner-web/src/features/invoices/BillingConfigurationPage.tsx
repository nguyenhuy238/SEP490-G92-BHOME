import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  invoiceError,
  formatBillingDecimal,
  type BillingSchedule,
  type Policy,
  type PolicyInput,
} from '../../../../../packages/client-core/src/invoices';
import { PageHeader, FilterToolbar } from '../../components/common/PortalUI';
import { useInvoiceApi } from './useInvoiceApi';
import { ConflictReload } from '../locations/components/ConflictReload';
import { todayVietnam } from '../staff/staffContracts';
import { canEditPolicyInPlace } from './policyVersions';

/**
 * Inline, read-only guide for the existing /pricing demo. It deliberately
 * leaves that page's sample CRUD editor in place; no separate price state.
 */
export function DemoBillingConfigurationGuide() {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{ gap: 1, alignItems: { md: 'center' }, justifyContent: 'space-between', mb: 1.5 }}
    >
      <Typography variant="caption" color="text.secondary">
        Giá minh họa · Thay đổi tại đây không tác động hóa đơn thật.
      </Typography>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" component={Link} to="/billing-automation">
          Xem lịch xử lý
        </Button>
        <Button size="small" component={Link} to="/invoices">
          Xem hóa đơn nháp
        </Button>
      </Stack>
    </Stack>
  );
}

export function BillingConfigurationPage({
  initialLocationId = '',
}: { initialLocationId?: string } = {}) {
  const api = useInvoiceApi();
  const { locationId: routeLocationId } = useParams();
  const [params] = useSearchParams();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [location, setLocation] = useState(
    routeLocationId ?? (initialLocationId || params.get('locationId') || ''),
  );
  const locations = useQuery({
    queryKey: ['billing-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  return (
    <>
      <PageHeader
        title="Giá thuê & Chính sách phí"
        subtitle="Kiểm tra quy tắc tính tiền và các mức giá đang áp dụng trước khi lập hóa đơn."
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
        {locations.data?.length === 0 && (
          <Alert
            severity="info"
            action={
              <Button component={Link} to="/locations" size="small">
                Xem cơ sở
              </Button>
            }
          >
            Chưa có cơ sở. Hãy tạo hoặc chọn cơ sở trước khi thiết lập biểu giá và lịch hóa đơn.
          </Alert>
        )}
        <FilterToolbar>
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
        </FilterToolbar>
        {!location && locations.data?.length !== 0 && (
          <Alert severity="info">Chọn cơ sở để xem quy tắc hóa đơn và biểu giá.</Alert>
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
  const [notice, setNotice] = useState('');
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
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() =>
        ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
      );
    }
  };
  const openPolicy = (policy: Policy | null) => {
    setReplacing(policy);
    setShowPolicyForm(true);
    scrollTo(policyAnchor);
  };
  return (
    <>
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {schedule.isPending && <LinearProgress />}
      {schedule.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void schedule.refetch()}>Thử lại</Button>}
        >
          {invoiceError(schedule.error)}
        </Alert>
      )}
      {schedule.isSuccess && !schedule.data && (
        <Alert
          severity="info"
          action={
            <Button size="small" href="#billing-schedule">
              Thiết lập lịch
            </Button>
          }
        >
          Cơ sở chưa có lịch lập nháp và phát hành. Hoàn tất phần “Lịch & quy tắc hóa đơn” bên dưới
          để xác định các ngày xử lý.
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Biểu giá đã lưu
            </Typography>
            <Button size="small" variant="contained" onClick={() => openPolicy(null)}>
              Thêm biểu giá
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Kiểm tra khoản thu, phạm vi phòng hoặc cơ sở và ngày hiệu lực. Sử dụng “Thêm biểu giá”
            để bắt đầu hoặc “Chỉnh sửa” khi cần thay đổi mức giá. Hợp đồng đã chốt giữ nguyên giá.
          </Typography>
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
          {!policies.error &&
            policies.data?.items.map((p) => (
              <Stack
                key={p.id}
                direction={{ xs: 'column', sm: 'row' }}
                sx={{
                  gap: 1,
                  alignItems: { sm: 'center' },
                  justifyContent: 'space-between',
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  pt: 1,
                }}
              >
                <Stack spacing={0.25} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <Typography sx={{ fontWeight: 650 }}>{p.name}</Typography>
                  <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatBillingDecimal(p.rate)} đ/
                    {p.category === 1
                      ? 'kWh'
                      : p.category === 2
                        ? 'm³'
                        : p.method === 2
                          ? 'người/tháng'
                          : 'phòng/tháng'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.effectiveFrom.split('-').reverse().join('/')} –{' '}
                    {p.effectiveTo?.split('-').reverse().join('/') ?? 'Không hạn'} ·{' '}
                    {p.roomId ? 'Phòng' : 'Cơ sở'}
                  </Typography>
                  {p.lastContractEndDate && (
                    <Typography variant="caption" color="text.secondary">
                      Ràng buộc hợp đồng đến {p.lastContractEndDate.split('-').reverse().join('/')}
                    </Typography>
                  )}
                </Stack>
                {(!p.effectiveTo || p.effectiveTo >= todayVietnam()) && (
                  <Button variant="outlined" size="small" onClick={() => openPolicy(p)}>
                    Chỉnh sửa
                  </Button>
                )}
              </Stack>
            ))}
          <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
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
        </Stack>
      </Paper>
      <Accordion
        id="billing-schedule"
        variant="outlined"
        disableGutters
        sx={{ scrollMarginTop: { xs: '80px', md: '96px' } }}
        expanded={schedule.isSuccess && (!schedule.data || editSchedule)}
        onChange={(_, expanded) => {
          if (schedule.data) setEditSchedule(expanded);
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{
              width: '100%',
              gap: 1,
              alignItems: { sm: 'center' },
              justifyContent: 'space-between',
            }}
          >
            <Typography sx={{ fontWeight: 700 }}>Lịch & quy tắc hóa đơn</Typography>
            {schedule.isSuccess && (
              <Typography variant="body2" color={schedule.data ? 'text.secondary' : 'warning.dark'}>
                {schedule.data
                  ? `Nháp ngày ${schedule.data.draftDay}${schedule.data.draftMonthOffset ? ` (+${schedule.data.draftMonthOffset} tháng)` : ''} · Phát hành ${schedule.data.finalDay}${schedule.data.finalMonthOffset ? ` (+${schedule.data.finalMonthOffset} tháng)` : ''} · Hạn trả ${schedule.data.dueDay}${schedule.data.dueMonthOffset ? ` (+${schedule.data.dueMonthOffset} tháng)` : ''}`
                  : 'Chưa thiết lập · Cần cấu hình'}
              </Typography>
            )}
          </Stack>
        </AccordionSummary>
        {schedule.isSuccess && (!schedule.data || editSchedule) && (
          <AccordionDetails>
            <ScheduleForm
              key={schedule.data?.version ?? 0}
              location={location}
              current={schedule.data ?? undefined}
              onSaved={() => {
                setEditSchedule(false);
                setNotice('Đã lưu quy tắc hóa đơn.');
                void schedule.refetch();
              }}
            />
          </AccordionDetails>
        )}
      </Accordion>
      {showPolicyForm && (
        <Box ref={policyAnchor} sx={{ scrollMarginTop: 24 }}>
          <PolicyForm
            key={replacing?.id ?? 'new'}
            location={location}
            previous={replacing}
            mode={replacing && canEditPolicyInPlace(replacing) ? 'update' : 'replace'}
            onSaved={() => {
              setNotice(replacing ? 'Đã lưu biểu giá.' : 'Đã thêm biểu giá.');
              setReplacing(null);
              setShowPolicyForm(false);
              void policies.refetch();
            }}
            onCancel={() => {
              setReplacing(null);
              setShowPolicyForm(false);
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
      ].map((key) => [
        key,
        key === 'rentSource' ? '1' : current ? String(current[key as keyof BillingSchedule]) : '',
      ]),
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
        component={ValidatedForm}
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
            Chỉ điều chỉnh cách tính tiền và thời điểm xử lý, không thay đổi đơn giá hợp đồng.
          </Typography>
        </Box>
        {!current && (
          <Alert severity="info">Chọn đầy đủ các quy tắc trước khi lập hóa đơn đầu tiên.</Alert>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Cách tính tiền
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <TextField
            label="Nguồn tiền thuê cả phòng"
            value="Giá đã chốt trong hợp đồng"
            disabled
            sx={{ gridColumn: '1 / -1' }}
          />
          {choice('rateDate', 'Mốc tham chiếu kỳ (không thay đổi giá hợp đồng)', [
            'Ngày đầu tháng',
            'Ngày cuối tháng',
          ])}
          {choice('partialMonth', 'Phí cố định khi ở không đủ tháng', [
            'Thu cả tháng',
            'Theo số ngày phòng có khách / số ngày tháng',
          ])}
          {choice('rounding', 'Làm tròn từng khoản VND', [
            'Làm tròn .5 lên',
            'Làm tròn .5 về số chẵn',
          ])}
        </Box>
        <Alert severity="info">
          Tiền thuê, đơn giá điện nước và các khoản dịch vụ của hợp đồng được giữ cố định. Lịch hóa
          đơn chỉ điều khiển kỳ tính tiền, ngày chốt và cách làm tròn.
        </Alert>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Các mốc thời gian
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Tháng cộng thêm tính từ tháng hóa đơn. Ngày 29–31 tự co về cuối tháng ngắn.
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {(['draft', 'final', 'due'] as const).map((kind, i) => (
            <Box
              key={kind}
              sx={{
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 1.5,
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
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button
            type="submit"
            variant="contained"
            disabled={busy || Object.values(values).some((value) => value === '')}
          >
            Lưu quy tắc hóa đơn
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
export function PolicyForm({
  location,
  previous: initialPrevious,
  onSaved,
  onCancel,
  mode: initialMode = 'replace',
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
  const nextDay = (value: string) => {
    const day = new Date(`${value}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    return day.toISOString().slice(0, 10);
  };
  const earliest = (policy: Policy | null) => {
    const today = todayVietnam();
    if (!policy) return today;
    if (canEditPolicyInPlace(policy)) return nextDay(today);
    return nextDay(policy.effectiveFrom > today ? policy.effectiveFrom : today);
  };
  const [previous, setPrevious] = useState(initialPrevious);
  const mode = previous ? (canEditPolicyInPlace(previous) ? 'update' : 'replace') : initialMode;
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
    [rate, setRate] = useState(String(previous?.rate ?? '')),
    [date, setDate] = useState(
      mode === 'update' ? (previous?.effectiveFrom ?? '') : earliest(previous),
    ),
    [endDate, setEndDate] = useState(previous?.effectiveTo ?? '');
  const [name, setName] = useState(previous?.name ?? ''),
    [code, setCode] = useState(previous?.chargeCode ?? ''),
    [reason, setReason] = useState('');
  const [roomId, setRoomId] = useState(previous?.roomId ?? '');
  const [serviceMethod, setServiceMethod] = useState(previous?.method === 2 ? '2' : '0');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [rawError, setRawError] = useState<unknown>(null);
  const lock = useRef(false);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack
        component={ValidatedForm}
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current) return;
          if (!/^\d{1,14}(\.\d{1,4})?$/.test(rate)) {
            setError('Nhập giá không âm, tối đa 14 chữ số phần nguyên và 4 chữ số thập phân.');
            return;
          }
          if (
            !date ||
            date < earliest(previous) ||
            (endDate && endDate < date) ||
            (previous && mode === 'replace' && previous.effectiveTo && date > previous.effectiveTo)
          ) {
            setError(
              'Ngày hiệu lực phải nằm trong khoảng cho phép và sau ngày bắt đầu của giá cũ.',
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
            method: cat === 1 || cat === 2 ? 1 : cat === 3 ? Number(serviceMethod) : 0,
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
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {previous ? 'Chỉnh sửa: ' + previous.name : 'Thêm biểu giá'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {previous
              ? mode === 'update'
                ? 'Giá tương lai chưa sử dụng được cập nhật nếu vẫn đủ điều kiện.'
                : 'Khi thay đổi, hệ thống tạo phiên bản mới. Hợp đồng đã chốt giữ nguyên đơn giá.'
              : 'Chọn phạm vi, khoản thu và đơn giá cần áp dụng.'}
          </Typography>
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          01 · Khoản thu và phạm vi
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
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
            onChange={(e) => {
              setCategory(e.target.value);
              setServiceMethod('0');
              setRate('');
            }}
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
            sx={{ gridColumn: { md: '1 / -1' } }}
          />
          {category === '3' && (
            <TextField
              select
              label="Cách tính phí dịch vụ"
              value={serviceMethod}
              disabled={!!previous && mode === 'update'}
              onChange={(e) => {
                setServiceMethod(e.target.value);
                setRate('');
              }}
            >
              <MenuItem value="0">Cố định/phòng/tháng</MenuItem>
              <MenuItem value="2">Cố định/người/tháng</MenuItem>
            </TextField>
          )}
          {category === '3' && (
            <TextField
              required
              label="Mã phí dịch vụ"
              value={code}
              disabled={!!previous}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          )}
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          02 · Đơn giá và ngày hiệu lực
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <MoneyField
            allowDecimal
            required
            label="Đơn giá VND"
            value={rate}
            onValueChange={(raw) => setRate(raw)}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            required
            type="date"
            label="Hiệu lực từ ngày"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: {
                min: earliest(previous),
                ...(previous && mode === 'replace' && previous.effectiveTo
                  ? { max: previous.effectiveTo }
                  : {}),
              },
            }}
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
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: date || earliest(previous) },
            }}
          />
        </Box>
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
              setRate(String(latest.rate));
              setDate(canEditPolicyInPlace(latest) ? latest.effectiveFrom : earliest(latest));
              setEndDate(latest.effectiveTo ?? '');
              setServiceMethod(latest.method === 2 ? '2' : '0');
              setReason('');
              setError('');
              setRawError(null);
            }}
          />
        )}
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
