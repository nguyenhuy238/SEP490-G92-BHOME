import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Checkbox,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { OwnerFeedback, OwnerTable } from '../../../components/common/OwnerWorkspace';
import { OwnerLocationPicker } from '../../../components/common/OwnerSelectors';
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import {
  vietnamDateInput,
  vietnamInstant,
  type RecurringTemplate,
  type TaskWork,
} from '../taskContracts';
import { useTaskAction } from '../useOperationalTasksApi';
import { TaskWorkFields } from './TaskEditorDialog';
const root = '/api/v1/operational-task-templates';
const weekDays = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];
const scheduleLabel = (item: RecurringTemplate) =>
  item.scheduleType === 'Daily'
    ? 'Hằng ngày'
    : item.scheduleType === 'Weekly'
      ? `Hằng tuần · ${weekDays[(item.dayOfWeek ?? 1) - 1] ?? 'Chưa xác định'}`
      : item.scheduleType === 'Monthly'
        ? `Hằng tháng · Ngày ${item.dayOfMonth ?? '—'}`
        : `Mỗi ${item.intervalDays} ngày`;
export function RecurringTasks({
  location,
  change,
  locationName,
  notify,
}: {
  location: string;
  change: (id: string) => void;
  locationName: (id: string) => string;
  notify: (message: string) => void;
}) {
  const list = useOwnerQuery<RecurringTemplate[]>(
    ['recurring-tasks', location],
    `${root}?locationId=${location}`,
    !!location,
  );
  const [editor, setEditor] = useState<RecurringTemplate | null | undefined>();
  const [command, setCommand] = useState<{ item: RecurringTemplate; mode: 'toggle' | 'delete' }>();
  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between' }}
      >
        <Box>
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>Lịch công việc định kỳ</Typography>
        </Box>
        <Button variant="contained" disabled={!location} onClick={() => setEditor(null)}>
          Tạo lịch định kỳ
        </Button>
      </Stack>
      <OwnerLocationPicker simple value={location} change={change} />
      {!location ? (
        <Typography>Chọn cơ sở để xem và tạo lịch định kỳ.</Typography>
      ) : (
        <>
          <OwnerFeedback busy={list.isFetching} error={list.error} />
          <Button onClick={() => void list.refetch()}>Làm mới lịch</Button>
          <OwnerTable
            rows={list.data ?? []}
            loading={list.isPending}
            error={list.error}
            retry={() => void list.refetch()}
            id={(item) => item.id}
            columns={[
              {
                label: 'Tên công việc',
                render: (item) => (
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{item.title}</Typography>
                ),
              },
              { label: 'Cơ sở', render: () => locationName(location) },
              {
                label: 'Chu kỳ',
                render: scheduleLabel,
              },
              { label: 'Lần tạo tiếp theo', render: (item) => formatInstant(item.nextRunAt) },
              { label: 'Hạn hoàn thành', render: (item) => `${item.dueAfterHours} giờ` },
              { label: 'Trạng thái', render: (item) => (item.isActive ? 'Đang bật' : 'Đã tắt') },
              {
                label: 'Thao tác',
                render: (item) => (
                  <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <Button onClick={() => setEditor(item)}>Chỉnh sửa</Button>
                    <Button onClick={() => setCommand({ item, mode: 'toggle' })}>
                      {item.isActive ? 'Tắt lịch' : 'Bật lịch'}
                    </Button>
                    <Button color="error" onClick={() => setCommand({ item, mode: 'delete' })}>
                      Xóa
                    </Button>
                  </Stack>
                ),
              },
            ]}
          />
        </>
      )}
      {editor !== undefined && (
        <RecurringEditor
          key={editor?.id ?? 'new'}
          template={editor}
          location={location}
          close={() => setEditor(undefined)}
          reload={async () => (await list.refetch()).data}
          notify={notify}
        />
      )}{' '}
      {command && (
        <TemplateCommand
          key={command.item.id + command.mode}
          {...command}
          close={() => setCommand(undefined)}
          reload={async () => (await list.refetch()).data}
          notify={notify}
        />
      )}
    </Stack>
  );
}
function TemplateCommand({
  item,
  mode,
  close,
  reload,
  notify,
}: {
  item: RecurringTemplate;
  mode: 'toggle' | 'delete';
  close: () => void;
  reload: () => Promise<RecurringTemplate[] | undefined>;
  notify: (message: string) => void;
}) {
  const action = useTaskAction();
  const [current, setCurrent] = useState(item);
  const [missing, setMissing] = useState(false);
  const { id, ...write } = current;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="xs"
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>
        {mode === 'delete'
          ? 'Xóa lịch định kỳ'
          : item.isActive
            ? 'Tắt lịch định kỳ'
            : 'Bật lịch định kỳ'}
      </DialogTitle>
      <DialogContent>
        <OwnerFeedback error={action.error} busy={action.busy} />
        <Typography>{current.title}</Typography>
        <Typography sx={{ fontSize: 14, mt: 1 }}>
          Các công việc đã tạo và lịch sử vẫn được giữ nguyên.
        </Typography>
        {action.conflict && (
          <Alert severity="warning">
            Mẫu đã thay đổi.
            <Button
              onClick={async () => {
                const latest = (await reload())?.find((x) => x.id === item.id);
                if (latest) {
                  setCurrent(latest);
                  action.reviewed();
                } else setMissing(true);
              }}
            >
              Tải dữ liệu mới
            </Button>
          </Alert>
        )}
        {missing && (
          <Alert severity="error">Không tìm thấy mẫu. Đóng hộp thoại để kiểm tra danh sách.</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button
          color={mode === 'delete' ? 'error' : 'primary'}
          variant="contained"
          disabled={action.busy || action.conflict || missing}
          onClick={() =>
            void action
              .run(() =>
                action.command(
                  mode === 'delete'
                    ? `${root}/${id}?locationId=${current.locationId}&version=${current.version}`
                    : `${root}/${id}`,
                  mode === 'delete' ? 'DELETE' : 'PUT',
                  mode === 'delete' ? undefined : { ...write, isActive: !item.isActive },
                ),
              )
              .then((ok) => {
                if (ok) {
                  notify('Đã cập nhật lịch định kỳ.');
                  close();
                }
              })
          }
        >
          Xác nhận
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function RecurringEditor({
  template,
  location,
  close,
  reload,
  notify,
}: {
  template: RecurringTemplate | null;
  location: string;
  close: () => void;
  reload: () => Promise<RecurringTemplate[] | undefined>;
  notify: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState(template);
  const [work, setWork] = useState<TaskWork>({
    title: template?.title ?? '',
    requirements: template?.requirements ?? '',
    priority: template?.priority ?? 'Normal',
    evidenceRequired: template?.evidenceRequired ?? false,
    dueAt: '',
  });
  const [days, setDays] = useState(template?.intervalDays ?? 1),
    [hours, setHours] = useState(template?.dueAfterHours ?? 24),
    [next, setNext] = useState(vietnamDateInput(template?.nextRunAt ?? '')),
    [active, setActive] = useState(template?.isActive ?? true),
    [missing, setMissing] = useState(false);
  const action = useTaskAction();
  const [scheduleType, setScheduleType] = useState<NonNullable<RecurringTemplate['scheduleType']>>(
    template?.scheduleType ?? 'IntervalDays',
  );
  const [dayOfWeek, setDayOfWeek] = useState(template?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(template?.dayOfMonth ?? 1);
  const interval = scheduleType === 'Weekly' ? 7 : scheduleType === 'IntervalDays' ? days : 1;
  const nextDate = new Date(next.slice(0, 10) + 'T00:00:00Z');
  const calendarMismatch =
    !!next &&
    ((scheduleType === 'Weekly' && (nextDate.getUTCDay() || 7) !== dayOfWeek) ||
      (scheduleType === 'Monthly' && nextDate.getUTCDate() !== dayOfMonth));
  const valid =
    work.title.trim() &&
    work.requirements.trim() &&
    Number.isInteger(interval) &&
    interval >= 1 &&
    interval <= 365 &&
    Number.isInteger(hours) &&
    hours >= 1 &&
    hours <= 720 &&
    next &&
    Number.isFinite(Date.parse(next + ':00+07:00')) &&
    !calendarMismatch &&
    (scheduleType !== 'Monthly' ||
      (Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31));
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>{template ? 'Chỉnh sửa lịch định kỳ' : 'Tạo lịch định kỳ'}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="recurring-editor"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || action.conflict || missing) return;
            const fields = {
              title: work.title,
              requirements: work.requirements,
              priority: work.priority,
              evidenceRequired: work.evidenceRequired,
            };
            void action
              .run(() =>
                action.command(
                  root + (template ? `/${template.id}` : ''),
                  template ? 'PUT' : 'POST',
                  {
                    ...fields,
                    locationId: location,
                    intervalDays: interval,
                    nextRunAt: vietnamInstant(next),
                    dueAfterHours: hours,
                    isActive: active,
                    version: snapshot?.version ?? 0,
                    scheduleType,
                    dayOfWeek: scheduleType === 'Weekly' ? dayOfWeek : null,
                    dayOfMonth: scheduleType === 'Monthly' ? dayOfMonth : null,
                  },
                ),
              )
              .then((ok) => {
                if (ok) {
                  notify('Đã lưu lịch định kỳ.');
                  close();
                }
              });
          }}
        >
          <OwnerFeedback error={action.error} busy={action.busy} />
          <TaskWorkFields work={work} change={setWork} includeDue={false} errors={action.fields} />
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Cấu hình định kỳ</Typography>
          <TextField
            select
            label="Chu kỳ"
            value={scheduleType}
            onChange={(e) =>
              setScheduleType(e.target.value as NonNullable<RecurringTemplate['scheduleType']>)
            }
          >
            <MenuItem value="Daily">Hằng ngày</MenuItem>
            <MenuItem value="Weekly">Hằng tuần</MenuItem>
            <MenuItem value="Monthly">Hằng tháng</MenuItem>
            <MenuItem value="IntervalDays">Mỗi N ngày</MenuItem>
          </TextField>
          {scheduleType === 'Weekly' && (
            <TextField
              select
              label="Ngày trong tuần"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
            >
              {weekDays.map((day, index) => (
                <MenuItem key={day} value={index + 1}>
                  {day}
                </MenuItem>
              ))}
            </TextField>
          )}
          {scheduleType === 'Monthly' && (
            <TextField
              required
              type="number"
              label="Ngày trong tháng"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
              helperText="Tháng không có ngày đã chọn sẽ được bỏ qua."
            />
          )}
          {scheduleType === 'IntervalDays' && (
            <TextField
              required
              type="number"
              label="Mỗi bao nhiêu ngày"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
            />
          )}
          <TextField
            required
            type="datetime-local"
            label="Thời điểm sinh việc tiếp theo (giờ Việt Nam)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={calendarMismatch}
            helperText={
              calendarMismatch
                ? 'Thời điểm đầu tiên phải đúng ngày trong chu kỳ đã chọn.'
                : undefined
            }
          />
          <TextField
            required
            type="number"
            label="Thời gian hoàn thành (giờ)"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            slotProps={{ htmlInput: { min: 1, max: 720 } }}
          />
          <FormControlLabel
            label="Lịch đang bật"
            control={<Checkbox checked={active} onChange={(_, v) => setActive(v)} />}
          />
          {action.conflict && (
            <Alert severity="warning">
              Mẫu đã thay đổi. Nội dung nhập được giữ nguyên.
              <Button
                onClick={async () => {
                  const latest = (await reload())?.find((item) => item.id === template?.id);
                  if (latest) {
                    setSnapshot(latest);
                    action.reviewed();
                  } else setMissing(true);
                }}
              >
                Tải dữ liệu mới
              </Button>
            </Alert>
          )}
          {missing && <Alert severity="error">Không tìm thấy mẫu.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button
          variant="contained"
          type="submit"
          form="recurring-editor"
          disabled={action.busy || action.conflict || !valid || missing}
        >
          Lưu mẫu
        </Button>
      </DialogActions>
    </Dialog>
  );
}
