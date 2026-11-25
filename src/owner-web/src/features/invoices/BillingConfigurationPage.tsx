import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  invoiceError,
  formatBillingDecimal,
  type Policy,
  type PolicyInput,
} from '../../../../../packages/client-core/src/invoices';
import { PageHeader, FilterToolbar } from '../../components/common/PortalUI';
import { useInvoiceApi } from './useInvoiceApi';
import { locationBillingSettingsPath } from './LocationBillingSchedule';
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
        subtitle="Kiểm tra các mức giá đang áp dụng trước khi lập hóa đơn."
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
          <Alert severity="info">Chọn cơ sở để xem biểu giá.</Alert>
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
            <Button size="small" component={Link} to={locationBillingSettingsPath(location)}>
              Thiết lập lịch
            </Button>
          }
        >
          Cơ sở chưa có lịch lập nháp và phát hành. Thiết lập lịch trong phần Thiết lập cơ sở.
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
      {schedule.isSuccess && schedule.data && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button component={Link} to={locationBillingSettingsPath(location)}>
            Cấu hình lịch điện nước & hóa đơn
          </Button>
        </Stack>
      )}
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
