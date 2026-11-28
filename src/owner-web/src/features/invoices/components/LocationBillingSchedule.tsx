import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  LinearProgress,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { TextField, ValidatedForm } from '../../../components/common/ValidatedForm';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { businessToday } from '../../../../../../packages/client-core/src/contracts';
import {
  invoiceError,
  type BillingSchedule,
} from '../../../../../../packages/client-core/src/invoices';
import {
  automationCalendar,
  type AutomationPlan,
} from '../../../../../../packages/client-core/src/billingAutomation';
import { useInvoiceApi } from '../hooks/useInvoiceApi';
import { locationBillingSettingsPath } from '../utils/locationBillingSettingsPath';

const milestones = [
  { label: 'Giao nhiệm vụ ghi số', day: 'meterDay', offset: null },
  { label: 'Hạn ghi chỉ số', day: 'meterDueDay', offset: 'meterDueMonthOffset' },
  { label: 'Lập hóa đơn nháp', day: 'draftDay', offset: 'draftMonthOffset' },
  { label: 'Phát hành hóa đơn chính thức', day: 'finalDay', offset: 'finalMonthOffset' },
  { label: 'Hạn thanh toán', day: 'dueDay', offset: 'dueMonthOffset' },
] as const;

const offsetLabels = ['Trong kỳ', 'Kỳ kế tiếp'];

function useSchedule(location: string) {
  const api = useInvoiceApi();
  const { session } = useAuth();
  return useQuery({
    queryKey: ['manual-billing-schedule', session?.userId, location],
    queryFn: async ({ signal }) => {
      const [history, calendar] = await Promise.all([
        api.request<AutomationPlan[]>(
          `/api/v1/billing-automation/${encodeURIComponent(location)}/history`,
          { signal },
        ),
        api.schedule(location, signal),
      ]);
      if (!Array.isArray(history)) throw new Error('Không tải được lịch cơ sở.');
      const period = businessToday().slice(0, 7);
      const [year, month] = period.split('-').map(Number);
      const sorted = [...history].sort(
        (a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version,
      );
      const currentPlan = sorted.find((p) => p.effectiveFrom.slice(0, 7) <= period);
      const previewPeriod = currentPlan
        ? new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 7)
        : period;
      const plan = sorted.find((p) => p.effectiveFrom.slice(0, 7) <= previewPeriod);
      const laterPlan = sorted.filter((p) => p.effectiveFrom.slice(0, 7) > previewPeriod).at(-1);
      const effective = plan ? automationCalendar(plan) : calendar;
      if (plan && !effective) throw new Error('Không đọc được lịch đã lưu.');
      const latestVersion = Math.max(0, ...history.map((p) => p.version));
      return { plan, calendar, effective, currentPlan, previewPeriod, latestVersion, laterPlan };
    },
  });
}

function scheduleValues(plan?: AutomationPlan, calendar?: BillingSchedule | null) {
  return {
    meterDay: plan ? String(plan.meterDay) : '',
    meterDueDay: plan ? String(plan.meterDueDay) : '',
    meterDueMonthOffset: String(plan?.meterDueMonthOffset ?? 0),
    draftDay: calendar ? String(calendar.draftDay) : '',
    draftMonthOffset: String(calendar?.draftMonthOffset ?? 0),
    finalDay: calendar ? String(calendar.finalDay) : '',
    finalMonthOffset: String(calendar?.finalMonthOffset ?? 0),
    dueDay: calendar ? String(calendar.dueDay) : '',
    dueMonthOffset: String(calendar?.dueMonthOffset ?? 1),
  };
}

type Values = ReturnType<typeof scheduleValues>;

function datesFor(period: string, values: Values) {
  const [year, month] = period.split('-').map(Number);
  return milestones.map(({ day, offset }) => {
    const d = Number(values[day]);
    const o = offset ? Number(values[offset]) : 0;
    if (!Number.isInteger(d) || d < 1 || d > 31 || !Number.isInteger(o) || o < 0 || o > 1)
      return null;
    const last = new Date(Date.UTC(year!, month! + o, 0)).getUTCDate();
    return new Date(Date.UTC(year!, month! - 1 + o, Math.min(d, last)));
  });
}

function ordered(dates: (Date | null)[]) {
  return dates.every((d, i) => d !== null && (i === 0 || dates[i - 1]!.getTime() <= d.getTime()));
}

export function LocationBillingSchedule({
  location,
  disabled = false,
}: {
  location: string;
  disabled?: boolean;
}) {
  const settings = useSchedule(location);
  const cache = useQueryClient();
  const [notice, setNotice] = useState('');
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>
          Cấu hình lịch điện nước & hóa đơn
        </Typography>
        {settings.isPending && <LinearProgress />}
        {settings.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void settings.refetch()}>Thử lại</Button>}
          >
            {invoiceError(settings.error)}
          </Alert>
        )}
        {notice && <Alert severity="success">{notice}</Alert>}
        {settings.data && !settings.error && (
          <ScheduleEditor
            key={`${settings.data.latestVersion}:${settings.data.calendar?.version ?? 0}:${settings.data.previewPeriod}`}
            location={location}
            plan={settings.data.plan}
            calendar={settings.data.calendar}
            effective={settings.data.effective}
            currentPlan={settings.data.currentPlan}
            previewPeriod={settings.data.previewPeriod}
            latestVersion={settings.data.latestVersion}
            laterPlan={settings.data.laterPlan}
            onEdit={() => setNotice('')}
            disabled={disabled || settings.isFetching}
            reload={async () => {
              await settings.refetch();
            }}
            onSaved={async () => {
              setNotice('Đã lưu cấu hình lịch.');
              await Promise.all([
                cache.invalidateQueries({ queryKey: ['manual-billing-schedule'] }),
                cache.invalidateQueries({ queryKey: ['automation'] }),
                cache.invalidateQueries({ queryKey: ['billing-schedule'] }),
                cache.invalidateQueries({ queryKey: ['automation-drafts'] }),
              ]);
            }}
          />
        )}
      </Stack>
    </Paper>
  );
}

function ScheduleEditor({
  location,
  plan,
  calendar,
  effective,
  currentPlan,
  previewPeriod,
  latestVersion,
  laterPlan,
  onEdit,
  disabled,
  reload,
  onSaved,
}: {
  location: string;
  plan?: AutomationPlan;
  calendar?: BillingSchedule;
  effective?: BillingSchedule | null;
  currentPlan?: AutomationPlan;
  previewPeriod: string;
  latestVersion: number;
  laterPlan?: AutomationPlan;
  onEdit: () => void;
  disabled: boolean;
  reload: () => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const api = useInvoiceApi();
  const [values, setValues] = useState(() => scheduleValues(plan, effective));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const dates = datesFor(previewPeriod, values);
  const invalidOffset = milestones.find(
    ({ offset }) => offset && !['0', '1'].includes(values[offset]),
  );
  const invalidDay = milestones.find(
    ({ day }) =>
      !Number.isInteger(Number(values[day])) || Number(values[day]) < 1 || Number(values[day]) > 31,
  );
  const dateSets = [previewPeriod, '2027-02', '2028-02', '2026-12'].map((p) => datesFor(p, values));
  const invalidOrder = milestones.findIndex(
    (_, i) =>
      i > 0 &&
      dateSets.some(
        (set) =>
          set[i] !== null && set[i - 1] !== null && set[i]!.getTime() < set[i - 1]!.getTime(),
      ),
  );
  const valid = !invalidOffset && !invalidDay && dateSets.every(ordered);
  const validationMessage = invalidOffset
    ? invalidOffset.label + ': chọn Trong kỳ hoặc Kỳ kế tiếp.'
    : invalidDay
      ? invalidDay.label + ': chọn ngày từ 1 đến 31.'
      : invalidOrder > 0
        ? milestones[invalidOrder]!.label +
          ' không được trước ' +
          milestones[invalidOrder - 1]!.label.toLocaleLowerCase('vi') +
          '.'
        : 'Kiểm tra các mốc thời gian.';
  const update = (key: keyof Values, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    onEdit();
    setError('');
  };
  return (
    <Stack
      component={ValidatedForm}
      spacing={1.5}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || lock.current || !valid) return;
        lock.current = true;
        setBusy(true);
        setError('');
        void api
          .request(`/api/v1/billing-automation/${encodeURIComponent(location)}/schedule`, {
            method: 'PUT',
            body: JSON.stringify({
              ...Object.fromEntries(
                Object.entries(values).map(([key, value]) => [key, Number(value)]),
              ),
              expectedVersion: latestVersion,
              expectedBillingScheduleVersion: calendar?.version ?? 0,
            }),
          })
          .then(onSaved)
          .catch((cause) => setError(invoiceError(cause)))
          .finally(() => {
            lock.current = false;
            setBusy(false);
          });
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {currentPlan
          ? 'Lịch tháng đang chạy được giữ nguyên. Thay đổi áp dụng từ kỳ '
          : 'Cấu hình đầu tiên áp dụng từ kỳ '}
        <strong>
          {previewPeriod.slice(5)}/{previewPeriod.slice(0, 4)}
        </strong>
        .
      </Typography>
      {laterPlan && (
        <Alert severity="info">
          Có lịch đã lên trước từ kỳ {laterPlan.effectiveFrom.slice(5, 7)}/
          {laterPlan.effectiveFrom.slice(0, 4)}; lịch đó vẫn được giữ.
        </Alert>
      )}
      {milestones.map(({ label, day, offset }, i) => (
        <Box
          key={day}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(0, 1fr) 116px 144px 98px' },
            alignItems: 'center',
            gap: 1.25,
          }}
        >
          <Typography
            component="span"
            variant="body2"
            sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, fontWeight: 600 }}
          >
            {label}
          </Typography>
          <TextField
            type="number"

            value={values[day]}
            onChange={(e) => update(day, e.target.value)}
            required
            size="small"
            disabled={disabled || busy}
            slotProps={{
              htmlInput: { min: 1, max: 31, 'aria-label': 'Ngày ' + label.toLocaleLowerCase('vi') },
              input: { startAdornment: <InputAdornment position="start">Ngày</InputAdornment> },
            }}
          />
          {offset ? (
            <TextField
              select
              size="small"
              value={['0', '1'].includes(values[offset]) ? values[offset] : ''}

              onChange={(e) => update(offset, e.target.value)}
              disabled={disabled || busy}
              slotProps={{
                select: {
                  displayEmpty: true,
                  inputProps: { 'aria-label': 'Thời điểm ' + label.toLocaleLowerCase('vi') },
                },
              }}
            >
              {!['0', '1'].includes(values[offset]) && (
                <MenuItem value="" disabled>
                  Chọn lại kỳ
                </MenuItem>
              )}
              {offsetLabels.map((text, index) => (
                <MenuItem key={text} value={String(index)}>
                  {text}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Trong kỳ
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              gridColumn: { xs: '1 / -1', sm: 'auto' },
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {dates[i]?.toLocaleDateString('vi-VN', {
              timeZone: 'UTC',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            }) ?? 'Chưa chọn ngày'}
          </Typography>
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary">
        Xem trước kỳ {previewPeriod.slice(5)}/{previewPeriod.slice(0, 4)}. Ngày vượt quá số ngày
        trong tháng được tính vào ngày cuối tháng.
      </Typography>
      {!valid && (
        <Typography variant="caption" color="error">
          {validationMessage}
        </Typography>
      )}
      {error && (
        <Alert severity="error" action={<Button onClick={() => void reload()}>Tải lại</Button>}>
          {error}
        </Alert>
      )}
      <Divider />
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="contained" disabled={disabled || busy || !valid}>
          {busy ? 'Đang lưu…' : 'Lưu cấu hình lịch'}
        </Button>
      </Stack>
    </Stack>
  );
}

/** The operations page reads the same schedule; only Location Settings edits it. */
export function LocationBillingScheduleSummary({ location }: { location: string }) {
  const settings = useSchedule(location);
  const plan = settings.data?.currentPlan;
  const values = scheduleValues(plan, plan ? automationCalendar(plan) : undefined);
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <Typography component="h2" variant="h6" sx={{ fontWeight: 750 }}>
            Cấu hình lịch
          </Typography>
          <Button component={Link} to={locationBillingSettingsPath(location)}>
            Thiết lập lịch tại cơ sở
          </Button>
        </Stack>
        {settings.isPending && <LinearProgress />}
        {settings.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void settings.refetch()}>Thử lại cấu hình</Button>}
          >
            {invoiceError(settings.error)}
          </Alert>
        )}
        {settings.data && !plan && (
          <Typography color="text.secondary">
            Chưa có lịch điện nước & hóa đơn áp dụng cho kỳ hiện tại.
          </Typography>
        )}
        {plan && (
          <>
            <Typography variant="body2" color="text.secondary">
              Lịch kỳ hiện tại ·{' '}
              {plan.enabled ? 'Đã cấu hình chạy tự động' : 'Chưa kích hoạt chạy tự động'}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              {milestones.map(({ label, day, offset }) => (
                <Box key={day}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {values[day]
                      ? `Ngày ${values[day]} · ${offsetLabels[offset ? Number(values[offset]) : 0] ?? 'Kỳ cũ (+' + (offset ? values[offset] : '0') + ' tháng)'}`
                      : 'Chưa có'}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
      </Stack>
    </Paper>
  );
}
