import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
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
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  formatBillingDecimal,
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
        subtitle="Theo dõi tiến độ ghi số, lập nháp, phát hành và những dữ liệu cần xử lý trong từng kỳ."
        actions={
          <Button size="small" component={Link} variant="outlined" to="/pricing">
            Thiết lập giá & lịch hóa đơn
          </Button>
        }
      />
      <Stack spacing={2}>
        {locations.isPending && <LinearProgress />}
        {locations.error && (
          <Alert severity="error">
            {invoiceError(locations.error)}
            <Button onClick={() => void locations.refetch()}>Thử lại</Button>
          </Alert>
        )}
        {locations.data?.length === 0 && <Alert severity="info">Chưa có cơ sở.</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Kỳ cần theo dõi</Typography>
              <Typography variant="body2" color="text.secondary">
                Chọn cơ sở và kỳ hóa đơn để xem lịch chạy thực tế và xử lý các mục đang chờ.
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              <TextField
                select
                size="small"
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
                size="small"
                type="month"
                label="Kỳ hóa đơn"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
          </Stack>
        </Paper>
        {locations.isSuccess && (!location || !/^\d{4}-\d{2}$/.test(period)) && (
          <Alert severity="info">Chọn cơ sở và kỳ hóa đơn để hiển thị tiến độ tự động.</Alert>
        )}
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
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showRepresentative, setShowRepresentative] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
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
  const needsRepresentative = data.data?.executions.some((execution) =>
    automationIssues(execution.exceptionsJson).some(
      (issue) => issue.code === 'representative_selection_required',
    ),
  );
  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1 }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Tổng quan kỳ {period.slice(0, 7)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Kết quả được đồng bộ với dữ liệu máy chủ.
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            void data.refetch();
            void cache.invalidateQueries({
              queryKey: ['automation-drafts', session?.userId, location, period],
            });
          }}
        >
          Làm mới lịch và kết quả
        </Button>
      </Stack>
      {data.isPending && <LinearProgress />}
      {data.error && <Alert severity="error">{invoiceError(data.error)}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="info">{notice}</Alert>}
      {data.data && (
        <>
          <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1.5 }}
            >
              <Box>
                <Typography sx={{ fontWeight: 700 }}>Thao tác cho kỳ đang xem</Typography>
                <Typography variant="body2" color="text.secondary">
                  Theo dõi các bước bên dưới hoặc mở cấu hình để thay đổi lịch áp dụng.
                </Typography>
              </Box>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                <Button variant="outlined" component={Link} to="/invoices">
                  Mở danh sách hóa đơn
                </Button>
                <Button variant="outlined" onClick={() => setSettings(true)}>
                  Cấu hình lịch hóa đơn
                </Button>
              </Stack>
            </Stack>
          </Paper>
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
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
            <Stack spacing={2}>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  flexWrap: 'wrap',
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  01 · Lịch chạy kỳ này
                </Typography>
                <Chip
                  size="small"
                  color={data.data.preview.workerEnabled ? 'success' : 'default'}
                  variant="outlined"
                  label={data.data.preview.workerEnabled ? 'Worker đang bật' : 'Worker đang tắt'}
                />
              </Stack>
              {!data.data.preview.workerEnabled && (
                <Alert severity="warning">
                  Worker tự động đang tắt trên máy chủ. Chạy ngay chỉ dùng trong môi trường
                  Development/Testing khi máy chủ cho phép.
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary">
                Ngày nghiệp vụ: {data.data.preview.businessDate} · {data.data.preview.timeZone}
              </Typography>
              {data.data.preview.phases.length === 0 && (
                <Alert
                  severity="warning"
                  action={<Button onClick={() => setSettings(true)}>Cấu hình ngay</Button>}
                >
                  Chưa có lịch tự động cho kỳ này.
                </Alert>
              )}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                {data.data.preview.phases.map((p, i) => (
                  <Paper
                    key={p.phase}
                    variant="outlined"
                    sx={{ p: 2, borderRadius: 1.5, minWidth: 0 }}
                  >
                    <Stack spacing={1.5}>
                      <Stack
                        direction="row"
                        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Bước {i + 1}
                        </Typography>
                        <Chip
                          size="small"
                          color={p.eligible ? 'warning' : 'default'}
                          variant="outlined"
                          label={p.eligible ? 'Đến lịch' : 'Chưa đến lịch'}
                        />
                      </Stack>
                      <Box>
                        <Typography sx={{ fontWeight: 700 }}>{phaseLabel[p.phase]}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Ngày dự kiến: {p.scheduledDate.split('-').reverse().join('/')}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {p.eligible
                          ? 'Đến lịch, cần kiểm tra dữ liệu'
                          : 'Chưa đến lịch hoặc chưa bật quyền'}
                      </Typography>
                      {data.data.preview.developerActionsEnabled && (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!p.eligible || busy}
                          onClick={() => void run(p.phase)}
                        >
                          Chạy ngay: {phaseLabel[p.phase]}
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary">
                Lần tiếp theo phụ thuộc ngày cấu hình và kết quả gần nhất. Worker bỏ qua lần đã hoàn
                tất; PendingInputs được kiểm tra lại, Failed dừng tự động sau 4 lần xử lý.
              </Typography>
            </Stack>
          </Paper>
          <AutomationDrafts location={location} period={period} />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              03 · Kết quả & việc cần xử lý
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Các cảnh báo bên dưới lấy từ kết quả chạy thực tế. Mở công việc tương ứng để xử lý.
            </Typography>
          </Box>
          {needsRepresentative && (
            <Alert
              severity="warning"
              action={
                <Button size="small" onClick={() => setShowRepresentative(true)}>
                  Chọn hợp đồng
                </Button>
              }
            >
              Có phòng/kỳ đang thiếu hợp đồng đại diện. Mở mục hợp đồng bên dưới để chọn.
            </Alert>
          )}
          {data.data.executions.length === 0 && (
            <Alert severity="info">Chưa có lần chạy cho cơ sở/kỳ này.</Alert>
          )}
          {data.data.executions.map((e) => (
            <Paper key={e.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack spacing={1}>
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography sx={{ fontWeight: 700 }}>{phaseLabel[e.phase]}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={
                      e.status === 'Failed'
                        ? 'error'
                        : e.status === 'Completed'
                          ? 'success'
                          : 'warning'
                    }
                    label={e.status}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Bắt đầu: {date(e.lastStartedAt)} · Kết thúc: {date(e.finishedAt)}
                </Typography>
                <Typography variant="body2">
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
                    {!issue.taskId &&
                      [
                        'active_meter_configuration_required',
                        'meter_replacement_review_required',
                      ].includes(issue.code) && (
                        <Button component={Link} to="/meters" size="small">
                          Kiểm tra đồng hồ
                        </Button>
                      )}
                    {issue.code === 'representative_selection_required' && (
                      <Button size="small" onClick={() => setShowRepresentative(true)}>
                        Chọn hợp đồng đại diện
                      </Button>
                    )}
                    {[
                      'draft_invoice_required',
                      'draft_missing_inputs',
                      'confirmed_billing_inputs_required',
                    ].includes(issue.code) && (
                      <Button size="small" component={Link} to="/invoices">
                        Xem hóa đơn
                      </Button>
                    )}
                    {issue.code === 'automation_authorization_changed' && (
                      <Button size="small" onClick={() => setSettings(true)}>
                        Kiểm tra cấu hình
                      </Button>
                    )}
                  </Alert>
                ))}
              </Stack>
            </Paper>
          ))}
          <Accordion
            disableGutters
            variant="outlined"
            expanded={showRepresentative}
            onChange={(_, expanded) => setShowRepresentative(expanded)}
            sx={{ borderRadius: '8px !important', overflow: 'hidden' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Stack sx={{ gap: 0.25 }}>
                <Typography sx={{ fontWeight: 700 }}>04 · Chọn hợp đồng đại diện</Typography>
                <Typography variant="caption" color="text.secondary">
                  Mở khi nhiều hợp đồng cùng thuộc một phòng/kỳ hoặc có cảnh báo cần chọn
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <RepresentativeForm location={location} period={period} />
            </AccordionDetails>
          </Accordion>
          <Accordion
            disableGutters
            variant="outlined"
            expanded={showDeliveries}
            onChange={(_, expanded) => setShowDeliveries(expanded)}
            sx={{ borderRadius: '8px !important', overflow: 'hidden' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Stack sx={{ gap: 0.25 }}>
                <Typography sx={{ fontWeight: 700 }}>05 · Theo dõi gửi thông báo</Typography>
                <Typography variant="caption" color="text.secondary">
                  Kiểm tra email/push và trạng thái các lần gửi khi cần
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <DeliveryMonitor location={location} />
            </AccordionDetails>
          </Accordion>
          <Accordion
            disableGutters
            variant="outlined"
            expanded={showDiagnostics}
            onChange={(_, expanded) => setShowDiagnostics(expanded)}
            sx={{ borderRadius: '8px !important', overflow: 'hidden' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Stack sx={{ gap: 0.25 }}>
                <Typography sx={{ fontWeight: 700 }}>Lịch sử & hàng đợi xử lý</Typography>
                <Typography variant="caption" color="text.secondary">
                  {data.data.attempts.length} lần xử lý · {data.data.queue.length} mục hàng đợi
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Lịch sử xử lý (tối đa 100 lần gần nhất)
                </Typography>
                {data.data.attempts.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có lịch sử xử lý.
                  </Typography>
                )}
                {data.data.attempts.map((a) => (
                  <Typography key={a.id} variant="body2" color="text.secondary">
                    Lần {a.sequence} · {a.status} · {date(a.startedAt)} → {date(a.finishedAt)}
                  </Typography>
                ))}
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Hàng đợi xử lý (30 lượt gần nhất)
                </Typography>
                {data.data.queue.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có lượt chạy được scheduler đưa vào hàng đợi.
                  </Typography>
                )}
                {data.data.queue.map((j) => (
                  <Paper key={j.id} variant="outlined" sx={{ p: 1.75, borderRadius: 1.5 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                      {j.name} · {j.state} · Lần {j.attempts}/4
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Đến lượt / thử lại: {date(j.availableAt)}
                      {j.lockedUntil ? ` · Lease đến ${date(j.lockedUntil)}` : ''}
                    </Typography>
                    {j.lastErrorCode && <Alert severity="warning">{j.lastErrorCode}</Alert>}
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </>
      )}
    </Stack>
  );
}
function AutomationDrafts({ location, period }: { location: string; period: string }) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState('');
  const [feedback, setFeedback] = useState<{ room: string; error?: string }>();
  const lock = useRef(false);
  const key = ['automation-drafts', session?.userId, location, period, page];
  const drafts = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api.list(page, signal, '', { locationId: location, billingPeriod: period, status: 'Draft' }),
  });

  async function refreshDraft(id: string, version: number, room: string) {
    if (lock.current) return;
    lock.current = true;
    setActiveId(id);
    setFeedback(undefined);
    try {
      const updated = await api.refresh(id, version);
      await cache.cancelQueries({ queryKey: key, exact: true });
      cache.setQueryData(
        key,
        (previous: typeof drafts.data) =>
          previous && {
            ...previous,
            items: previous.items.map((item) => (item.id === id ? updated : item)),
          },
      );
      setFeedback({ room });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['invoices', session?.userId] }),
        cache.invalidateQueries({ queryKey: ['invoice', session?.userId, id] }),
      ]);
    } catch (e) {
      setFeedback({ room, error: invoiceError(e) });
      const result = await drafts.refetch();
      if (page > 1 && result.data?.items.length === 0) setPage(page - 1);
    } finally {
      lock.current = false;
      setActiveId('');
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              02 · Hóa đơn nháp của kỳ
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Cập nhật từng bản nháp để lấy lại số liệu đã xác nhận trước khi phát hành.
            </Typography>
          </Box>
          {drafts.data && (
            <Chip size="small" variant="outlined" label={`${drafts.data.totalCount} bản nháp`} />
          )}
        </Stack>
        {drafts.isPending && <LinearProgress />}
        {drafts.error && <Alert severity="error">{invoiceError(drafts.error)}</Alert>}
        {feedback && (
          <Alert severity={feedback.error ? 'error' : 'success'}>
            Phòng {feedback.room} · {feedback.error ?? 'Đã tính lại hóa đơn nháp.'}
          </Alert>
        )}
        {drafts.data?.totalCount === 0 && <Alert severity="info">Chưa có hóa đơn nháp.</Alert>}
        {drafts.data?.items.map((draft) => (
          <Paper variant="outlined" key={draft.id} sx={{ p: 1.75, borderRadius: 1.5 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{ justifyContent: 'space-between', gap: 1.5, alignItems: { md: 'center' } }}
            >
              <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 700 }}>Phòng {draft.roomNumber}</Typography>
                  <Chip
                    size="small"
                    color={draft.missingInputs.length > 0 ? 'warning' : 'success'}
                    variant="outlined"
                    label={draft.missingInputs.length > 0 ? 'Thiếu dữ liệu' : 'Đủ dữ liệu'}
                  />
                </Stack>
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                  {formatBillingDecimal(draft.total)} ₫
                </Typography>
              </Stack>
              {draft.missingInputs.length > 0 && (
                <Alert
                  severity="warning"
                  sx={{ flex: 2, width: { xs: '100%', md: 'auto' }, py: 0.25 }}
                >
                  {draft.missingInputs.map((code) => (
                    <Typography key={code} variant="body2">
                      Thiếu: {missingBillingInput(code)}
                    </Typography>
                  ))}
                </Alert>
              )}
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" component={Link} to={`/invoices?invoiceId=${draft.id}`}>
                  Xem hóa đơn
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!!activeId}
                  onClick={() => void refreshDraft(draft.id, draft.version, draft.roomNumber)}
                >
                  {activeId === draft.id ? 'Đang cập nhật…' : 'Cập nhật Invoice Draft'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))}
        {drafts.data && (page > 1 || drafts.data.totalCount > drafts.data.pageSize) && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: 'flex-end', alignItems: 'center' }}
          >
            <Button
              size="small"
              disabled={page === 1 || !!activeId}
              onClick={() => setPage(page - 1)}
            >
              Trang trước
            </Button>
            <Typography variant="body2" color="text.secondary">
              Trang {page}
            </Typography>
            <Button
              size="small"
              disabled={page * drafts.data.pageSize >= drafts.data.totalCount || !!activeId}
              onClick={() => setPage(page + 1)}
            >
              Trang sau
            </Button>
          </Stack>
        )}
      </Stack>
    </Paper>
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
    <Box sx={{ pt: 1 }}>
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
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Cấu hình tự động
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Phiên bản mới nhất: {current?.version ?? 'Chưa có'} · Lịch hóa đơn hiện tại:{' '}
            {calendarVersion || 'Chưa cấu hình'}
          </Typography>
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Thời điểm áp dụng & ghi số
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
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Quyền tự động
        </Typography>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
          <Stack spacing={0.5}>
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
          </Stack>
        </Paper>
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
          sx={{ alignSelf: { sm: 'flex-start' } }}
          disabled={busy || !calendarVersion || !day || !due || offset === ''}
        >
          Lưu phiên bản tự động
        </Button>
        {!!history.length && (
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Lịch sử cấu hình
            </Typography>
            {history.map((p) => (
              <Typography key={p.id} variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
                v{p.version} · từ {p.effectiveFrom} · {p.enabled ? 'Bật' : 'Tắt'} · quyền Final:{' '}
                {p.authorizeAutomaticFinalization ? 'Có' : 'Không'} · {date(p.recordedAt)}
              </Typography>
            ))}
          </Box>
        )}
      </Stack>
    </Box>
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
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ gap: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              04 · Hợp đồng đại diện
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Khi có nhiều hợp đồng trong cùng kỳ, chọn đại diện từ lịch sử thuê phòng.
            </Typography>
          </Box>
          <Button component={Link} to="/contracts" size="small">
            Xem hợp đồng
          </Button>
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
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
        </Box>
        {(rooms.error || selection.error || contracts.error) && (
          <Alert severity="error">
            {invoiceError(rooms.error ?? selection.error ?? contracts.error)}
          </Alert>
        )}
        {selection.data && (
          <Typography variant="body2" color="text.secondary">
            Đang chọn: {selection.data.contractId} · v{selection.data.version}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          Máy chủ kiểm tra phòng, kỳ và quyền trước khi lưu lựa chọn này.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button
          variant="contained"
          sx={{ alignSelf: { sm: 'flex-start' } }}
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
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              05 · Gửi thông báo bên ngoài
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Tình trạng chuyển tiếp email / push theo cấu hình dịch vụ.
            </Typography>
          </Box>
          {data.data && (
            <Chip
              size="small"
              variant="outlined"
              label={`${data.data.deliveries.totalCount} lượt gửi`}
            />
          )}
        </Stack>
        {data.isPending && <LinearProgress />}
        {data.error && <Alert severity="error">{invoiceError(data.error)}</Alert>}
        {data.data && (
          <>
            <Alert severity={data.data.configured ? 'info' : 'warning'}>
              {data.data.configured
                ? `Provider đã cấu hình; tối đa ${data.data.maxAttempts} lần.`
                : 'Chưa có provider gửi bên ngoài. Hộp thông báo trong ứng dụng vẫn hoạt động.'}
            </Alert>
            {data.data.deliveries.items.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                Chưa có lượt gửi bên ngoài trong danh sách này.
              </Typography>
            )}
            {data.data.deliveries.items.map((d) => (
              <Paper variant="outlined" key={d.id} sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {d.category}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Lần {d.attempts} · Lần tới: {date(d.nextAttemptAt)}
                    </Typography>
                  </Box>
                  <Chip size="small" variant="outlined" label={d.state} />
                </Stack>
                {d.errorCode && (
                  <Typography variant="caption" color="error.main">
                    Mã lỗi: {d.errorCode}
                  </Typography>
                )}
              </Paper>
            ))}
            {(page > 1 || page * 20 < data.data.deliveries.totalCount) && (
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
                  disabled={page * 20 >= data.data.deliveries.totalCount}
                  onClick={() => setPage(page + 1)}
                >
                  Trang sau
                </Button>
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
