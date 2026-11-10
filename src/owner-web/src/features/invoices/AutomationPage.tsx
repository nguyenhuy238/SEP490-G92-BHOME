import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  invoiceError,
  missingBillingInput,
} from '../../../../../packages/client-core/src/invoices';
import {
  automationCalendar,
  automationIssues,
  type AutomationPlan,
  type AutomationPreview,
  type AutomationExecution,
  type AutomationAttempt,
} from '../../../../../packages/client-core/src/billingAutomation';
import { PageHeader } from '../../components/common/PortalUI';
import { isMockMode } from '../../services/config';
import { useInvoiceApi } from './useInvoiceApi';

const phaseLabel: Record<string, string> = {
  Meter: 'Giao việc ghi số',
  Draft: 'Lập hóa đơn nháp',
  Final: 'Phát hành hóa đơn',
};
const issueLabel: Record<string, string> = {
  active_meter_configuration_required: 'Thiếu đồng hồ hoạt động đúng ngày ghi số',
  staff_assignment_required: 'Cần phân công Staff đang phụ trách cơ sở',
  representative_selection_required: 'Cần chọn hợp đồng đại diện hóa đơn phòng/kỳ',
  draft_missing_inputs: 'Bản nháp còn thiếu dữ liệu bắt buộc',
  confirmed_billing_inputs_required: 'Chưa đủ giá hoặc chỉ số hợp lệ để phát hành',
  draft_invoice_required: 'Chưa có hóa đơn nháp',
  meter_replacement_review_required: 'Cần Owner kiểm tra việc thay đồng hồ trong kỳ',
  cancelled_period_requires_review: 'Tác vụ kỳ này đã hủy, cần Owner kiểm tra',
  automation_authorization_changed: 'Quyền hoặc lịch đã thay đổi, cần kiểm tra lại',
};
type QueueRow = {
  id: string;
  name: string;
  state: string;
  attempts: number;
  availableAt: string;
  lockedUntil: string | null;
  lastErrorCode: string | null;
};
const date = (s?: string | null) =>
  s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa chạy';
export default function AutomationPage() {
  return isMockMode ? (
    <Alert severity="info">Kết nối API để cấu hình và theo dõi lịch tự động.</Alert>
  ) : (
    <LiveAutomationPage />
  );
}
export function LiveAutomationPage() {
  const [params] = useSearchParams();
  const api = useInvoiceApi();
  const { session } = useAuth();
  const [location, setLocation] = useState(params.get('locationId') ?? ''),
    [period, setPeriod] = useState(params.get('period') ?? '');
  const locations = useQuery({
    queryKey: ['automation-locations', session?.userId],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  return (
    <>
      <PageHeader
        title="Lịch tự động & Thông báo"
        subtitle="Lịch theo cơ sở và kỳ, múi giờ Asia/Ho_Chi_Minh."
      />
      <Stack spacing={2}>
        <Button component={Link} to="/pricing">
          Cấu hình giá, lịch Draft / Final / hạn thanh toán
        </Button>
        {locations.isPending && <LinearProgress />}
        {locations.error && (
          <Alert severity="error">
            {invoiceError(locations.error)}
            <Button onClick={() => void locations.refetch()}>Thử lại</Button>
          </Alert>
        )}
        {locations.data?.length === 0 && <Alert severity="info">Chưa có cơ sở.</Alert>}
        <TextField
          select
          label="Cơ sở tự động"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <MenuItem value="">Chọn cơ sở</MenuItem>
          {locations.data?.map((l) => (
            <MenuItem key={l.id} value={l.id}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="month"
          label="Kỳ hóa đơn"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {location && /^\d{4}-\d{2}$/.test(period) && (
          <AutomationLocation
            key={location + period + session?.userId}
            location={location}
            period={period + '-01'}
          />
        )}
      </Stack>
    </>
  );
}
function AutomationLocation({ location, period }: { location: string; period: string }) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [settings, setSettings] = useState(false);
  const key = ['automation', session?.userId, location, period];
  const query = `locationId=${location}&period=${period}`;
  const data = useQuery({
    queryKey: key,
    refetchInterval: 30000,
    queryFn: async ({ signal }) => {
      const [history, preview, executions, attempts, calendar, queue] = await Promise.all([
        api.request<AutomationPlan[]>(`/api/v1/billing-automation/${location}/history`, { signal }),
        api.request<AutomationPreview>(`/api/v1/billing-automation/preview?${query}`, { signal }),
        api.request<AutomationExecution[]>(`/api/v1/billing-automation/executions?${query}`, {
          signal,
        }),
        api.request<AutomationAttempt[]>(`/api/v1/billing-automation/attempts?${query}`, {
          signal,
        }),
        api.schedule(location, signal),
        api.request<QueueRow[]>(`/api/v1/billing-automation/queue?${query}`, { signal }),
      ]);
      return { history, preview, executions, attempts, calendar, queue };
    },
  });
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(phase: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.request<AutomationExecution | undefined>(
        '/api/v1/billing-automation/run-now',
        {
          method: 'POST',
          body: JSON.stringify({ locationId: location, billingPeriod: period, phase }),
        },
      );
      setNotice(
        result
          ? 'Đã xử lý. Xem trạng thái và dữ liệu còn thiếu bên dưới.'
          : 'Chưa đủ điều kiện chạy theo lịch hoặc quyền hiện tại.',
      );
      await data.refetch();
    } catch (e) {
      setError(invoiceError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Button onClick={() => void data.refetch()}>Làm mới lịch và kết quả</Button>
      {data.isPending && <LinearProgress />}
      {data.error && <Alert severity="error">{invoiceError(data.error)}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="info">{notice}</Alert>}
      {data.data && (
        <>
          <Button onClick={() => setSettings(true)}>Cấu hình lịch hóa đơn</Button>
          <Dialog
            open={settings}
            onClose={() => setSettings(false)}
            maxWidth="md"
            fullWidth
            aria-labelledby="automation-settings-title"
          >
            <DialogTitle id="automation-settings-title">Cấu hình lịch hóa đơn</DialogTitle>
            <DialogContent>
              {settings && (
                <AutomationForm
                  key={data.data.history[0]?.id ?? 'new'}
                  location={location}
                  period={period}
                  history={data.data.history}
                  calendarVersion={data.data.calendar?.version ?? 0}
                  saved={() => {
                    void cache.invalidateQueries({ queryKey: ['automation'] });
                  }}
                />
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSettings(false)}>Đóng cấu hình lịch</Button>
            </DialogActions>
          </Dialog>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Lịch kỳ đang xem</Typography>
              <Alert severity={data.data.preview.workerEnabled ? 'info' : 'warning'}>
                {data.data.preview.workerEnabled
                  ? 'Worker tự động đang bật trên máy chủ này.'
                  : 'Worker tự động đang tắt trên máy chủ này. Chạy ngay chỉ là thao tác Development/Testing.'}
              </Alert>
              <Typography>
                Ngày nghiệp vụ: {data.data.preview.businessDate} · {data.data.preview.timeZone}
              </Typography>
              {data.data.preview.phases.length === 0 && (
                <Alert severity="warning">Thiếu cấu hình tự động cho kỳ này.</Alert>
              )}
              {data.data.preview.phases.map((p) => (
                <Stack
                  key={p.phase}
                  direction="row"
                  spacing={2}
                  sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <Typography>
                    {phaseLabel[p.phase]} · {p.scheduledDate} ·{' '}
                    {p.eligible
                      ? 'Đến lịch, cần kiểm tra dữ liệu'
                      : 'Chưa đến lịch hoặc chưa bật quyền'}
                  </Typography>
                  {data.data.preview.developerActionsEnabled && (
                    <Button disabled={!p.eligible || busy} onClick={() => void run(p.phase)}>
                      Chạy ngay: {phaseLabel[p.phase]}
                    </Button>
                  )}
                </Stack>
              ))}
              <Typography variant="body2">
                Lần tiếp theo phụ thuộc ngày cấu hình và kết quả gần nhất. Worker bỏ qua lần đã hoàn
                tất; PendingInputs được kiểm tra lại, Failed dừng tự động sau 4 lần xử lý.
              </Typography>
            </Stack>
          </Paper>
          <Typography variant="h6">Kết quả & Ngoại lệ</Typography>
          {data.data.executions.length === 0 && (
            <Alert severity="info">Chưa có lần chạy cho cơ sở/kỳ này.</Alert>
          )}
          {data.data.executions.map((e) => (
            <Paper key={e.id} sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="h6">
                  {phaseLabel[e.phase]} · {e.status}
                </Typography>
                <Typography>
                  Bắt đầu: {date(e.lastStartedAt)} · Kết thúc: {date(e.finishedAt)}
                </Typography>
                <Typography>
                  Tạo: {e.createdCount} · Đã tồn tại / replay: {e.existingCount} · Lần xử lý:{' '}
                  {e.attempts}
                </Typography>
                {e.lastErrorCode && <Alert severity="error">{e.lastErrorCode}</Alert>}
                {automationIssues(e.exceptionsJson).map((issue, i) => (
                  <Alert severity="warning" key={i}>
                    {issueLabel[issue.code] ?? issue.code}
                    {issue.missingInputs?.map((code) => (
                      <Typography key={code}>Thiếu: {missingBillingInput(code)}</Typography>
                    ))}
                    {issue.roomId && ` · Phòng ${issue.roomId}`}
                    {issue.taskId && (
                      <Button component={Link} to={`/meters?taskId=${issue.taskId}`}>
                        Mở công việc
                      </Button>
                    )}
                  </Alert>
                ))}
              </Stack>
            </Paper>
          ))}
          <Typography variant="h6">Lịch sử xử lý (tối đa 100 lần gần nhất)</Typography>
          {data.data.attempts.map((a) => (
            <Typography key={a.id}>
              Lần {a.sequence} · {a.status} · {date(a.startedAt)} → {date(a.finishedAt)}
            </Typography>
          ))}
          <Typography variant="h6">Hàng đợi bền vững (30 lượt gần nhất)</Typography>
          {data.data.queue.length === 0 && (
            <Typography>Chưa có lượt chạy được scheduler đưa vào hàng đợi.</Typography>
          )}
          {data.data.queue.map((j) => (
            <Paper key={j.id} sx={{ p: 2 }}>
              <Typography>
                {j.name} · {j.state} · Lần {j.attempts}/4
              </Typography>
              <Typography>
                Đến lượt / thử lại: {date(j.availableAt)}
                {j.lockedUntil ? ` · Lease đến ${date(j.lockedUntil)}` : ''}
              </Typography>
              {j.lastErrorCode && <Alert severity="warning">{j.lastErrorCode}</Alert>}
            </Paper>
          ))}
          <RepresentativeForm location={location} period={period} />
          <DeliveryMonitor location={location} />
        </>
      )}
    </Stack>
  );
}
function AutomationForm({
  location,
  period,
  history,
  calendarVersion,
  saved,
}: {
  location: string;
  period: string;
  history: AutomationPlan[];
  calendarVersion: number;
  saved: () => void;
}) {
  const api = useInvoiceApi();
  const current = history[0];
  const [enabled, setEnabled] = useState(current?.enabled ?? false),
    [final, setFinal] = useState(current?.authorizeAutomaticFinalization ?? false);
  const [effective, setEffective] = useState(period.slice(0, 7)),
    [day, setDay] = useState(current ? String(current.meterDay) : ''),
    [due, setDue] = useState(current ? String(current.meterDueDay) : ''),
    [offset, setOffset] = useState(current ? String(current.meterDueMonthOffset) : '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const selected = history
    .filter((p) => p.effectiveFrom <= period)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0];
  const c = selected ? automationCalendar(selected) : null;
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void api
            .request('/api/v1/billing-automation', {
              method: 'PUT',
              body: JSON.stringify({
                locationId: location,
                effectiveFrom: effective + '-01',
                enabled,
                authorizeAutomaticFinalization: enabled && final,
                meterDay: Number(day),
                meterDueDay: Number(due),
                meterDueMonthOffset: Number(offset),
                timeZone: 'Asia/Ho_Chi_Minh',
                expectedVersion: current?.version ?? 0,
                expectedBillingScheduleVersion: calendarVersion,
              }),
            })
            .then(saved)
            .catch((e) => setError(invoiceError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Typography variant="h6">Cấu hình tự động</Typography>
        <Typography>
          Phiên bản mới nhất: {current?.version ?? 'Chưa có'} · Lịch hóa đơn hiện tại:{' '}
          {calendarVersion || 'Chưa cấu hình'}
        </Typography>
        <TextField
          required
          type="month"
          label="Áp dụng từ kỳ"
          value={effective}
          onChange={(e) => setEffective(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          required
          type="number"
          label="Ngày giao việc ghi số"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          slotProps={{ htmlInput: { min: 1, max: 31 } }}
        />
        <TextField
          required
          type="number"
          label="Ngày hết hạn ghi số"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          slotProps={{ htmlInput: { min: 1, max: 31 } }}
        />
        <TextField
          required
          select
          label="Tháng cộng thêm cho hạn ghi số"
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
        >
          <MenuItem value="">Chọn tháng</MenuItem>
          {[0, 1, 2].map((v) => (
            <MenuItem key={v} value={String(v)}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                if (!e.target.checked) setFinal(false);
              }}
            />
          }
          label="Bật tự động cho cơ sở"
        />
        <FormControlLabel
          control={
            <Checkbox
              disabled={!enabled}
              checked={final}
              onChange={(e) => setFinal(e.target.checked)}
            />
          }
          label="Tôi cho phép tự động phát hành khi đủ dữ liệu theo lịch đã lưu"
        />
        {c && (
          <Alert severity="info">
            Kỳ đang xem dùng phiên bản tự động {selected.version}, lịch hóa đơn{' '}
            {selected.billingScheduleVersion}: Draft ngày {c.draftDay} (+{c.draftMonthOffset}{' '}
            tháng), Final ngày {c.finalDay} (+{c.finalMonthOffset}), hạn thanh toán ngày {c.dueDay}{' '}
            (+{c.dueMonthOffset}).
          </Alert>
        )}
        {!calendarVersion && (
          <Alert severity="warning">
            Lưu quy tắc hóa đơn ở màn Giá thuê trước khi lưu lịch tự động.
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !calendarVersion || !day || !due || offset === ''}
        >
          Lưu phiên bản tự động
        </Button>
        {history.map((p) => (
          <Typography key={p.id} variant="body2">
            v{p.version} · từ {p.effectiveFrom} · {p.enabled ? 'Bật' : 'Tắt'} · quyền Final:{' '}
            {p.authorizeAutomaticFinalization ? 'Có' : 'Không'} · {date(p.recordedAt)}
          </Typography>
        ))}
      </Stack>
    </Paper>
  );
}
function RepresentativeForm({ location, period }: { location: string; period: string }) {
  const api = useInvoiceApi();
  const { session } = useAuth();
  const [room, setRoom] = useState(''),
    [contract, setContract] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const rooms = useQuery({
    queryKey: ['automation-rooms', session?.userId, location],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  const selection = useQuery({
    queryKey: ['automation-representative', session?.userId, room, period],
    enabled: !!room,
    queryFn: async ({ signal }) =>
      (await api.request<{ contractId: string; version: number } | undefined>(
        `/api/v1/billing-automation/representative?roomId=${room}&period=${period}`,
        { signal },
      )) ?? null,
  });
  const contracts = useQuery({
    queryKey: ['automation-contract-options', session?.userId, room],
    enabled: !!room,
    queryFn: ({ signal }) =>
      api.request<{
        periods: {
          contractId: string;
          from: string;
          to: string;
          contractStatus: string;
          occupants: { displayLabel: string }[];
        }[];
      }>(`/api/v1/rooms/${room}/occupancy-history`, { signal }),
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Hợp đồng đại diện hóa đơn phòng</Typography>
        <Typography variant="body2">
          Khi nhiều hợp đồng cùng kỳ, chọn đại diện từ lịch sử thuê phòng. Máy chủ kiểm tra phòng,
          kỳ và quyền trước khi lưu.
        </Typography>
        <Button component={Link} to="/contracts">
          Xem hợp đồng
        </Button>
        <TextField
          select
          label="Phòng chọn đại diện"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setContract('');
            setNotice('');
          }}
        >
          <MenuItem value="">Chọn phòng</MenuItem>
          {rooms.data?.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
        {(rooms.error || selection.error || contracts.error) && (
          <Alert severity="error">
            {invoiceError(rooms.error ?? selection.error ?? contracts.error)}
          </Alert>
        )}
        {selection.data && (
          <Typography>
            Đang chọn: {selection.data.contractId} · v{selection.data.version}
          </Typography>
        )}
        <TextField
          select
          label="Hợp đồng đại diện"
          value={contract}
          onChange={(e) => setContract(e.target.value)}
          disabled={!room || contracts.isFetching}
        >
          <MenuItem value="">Chọn hợp đồng</MenuItem>
          {contracts.data?.periods
            .filter((c) => ['Active', 'Terminated', 'Superseded'].includes(c.contractStatus))
            .map((c) => (
              <MenuItem key={c.contractId} value={c.contractId}>
                {c.from} – {c.to} · {c.occupants.map((o) => o.displayLabel).join(', ')}
              </MenuItem>
            ))}
        </TextField>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button
          disabled={!room || !contract || !selection.isSuccess || busy}
          onClick={() => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError('');
            void api
              .request('/api/v1/billing-automation/representative', {
                method: 'PUT',
                body: JSON.stringify({
                  roomId: room,
                  billingPeriod: period,
                  contractId: contract.trim(),
                  expectedVersion: selection.data?.version ?? 0,
                }),
              })
              .then(async () => {
                setNotice('Đã lưu hợp đồng đại diện.');
                await selection.refetch();
              })
              .catch((e) => setError(invoiceError(e)))
              .finally(() => {
                lock.current = false;
                setBusy(false);
              });
          }}
        >
          Lưu đại diện kỳ
        </Button>
      </Stack>
    </Paper>
  );
}
function DeliveryMonitor({ location }: { location: string }) {
  const api = useInvoiceApi();
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const data = useQuery({
    queryKey: ['delivery-status', session?.userId, location, page],
    queryFn: ({ signal }) =>
      api.request<{
        configured: boolean;
        enabled: boolean;
        maxAttempts: number;
        deliveries: {
          totalCount: number;
          items: {
            id: string;
            category: string;
            state: string;
            attempts: number;
            nextAttemptAt: string | null;
            errorCode: string | null;
          }[];
        };
      }>(`/api/v1/notifications/delivery-status?locationId=${location}&page=${page}`, { signal }),
    refetchInterval: 30000,
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="h6">Gửi thông báo bên ngoài</Typography>
        {data.isPending && <LinearProgress />}
        {data.error && <Alert severity="error">{invoiceError(data.error)}</Alert>}
        {data.data && (
          <>
            <Alert severity={data.data.configured ? 'info' : 'warning'}>
              {data.data.configured
                ? `Provider đã cấu hình; tối đa ${data.data.maxAttempts} lần.`
                : 'Unconfigured: chưa có provider chính thức. Hộp thông báo trong ứng dụng vẫn hoạt động.'}
            </Alert>
            {data.data.deliveries.items.map((d) => (
              <Typography key={d.id}>
                {d.category} · {d.state} · Lần {d.attempts} · Lần tới: {date(d.nextAttemptAt)}{' '}
                {d.errorCode}
              </Typography>
            ))}
            <Stack direction="row">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <Button
                disabled={page * 20 >= data.data.deliveries.totalCount}
                onClick={() => setPage(page + 1)}
              >
                Trang sau
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}
