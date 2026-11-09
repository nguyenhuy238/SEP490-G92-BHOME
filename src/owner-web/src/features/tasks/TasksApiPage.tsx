import { useState } from 'react';
import { useSearchParams } from 'react-router';
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
  type TaskEvidence,
  type RecurringTemplate,
} from './taskContracts';
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
    [overdue, setOverdue] = useState(false),
    [id, setId] = useState(params.get('taskId') ?? ''),
    [editor, setEditor] = useState<OwnerTask | null | undefined>();
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const list = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['tasks', location, status, priority, overdue, from, to, page],
    root +
      '?' +
      ownerQuery({
        locationId: location,
        status,
        priority,
        isOverdue: overdue || undefined,
        dueFrom: from ? vietnamInstant(from) : '',
        dueTo: to ? vietnamInstant(to) : '',
        page,
        pageSize: 20,
      }),
  );
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
      <OwnerLocationPicker
        value={location}
        change={(v) => {
          setLocation(v);
          setPage(1);
        }}
      />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
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
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
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
      <OwnerFeedback busy={list.isFetching} error={list.error} />
      <Paper>
        <OwnerTable
          rows={list.data?.items ?? []}
          id={(x) => x.id}
          select={(x) => setId(x.id)}
          columns={[
            { label: 'Công việc', render: (x) => x.title },
            {
              label: 'Trạng thái',
              render: (x) => <StatusChip label={taskStatus[x.status] ?? x.status} />,
            },
            {
              label: 'Hạn / ưu tiên',
              render: (x) =>
                `${x.dueAt ? formatInstant(x.dueAt) : 'Chưa có hạn'} · ${x.priority} ${x.isOverdue ? '· Quá hạn' : ''}`,
            },
            {
              label: 'Người phụ trách',
              render: (x) =>
                x.responsibilityAvailable
                  ? x.currentResponsibleStaffUserId
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
      {id && <TaskDetail key={id} id={id} close={() => setId('')} edit={setEditor} />}
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
}: {
  id: string;
  close: () => void;
  edit: (task: OwnerTask) => void;
}) {
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
  const { request } = useMeterApi();
  const action = useOwnerAction();
  const task = detail.data;
  const mutable = task?.kind === 'AdHoc' && !['Completed', 'Cancelled'].includes(task.status);
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <OwnerFeedback
          busy={detail.isFetching || history.isFetching || evidence.isFetching || action.busy}
          error={action.error || detail.error || history.error || evidence.error}
          notice={action.notice}
        />
        {task && (
          <>
            <Typography variant="h6">
              {task.title} · {taskStatus[task.status] ?? task.status}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{task.requirements}</Typography>
            <Typography>
              Kết quả: {task.result ?? 'Chưa gửi'} · Phiên bản {task.version}
            </Typography>
            <Typography>
              Người phụ trách hiện tại: {task.currentResponsibleStaffUserId ?? 'Chưa có'} · Khi
              giao: {task.recordedStaffUserId ?? 'Chưa có'}
            </Typography>
            {!task.responsibilityAvailable && (
              <Alert severity="warning">
                Cần phân công người phụ trách cơ sở trước khi giao hoặc thực hiện việc.
              </Alert>
            )}
            {task.verifiedAt && (
              <Typography>
                Nghiệm thu: {formatInstant(task.verifiedAt)} · {task.verifiedByUserId}
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
                ['assign', 'Đồng bộ người phụ trách'],
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
                { label: 'Thao tác', render: (x) => `${x.action} · v${x.taskVersion}` },
                { label: 'Nội dung', render: (x) => x.note },
                { label: 'Người thực hiện', render: (x) => x.actorId },
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
                if (ok) setOperation('');
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
function WorkFields({ work, change }: { work: TaskWork; change: (value: TaskWork) => void }) {
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
      <TextField
        required
        type="datetime-local"
        label="Thời điểm (giờ Việt Nam)"
        value={work.dueAt}
        onChange={(e) => change({ ...work, dueAt: e.target.value })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
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
            {!task && <OwnerLocationPicker required value={location} change={setLocation} />}
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
        <Button disabled={action.busy || !location} type="submit" form="task-editor">
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
              render: (x) => `${x.intervalDays} ngày · hạn ${x.dueAfterHours} giờ`,
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
            close={() => setEditor(undefined)}
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
  const [days, setDays] = useState(template?.intervalDays ?? 1),
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
            const { dueAt, ...fields } = work;
            void action
              .run(() =>
                action.command(
                  '/api/v1/operational-task-templates' + (template ? `/${template.id}` : ''),
                  template ? 'PUT' : 'POST',
                  {
                    ...fields,
                    locationId: location,
                    intervalDays: days,
                    dueAfterHours: hours,
                    nextRunAt: vietnamInstant(dueAt),
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
            <WorkFields work={work} change={setWork} />
            <TextField
              type="number"
              required
              label="Chu kỳ (ngày)"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
            />
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
