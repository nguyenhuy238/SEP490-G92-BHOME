import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { X } from 'lucide-react';
import { OwnerFeedback, OwnerPagination } from '../../../components/common/OwnerWorkspace';
import { useOwnerQuery, type OwnerPage } from '../../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { Staff } from '../../staff/staffContracts';
import {
  taskStatus,
  type OwnerTask,
  type TaskActor,
  type TaskHistory,
  type TaskEvidence,
} from '../taskContracts';
import {
  actionNames,
  responsibleName,
  taskActions,
  taskRoot,
  useTaskAction,
} from '../useOperationalTasksApi';
import { TaskEvidenceGallery } from './TaskEvidenceGallery';

export function TaskStatus({ task }: { task: OwnerTask }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      <Chip
        size="small"
        label={taskStatus[task.status] ?? task.status}
        color={
          task.status === 'Completed'
            ? 'success'
            : task.status === 'PendingVerification'
              ? 'warning'
              : 'default'
        }
        sx={{ height: 28, fontSize: 12 }}
      />
      {task.isOverdue && (
        <Chip
          size="small"
          variant="outlined"
          color="error"
          label="Quá hạn"
          sx={{ height: 28, fontSize: 12 }}
        />
      )}
    </Stack>
  );
}
const historyNames: Record<string, string> = {
  created: 'Tạo công việc',
  updated: 'Chỉnh sửa công việc',
  start: 'Bắt đầu thực hiện',
  progress: 'Cập nhật tiến độ',
  blockers: 'Báo vướng mắc',
  submit: 'Nộp kết quả',
  verify: 'Nghiệm thu',
  rework: 'Yêu cầu làm lại',
  cancel: 'Hủy công việc',
  coordinate: 'Ghi chú phối hợp',
  assign: 'Đồng bộ người phụ trách',
  responsibility_changed: 'Thay đổi trách nhiệm',
  'assignment-replaced': 'Thay đổi phân công cơ sở',
  evidence_uploaded: 'Tải bằng chứng',
};
export function TaskDetailDrawer({
  id,
  staff,
  locationName,
  close,
  edit,
  notify,
  initialOperation = '',
}: {
  id: string;
  staff: Staff[];
  locationName: (id: string) => string;
  close: () => void;
  edit: (task: OwnerTask) => void;
  notify: (message: string) => void;
  initialOperation?: string;
}) {
  const [page, setPage] = useState(1);
  const [operation, setOperation] = useState(initialOperation);
  const detail = useOwnerQuery<OwnerTask>(['task', id], `${taskRoot}/${id}`);
  const history = useOwnerQuery<OwnerPage<TaskHistory>>(
    ['task-history', id, page],
    `${taskRoot}/${id}/history?page=${page}&pageSize=20`,
    !!detail.data,
  );
  const evidence = useOwnerQuery<TaskEvidence[]>(
    ['task-evidence', id],
    `${taskRoot}/${id}/evidence`,
    !!detail.data,
  );
  const actors = useOwnerQuery<TaskActor[]>(
    ['task-actors', id],
    `${taskRoot}/${id}/actors`,
    !!detail.data,
  );
  const task = detail.data;
  const actorName = (id: string | null) =>
    (Array.isArray(actors.data)
      ? actors.data.find((item) => item.userId === id)?.displayName
      : undefined) ||
    staff.find((item) => item.userId === id)?.fullName ||
    'Người dùng không xác định';
  const refresh = async () => {
    await Promise.all([detail.refetch(), history.refetch(), evidence.refetch(), actors.refetch()]);
  };
  return (
    <Drawer
      anchor="right"
      open
      onClose={close}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': 'Chi tiết công việc',
          sx: {
            width: { xs: '100%', sm: 600 },
            maxWidth: '100vw',
            '& .MuiButton-root': { borderRadius: '8px', minHeight: 40, fontSize: 14 },
          },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Chi tiết công việc</Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 700, mb: 1, overflowWrap: 'anywhere' }}>
            {task?.title}
          </Typography>
          {task && <TaskStatus task={task} />}
        </Box>
        <IconButton aria-label="Đóng chi tiết" onClick={close}>
          <X size={20} />
        </IconButton>
      </Stack>
      <Stack spacing={2.5} divider={<Divider />} sx={{ p: 2.5, flex: 1, overflowY: 'auto' }}>
        <OwnerFeedback busy={detail.isFetching} error={detail.error} />
        {!!detail.error && <Button onClick={() => void detail.refetch()}>Tải lại công việc</Button>}
        {task && (
          <>
            <Box sx={{ '& p': { fontSize: 14, mb: 1 } }}>
              <Typography>Cơ sở: {locationName(task.locationId)}</Typography>
              <Typography>Người phụ trách hiện tại: {responsibleName(task, staff)}</Typography>
              {task.recordedStaffUserId &&
                task.recordedStaffUserId !== task.currentResponsibleStaffUserId && (
                  <Typography>
                    Người được ghi nhận khi giao: {actorName(task.recordedStaffUserId)}
                  </Typography>
                )}
              <Typography>Ưu tiên: {task.priority === 'High' ? 'Cao' : 'Bình thường'}</Typography>
              <Typography sx={{ color: task.isOverdue ? 'error.main' : undefined }}>
                Thời hạn: {task.dueAt ? formatInstant(task.dueAt) : 'Chưa có hạn'}
              </Typography>
              <Typography>
                Loại: {task.kind === 'AdHoc' ? 'Công việc vận hành' : 'Ghi điện nước'}
              </Typography>
              {!task.responsibilityAvailable && (
                <Alert severity="warning">
                  Cơ sở chưa có người phụ trách.
                  <Button href="/staff-assignments">Mở phân công cơ sở</Button>
                </Alert>
              )}
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Yêu cầu công việc
              </Typography>
              <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {task.requirements}
              </Typography>
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Tiến độ và kết quả
              </Typography>
              <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
                {task.result || 'Nhân viên chưa gửi kết quả hoàn thành.'}
              </Typography>
              {task.verifiedAt && (
                <Typography sx={{ fontSize: 13, mt: 1 }}>
                  Nghiệm thu: {formatInstant(task.verifiedAt)} · {actorName(task.verifiedByUserId)}
                </Typography>
              )}
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Bằng chứng công việc
              </Typography>
              {task.evidenceRequired && (
                <Typography sx={{ fontSize: 13, mb: 1 }}>
                  Công việc yêu cầu bằng chứng hoàn thành.
                </Typography>
              )}
              <OwnerFeedback busy={evidence.isFetching} error={evidence.error} />
              {evidence.error ? (
                <Button onClick={() => void evidence.refetch()}>Tải lại bằng chứng</Button>
              ) : (
                evidence.data &&
                !operation && <TaskEvidenceGallery taskId={id} evidence={evidence.data} />
              )}
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Lịch sử xử lý
              </Typography>
              <OwnerFeedback busy={history.isFetching} error={history.error || actors.error} />
              {history.error && (
                <Button onClick={() => void history.refetch()}>Tải lại lịch sử</Button>
              )}
              {history.data?.items.length === 0 && (
                <Typography sx={{ fontSize: 14 }}>Chưa có lịch sử xử lý.</Typography>
              )}
              {[...(history.data?.items ?? [])]
                .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                .map((item) => (
                  <Box
                    key={item.id}
                    sx={{
                      borderLeft: '2px solid',
                      borderColor: 'divider',
                      pl: 2,
                      pb: 2,
                      position: 'relative',
                      '&:before': {
                        content: '""',
                        position: 'absolute',
                        width: 8,
                        height: 8,
                        bgcolor: 'primary.main',
                        borderRadius: '50%',
                        left: -5,
                        top: 6,
                      },
                    }}
                  >
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {historyNames[item.action] ?? item.action}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {formatInstant(item.occurredAt)}
                    </Typography>
                    <Tooltip title={item.actorId}>
                      <Typography sx={{ fontSize: 13 }}>
                        {actorName(item.actorId)}
                        {actorName(item.actorId) === 'Người dùng không xác định'
                          ? ` · ${item.actorId.slice(0, 8)}…`
                          : ''}
                      </Typography>
                    </Tooltip>
                    {item.action === 'blockers' && (
                      <Typography sx={{ fontSize: 13, color: 'warning.dark' }}>
                        Vướng mắc cần xử lý
                      </Typography>
                    )}
                    <Typography
                      sx={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {item.note}
                    </Typography>
                  </Box>
                ))}
              {(history.data?.totalCount ?? 0) > 20 && (
                <OwnerPagination page={page} total={history.data!.totalCount} change={setPage} />
              )}
            </Box>
          </>
        )}
      </Stack>
      {task && taskActions(task).length > 0 && (
        <Stack
          direction="row"
          useFlexGap
          spacing={1}
          sx={{ p: 2, borderTop: 1, borderColor: 'divider', flexWrap: 'wrap' }}
        >
          {taskActions(task).map((op) => (
            <Button
              key={op}
              disabled={detail.isFetching}
              color={op === 'cancel' ? 'error' : 'primary'}
              variant={op === 'verify' ? 'contained' : 'outlined'}
              onClick={async () => {
                const latest = await detail.refetch();
                if (!latest.data || latest.error || !taskActions(latest.data).includes(op)) return;
                if (op === 'edit') edit(latest.data);
                else setOperation(op);
              }}
            >
              {actionNames[op]}
            </Button>
          ))}
        </Stack>
      )}
      {task && operation && (
        <TaskActionDialog
          key={operation}
          task={task}
          operation={operation}
          evidence={evidence.data}
          evidenceError={evidence.error}
          close={() => setOperation('')}
          refresh={refresh}
          notify={notify}
          loading={detail.isFetching || !!detail.error || evidence.isFetching}
        />
      )}
    </Drawer>
  );
}
function TaskActionDialog({
  task,
  operation,
  evidence,
  evidenceError,
  close,
  refresh,
  notify,
  loading,
}: {
  task: OwnerTask;
  operation: string;
  evidence?: TaskEvidence[];
  evidenceError: unknown;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  loading: boolean;
}) {
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const action = useTaskAction();
  const needsNote = !['verify', 'assign'].includes(operation);
  const allowed = taskActions(task).includes(operation);
  const missingRequiredEvidence =
    operation === 'verify' && task.evidenceRequired && !evidence?.some((item) => item.submissionId);
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>{actionNames[operation]}</DialogTitle>
      <DialogContent>
        <Stack
          spacing={2}
          component="form"
          id="task-action"
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              loading ||
              !allowed ||
              action.conflict ||
              (needsNote && !note.trim()) ||
              (operation === 'verify' &&
                (!checked || !evidence || !!evidenceError || missingRequiredEvidence))
            )
              return;
            void action
              .run(() =>
                action.command(`${taskRoot}/${task.id}/${operation}`, 'POST', {
                  version: task.version,
                  note: note.trim() || null,
                }),
              )
              .then((ok) => {
                if (ok) {
                  notify(
                    operation === 'assign'
                      ? 'Đã đồng bộ theo phân công cơ sở.'
                      : 'Đã xử lý công việc.',
                  );
                  close();
                }
              });
          }}
        >
          <OwnerFeedback busy={action.busy} error={action.error} />
          <Typography sx={{ fontWeight: 600 }}>{task.title}</Typography>
          {['verify', 'rework'].includes(operation) && (
            <>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {task.result || 'Chưa có kết quả.'}
              </Typography>
              <OwnerFeedback error={evidenceError} />
              {evidence && (
                <>
                  <Typography sx={{ fontWeight: 600 }}>Bằng chứng của lần gửi hiện tại</Typography>
                  <TaskEvidenceGallery
                    taskId={task.id}
                    evidence={evidence.filter((item) => item.submissionId)}
                  />
                  {evidence.some((item) => !item.submissionId) && (
                    <>
                      <Typography sx={{ fontWeight: 600 }}>
                        Ảnh tiến độ và bằng chứng khác
                      </Typography>
                      <TaskEvidenceGallery
                        taskId={task.id}
                        evidence={evidence.filter((item) => !item.submissionId)}
                      />
                    </>
                  )}
                </>
              )}
              {missingRequiredEvidence && (
                <Alert severity="warning">
                  Chưa có bằng chứng bắt buộc được đính kèm lần gửi hiện tại. Yêu cầu nhân viên bổ
                  sung trước khi nghiệm thu.
                </Alert>
              )}
            </>
          )}
          {operation === 'cancel' && (
            <Typography>Hủy công việc sẽ giữ lại lịch sử và bằng chứng.</Typography>
          )}
          {operation === 'assign' && (
            <Typography>
              Đồng bộ theo người phụ trách hiện tại của cơ sở; không chọn người thực hiện riêng.
            </Typography>
          )}
          <TextField
            multiline
            minRows={2}
            label={operation === 'rework' ? 'Lý do yêu cầu làm lại' : 'Ghi chú / lý do'}
            required={needsNote}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 8000 } }}
          />
          {operation === 'verify' && (
            <FormControlLabel
              label="Đã kiểm tra kết quả và bằng chứng"
              control={<Checkbox checked={checked} onChange={(_, value) => setChecked(value)} />}
            />
          )}
          {action.conflict && (
            <Alert severity="warning">
              Dữ liệu đã thay đổi. Nội dung nhập được giữ nguyên.
              <Button
                onClick={async () => {
                  await refresh();
                  setChecked(false);
                  action.reviewed();
                }}
              >
                Tải dữ liệu mới
              </Button>
            </Alert>
          )}
          {!allowed && (
            <Alert severity="warning">Trạng thái hiện tại không còn cho phép thao tác này.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button
          variant="contained"
          color={operation === 'cancel' ? 'error' : 'primary'}
          type="submit"
          form="task-action"
          disabled={
            loading ||
            action.busy ||
            (operation === 'verify' && !checked) ||
            action.conflict ||
            !allowed ||
            (needsNote && !note.trim()) ||
            missingRequiredEvidence ||
            (operation === 'verify' && (!evidence || !!evidenceError))
          }
        >
          Xác nhận
        </Button>
      </DialogActions>
    </Dialog>
  );
}
