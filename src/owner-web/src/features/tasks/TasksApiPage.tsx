import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { PageHeader, StatusChip, ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import { OwnerLocationPicker } from '../../components/common/OwnerSelectors';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { useMeterApi } from '../meters/useMeterApi';
import { downloadOwnerFile } from '../../services/ownerDownloads';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import {
  taskStatus,
  vietnamDateInput,
  vietnamInstant,
  type OwnerTask,
  type TaskWork,
  type TaskHistory,
  type TaskActor,
  type TaskEvidence,
  type RecurringTemplate,
} from './taskContracts';
import { todayVietnam, type Staff, type StaffAssignment } from '../staff/staffContracts';
import type { OwnerLocation } from '../../hooks/useOwnerWorkspace';
const root = '/api/v1/operational-tasks';
const emptyWork: TaskWork = {
  title: '',
  requirements: '',
  priority: 'Normal',
  dueAt: '',
  evidenceRequired: false,
};
export function TasksApiPage() {
  const [params] = useSearchParams();
  const [location, setLocation] = useState(''),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [priority, setPriority] = useState(''),
    [staffUserId, setStaffUserId] = useState(''),
    [overdue, setOverdue] = useState(false),
    [id, setId] = useState(params.get('taskId') ?? ''),
    [editor, setEditor] = useState<OwnerTask | null | undefined>();
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const list = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['tasks', location, staffUserId, status, priority, overdue, from, to, page],
    root +
      '?' +
      ownerQuery({
        locationId: location,
        staffUserId,
        status,
        priority,
        isOverdue: overdue || undefined,
        dueFrom: from ? vietnamInstant(from) : '',
        dueTo: to ? vietnamInstant(to) : '',
        page,
        pageSize: 20,
      }),
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['task-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
  );
  const locationDirectory = useOwnerQuery<OwnerPage<OwnerLocation>>(
    ['task-location-directory'],
    '/api/v1/locations?page=1&pageSize=100',
  );
  const staffName = (id: string | null) => displayStaffName(staffDirectory.data?.items, id);
  const locationName = (id: string) =>
    locationDirectory.data?.items.find((item) => item.id === id)?.name ?? id;
  const hasFilters = Boolean(
    location || staffUserId || status || priority || overdue || from || to,
  );
  const clearFilters = () => {
    setLocation('');
    setStaffUserId('');
    setStatus('');
    setPriority('');
    setOverdue(false);
    setFrom('');
    setTo('');
    setPage(1);
  };
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Công việc vận hành"
        subtitle="Giao việc theo cơ sở, phối hợp và nghiệm thu kết quả."
        actions={
          <Button variant="contained" onClick={() => setEditor(null)}>
            Tạo công việc
          </Button>
        }
      />
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Bộ lọc công việc
          </Typography>
          <OwnerLocationPicker
            simple
            value={location}
            change={(v) => {
              setLocation(v);
              setPage(1);
            }}
          />
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ flexWrap: 'wrap', alignItems: { md: 'center' } }}
          >
            <TextField
              sx={{ minWidth: 220, flex: '1 1 220px' }}
              select
              label="Staff phụ trách"
              value={staffUserId}
              onChange={(e) => {
                setStaffUserId(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả Staff</MenuItem>
              {staffDirectory.data?.items.map((staff) => (
                <MenuItem key={staff.userId} value={staff.userId}>
                  {staff.fullName} {staff.isActive ? '' : '(Đã ngừng)'}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              sx={{ minWidth: 220, flex: '1 1 220px' }}
              select
              label="Trạng thái công việc"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả</MenuItem>
              {['Assigned', 'InProgress', 'Completed', 'Cancelled', 'PendingVerification'].map(
                (v, i) => (
                  <MenuItem key={v} value={String(i)}>
                    {taskStatus[v]}
                  </MenuItem>
                ),
              )}
            </TextField>
            <TextField
              sx={{ minWidth: 180, flex: '1 1 180px' }}
              select
              label="Ưu tiên"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả</MenuItem>
              <MenuItem value="0">Bình thường</MenuItem>
              <MenuItem value="1">Cao</MenuItem>
            </TextField>
            <FormControlLabel
              label="Chỉ quá hạn"
              control={
                <Checkbox
                  checked={overdue}
                  onChange={(_, v) => {
                    setOverdue(v);
                    setPage(1);
                  }}
                />
              }
            />
            <Button onClick={() => void list.refetch()}>Tải lại</Button>
            <Button disabled={!hasFilters} onClick={clearFilters}>
              Xóa bộ lọc
            </Button>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
            <TextField
              sx={{ minWidth: 260, flex: '1 1 260px' }}
              type="datetime-local"
              label="Hạn từ (giờ Việt Nam)"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              sx={{ minWidth: 260, flex: '1 1 260px' }}
              type="datetime-local"
              label="Hạn đến (giờ Việt Nam)"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: from } }}
            />
          </Stack>
        </Stack>
      </Paper>
      <OwnerFeedback busy={list.isFetching} error={list.error} />
      <Paper>
        <OwnerTable
          rows={list.data?.items ?? []}
          id={(x) => x.id}
          select={(x) => setId(x.id)}
          columns={[
            { label: 'Công việc', render: (x) => x.title },
            { label: 'Cơ sở', render: (x) => locationName(x.locationId) },
            {
              label: 'Trạng thái',
              render: (x) => <StatusChip label={taskStatus[x.status] ?? x.status} />,
            },
            {
              label: 'Thời hạn',
              render: (x) =>
                `${x.dueAt ? formatInstant(x.dueAt) : 'Chưa có hạn'}${x.isOverdue ? ' · Quá hạn' : ''}`,
            },
            { label: 'Ưu tiên', render: (x) => x.priority },
            {
              label: 'Người phụ trách',
              render: (x) =>
                x.responsibilityAvailable
                  ? staffName(x.currentResponsibleStaffUserId)
                  : 'Chưa có người phụ trách',
            },
          ]}
        />
      </Paper>
      <OwnerPagination
        page={page}
        total={list.data?.totalCount ?? 0}
        change={setPage}
        busy={list.isFetching}
      />
      {id && (
        <TaskDetail
          key={id}
          id={id}
          close={() => setId('')}
          edit={setEditor}
          locationName={locationName}
        />
      )}
      {location && <RecurringTemplates key={location} location={location} />}
      {editor !== undefined && (
        <TaskEditor task={editor} initialLocation={location} close={() => setEditor(undefined)} />
      )}
    </Stack>
  );
}
function TaskDetail({
  id,
  close,
  edit,
  locationName,
}: {
  id: string;
  close: () => void;
  edit: (task: OwnerTask) => void;
  locationName: (id: string) => string;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1),
    [operation, setOperation] = useState(''),
    [note, setNote] = useState('');
  const detail = useOwnerQuery<OwnerTask>(['task', id], `${root}/${id}`);
  const history = useOwnerQuery<OwnerPage<TaskHistory>>(
    ['task-history', id, page],
    `${root}/${id}/history?page=${page}&pageSize=20`,
    !!detail.data,
  );
  const evidence = useOwnerQuery<TaskEvidence[]>(
    ['task-evidence', id],
    `${root}/${id}/evidence`,
    !!detail.data,
  );
  const actors = useOwnerQuery<TaskActor[]>(
    ['task-actors', id],
    `${root}/${id}/actors`,
    !!detail.data,
  );
  const { request } = useMeterApi();
  const action = useOwnerAction();
  const task = detail.data;
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['task-detail-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
  );
  const staffName = (userId: string | null) => displayStaffName(staffDirectory.data?.items, userId);
  const actorName = (userId: string | null) =>
    userId
      ? (actors.data?.find((item) => item.userId === userId)?.displayName ?? staffName(userId))
      : 'Chưa có';
  const mutable = task?.kind === 'AdHoc' && !['Completed', 'Cancelled'].includes(task.status);
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <OwnerFeedback
          busy={
            detail.isFetching ||
            history.isFetching ||
            evidence.isFetching ||
            actors.isFetching ||
            action.busy
          }
          error={action.error || detail.error || history.error || evidence.error || actors.error}
          notice={action.notice}
        />
        {task && (
          <>
            <Typography variant="h6">
              {task.title} · {taskStatus[task.status] ?? task.status}
            </Typography>
            <Alert severity={task.isOverdue ? 'error' : 'info'}>
              Cơ sở: {locationName(task.locationId)} · Thời hạn:{' '}
              {task.dueAt ? formatInstant(task.dueAt) : 'Chưa đặt'}
              {task.isOverdue ? ' · Đã quá hạn' : ''}
            </Alert>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{task.requirements}</Typography>
            <Typography>
              Kết quả: {task.result ?? 'Chưa gửi'} · Phiên bản {task.version}
            </Typography>
            <Typography>
              Người phụ trách hiện tại: {staffName(task.currentResponsibleStaffUserId)} · Khi giao:{' '}
              {staffName(task.recordedStaffUserId)}
            </Typography>
            <Alert severity="info">
              Người thực hiện được xác định theo phân công Staff đang có hiệu lực tại cơ sở. Để đổi
              người, cập nhật phân công tại mục Nhân viên; các công việc đang mở sẽ được chuyển theo
              phân công mới.
            </Alert>
            <Button variant="outlined" onClick={() => navigate('/staff')}>
              Mở quản lý phân công Staff
            </Button>
            <Typography variant="subtitle1">Tiến độ công việc</Typography>
            <Typography>
              Trạng thái hiện tại: {taskStatus[task.status] ?? task.status} · Phiên bản{' '}
              {task.version}
            </Typography>
            {!task.responsibilityAvailable && (
              <Alert severity="warning">
                Cần phân công người phụ trách cơ sở trước khi giao hoặc thực hiện việc.
              </Alert>
            )}
            {task.verifiedAt && (
              <Typography>
                Nghiệm thu: {formatInstant(task.verifiedAt)} · {actorName(task.verifiedByUserId)}
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                disabled={!mutable || !['Assigned', 'InProgress'].includes(task.status)}
                onClick={() => edit(task)}
              >
                Sửa công việc
              </Button>
              {[
                ['coordinate', 'Ghi chú phối hợp'],
                ['assign', 'Đồng bộ theo phân công cơ sở'],
                ['cancel', 'Hủy công việc'],
                ['verify', 'Nghiệm thu'],
                ['rework', 'Yêu cầu làm lại'],
              ].map(([op, label]) => (
                <Button
                  key={op}
                  disabled={
                    action.busy ||
                    detail.isFetching ||
                    !mutable ||
                    (['verify', 'rework'].includes(op) && task.status !== 'PendingVerification') ||
                    (op === 'assign' && !task.responsibilityAvailable)
                  }
                  onClick={() => {
                    setOperation(op);
                    setNote('');
                  }}
                >
                  {label}
                </Button>
              ))}
            </Stack>
            <Typography variant="subtitle1">Minh chứng</Typography>
            {!evidence.data?.length && <Typography>Chưa có minh chứng.</Typography>}
            {evidence.data?.map((x) => (
              <Button
                key={x.id}
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    () =>
                      downloadOwnerFile(
                        request,
                        `${root}/${id}/evidence/${x.id}`,
                        `cong-viec-${x.id}.${x.contentType === 'image/png' ? 'png' : 'jpg'}`,
                      ),
                    'Đã tải minh chứng.',
                  )
                }
              >
                Tải ảnh · {formatInstant(x.createdAt)} · {x.length} bytes{' '}
                {x.submissionId ? '· Đã gửi nghiệm thu' : ''}
              </Button>
            ))}
            <Typography variant="subtitle1">Lịch sử / vướng mắc</Typography>
            <OwnerTable
              rows={history.data?.items ?? []}
              id={(x) => x.id}
              columns={[
                { label: 'Thời gian', render: (x) => formatInstant(x.occurredAt) },
                {
                  label: 'Thao tác',
                  render: (x) => `${taskActionLabel(x.action)} · v${x.taskVersion}`,
                },
                { label: 'Nội dung', render: (x) => x.note },
                {
                  label: 'Staff phụ trách',
                  render: (x) => staffName(x.responsibleStaffUserId),
                },
                { label: 'Người thao tác', render: (x) => actorName(x.actorId) },
              ]}
            />
            <OwnerPagination page={page} total={history.data?.totalCount ?? 0} change={setPage} />
          </>
        )}
        <Button onClick={close}>Đóng chi tiết</Button>
        <ConfirmDialog
          error={action.error}
          open={!!operation}
          title="Xác nhận xử lý công việc"
          busy={action.busy}
          onClose={() => setOperation('')}
          onConfirm={() => {
            if (!task || (!['verify', 'assign'].includes(operation) && !note.trim())) return;
            void action
              .run(() =>
                action.command(`${root}/${id}/${operation}`, 'POST', {
                  version: task.version,
                  note: note || null,
                }),
              )
              .then((ok) => {
                if (ok) {
                  setOperation('');
                  void Promise.all([
                    detail.refetch(),
                    history.refetch(),
                    evidence.refetch(),
                    actors.refetch(),
                  ]);
                }
              });
          }}
        >
          <Stack spacing={2}>
            <Typography>
              Máy chủ kiểm tra trạng thái, phiên bản và minh chứng trước khi chấp nhận.
            </Typography>
            <TextField
              label="Ghi chú / lý do"
              required={!['verify', 'assign'].includes(operation)}
              multiline
              value={note}
              onChange={(e) => setNote(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 8000 } }}
            />
            {!['verify', 'assign'].includes(operation) && !note.trim() && (
              <Alert severity="info">Cần nhập nội dung trước khi xác nhận.</Alert>
            )}
          </Stack>
        </ConfirmDialog>
      </Stack>
    </Paper>
  );
}

function displayStaffName(staff: Staff[] | undefined, userId: string | null) {
  return userId ? (staff?.find((item) => item.userId === userId)?.fullName ?? userId) : 'Chưa có';
}
function taskActionLabel(action: string) {
  const labels: Record<string, string> = {
    created: 'Tạo công việc',
    updated: 'Cập nhật công việc',
    start: 'Bắt đầu thực hiện',
    progress: 'Cập nhật tiến độ',
    blockers: 'Báo vướng mắc',
    submit: 'Gửi nghiệm thu',
    verify: 'Owner nghiệm thu',
    rework: 'Yêu cầu làm lại',
    cancel: 'Hủy công việc',
    coordinate: 'Ghi chú phối hợp',
    responsibility_changed: 'Thay đổi người phụ trách cơ sở',
    'assignment-replaced': 'Điều chuyển theo phân công cơ sở',
    evidence_uploaded: 'Tải minh chứng',
  };
  return labels[action] ?? action;
}
function WorkFields({
  work,
  change,
  includeDueAt = true,
}: {
  work: TaskWork;
  change: (value: TaskWork) => void;
  includeDueAt?: boolean;
}) {
  return (
    <>
      <TextField
        required
        label="Tên công việc"
        value={work.title}
        onChange={(e) => change({ ...work, title: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <TextField
        required
        multiline
        label="Yêu cầu"
        value={work.requirements}
        onChange={(e) => change({ ...work, requirements: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 8000 } }}
      />
      <TextField
        select
        label="Mức ưu tiên"
        value={work.priority}
        onChange={(e) => change({ ...work, priority: e.target.value })}
      >
        <MenuItem value="Normal">Bình thường</MenuItem>
        <MenuItem value="High">Cao</MenuItem>
      </TextField>
      {includeDueAt && (
        <TextField
          required
          type="datetime-local"
          label="Thời điểm (giờ Việt Nam)"
          value={work.dueAt}
          onChange={(e) => change({ ...work, dueAt: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )}
      <FormControlLabel
        label="Bắt buộc minh chứng"
        control={
          <Checkbox
            checked={work.evidenceRequired}
            onChange={(_, v) => change({ ...work, evidenceRequired: v })}
          />
        }
      />
    </>
  );
}
function TaskEditor({
  task,
  initialLocation,
  close,
}: {
  task: OwnerTask | null;
  initialLocation: string;
  close: () => void;
}) {
  const [location, setLocation] = useState(task?.locationId ?? initialLocation),
    [reason, setReason] = useState('');
  const [work, setWork] = useState<TaskWork>(
    task
      ? {
          title: task.title,
          requirements: task.requirements,
          priority: task.priority,
          evidenceRequired: task.evidenceRequired,
          dueAt: vietnamDateInput(task.dueAt ?? ''),
        }
      : emptyWork,
  );
  const action = useOwnerAction();
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['task-editor-assignment', location],
    `/api/v1/staff-location-assignments?locationId=${location}`,
    !!location && !task,
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['task-editor-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
    !task,
  );
  const today = todayVietnam();
  const responsible = assignments.data?.find(
    (item) => item.startDate <= today && today <= item.endDate,
  );
  const responsibleName = responsible
    ? displayStaffName(staffDirectory.data?.items, responsible.staffUserId)
    : null;
  return (
    <Dialog
      open
      fullWidth
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>{task ? 'Sửa công việc' : 'Tạo công việc'}</DialogTitle>
      <DialogContent>
        <form
          id="task-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void action
              .run(() =>
                action.command(
                  task ? `${root}/${task.id}` : root,
                  task ? 'PUT' : 'POST',
                  task
                    ? {
                        version: task.version,
                        work: { ...work, dueAt: vietnamInstant(work.dueAt) },
                        reason,
                      }
                    : {
                        locationId: location,
                        work: { ...work, dueAt: vietnamInstant(work.dueAt) },
                      },
                ),
              )
              .then((ok) => {
                if (ok) close();
              });
          }}
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <OwnerFeedback {...action} />
            {!task && <OwnerLocationPicker required simple value={location} change={setLocation} />}
            {!task && location && (
              <Alert severity={assignments.error ? 'error' : responsible ? 'success' : 'warning'}>
                {assignments.error
                  ? 'Không thể tải phân công Staff của cơ sở. Hãy tải lại trước khi tạo công việc.'
                  : assignments.isFetching || staffDirectory.isFetching
                    ? 'Đang kiểm tra Staff phụ trách cơ sở...'
                    : responsibleName
                      ? `Staff phụ trách: ${responsibleName}. Công việc sẽ được giao theo phân công đang hiệu lực.`
                      : 'Chưa có Staff phụ trách. Công việc vẫn được tạo nhưng sẽ ở trạng thái chưa có người phụ trách.'}
              </Alert>
            )}
            <WorkFields work={work} change={setWork} />
            {task && (
              <TextField
                required
                label="Lý do sửa"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
            )}
          </Stack>
        </form>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button
          disabled={
            action.busy ||
            !location ||
            (!task && (assignments.isFetching || staffDirectory.isFetching || !!assignments.error))
          }
          type="submit"
          form="task-editor"
        >
          Lưu công việc
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function RecurringTemplates({ location }: { location: string }) {
  const list = useOwnerQuery<RecurringTemplate[]>(
    ['recurring-tasks', location],
    `/api/v1/operational-task-templates?locationId=${location}`,
  );
  const [editor, setEditor] = useState<RecurringTemplate | null | undefined>(),
    [remove, setRemove] = useState<RecurringTemplate | null>(null);
  const action = useOwnerAction();
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Mẫu công việc định kỳ</Typography>
        <OwnerFeedback
          busy={list.isFetching || action.busy}
          error={action.error || list.error}
          notice={action.notice}
        />
        <Button onClick={() => setEditor(null)}>Tạo mẫu định kỳ</Button>
        <OwnerTable
          rows={list.data ?? []}
          id={(x) => x.id}
          select={setEditor}
          columns={[
            { label: 'Mẫu', render: (x) => x.title },
            {
              label: 'Lặp lại',
              render: (x) => `${recurringLabel(x)} · hạn ${x.dueAfterHours} giờ`,
            },
            { label: 'Lần tiếp', render: (x) => formatInstant(x.nextRunAt) },
            { label: 'Hoạt động', render: (x) => (x.isActive ? 'Có' : 'Không') },
            { label: 'Xóa', render: (x) => <Button onClick={() => setRemove(x)}>Xóa mẫu</Button> },
          ]}
        />
        <ConfirmDialog
          error={action.error}
          open={!!remove}
          title="Xóa mẫu định kỳ"
          busy={action.busy}
          onClose={() => setRemove(null)}
          onConfirm={() => {
            if (remove)
              void action
                .run(() =>
                  action.command(
                    `/api/v1/operational-task-templates/${remove.id}?locationId=${location}&version=${remove.version}`,
                    'DELETE',
                  ),
                )
                .then((ok) => {
                  if (ok) setRemove(null);
                });
          }}
        >
          Các công việc đã tạo vẫn giữ lịch sử.
        </ConfirmDialog>
        {editor !== undefined && (
          <TemplateEditor
            location={location}
            template={editor}
            close={() => {
              setEditor(undefined);
              void list.refetch();
            }}
          />
        )}
      </Stack>
    </Paper>
  );
}
function TemplateEditor({
  location,
  template,
  close,
}: {
  location: string;
  template: RecurringTemplate | null;
  close: () => void;
}) {
  const [work, setWork] = useState<TaskWork>(
    template
      ? {
          title: template.title,
          requirements: template.requirements,
          priority: template.priority,
          evidenceRequired: template.evidenceRequired,
          dueAt: vietnamDateInput(template.nextRunAt),
        }
      : emptyWork,
  );
  const initialRun = vietnamDateInput(template?.nextRunAt ?? '');
  const [scheduleType, setScheduleType] = useState(
    template?.scheduleType ?? ('Daily' as NonNullable<RecurringTemplate['scheduleType']>),
  );
  const [days, setDays] = useState(template?.intervalDays ?? 1),
    [dayOfWeek, setDayOfWeek] = useState(template?.dayOfWeek ?? 1),
    [dayOfMonth, setDayOfMonth] = useState(template?.dayOfMonth ?? 1),
    [startDate, setStartDate] = useState(initialRun.slice(0, 10) || todayVietnam()),
    [runTime, setRunTime] = useState(initialRun.slice(11, 16) || '08:00'),
    [hours, setHours] = useState(template?.dueAfterHours ?? 24),
    [active, setActive] = useState(template?.isActive ?? true);
  const action = useOwnerAction();
  return (
    <Dialog
      open
      fullWidth
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>Mẫu định kỳ · thời điểm là lần chạy tiếp</DialogTitle>
      <DialogContent>
        <form
          id="recurring-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const { dueAt: _dueAt, ...fields } = work;
            const nextRunAt = nextRecurringInstant(
              scheduleType,
              startDate,
              runTime,
              dayOfWeek,
              dayOfMonth,
            );
            void action
              .run(() =>
                action.command(
                  '/api/v1/operational-task-templates' + (template ? `/${template.id}` : ''),
                  template ? 'PUT' : 'POST',
                  {
                    ...fields,
                    locationId: location,
                    intervalDays:
                      scheduleType === 'Weekly' ? 7 : scheduleType === 'IntervalDays' ? days : 1,
                    dueAfterHours: hours,
                    nextRunAt,
                    scheduleType,
                    dayOfWeek: scheduleType === 'Weekly' ? dayOfWeek : null,
                    dayOfMonth: scheduleType === 'Monthly' ? dayOfMonth : null,
                    isActive: active,
                    version: template?.version ?? 0,
                  },
                ),
              )
              .then((ok) => {
                if (ok) close();
              });
          }}
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <OwnerFeedback {...action} />
            <WorkFields work={work} change={setWork} includeDueAt={false} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Lịch lặp lại
            </Typography>
            <TextField
              select
              required
              label="Tần suất"
              value={scheduleType}
              onChange={(e) =>
                setScheduleType(e.target.value as NonNullable<RecurringTemplate['scheduleType']>)
              }
            >
              <MenuItem value="Daily">Hàng ngày</MenuItem>
              <MenuItem value="Weekly">Hàng tuần</MenuItem>
              <MenuItem value="Monthly">Hàng tháng</MenuItem>
              {scheduleType === 'IntervalDays' && (
                <MenuItem value="IntervalDays">Theo số ngày (mẫu cũ)</MenuItem>
              )}
            </TextField>
            {scheduleType === 'Weekly' && (
              <TextField
                select
                required
                label="Ngày chạy trong tuần"
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {weekdays.map((day, index) => (
                  <MenuItem key={day} value={index + 1}>
                    {day}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scheduleType === 'Monthly' && (
              <TextField
                select
                required
                label="Ngày chạy trong tháng"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                helperText="Tháng không có ngày đã chọn sẽ được bỏ qua (ví dụ ngày 30 không chạy trong tháng 2)."
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                  <MenuItem key={day} value={day}>
                    Ngày {day}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scheduleType === 'IntervalDays' && (
              <TextField
                type="number"
                required
                label="Chu kỳ (ngày)"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 1, max: 365 } }}
              />
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth
                required
                type="date"
                label="Bắt đầu áp dụng từ"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                fullWidth
                required
                type="time"
                label="Giờ tạo công việc"
                value={runTime}
                onChange={(e) => setRunTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <Alert severity="info">
              {recurringSummary(scheduleType, dayOfWeek, dayOfMonth, runTime)} Thời gian được tính
              theo giờ Việt Nam.
            </Alert>
            <TextField
              type="number"
              required
              label="Thời gian hoàn thành (giờ)"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 720 } }}
            />
            <FormControlLabel
              label="Mẫu hoạt động"
              control={<Checkbox checked={active} onChange={(_, v) => setActive(v)} />}
            />
          </Stack>
        </form>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={action.busy}>
          Hủy
        </Button>
        <Button form="recurring-editor" type="submit" disabled={action.busy}>
          Lưu mẫu
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const weekdays = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];

function recurringLabel(template: RecurringTemplate) {
  switch (template.scheduleType) {
    case 'Daily':
      return 'Hàng ngày';
    case 'Weekly':
      return `Hàng tuần · ${weekdays[(template.dayOfWeek ?? 1) - 1]}`;
    case 'Monthly':
      return `Hàng tháng · ngày ${template.dayOfMonth ?? 1}`;
    default:
      return `Mỗi ${template.intervalDays} ngày`;
  }
}

function recurringSummary(
  scheduleType: NonNullable<RecurringTemplate['scheduleType']>,
  dayOfWeek: number,
  dayOfMonth: number,
  runTime: string,
) {
  if (scheduleType === 'Weekly')
    return `Công việc được tạo vào ${weekdays[dayOfWeek - 1]} hàng tuần lúc ${runTime}.`;
  if (scheduleType === 'Monthly')
    return `Công việc được tạo vào ngày ${dayOfMonth} hàng tháng lúc ${runTime}.`;
  if (scheduleType === 'Daily') return `Công việc được tạo hàng ngày lúc ${runTime}.`;
  return `Mẫu tiếp tục chạy theo chu kỳ số ngày hiện có lúc ${runTime}.`;
}

function nextRecurringInstant(
  scheduleType: NonNullable<RecurringTemplate['scheduleType']>,
  startDate: string,
  runTime: string,
  dayOfWeek: number,
  dayOfMonth: number,
) {
  const [year, month, day] = startDate.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const now = new Date();
  for (let offset = 0; offset < 800; offset += 1) {
    const isoDay = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    const matches =
      scheduleType === 'Weekly'
        ? isoDay === dayOfWeek
        : scheduleType === 'Monthly'
          ? cursor.getUTCDate() === dayOfMonth
          : true;
    const date = cursor.toISOString().slice(0, 10);
    const candidate = new Date(`${date}T${runTime}:00+07:00`);
    if (matches && candidate >= now) return candidate.toISOString();
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error('Không thể xác định lần chạy tiếp theo từ lịch đã chọn.');
}
