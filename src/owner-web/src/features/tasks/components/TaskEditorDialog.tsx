import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { OwnerLocationPicker } from '../../../components/common/OwnerSelectors';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { todayVietnam, type StaffAssignment } from '../../staff/staffContracts';
import { vietnamDateInput, vietnamInstant, type OwnerTask, type TaskWork } from '../taskContracts';
import { taskActions, taskRoot, useTaskAction, useTaskDirectory } from '../useOperationalTasksApi';

export function TaskWorkFields({
  work,
  change,
  errors = {},
  includeDue = true,
}: {
  work: TaskWork;
  change: (value: TaskWork) => void;
  errors?: Record<string, string>;
  includeDue?: boolean;
}) {
  return (
    <>
      <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Thông tin công việc</Typography>
      <TextField
        required
        label="Tên công việc"
        value={work.title}
        onChange={(e) => change({ ...work, title: e.target.value })}
        error={!!errors.title}
        helperText={errors.title}
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />
      <TextField
        required
        multiline
        minRows={3}
        label="Yêu cầu"
        value={work.requirements}
        onChange={(e) => change({ ...work, requirements: e.target.value })}
        error={!!errors.requirements}
        helperText={errors.requirements}
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
      <Divider />
      <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Thời hạn và bằng chứng</Typography>
      {includeDue && (
        <TextField
          required
          type="datetime-local"
          label="Thời điểm hoàn thành (giờ Việt Nam)"
          value={work.dueAt}
          onChange={(e) => change({ ...work, dueAt: e.target.value })}
          error={!!errors.dueat}
          helperText={errors.dueat}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )}
      <FormControlLabel
        label="Bắt buộc bằng chứng hoàn thành"
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
export function TaskEditorDialog({
  task,
  initialLocation,
  close,
  notify,
}: {
  task: OwnerTask | null;
  initialLocation: string;
  close: () => void;
  notify: (message: string) => void;
}) {
  const [location, setLocation] = useState(task?.locationId ?? initialLocation);
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(task?.version ?? 0);
  const [editable, setEditable] = useState(!task || taskActions(task).includes('edit'));
  const [work, setWork] = useState<TaskWork>(
    task
      ? {
          title: task.title,
          requirements: task.requirements,
          priority: task.priority,
          evidenceRequired: task.evidenceRequired,
          dueAt: vietnamDateInput(task.dueAt ?? ''),
        }
      : { title: '', requirements: '', priority: 'Normal', dueAt: '', evidenceRequired: false },
  );
  const action = useTaskAction();
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['task-editor-assignment', location],
    `/api/v1/staff-location-assignments?locationId=${location}`,
    !!location && !task,
  );
  const latest = useOwnerQuery<OwnerTask>(['task', task?.id], `${taskRoot}/${task?.id}`, !!task);
  const { staff } = useTaskDirectory();
  const today = todayVietnam();
  const responsible = assignments.data?.find(
    (item) => item.startDate <= today && today <= item.endDate,
  );
  const person = staff.data?.find((item) => item.userId === responsible?.staffUserId);
  const dateValid = work.dueAt && Number.isFinite(Date.parse(work.dueAt + ':00+07:00'));
  const unchangedDate = !!task && work.dueAt === vietnamDateInput(task.dueAt ?? '');
  const deadlineError = work.dueAt && !dateValid ? 'Thời hạn mới phải ở tương lai.' : '';
  const blocked =
    action.busy ||
    action.conflict ||
    !editable ||
    !location ||
    !work.title.trim() ||
    !work.requirements.trim() ||
    !dateValid ||
    !!deadlineError ||
    (task
      ? !reason.trim()
      : !responsible ||
        !person?.isActive ||
        assignments.isFetching ||
        !!assignments.error ||
        staff.isFetching ||
        !!staff.error);
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!action.busy) close();
      }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: '12px',
            '& .MuiInputBase-root, & .MuiInputLabel-root': { fontSize: 14 },
          },
        },
      }}
    >
      <DialogTitle>{task ? 'Chỉnh sửa công việc' : 'Tạo công việc'}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="task-editor"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked) return;
            void action
              .run(() =>
                action.command(
                  task ? `${taskRoot}/${task.id}` : taskRoot,
                  task ? 'PUT' : 'POST',
                  task
                    ? {
                        version,
                        work: {
                          ...work,
                          dueAt: unchangedDate ? task.dueAt : vietnamInstant(work.dueAt),
                        },
                        reason: reason.trim(),
                      }
                    : {
                        locationId: location,
                        work: { ...work, dueAt: vietnamInstant(work.dueAt) },
                      },
                ),
              )
              .then((ok) => {
                if (ok) {
                  notify('Đã lưu công việc.');
                  close();
                }
              });
          }}
        >
          <OwnerFeedback
            busy={action.busy}
            error={action.error || assignments.error || staff.error || latest.error}
          />
          {!task && (
            <>
              <OwnerLocationPicker required simple value={location} change={setLocation} />
              {location && (
                <Alert severity={responsible ? 'info' : 'warning'}>
                  {assignments.isFetching
                    ? 'Đang kiểm tra người phụ trách…'
                    : responsible
                      ? `Staff phụ trách: ${person?.fullName || 'Không tải được tên nhân viên'}`
                      : 'Cơ sở chưa có Staff phụ trách. Cần phân công trước khi tạo công việc.'}
                  {!responsible && <Button href="/staff-assignments">Mở phân công cơ sở</Button>}
                </Alert>
              )}
              {!!assignments.error && (
                <Button onClick={() => void assignments.refetch()}>Tải lại phân công</Button>
              )}
            </>
          )}
          <TaskWorkFields
            work={work}
            change={setWork}
            errors={{ ...action.fields, ...(deadlineError ? { dueat: deadlineError } : {}) }}
          />
          {task && (
            <TextField
              required
              multiline
              label="Lý do chỉnh sửa"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          )}
          {action.conflict && task && (
            <Alert severity="warning">
              Dữ liệu đã thay đổi. Bản nhập được giữ nguyên.
              <Button
                onClick={async () => {
                  const result = await latest.refetch();
                  if (result.data && !result.error) {
                    setVersion(result.data.version);
                    setEditable(taskActions(result.data).includes('edit'));
                    action.reviewed();
                  }
                }}
              >
                Tải dữ liệu mới
              </Button>
            </Alert>
          )}
          {!editable && (
            <Alert severity="warning">Công việc không còn ở trạng thái cho phép chỉnh sửa.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button variant="contained" form="task-editor" type="submit" disabled={!!blocked}>
          Lưu công việc
        </Button>
      </DialogActions>
    </Dialog>
  );
}
