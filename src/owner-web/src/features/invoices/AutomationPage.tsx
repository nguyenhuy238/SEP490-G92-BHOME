import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
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
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { businessToday } from '../../../../../packages/client-core/src/contracts';
import {
  formatBillingDecimal,
  invoiceError,
  missingBillingInput,
  type BillingSchedule,
  type Invoice,
} from '../../../../../packages/client-core/src/invoices';
import {
  automationCalendar,
  automationIssues,
  type AutomationPlan,
  type AutomationPreview,
  type AutomationExecution,
  type AutomationAttempt,
} from '../../../../../packages/client-core/src/billingAutomation';
import type { MeterTask } from '../../../../../packages/client-core/src/meter';
import { PageHeader, FilterToolbar } from '../../components/common/PortalUI';
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
  invoice_adjustment_pending:
    'Có yêu cầu điều chỉnh đang chờ Owner duyệt hoặc từ chối; chưa thể phát hành',
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
  return isMockMode ? <DemoAutomationPage /> : <LiveAutomationPage />;
}

/** Interactive timeline preview, isolated from all billing automation APIs. */
export function DemoAutomationPage() {
  const [params] = useSearchParams();
  const [location, setLocation] = useState('bhome-thanh-xuan');
  const [period, setPeriod] = useState(params.get('period')?.slice(0, 7) ?? '2026-11');
  const [settings, setSettings] = useState(false);
  const automaticFinal = false;
  const [effective, setEffective] = useState('2026-11');
  const [meterDay, setMeterDay] = useState('3');
  const [meterDueDay, setMeterDueDay] = useState('5');
  const [draftDay, setDraftDay] = useState('7');
  const [finalDay, setFinalDay] = useState('20');
  const beforeSettings = useRef({
    effective,
    meterDay,
    meterDueDay,
    draftDay,
    finalDay,
  });
  const openSettings = () => {
    beforeSettings.current = { effective, meterDay, meterDueDay, draftDay, finalDay };
    setSettings(true);
  };
  const cancelSettings = () => {
    const previous = beforeSettings.current;
    setEffective(previous.effective);
    setMeterDay(previous.meterDay);
    setMeterDueDay(previous.meterDueDay);
    setDraftDay(previous.draftDay);
    setFinalDay(previous.finalDay);
    setSettings(false);
  };
  const [notice, setNotice] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const matchingPeriod = period === '2026-11' && location === 'bhome-thanh-xuan';
  const phases = [
    {
      key: 'Meter',
      name: 'Giao việc ghi số',
      day: meterDay,
      status: 'Đã tạo nhiệm vụ mẫu',
      detail: 'Nước phòng A101 vẫn chưa xác nhận',
      href: '/meters',
      action: 'Xem công việc',
    },
    {
      key: 'Draft',
      name: 'Lập hóa đơn nháp',
      day: draftDay,
      status: '2 bản nháp mẫu',
      detail: 'Một bản nháp đủ dữ liệu để kiểm tra',
      href: '/invoices',
      action: 'Xem bản nháp',
    },
    {
      key: 'Final',
      name: 'Phát hành hóa đơn',
      day: finalDay,
      status: automaticFinal ? 'Được cho phép trong demo' : 'Chờ Owner xác nhận',
      detail: 'Chỉ phát hành hóa đơn đủ đầu vào bắt buộc',
      href: '/invoices?invoiceId=demo-invoice-102',
      action: 'Kiểm tra hóa đơn sẵn sàng',
    },
  ];
  return (
    <>
      <PageHeader
        title="Cấu hình lịch & chạy thử hóa đơn"
        subtitle="Hai khu vực riêng: lịch bắt đầu áp dụng từ kỳ được chọn và các bước thử thủ công."
        actions={
          <Button component={Link} to="/pricing" variant="outlined">
            Giá & biểu phí
          </Button>
        }
      />
      <Stack spacing={2}>
        <Alert severity="info">
          Lịch và dữ liệu minh họa. Chỉnh sửa trên trang này không kích hoạt worker, không tạo hóa
          đơn thật và không gửi thông báo cho Tenant.
        </Alert>
        {notice && (
          <Alert severity="success" onClose={() => setNotice('')}>
            {notice}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            sx={{ gap: 1.5, alignItems: { md: 'center' }, justifyContent: 'space-between' }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, flex: 1 }}>
              <TextField
                select
                size="small"
                label="Cơ sở"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                sx={{ flex: 1 }}
              >
                <MenuItem value="bhome-thanh-xuan">BHOME Thanh Xuân</MenuItem>
                <MenuItem value="bhome-cau-giay">BHOME Cầu Giấy (chưa có mẫu)</MenuItem>
              </TextField>
              <TextField
                size="small"
                label="Kỳ kiểm thử"
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ flex: 1 }}
              />
            </Stack>
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack spacing={1}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="h6" component="h2" sx={{ fontWeight: 750 }}>
                  Cấu hình lịch
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Bắt đầu từ kỳ {effective} · Giao việc ngày {meterDay}, hạn ngày {meterDueDay} ·
                  Nháp ngày {draftDay}, chính thức ngày {finalDay}
                </Typography>
              </Box>
              <Button size="small" variant="outlined" onClick={openSettings}>
                Sửa cấu hình demo
              </Button>
            </Stack>
            <Chip
              size="small"
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
              label="Chưa kích hoạt tự động"
            />
          </Stack>
        </Paper>
        <DemoManualActions
          key={location + period}
          period={period}
          meterDay={meterDay}
          setNotice={setNotice}
        />
        {matchingPeriod ? (
          <>
            <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Hóa đơn nháp
                  </Typography>
                  <Chip label="2 bản nháp" size="small" variant="outlined" />
                </Stack>
                {[
                  { id: 'demo-invoice-101', room: 'A101', total: '3785000', missing: true },
                  { id: 'demo-invoice-102', room: 'A102', total: '4268000', missing: false },
                ].map((draft) => (
                  <Box
                    key={draft.id}
                    sx={{ py: 1.25, borderTop: '1px solid', borderColor: 'divider' }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      sx={{
                        gap: 1.5,
                        alignItems: { sm: 'center' },
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box>
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>Phòng {draft.room}</Typography>
                          <Chip
                            size="small"
                            color={draft.missing ? 'warning' : 'success'}
                            variant="outlined"
                            label={draft.missing ? 'Thiếu chỉ số nước' : 'Đủ dữ liệu'}
                          />
                        </Stack>
                        <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {formatBillingDecimal(draft.total)} ₫
                        </Typography>
                      </Box>
                      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                        {draft.missing && (
                          <Button size="small" component={Link} to="/meters">
                            Kiểm tra chỉ số
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          component={Link}
                          to={`/invoices?invoiceId=${draft.id}`}
                        >
                          Mở hóa đơn
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Paper>
            <Accordion
              disableGutters
              variant="outlined"
              expanded={detailsOpen}
              onChange={(_, value) => setDetailsOpen(value)}
              sx={{ borderRadius: '12px !important' }}
            >
              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                <Typography sx={{ fontWeight: 700 }}>Lịch chạy và giám sát demo</Typography>
              </AccordionSummary>
              {detailsOpen && (
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Chip
                      sx={{ alignSelf: 'flex-start' }}
                      size="small"
                      label="Lịch mẫu chưa kích hoạt tự động"
                    />
                    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                      {phases.map((phase) => (
                        <Box
                          component="li"
                          key={phase.key}
                          sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', md: 'row' },
                            alignItems: { md: 'center' },
                            gap: 1,
                            py: 1,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {phase.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Dự kiến {phase.day}/11/2026 · {phase.detail}
                            </Typography>
                          </Box>
                          <Chip size="small" variant="outlined" label={phase.status} />
                          <Button size="small" component={Link} to={phase.href}>
                            {phase.action}
                          </Button>
                        </Box>
                      ))}
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Thông báo và lịch sử
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Demo không gửi email/push thật hoặc kích hoạt worker.
                    </Typography>
                    <Typography variant="body2">
                      03/11/2026 · Giao việc ghi số · Hoàn tất
                    </Typography>
                    <Typography variant="body2">
                      07/11/2026 · Lập nháp · Chờ dữ liệu nước A101
                    </Typography>
                  </Stack>
                </AccordionDetails>
              )}
            </Accordion>
          </>
        ) : (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 700 }}>Chưa có dữ liệu mẫu cho cơ sở/kỳ này.</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Chọn BHOME Thanh Xuân, kỳ 11/2026 để thử luồng xử lý.
            </Typography>
            <Button
              variant="outlined"
              sx={{ mt: 1.5 }}
              onClick={() => {
                setLocation('bhome-thanh-xuan');
                setPeriod('2026-11');
              }}
            >
              Quay về kỳ mẫu
            </Button>
          </Paper>
        )}
        <Dialog
          open={settings}
          onClose={cancelSettings}
          fullWidth
          maxWidth="sm"
          aria-labelledby="demo-automation-settings-title"
        >
          <DialogTitle id="demo-automation-settings-title">
            Cấu hình lịch hóa đơn (demo)
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="info">
                Thay đổi chỉ cập nhật lịch hiển thị trên trang demo, không lưu cấu hình máy chủ.
              </Alert>
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5 }}>
                <TextField
                  label="Kỳ bắt đầu áp dụng cấu hình"
                  type="month"
                  value={effective}
                  onChange={(event) => setEffective(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="Ngày giao việc ghi số"
                  type="number"
                  value={meterDay}
                  onChange={(event) => setMeterDay(event.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: 28 } }}
                />
                <TextField
                  label="Ngày hết hạn ghi số"
                  type="number"
                  value={meterDueDay}
                  onChange={(event) => setMeterDueDay(event.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: 31 } }}
                />
                <TextField
                  label="Ngày lập hóa đơn nháp"
                  type="number"
                  value={draftDay}
                  onChange={(event) => setDraftDay(event.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: 28 } }}
                />
                <TextField
                  label="Ngày phát hành hóa đơn"
                  type="number"
                  value={finalDay}
                  onChange={(event) => setFinalDay(event.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: 28 } }}
                />
              </Stack>
              <Alert severity="info">
                Cấu hình demo luôn tắt tự động phát hành và chạy worker.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={cancelSettings}>Đóng</Button>
            <Button
              variant="contained"
              disabled={
                !/^\d{4}-\d{2}$/.test(effective) ||
                [meterDay, meterDueDay, draftDay, finalDay].some(
                  (day) => !/^(?:[1-9]|1\d|2[0-8])$/.test(day),
                )
              }
              onClick={() => {
                setSettings(false);
                setNotice(
                  'Lịch mô phỏng đã cập nhật trong giao diện. Không có tác vụ worker nào được chạy.',
                );
              }}
            >
              Áp dụng lịch mẫu
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </>
  );
}

function DemoManualActions({
  period,
  meterDay,
  setNotice,
}: {
  period: string;
  meterDay: string;
  setNotice: (value: string) => void;
}) {
  const [room, setRoom] = useState('A101');
  const [meter, setMeter] = useState('Điện');
  const [initial, setInitial] = useState(false);
  const [periodic, setPeriodic] = useState(false);
  const [draft, setDraft] = useState(false);
  const [final, setFinal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [checked, setChecked] = useState(false);
  const today = businessToday();
  const meterScheduledDate = `${period}-${String(Math.min(Number(meterDay), new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate())).padStart(2, '0')}`;
  const meterReady = today >= meterScheduledDate;
  const reset = () => {
    setInitial(false);
    setPeriodic(false);
    setDraft(false);
    setFinal(false);
    setNotice('');
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 750 }}>
          Chạy thử thủ công
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Kỳ {period} · Dữ liệu minh họa, chỉ cập nhật màn hình demo.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Ngày nghiệp vụ: {today} · Mốc giao việc ghi số kỳ này: {meterScheduledDate}.
          {meterReady ? ' Có thể giao việc thủ công.' : ' Chưa đến ngày giao việc.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1 }}>
          <TextField
            select
            size="small"
            label="Phòng kiểm thử (demo)"
            value={room}
            onChange={(e) => {
              setRoom(e.target.value);
              reset();
            }}
            sx={{ flex: 1 }}
          >
            <MenuItem value="A101">A101</MenuItem>
            <MenuItem value="A102">A102</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Đồng hồ kiểm thử (demo)"
            value={meter}
            onChange={(e) => {
              setMeter(e.target.value);
              reset();
            }}
            sx={{ flex: 1 }}
          >
            <MenuItem value="Điện">Điện</MenuItem>
            <MenuItem value="Nước">Nước</MenuItem>
          </TextField>
        </Stack>
        <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
          Bước 1–2 · Nhiệm vụ đồng hồ ({meter})
        </Typography>
        <Stack spacing={1}>
          {[
            {
              number: 1,
              label: 'Khởi tạo chỉ số ban đầu',
              done: initial,
              disabled: initial || !meterReady,
              action: () => {
                setInitial(true);
                setNotice(`Demo: đã giao nhiệm vụ khởi tạo đồng hồ ${meter} phòng ${room}.`);
              },
              button: 'Giao nhiệm vụ khởi tạo',
            },
            {
              number: 2,
              label: 'Ghi chỉ số vận hành',
              done: periodic,
              disabled: periodic || !meterReady,
              action: () => {
                setPeriodic(true);
                setNotice(`Demo: đã giao nhiệm vụ ghi chỉ số vận hành kỳ ${period}.`);
              },
              button: 'Giao nhiệm vụ vận hành',
            },
          ].map((item) => (
            <Box
              key={item.number}
              sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>
                    {item.number}. {item.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.done
                      ? 'Đã mô phỏng giao nhiệm vụ.'
                      : meterReady
                        ? 'Sẵn sàng thực hiện trên dữ liệu demo.'
                        : `Chưa đến ngày giao việc ${meterScheduledDate}.`}
                  </Typography>
                </Box>
                <Button variant="outlined" disabled={item.disabled} onClick={item.action}>
                  {item.button}
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
        <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
          Bước 3–4 · Hóa đơn (chỉ cần phòng và kỳ)
        </Typography>
        <Stack spacing={1}>
          <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}
            >
              <Box>
                <Typography sx={{ fontWeight: 700 }}>3. Tạo hóa đơn nháp</Typography>
                <Typography variant="body2" color="text.secondary">
                  {draft
                    ? 'Đã tạo bản nháp demo.'
                    : 'Sẵn sàng tạo bản nháp minh họa, không cần đồng hồ.'}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                disabled={draft}
                onClick={() => {
                  setDraft(true);
                  setNotice(`Demo: đã tạo nháp phòng ${room}. Không ghi dữ liệu thật.`);
                }}
              >
                Tạo hóa đơn nháp
              </Button>
            </Stack>
          </Box>
          <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}
            >
              <Box>
                <Typography sx={{ fontWeight: 700 }}>4. Phát hành hóa đơn chính thức</Typography>
                <Typography variant="body2" color="text.secondary">
                  {final
                    ? 'Đã mô phỏng phát hành.'
                    : draft
                      ? 'Sẵn sàng kiểm tra và xác nhận phát hành demo.'
                      : 'Tạo hóa đơn nháp ở bước 3 trước.'}
                </Typography>
              </Box>
              <Button
                variant="contained"
                disabled={!draft || final}
                onClick={() => {
                  setChecked(false);
                  setConfirm(true);
                }}
              >
                Kiểm tra và phát hành
              </Button>
            </Stack>
          </Box>
        </Stack>
        <Dialog open={confirm} onClose={() => setConfirm(false)} fullWidth maxWidth="sm">
          <DialogTitle>Xác nhận phát hành hóa đơn chính thức (demo)</DialogTitle>
          <DialogContent>
            <Typography sx={{ mt: 1 }}>
              Phòng {room} · Kỳ {period} · Hóa đơn nháp minh họa
            </Typography>
            <Alert severity="info" sx={{ mt: 1 }}>
              Chỉ mô phỏng thao tác; không có hóa đơn hoặc thông báo thật được tạo.
            </Alert>
            <FormControlLabel
              control={
                <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              }
              label="Tôi đã kiểm tra phòng và kỳ trước khi phát hành."
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(false)}>Hủy</Button>
            <Button
              disabled={!checked}
              variant="contained"
              onClick={() => {
                setFinal(true);
                setConfirm(false);
                setNotice(`Demo: đã mô phỏng phát hành hóa đơn phòng ${room}.`);
              }}
            >
              Xác nhận phát hành
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Paper>
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
        title="Cấu hình lịch & chạy thử hóa đơn"
        subtitle="Lưu lịch áp dụng từ kỳ bạn chọn, sau đó chạy thử từng nghiệp vụ thủ công theo phòng và kỳ hóa đơn."
        actions={
          <Button
            component={Link}
            to={location ? `/pricing?locationId=${encodeURIComponent(location)}` : '/pricing'}
          >
            Giá & biểu phí
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
        <FilterToolbar>
          <TextField
            select
            label="Cơ sở"
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
            label="Kỳ kiểm thử"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </FilterToolbar>
        {location && <ScheduleConfiguration key={location + session?.userId} location={location} />}
        {(!location || !/^\d{4}-\d{2}$/.test(period)) && !locations.error && (
          <Alert severity="info">
            {!location
              ? 'Chọn cơ sở để cấu hình lịch. Kỳ kiểm thử dùng riêng cho các thao tác thủ công.'
              : 'Chọn kỳ kiểm thử để thao tác thủ công theo phòng; kỳ này không làm thay đổi thời điểm áp dụng cấu hình.'}
          </Alert>
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

/** Config remains visible with only a Location: the test period never selects the effective policy version. */
function ScheduleConfiguration({ location }: { location: string }) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const settings = useQuery({
    queryKey: ['manual-billing-schedule', session?.userId, location],
    queryFn: async ({ signal }) => {
      const [history, calendar] = await Promise.all([
        api.request<AutomationPlan[]>(`/api/v1/billing-automation/${location}/history`, { signal }),
        api.schedule(location, signal),
      ]);
      return { history, calendar };
    },
  });
  const existingActive = settings.data?.history.some(
    (plan) => plan.enabled || plan.authorizeAutomaticFinalization,
  );
  const savedPlan = settings.data?.history[0];
  const savedCalendar = savedPlan ? automationCalendar(savedPlan) : undefined;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1 }}
        >
          <Box>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 750 }}>
              Cấu hình lịch
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Lịch lưu theo kỳ hiệu lực, độc lập với kỳ chạy thử bên dưới.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? 'Đóng chỉnh sửa' : savedPlan ? 'Chỉnh sửa lịch' : 'Thiết lập lịch'}
          </Button>
        </Stack>
        <Chip
          size="small"
          variant="outlined"
          sx={{ alignSelf: 'flex-start' }}
          label="Chưa kích hoạt chạy tự động"
        />
        {settings.data &&
          (savedPlan ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' },
                gap: 1,
                p: 1.5,
                bgcolor: 'action.hover',
                borderRadius: 2,
              }}
            >
              {[
                ['Áp dụng từ kỳ', savedPlan.effectiveFrom.slice(0, 7)],
                [
                  'Giao việc ghi số',
                  `Ngày ${savedPlan.meterDay} · hạn ${savedPlan.meterDueDay} (+${savedPlan.meterDueMonthOffset} tháng)`,
                ],
                [
                  'Tạo nháp',
                  savedCalendar
                    ? `Ngày ${savedCalendar.draftDay} (+${savedCalendar.draftMonthOffset} tháng)`
                    : 'Chưa có',
                ],
                [
                  'Phát hành',
                  savedCalendar
                    ? `Ngày ${savedCalendar.finalDay} (+${savedCalendar.finalMonthOffset} tháng)`
                    : 'Chưa có',
                ],
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Alert severity="info">
              Chưa lưu lịch cho cơ sở này. Chọn “Thiết lập lịch” để tạo phiên bản áp dụng từ kỳ mong
              muốn.
            </Alert>
          ))}
        {existingActive && (
          <Alert severity="warning">
            Có phiên bản cũ được bật tự động. Lưu lịch mới ở đây sẽ tắt các cờ tự động kể từ kỳ bắt
            đầu áp dụng; những kỳ còn dùng phiên bản cũ cần được kiểm tra riêng.
          </Alert>
        )}
        {settings.isPending && <LinearProgress />}
        {settings.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void settings.refetch()}>Thử lại cấu hình</Button>}
          >
            {invoiceError(settings.error)}
          </Alert>
        )}
        {expanded && settings.data && (
          <AutomationForm
            key={settings.data.history[0]?.id ?? 'new'}
            location={location}
            history={settings.data.history}
            calendar={settings.data.calendar}
            saved={() => {
              void cache.invalidateQueries({
                queryKey: ['manual-billing-schedule', session?.userId, location],
              });
              void cache.invalidateQueries({ queryKey: ['automation'] });
            }}
          />
        )}
      </Stack>
    </Paper>
  );
}

function AutomationLocation({ location, period }: { location: string; period: string }) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const representativeRef = useRef<HTMLDivElement>(null);
  const revealRepresentative = () => {
    setShowAdvanced(true);
    window.setTimeout(
      () => representativeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      100,
    );
  };
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
  const needsRepresentative = data.data?.executions.some((execution) =>
    automationIssues(execution.exceptionsJson).some(
      (issue) => issue.code === 'representative_selection_required',
    ),
  );
  const issues =
    data.data?.executions.flatMap((execution) => automationIssues(execution.exceptionsJson)) ?? [];
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end' }}>
        <Button
          disabled={data.isFetching}
          onClick={() => {
            void data.refetch();
            void cache.invalidateQueries({
              queryKey: ['automation-drafts', session?.userId, location, period],
            });
          }}
        >
          Làm mới
        </Button>
      </Stack>
      {data.isPending && <LinearProgress />}
      {data.error && <Alert severity="error">{invoiceError(data.error)}</Alert>}
      <ManualBillingActions
        location={location}
        period={period}
        preview={data.data?.preview}
        onRepresentativeRequired={revealRepresentative}
      />
      <AutomationDrafts location={location} period={period} />
      {issues.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button size="small" onClick={revealRepresentative}>
              Xem cách xử lý
            </Button>
          }
        >
          {issues
            .slice(0, 2)
            .map((issue) => issueLabel[issue.code] ?? issue.code)
            .join(' · ')}
          {issues.length > 2 ? ` · +${issues.length - 2} vấn đề` : ''}
        </Alert>
      )}
      {data.data && !data.error && (
        <>
          <Accordion
            disableGutters
            variant="outlined"
            expanded={showAdvanced}
            onChange={(_, expanded) => setShowAdvanced(expanded)}
            sx={{ borderRadius: '12px !important' }}
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
                <Typography sx={{ fontWeight: 700 }}>Lịch chạy & giám sát</Typography>
                <Typography variant="caption" color="text.secondary">
                  {data.data.preview.workerEnabled ? 'Worker đang bật' : 'Worker đang tắt'} ·{' '}
                  {data.data.attempts.length} lần xử lý
                </Typography>
              </Stack>
            </AccordionSummary>
            {showAdvanced && (
              <AccordionDetails>
                <Stack spacing={2}>
                  <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2 }}>
                    <Stack spacing={1.5}>
                      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
                        Lịch chạy kỳ này
                      </Typography>
                      <Chip
                        sx={{ alignSelf: 'flex-start' }}
                        size="small"
                        variant="outlined"
                        color={data.data.preview.workerEnabled ? 'success' : 'default'}
                        label={
                          data.data.preview.workerEnabled ? 'Worker đang bật' : 'Worker đang tắt'
                        }
                      />
                      {!data.data.preview.workerEnabled && (
                        <Alert severity="warning">
                          Worker tự động đang tắt. Chạy ngay chỉ có thể dùng trong môi trường
                          Development/Testing được máy chủ cho phép.
                        </Alert>
                      )}
                      <Typography variant="body2" color="text.secondary">
                        Ngày nghiệp vụ: {data.data.preview.businessDate} ·{' '}
                        {data.data.preview.timeZone}
                      </Typography>
                      {data.data.preview.phases.length === 0 && (
                        <Alert
                          severity="warning"
                          action={
                            <Button component={Link} to="/pricing">
                              Xem lịch giá & phí
                            </Button>
                          }
                        >
                          Thiếu cấu hình tự động cho kỳ này.
                        </Alert>
                      )}
                      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                        {data.data.preview.phases.map((p) => (
                          <Box
                            component="li"
                            key={p.phase}
                            sx={{
                              display: 'flex',
                              flexDirection: { xs: 'column', md: 'row' },
                              alignItems: { md: 'center' },
                              gap: 1,
                              py: 1.25,
                              borderBottom: '1px solid',
                              borderColor: 'divider',
                            }}
                          >
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                {phaseLabel[p.phase]}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Ngày dự kiến: {p.scheduledDate.split('-').reverse().join('/')}
                              </Typography>
                            </Box>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={p.eligible ? 'warning' : 'default'}
                              label={p.eligible ? 'Đến lịch' : 'Chưa đến lịch'}
                              sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
                            />
                          </Box>
                        ))}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Lần tiếp theo phụ thuộc ngày cấu hình và kết quả gần nhất. Worker bỏ qua lần
                        đã hoàn tất; PendingInputs được kiểm tra lại, Failed dừng tự động sau 4 lần
                        xử lý.
                      </Typography>
                    </Stack>
                  </Paper>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Kết quả và vấn đề
                  </Typography>
                  {needsRepresentative && (
                    <Alert
                      severity="warning"
                      action={
                        <Button size="small" onClick={() => setShowAdvanced(true)}>
                          Chọn hợp đồng
                        </Button>
                      }
                    >
                      Có phòng/kỳ thiếu hợp đồng đại diện. Mở mục hợp đồng bên dưới để chọn.
                    </Alert>
                  )}
                  {data.data.executions.length === 0 && (
                    <Alert severity="info">Chưa có lần chạy cho cơ sở/kỳ này.</Alert>
                  )}
                  {data.data.executions.map((e) => (
                    <Paper
                      key={e.id}
                      variant="outlined"
                      sx={{ p: 2, borderRadius: 2, overflowWrap: 'anywhere' }}
                    >
                      <Stack spacing={1}>
                        <Stack
                          direction="row"
                          sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
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
                          Tạo: {e.createdCount} · Đã tồn tại / replay: {e.existingCount} · Lần xử
                          lý: {e.attempts}
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
                                <Button size="small" component={Link} to="/meters">
                                  Kiểm tra đồng hồ
                                </Button>
                              )}
                            {issue.code === 'representative_selection_required' && (
                              <Button size="small" onClick={() => setShowAdvanced(true)}>
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
                              <Button size="small" component={Link} to="/billing-automation">
                                Kiểm tra cấu hình
                              </Button>
                            )}
                          </Alert>
                        ))}
                      </Stack>
                    </Paper>
                  ))}
                  <Box ref={representativeRef} sx={{ scrollMarginTop: 24 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Chọn hợp đồng đại diện
                    </Typography>
                    <RepresentativeForm location={location} period={period} />
                  </Box>
                  <DeliveryMonitor location={location} />
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
                    Hàng đợi xử lý
                  </Typography>
                  {data.data.queue.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có lượt chạy trong hàng đợi.
                    </Typography>
                  )}
                  {data.data.queue.map((j) => (
                    <Box key={j.id} sx={{ py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Typography sx={{ fontWeight: 650 }}>
                        {j.name} · {j.state} · Lần {j.attempts}/4
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Đến lượt / thử lại: {date(j.availableAt)}
                        {j.lockedUntil ? ` · Lease đến ${date(j.lockedUntil)}` : ''}
                      </Typography>
                      {j.lastErrorCode && <Alert severity="warning">{j.lastErrorCode}</Alert>}
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            )}
          </Accordion>
        </>
      )}
    </Stack>
  );
}
/** Deliberately calls the Owner's existing single-room endpoints, never location-wide automation run-now. */
function ManualBillingActions({
  location,
  period,
  preview,
  onRepresentativeRequired,
}: {
  location: string;
  period: string;
  preview?: AutomationPreview;
  onRepresentativeRequired: () => void;
}) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [room, setRoom] = useState('');
  const [meter, setMeter] = useState('');
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [finalChecked, setFinalChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [taskId, setTaskId] = useState('');
  const [representativeIssue, setRepresentativeIssue] = useState(false);
  const lock = useRef(false);
  const rooms = useQuery({
    queryKey: ['manual-billing-rooms', session?.userId, location],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  const meters = useQuery({
    queryKey: ['manual-billing-meters', session?.userId, location],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string; parentId: string }[]>(
        `/api/v1/capture/locations/${location}/meters`,
        { signal },
      ),
  });
  const tasks = useQuery({
    queryKey: ['manual-billing-tasks', session?.userId, room],
    enabled: !!room,
    queryFn: async ({ signal }) => {
      // Capture returns at most 100 rows per page. Failing closed avoids silently
      // creating a duplicate when the matching task belongs to an older page.
      const all: MeterTask[] = [];
      for (let page = 1; page <= 20; page++) {
        const batch = await api.request<MeterTask[]>(
          `/api/v1/capture/meter-tasks?roomId=${encodeURIComponent(room)}&page=${page}`,
          { signal },
        );
        all.push(...batch);
        if (batch.length < 100) return all;
      }
      throw new Error(
        'Không thể kiểm tra toàn bộ lịch sử nhiệm vụ. Mở trang Đồng hồ để kiểm tra trước khi giao việc.',
      );
    },
  });
  const invoices = useQuery({
    queryKey: ['manual-billing-invoice', session?.userId, room, period],
    enabled: !!room,
    queryFn: ({ signal }) =>
      api.list(1, signal, room, { locationId: location, billingPeriod: period }),
  });
  const visibleMeters = meters.data?.filter((item) => item.parentId === room) ?? [];
  const meterBelongsToRoom = visibleMeters.some((item) => item.id === meter);
  const invoice = invoices.data?.items.find(
    (item) => item.roomId === room && item.billingPeriod === period,
  );
  const draft = invoice?.status === 'Draft' ? invoice : undefined;
  const alreadyInitial =
    tasks.data?.some((task) => task.meterId === meter && task.purpose === 0) ?? false;
  const alreadyPeriodic =
    tasks.data?.some(
      (task) => task.meterId === meter && task.purpose === 1 && task.billingPeriod === period,
    ) ?? false;
  const allowed = preview?.developerActionsEnabled === true;
  const businessDate = preview?.businessDate ?? '';
  // Preview derives the Meter phase date from the effective persisted plan, even when
  // automatic execution is disabled. Only the calendar date matters for manual testing.
  const scheduledMeterDate =
    preview?.phases.find((phase) => phase.phase === 'Meter')?.scheduledDate ?? '';
  const meterDateReached =
    !!scheduledMeterDate && !!businessDate && businessDate >= scheduledMeterDate;
  const scheduledDraftDate =
    preview?.phases.find((phase) => phase.phase === 'Draft')?.scheduledDate ?? '';
  const draftDateReached = !scheduledDraftDate || businessDate >= scheduledDraftDate;
  const initialReady =
    allowed &&
    !!room &&
    meterBelongsToRoom &&
    meterDateReached &&
    tasks.isSuccess &&
    !alreadyInitial;
  const periodicReady =
    allowed &&
    !!room &&
    meterBelongsToRoom &&
    meterDateReached &&
    tasks.isSuccess &&
    !alreadyPeriodic;
  const draftReady = allowed && !!room && invoices.isSuccess && (!!invoice || draftDateReached);
  const finalReady =
    allowed && !!room && !!draft && draft.version > 0 && draft.missingInputs.length === 0;

  async function execute(operation: 'initial' | 'periodic' | 'draft' | 'final') {
    if (lock.current || !allowed) return;
    if (
      (operation === 'initial' && !initialReady) ||
      (operation === 'periodic' && !periodicReady) ||
      (operation === 'draft' && !draftReady) ||
      (operation === 'final' && (!finalReady || !finalChecked))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    setTaskId('');
    try {
      if (operation === 'initial' || operation === 'periodic') {
        // Refresh the scoped meter and task lists before writing; never create a
        // task for a meter that has moved out of the currently selected room.
        const [latest, latestMeters] = await Promise.all([tasks.refetch(), meters.refetch()]);
        if (
          !latestMeters.isSuccess ||
          !latestMeters.data?.some((item) => item.id === meter && item.parentId === room)
        ) {
          setError(
            'Đồng hồ của phòng đã thay đổi. Tải lại phòng và đồng hồ trước khi giao nhiệm vụ.',
          );
          return;
        }
        if (
          !latest.isSuccess ||
          latest.data?.some(
            (task) =>
              task.meterId === meter &&
              task.purpose === (operation === 'initial' ? 0 : 1) &&
              (operation === 'initial' || task.billingPeriod === period),
          )
        ) {
          setError(
            'Đã có nhiệm vụ cùng đồng hồ và loại kỳ, hoặc không tải được danh sách. Kiểm tra nhiệm vụ trước khi thử lại.',
          );
          return;
        }
        const created = await api.request<{ id: string }>(
          '/api/v1/billing-automation/manual-meter-tasks',
          {
            method: 'POST',
            body: JSON.stringify({
              meterId: meter,
              purpose: operation === 'initial' ? 0 : 1,
              billingPeriod: period,
            }),
          },
        );
        setTaskId(created.id);
        setFeedback(
          operation === 'initial'
            ? 'Đã tạo nhiệm vụ ghi chỉ số ban đầu. Staff xác nhận ảnh và chỉ số trong màn Đồng hồ.'
            : 'Đã tạo nhiệm vụ ghi chỉ số vận hành cho kỳ kiểm thử.',
        );
        void tasks.refetch();
      } else if (operation === 'draft') {
        const latestInvoice = await invoices.refetch();
        if (!latestInvoice.isSuccess) {
          setError(
            'Chưa kiểm tra được hóa đơn hiện tại của phòng/kỳ. Tải lại dữ liệu trước khi tạo nháp.',
          );
          return;
        }
        const existing = latestInvoice.data?.items.find(
          (item) => item.roomId === room && item.billingPeriod === period,
        );
        if (existing) {
          setFeedback(
            existing.status === 'Draft'
              ? 'Phòng/kỳ này đã có bản nháp. Mở hóa đơn để kiểm tra.'
              : 'Hóa đơn phòng/kỳ này đã phát hành. Không tạo thêm bản nháp.',
          );
        } else {
          // The backend chooses the persisted representative, or the only eligible
          // contract. A conflict requires Owner review instead of a guessed contract.
          const created = await api.request<Invoice>('/api/v1/invoices/drafts', {
            method: 'POST',
            body: JSON.stringify({ roomId: room, billingPeriod: period }),
          });
          setFeedback(
            `Đã tạo hóa đơn nháp cho phòng đã chọn (trạng thái ${created.status}). Kiểm tra dữ liệu trước khi phát hành.`,
          );
          setRepresentativeIssue(false);
        }
      } else if (draft) {
        // Recheck the exact room, period and version after Owner confirms the dialog.
        const latest = await api.get(draft.id);
        if (
          latest.roomId !== room ||
          latest.billingPeriod !== period ||
          latest.status !== 'Draft' ||
          latest.version !== draft.version ||
          latest.missingInputs.length > 0 ||
          latest.total !== draft.total
        ) {
          setConfirmFinal(false);
          setFinalChecked(false);
          setError(
            'Hóa đơn đã thay đổi trong lúc kiểm tra. Tải lại dữ liệu, đối chiếu rồi xác nhận lại.',
          );
          void invoices.refetch();
          return;
        }
        const published = await api.finalize(latest.id, latest.version);
        setConfirmFinal(false);
        setFinalChecked(false);
        setFeedback(
          `Hóa đơn phòng ${published.roomNumber} đã phát hành với phiên bản ${published.version}.`,
        );
      }
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ['manual-billing-invoice', session?.userId, room, period],
        }),
        cache.invalidateQueries({
          queryKey: ['automation-drafts', session?.userId, location, period],
        }),
        cache.invalidateQueries({ queryKey: ['invoices', session?.userId] }),
        cache.invalidateQueries({ queryKey: ['automation'] }),
      ]);
    } catch (e) {
      const problem = e as { code?: string; problem?: { code?: string } };
      const code = problem.problem?.code ?? problem.code;
      if (operation === 'draft' && code === 'representative_selection_required')
        setRepresentativeIssue(true);
      setError(
        operation === 'draft' && code === 'representative_selection_required'
          ? 'Có nhiều hợp đồng trong kỳ. Hãy chọn hợp đồng đại diện bên dưới rồi tạo nháp lại.'
          : operation === 'draft' && code === 'representative_contract_not_eligible'
            ? 'Phòng chưa có hợp đồng hợp lệ trong kỳ này. Kiểm tra lịch sử thuê phòng trước khi tạo nháp.'
            : operation === 'draft' && code === 'draft_date_not_reached'
              ? `Chưa đến ngày tạo hóa đơn nháp${scheduledDraftDate ? ` (${scheduledDraftDate})` : ''}. Kiểm tra mốc tạo nháp trong Cấu hình lịch và thử lại khi đến ngày.`
              : invoiceError(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const meterReason = !allowed
    ? 'Máy chủ chưa cho phép chạy thử thủ công.'
    : !room
      ? 'Chọn phòng để tiếp tục.'
      : !meter
        ? 'Chọn đồng hồ điện hoặc nước ở phần ghi chỉ số.'
        : !meterBelongsToRoom
          ? 'Đồng hồ không thuộc phòng đã chọn.'
          : !scheduledMeterDate
            ? 'Kỳ này chưa có lịch ghi chỉ số. Hãy thiết lập lịch áp dụng.'
            : !meterDateReached
              ? `Chưa đến ngày giao việc ${scheduledMeterDate}.`
              : !tasks.isSuccess
                ? 'Chưa kiểm tra được danh sách nhiệm vụ của phòng.'
                : '';
  const draftReason = !allowed
    ? 'Máy chủ chưa cho phép chạy thử thủ công.'
    : !room
      ? 'Chọn phòng để tạo hóa đơn nháp.'
      : !invoices.isSuccess
        ? 'Đang kiểm tra hóa đơn của phòng/kỳ hoặc dữ liệu chưa tải được.'
        : !invoice && !draftDateReached
          ? `Chưa đến ngày lập nháp ${scheduledDraftDate}.`
          : '';
  const finalReason = !allowed
    ? 'Máy chủ chưa cho phép chạy thử thủ công.'
    : !room
      ? 'Chọn phòng để kiểm tra hóa đơn.'
      : !draft
        ? invoice
          ? 'Hóa đơn kỳ này đã phát hành hoặc không còn là bản nháp.'
          : 'Hãy tạo hóa đơn nháp trước.'
        : draft.version <= 0
          ? 'Hóa đơn chưa có phiên bản hợp lệ.'
          : draft.missingInputs.length
            ? `Hóa đơn thiếu: ${draft.missingInputs.map(missingBillingInput).join(' · ')}.`
            : '';
  const step = (
    number: number,
    title: string,
    detail: string,
    ready: boolean,
    complete: boolean,
    reason: string,
    action: React.ReactNode,
    followUp?: React.ReactNode,
  ) => (
    <Box
      component="section"
      aria-label={`Bước ${number}: ${title}`}
      sx={{ p: { xs: 1.5, sm: 2 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1.5, alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" sx={{ gap: 1.25, alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: complete ? 'success.main' : 'action.selected',
              color: complete ? 'success.contrastText' : 'text.primary',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              fontWeight: 700,
            }}
          >
            {number}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 750 }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {detail}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                mt: 0.75,
                color: complete ? 'success.main' : ready ? 'text.primary' : 'text.secondary',
                fontWeight: 600,
              }}
            >
              {complete
                ? reason || 'Đã có kết quả cho lựa chọn hiện tại.'
                : ready
                  ? 'Sẵn sàng thực hiện.'
                  : reason}
            </Typography>
            {followUp}
          </Box>
        </Stack>
        <Box
          sx={{
            width: { xs: '100%', sm: 'auto' },
            flexShrink: 0,
            '& > button': { width: { xs: '100%', sm: 'auto' } },
          }}
        >
          {action}
        </Box>
      </Stack>
    </Box>
  );

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 750 }}>
            Chạy thử thủ công
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Kỳ kiểm thử {period.slice(0, 7)} · Chỉ thực hiện bước bạn bấm, với một phòng được chọn.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Ngày nghiệp vụ: {businessDate || 'Chưa tải'} · Ngày giao việc ghi chỉ số theo cấu hình:{' '}
            {scheduledMeterDate || 'Chưa có lịch áp dụng cho kỳ này'}.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Khi giao nhiệm vụ, máy chủ sẽ tự lấy ngày ghi chỉ số theo lịch đã lưu, không cần nhập
            ngày thủ công.
          </Typography>
        </Box>
        {!allowed && (
          <Alert severity="warning">
            Máy chủ chưa cho phép thao tác thử nghiệm trong môi trường hiện tại. Các bước được hiển
            thị để kiểm tra; không thể gửi lệnh cho đến khi quyền thử nghiệm được bật ở phía máy
            chủ.
          </Alert>
        )}
        <Box sx={{ maxWidth: 460 }}>
          <TextField
            select
            size="small"
            label="Phòng kiểm thử"
            value={room}
            onChange={(e) => {
              setRoom(e.target.value);
              setMeter('');
              setFeedback('');
              setError('');
              setTaskId('');
              setRepresentativeIssue(false);
              setConfirmFinal(false);
              setFinalChecked(false);
            }}
            fullWidth
          >
            <MenuItem value="">Chọn phòng</MenuItem>
            {rooms.data?.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        {(rooms.isPending || meters.isPending || tasks.isFetching || invoices.isFetching) && (
          <LinearProgress />
        )}
        {(rooms.error || meters.error || tasks.error || invoices.error) && (
          <Alert
            severity="error"
            action={
              <Button
                onClick={() => {
                  void rooms.refetch();
                  void meters.refetch();
                  if (room) {
                    void tasks.refetch();
                    void invoices.refetch();
                  }
                }}
              >
                Tải lại dữ liệu phòng
              </Button>
            }
          >
            {invoiceError(rooms.error ?? meters.error ?? tasks.error ?? invoices.error)}
          </Alert>
        )}
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 750, mb: 1 }}>
            Dành cho bước 1–2: chọn đồng hồ
          </Typography>
          <TextField
            select
            size="small"
            label="Đồng hồ điện hoặc nước"
            value={meter}
            disabled={!room}
            fullWidth
            sx={{ maxWidth: 460 }}
            onChange={(e) => setMeter(e.target.value)}
          >
            <MenuItem value="">Chọn đồng hồ</MenuItem>
            {visibleMeters.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
          {room && visibleMeters.length === 0 && meters.isSuccess && (
            <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
              Phòng chưa có đồng hồ. Kiểm tra tại trang Đồng hồ.
            </Typography>
          )}
        </Box>
        <Stack spacing={1}>
          {step(
            1,
            'Khởi tạo chỉ số ban đầu',
            'Giao việc cho Staff xác nhận chỉ số đầu kỳ của đồng hồ.',
            initialReady,
            alreadyInitial,
            alreadyInitial ? 'Đã có nhiệm vụ khởi tạo cho đồng hồ này.' : meterReason,
            <Button
              variant="outlined"
              disabled={!initialReady || busy}
              onClick={() => void execute('initial')}
            >
              Giao nhiệm vụ khởi tạo
            </Button>,
            alreadyInitial ? (
              <Button component={Link} to="/meters" size="small" sx={{ mt: 0.5 }}>
                Xem nhiệm vụ đã có
              </Button>
            ) : null,
          )}
          {step(
            2,
            'Ghi chỉ số vận hành',
            'Giao việc chụp và xác nhận chỉ số cho kỳ kiểm thử.',
            periodicReady,
            alreadyPeriodic,
            alreadyPeriodic ? 'Đã có nhiệm vụ vận hành cho kỳ này.' : meterReason,
            <Button
              variant="outlined"
              disabled={!periodicReady || busy}
              onClick={() => void execute('periodic')}
            >
              Giao nhiệm vụ vận hành
            </Button>,
            alreadyPeriodic ? (
              <Button component={Link} to="/meters" size="small" sx={{ mt: 0.5 }}>
                Xem nhiệm vụ đã có
              </Button>
            ) : null,
          )}
        </Stack>
        <Typography variant="subtitle2" sx={{ fontWeight: 750, mt: 1 }}>
          Hóa đơn · chỉ dùng phòng và kỳ đã chọn
        </Typography>
        <Stack spacing={1}>
          {step(
            3,
            'Tạo hóa đơn nháp',
            'Máy chủ xác định hợp đồng đại diện; không cần chọn đồng hồ.',
            draftReady,
            !!invoice,
            draftReason,
            <Button
              variant="outlined"
              disabled={!draftReady || busy}
              onClick={() => void execute('draft')}
            >
              Tạo hóa đơn nháp
            </Button>,
            invoice ? (
              <Button
                size="small"
                component={Link}
                to={`/invoices?invoiceId=${invoice.id}`}
                sx={{ mt: 0.5 }}
              >
                Mở hóa đơn hiện có
              </Button>
            ) : null,
          )}
          {representativeIssue && (
            <Alert
              severity="warning"
              action={
                <Button size="small" onClick={onRepresentativeRequired}>
                  Chọn hợp đồng
                </Button>
              }
            >
              Phòng này có nhiều hợp đồng cùng kỳ. Chọn hợp đồng đại diện trong mục giám sát rồi thử
              tạo nháp lại.
            </Alert>
          )}
          {step(
            4,
            'Phát hành hóa đơn chính thức',
            'Kiểm tra số tiền và xác nhận trước khi gửi phát hành.',
            finalReady,
            !!invoice && invoice.status !== 'Draft',
            finalReason,
            <Button
              variant="contained"
              color="primary"
              disabled={!finalReady || busy}
              onClick={() => {
                setFinalChecked(false);
                setConfirmFinal(true);
              }}
            >
              Kiểm tra và phát hành
            </Button>,
            draft ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                Bản nháp v{draft.version} · {formatBillingDecimal(draft.total)} ₫
              </Typography>
            ) : null,
          )}
        </Stack>
        {invoice && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ justifyContent: 'space-between', gap: 1, alignItems: { sm: 'center' } }}
          >
            <Typography variant="body2">
              Hóa đơn phòng: <strong>{invoice.status}</strong> · v{invoice.version} ·{' '}
              {formatBillingDecimal(invoice.total)} ₫
            </Typography>
            <Button size="small" component={Link} to={`/invoices?invoiceId=${invoice.id}`}>
              Xem hóa đơn
            </Button>
          </Stack>
        )}
        {draft?.missingInputs.length ? (
          <Alert severity="warning">
            Hóa đơn nháp còn thiếu: {draft.missingInputs.map(missingBillingInput).join(' · ')}
          </Alert>
        ) : null}
        {feedback && (
          <Alert severity="success">
            {feedback}
            {taskId && (
              <Button component={Link} to={`/meters?taskId=${taskId}`}>
                Xem nhiệm vụ
              </Button>
            )}
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <Dialog
          open={confirmFinal}
          onClose={() => !busy && setConfirmFinal(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Xác nhận phát hành hóa đơn chính thức</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography>
                Phòng: {rooms.data?.find((item) => item.id === room)?.label} · Kỳ:{' '}
                {period.slice(0, 7)}
              </Typography>
              <Typography>
                Hóa đơn: {draft?.id ?? 'Chưa có'} · Trạng thái: {draft?.status ?? 'Không hợp lệ'} ·
                Phiên bản: {draft?.version ?? '—'}
              </Typography>
              <Typography sx={{ fontWeight: 750 }}>
                Tổng tiền: {draft ? formatBillingDecimal(draft.total) : '—'} ₫
              </Typography>
              <Typography variant="body2">Hạn thanh toán: {draft?.dueDate ?? '—'}</Typography>
              <Alert severity="warning">
                Sau khi phát hành, hóa đơn trở thành chính thức. Máy chủ sẽ kiểm tra lại dữ liệu và
                phiên bản; thao tác này có thể tạo sự kiện thông báo đến Tenant.
              </Alert>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={finalChecked}
                    onChange={(e) => setFinalChecked(e.target.checked)}
                  />
                }
                label="Tôi đã kiểm tra đúng phòng, kỳ, số tiền và đồng ý phát hành."
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirmFinal(false)}>
              Hủy
            </Button>
            <Button
              variant="contained"
              disabled={!finalChecked || !finalReady || busy}
              onClick={() => void execute('final')}
            >
              Xác nhận phát hành
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </Paper>
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
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Hóa đơn nháp của kỳ
            </Typography>
          </Box>
          {drafts.data && (
            <Chip size="small" variant="outlined" label={`${drafts.data.totalCount} bản nháp`} />
          )}
        </Stack>
        {drafts.isPending && <LinearProgress />}
        {drafts.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void drafts.refetch()}>Thử lại bản nháp</Button>}
          >
            {invoiceError(drafts.error)}
          </Alert>
        )}
        {feedback && (
          <Alert severity={feedback.error ? 'error' : 'success'}>
            Phòng {feedback.room} · {feedback.error ?? 'Đã tính lại hóa đơn nháp.'}
          </Alert>
        )}
        {drafts.data?.totalCount === 0 && <Alert severity="info">Chưa có hóa đơn nháp.</Alert>}
        {drafts.data?.items.map((draft) => (
          <Box key={draft.id} sx={{ py: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
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
                  {activeId === draft.id ? 'Đang cập nhật…' : 'Tính lại bản nháp'}
                </Button>
              </Stack>
            </Stack>
          </Box>
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

/** Month offsets stay numeric in the API; owners choose a calendar month instead. */
function MonthChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <MenuItem value="0">Tháng này</MenuItem>
      <MenuItem value="1">Tháng sau</MenuItem>
      {value === '2' && <MenuItem value="2">Hai tháng sau (lịch đã lưu)</MenuItem>}
    </TextField>
  );
}

function scheduledDay(period: string, day: string, monthOffset: string): number | null {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
    !Number.isInteger(Number(day)) ||
    Number(day) < 1 ||
    Number(day) > 31 ||
    !['0', '1', '2'].includes(monthOffset)
  )
    return null;
  const [year, month] = period.split('-').map(Number);
  const firstOfMonth = Date.UTC(year!, month! - 1 + Number(monthOffset), 1);
  const endOfMonth = new Date(Date.UTC(year!, month! + Number(monthOffset), 0)).getUTCDate();
  return firstOfMonth + (Math.min(Number(day), endOfMonth) - 1) * 86_400_000;
}

function previewDate(value: number | null): string {
  if (value === null) return 'Chưa chọn ngày';
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function AutomationForm({
  location,
  history,
  calendar,
  saved,
}: {
  location: string;
  history: AutomationPlan[];
  calendar?: BillingSchedule;
  saved: () => void;
}) {
  const api = useInvoiceApi();
  const current = history[0];
  const schedule = current ? automationCalendar(current) : calendar;
  const [effective, setEffective] = useState(
      current?.effectiveFrom.slice(0, 7) ?? businessToday().slice(0, 7),
    ),
    [day, setDay] = useState(current ? String(current.meterDay) : ''),
    [due, setDue] = useState(current ? String(current.meterDueDay) : ''),
    [offset, setOffset] = useState(current ? String(current.meterDueMonthOffset) : '0');
  const [draftDay, setDraftDay] = useState(schedule ? String(schedule.draftDay) : ''),
    [draftOffset, setDraftOffset] = useState(schedule ? String(schedule.draftMonthOffset) : '0'),
    [finalDay, setFinalDay] = useState(schedule ? String(schedule.finalDay) : ''),
    [finalOffset, setFinalOffset] = useState(schedule ? String(schedule.finalMonthOffset) : '0');
  const [rateDate, setRateDate] = useState(
      calendar
        ? String(calendar.rateDate)
        : schedule?.rateDate != null
          ? String(schedule.rateDate)
          : '',
    ),
    [partialMonth, setPartialMonth] = useState(
      calendar
        ? String(calendar.partialMonth)
        : schedule?.partialMonth != null
          ? String(schedule.partialMonth)
          : '',
    ),
    [rounding, setRounding] = useState(
      calendar
        ? String(calendar.rounding)
        : schedule?.rounding != null
          ? String(schedule.rounding)
          : '',
    ),
    [paymentDueDay, setPaymentDueDay] = useState(schedule ? String(schedule.dueDay) : ''),
    [paymentDueOffset, setPaymentDueOffset] = useState(
      schedule ? String(schedule.dueMonthOffset) : '0',
    );
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const validDay = (value: string) =>
    Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;
  const assignmentDate = scheduledDay(effective, day, '0');
  const meterDeadline = scheduledDay(effective, due, offset);
  const draftDate = scheduledDay(effective, draftDay, draftOffset);
  const finalDate = scheduledDay(effective, finalDay, finalOffset);
  const paymentDate = scheduledDay(effective, paymentDueDay, paymentDueOffset);
  const datesOrdered =
    assignmentDate !== null &&
    meterDeadline !== null &&
    draftDate !== null &&
    finalDate !== null &&
    paymentDate !== null &&
    assignmentDate <= meterDeadline &&
    draftDate <= finalDate &&
    finalDate <= paymentDate;
  const valid =
    /^\d{4}-(0[1-9]|1[0-2])$/.test(effective) &&
    [day, due, draftDay, finalDay].every(validDay) &&
    [offset, draftOffset, finalOffset, paymentDueOffset].every((v) =>
      ['0', '1', '2'].includes(v),
    ) &&
    validDay(paymentDueDay) &&
    ['0', '1'].includes(rateDate) &&
    ['0', '1'].includes(partialMonth) &&
    ['0', '1'].includes(rounding) &&
    datesOrdered;
  return (
    <Box>
      <Stack
        component={ValidatedForm}
        spacing={1.5}
        onSubmit={(e) => {
          e.preventDefault();
          if (lock.current || !valid) return;
          lock.current = true;
          setBusy(true);
          setError('');
          setNotice('');
          void api
            .request('/api/v1/billing-automation', {
              method: 'PUT',
              body: JSON.stringify({
                locationId: location,
                effectiveFrom: effective + '-01',
                enabled: false,
                authorizeAutomaticFinalization: false,
                meterDay: Number(day),
                meterDueDay: Number(due),
                meterDueMonthOffset: Number(offset),
                draftDay: Number(draftDay),
                draftMonthOffset: Number(draftOffset),
                finalDay: Number(finalDay),
                finalMonthOffset: Number(finalOffset),
                dueDay: Number(paymentDueDay),
                dueMonthOffset: Number(paymentDueOffset),
                timeZone: 'Asia/Ho_Chi_Minh',
                expectedVersion: current?.version ?? 0,
                expectedBillingScheduleVersion: calendar?.version ?? 0,
                initialSchedule: {
                  rateDate: Number(rateDate),
                  partialMonth: Number(partialMonth),
                  rounding: Number(rounding),
                },
              }),
            })
            .then(() => {
              setNotice('Đã lưu cấu hình lịch theo kỳ bắt đầu áp dụng. Chưa bật chạy tự động.');
              saved();
            })
            .catch((e) => setError(invoiceError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Phiên bản đã lưu: {current?.version ?? 'Chưa có'} · Lịch thanh toán hiện tại:{' '}
          {calendar?.version ?? 'Chưa có'}. Mọi lần lưu ở đây đều đặt cả hai cờ tự động thành tắt.
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          <TextField
            required
            type="month"
            label="Kỳ bắt đầu áp dụng cấu hình"
            value={effective}
            onChange={(e) => setEffective(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Độc lập với kỳ kiểm thử bên dưới"
          />
          <TextField disabled value="Tắt — chạy thủ công từng bước" label="Trạng thái tự động" />
          <TextField
            required
            type="number"
            label="Ngày giao việc ghi chỉ số"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
          />
          <TextField
            required
            type="number"
            label="Ngày hết hạn ghi chỉ số"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
          />
          <MonthChoice label="Hạn ghi số thuộc tháng" value={offset} onChange={setOffset} />
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
          Mốc tạo & phát hành hóa đơn
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          <TextField
            required
            type="number"
            label="Ngày tạo hóa đơn nháp"
            value={draftDay}
            onChange={(e) => setDraftDay(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
          />
          <MonthChoice label="Tạo nháp vào tháng" value={draftOffset} onChange={setDraftOffset} />
          <TextField
            required
            type="number"
            label="Ngày phát hành chính thức"
            value={finalDay}
            onChange={(e) => setFinalDay(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
          />
          <MonthChoice label="Phát hành vào tháng" value={finalOffset} onChange={setFinalOffset} />
        </Box>
        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                Quy tắc tính tiền cho cơ sở
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {calendar
                  ? 'Có thể chỉnh sửa cách tính tiền ngay tại đây. Thay đổi chỉ áp dụng cho lịch mới, không sửa hóa đơn đã phát hành.'
                  : 'Chọn quy tắc và hạn thanh toán tại đây; hệ thống sẽ tạo lịch nền cùng lịch giao việc trong một lần lưu. Giá thuê lấy theo hợp đồng.'}
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              <TextField
                select
                required
                label="Mốc tham chiếu kỳ"
                value={rateDate}
                onChange={(e) => setRateDate(e.target.value)}
              >
                <MenuItem value="">Chọn mốc tham chiếu</MenuItem>
                <MenuItem value="0">Ngày đầu tháng</MenuItem>
                <MenuItem value="1">Ngày cuối tháng</MenuItem>
              </TextField>
              <TextField
                select
                required
                label="Phí cố định khi ở không đủ tháng"
                value={partialMonth}
                onChange={(e) => setPartialMonth(e.target.value)}
              >
                <MenuItem value="">Chọn cách tính</MenuItem>
                <MenuItem value="0">Thu cả tháng</MenuItem>
                <MenuItem value="1">Theo số ngày ở</MenuItem>
              </TextField>
              <TextField
                select
                required
                label="Làm tròn từng khoản VND"
                value={rounding}
                onChange={(e) => setRounding(e.target.value)}
              >
                <MenuItem value="">Chọn cách làm tròn</MenuItem>
                <MenuItem value="0">0,5 làm tròn lên</MenuItem>
                <MenuItem value="1">0,5 làm tròn về số chẵn</MenuItem>
              </TextField>
            </Box>
          </Stack>
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
          Hạn thanh toán
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          <TextField
            required
            type="number"
            label="Ngày hạn thanh toán"
            value={paymentDueDay}
            onChange={(e) => setPaymentDueDay(e.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
          />
          <MonthChoice
            label="Hạn thanh toán thuộc tháng"
            value={paymentDueOffset}
            onChange={setPaymentDueOffset}
          />
        </Box>
        <Box
          sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.5 }}
          aria-label="Xem trước lịch thực hiện"
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 750, mb: 1 }}>
            Xem trước ngày thực hiện · kỳ{' '}
            {/^\d{4}-\d{2}$/.test(effective)
              ? effective.slice(5) + '/' + effective.slice(0, 4)
              : 'chưa chọn'}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            {(
              [
                ['Giao nhiệm vụ ghi số', assignmentDate],
                ['Hạn ghi chỉ số', meterDeadline],
                ['Tạo hóa đơn nháp', draftDate],
                ['Phát hành chính thức', finalDate],
                ['Hạn thanh toán', paymentDate],
              ] as const
            ).map(([label, dateValue]) => (
              <Typography key={label} variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {label}:{' '}
                </Box>
                <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {previewDate(dateValue)}
                </Box>
              </Typography>
            ))}
          </Box>
          {!datesOrdered && (
            <Typography color="error" variant="body2" sx={{ mt: 1 }}>
              Ngày đang thiếu hoặc chưa theo đúng thứ tự. Kiểm tra các mốc trước khi lưu.
            </Typography>
          )}
        </Box>
        {!calendar && (
          <Alert severity="info">
            Chưa có lịch nền. Lần lưu đầu tiên sẽ tạo cả quy tắc tính tiền và lịch xử lý tại đây.
          </Alert>
        )}
        {!valid && (
          <Typography variant="caption" color="error">
            Kiểm tra kỳ, các ngày 1–31 và thứ tự giao việc/hạn ghi số/nháp/phát hành/hạn thanh toán.
          </Typography>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Button
          type="submit"
          variant="contained"
          sx={{ alignSelf: 'flex-start' }}
          disabled={busy || !valid}
        >
          {busy
            ? 'Đang lưu lịch…'
            : !calendar
              ? 'Tạo lịch (không kích hoạt tự động)'
              : 'Lưu lịch (không kích hoạt tự động)'}
        </Button>
        {history.length > 0 && (
          <Box component="details">
            <Box component="summary" sx={{ cursor: 'pointer', fontWeight: 700 }}>
              Lịch sử cấu hình ({history.length} phiên bản)
            </Box>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {history.map((p) => (
                <Typography key={p.id} variant="body2">
                  v{p.version} · từ {p.effectiveFrom} ·{' '}
                  {p.enabled ? 'Đang bật tự động' : 'Tự động tắt'} · phát hành tự động:{' '}
                  {p.authorizeAutomaticFinalization ? 'Có' : 'Không'} · {date(p.recordedAt)}
                </Typography>
              ))}
            </Stack>
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
