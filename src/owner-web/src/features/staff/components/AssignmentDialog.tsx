import { useState } from 'react';
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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import {
  useOwnerAction,
  useOwnerQuery,
  type OwnerLocation,
} from '../../../hooks/useOwnerWorkspace';
import {
  todayVietnam,
  type Staff,
  type StaffAssignment,
  type StaffChangePreview,
} from '../staffContracts';
import { assignmentDate, overlaps } from '../useLocationAssignments';

export type AssignmentIntent = {
  mode: 'create' | 'replace' | 'period' | 'remove';
  locationId?: string;
  assignment?: StaffAssignment;
};
const titles = {
  create: 'Tạo phân công nhân viên',
  replace: 'Thay người phụ trách',
  period: 'Chỉnh thời hạn phân công',
  remove: 'Gỡ người phụ trách',
};
export function ResponsibilityPreview({ preview }: { preview: StaffChangePreview }) {
  const labels: Record<string, string> = {
    GENERAL: 'Công việc vận hành',
    METER_READ: 'Ghi chỉ số điện nước',
    WORK_ORDER: 'Lệnh sửa chữa',
    MOVE_OUT_INSPECTION: 'Kiểm tra trả phòng',
  };
  return (
    <Alert
      severity={preview.openResponsibilities.some((item) => item.count > 0) ? 'warning' : 'info'}
    >
      <Typography sx={{ fontSize: 14 }}>Trách nhiệm đang mở</Typography>
      {preview.openResponsibilities.length
        ? preview.openResponsibilities.map((item) => (
            <Typography key={item.code} sx={{ fontSize: 13 }}>
              {labels[item.code] ?? item.code}: {item.count}
            </Typography>
          ))
        : 'Không có trách nhiệm đang mở.'}
      {!preview.canRemove && (
        <Typography sx={{ fontSize: 13 }}>
          Chưa thể gỡ. Hãy xử lý trách nhiệm hoặc thay người phụ trách.
        </Typography>
      )}
    </Alert>
  );
}
export function AssignmentDialog({
  intent,
  locations,
  staff,
  close,
  saved,
}: {
  intent: AssignmentIntent;
  locations: OwnerLocation[];
  staff: Staff[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const action = useOwnerAction();
  const [locationId, setLocationId] = useState(intent.locationId ?? '');
  const [staffId, setStaffId] = useState('');
  const [start, setStart] = useState(intent.assignment?.startDate ?? todayVietnam());
  const [end, setEnd] = useState(intent.assignment?.endDate ?? '');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const location = useOwnerQuery<OwnerLocation>(
    ['assignment-location', locationId],
    `/api/v1/locations/${locationId}`,
    !!locationId,
  );
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['staff-assignments', locationId],
    `/api/v1/staff-location-assignments?locationId=${locationId}`,
    !!locationId,
  );
  const needsPreview = intent.mode === 'replace' || intent.mode === 'remove';
  const preview = useOwnerQuery<StaffChangePreview>(
    ['staff-change-preview', locationId],
    `/api/v1/locations/${locationId}/staff-change-preview`,
    !!locationId && needsPreview,
  );
  const today = todayVietnam();
  const current = assignments.data?.find(
    (item) => item.startDate <= today && today <= item.endDate,
  );
  const period = intent.mode === 'create' || intent.mode === 'period';
  const chosen =
    intent.assignment && assignments.data?.find((item) => item.id === intent.assignment!.id);
  const invalid =
    period &&
    start &&
    end &&
    (end < start
      ? 'Ngày kết thúc không được trước ngày bắt đầu.'
      : overlaps(
            assignments.data ?? [],
            start,
            end,
            intent.mode === 'period' ? intent.assignment?.id : undefined,
          )
        ? 'Khoảng thời gian trùng với một phân công tại cơ sở.'
        : '');
  const periodInvalid =
    intent.mode === 'period' &&
    (!chosen ||
      chosen.endDate < today ||
      (chosen.startDate <= today && chosen.endDate >= today && (start > today || end < today)));
  const busy =
    action.busy ||
    refreshing ||
    location.isFetching ||
    assignments.isFetching ||
    (needsPreview && preview.isFetching);
  const blocked =
    busy ||
    review ||
    !location.data ||
    !!location.error ||
    !assignments.data ||
    !!assignments.error ||
    !!invalid ||
    periodInvalid ||
    (period && (!start || !end)) ||
    (needsPreview && (!current || !preview.data || !!preview.error)) ||
    (intent.mode !== 'create' && !reason.trim()) ||
    ((intent.mode === 'create' || intent.mode === 'replace') &&
      !staff.some(
        (item) =>
          item.userId === staffId &&
          item.isActive &&
          (intent.mode !== 'replace' || item.userId !== current?.staffUserId),
      )) ||
    (intent.mode === 'remove' && !preview.data?.canRemove);
  async function reload() {
    setRefreshing(true);
    try {
      await Promise.all([
        location.refetch(),
        assignments.refetch(),
        ...(needsPreview ? [preview.refetch()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }
  async function submit() {
    if (blocked) return;
    let conflict = false;
    const base = '/api/v1/staff-location-assignments';
    const ok = await action.run(async () => {
      try {
        return await action.command(
          intent.mode === 'create'
            ? base
            : intent.mode === 'period'
              ? `${base}/assignment/${intent.assignment!.id}`
              : `${base}/${locationId}`,
          intent.mode === 'create' ? 'POST' : intent.mode === 'remove' ? 'DELETE' : 'PUT',
          intent.mode === 'create'
            ? { locationId, staffUserId: staffId, startDate: start, endDate: end }
            : intent.mode === 'period'
              ? {
                  startDate: start,
                  endDate: end,
                  locationVersion: location.data!.version,
                  reason: reason.trim(),
                }
              : {
                  ...(intent.mode === 'replace' ? { staffUserId: staffId } : {}),
                  effectiveFrom: today,
                  locationVersion: location.data!.version,
                  reason: reason.trim(),
                },
        );
      } catch (error) {
        conflict = error instanceof ApiError && error.status === 409;
        throw error;
      }
    });
    if (ok) {
      await saved();
      close();
    } else if (conflict) {
      setReview(true);
      await reload();
    }
  }
  const name = (id?: string) =>
    staff.find((item) => item.userId === id)?.fullName ||
    staff.find((item) => item.userId === id)?.email ||
    id ||
    'Chưa có người phụ trách';
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!busy) close();
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
      <DialogTitle>{titles[intent.mode]}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="assignment-editor"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <OwnerFeedback
            busy={busy}
            error={
              action.error || location.error || assignments.error || (needsPreview && preview.error)
            }
          />
          {(location.error || assignments.error || preview.error) && (
            <Button onClick={() => void reload()}>Tải lại dữ liệu</Button>
          )}
          {intent.mode === 'create' ? (
            <TextField
              select
              required
              label="Cơ sở"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography sx={{ fontWeight: 600 }}>
              {location.data?.name ?? locations.find((item) => item.id === locationId)?.name}
            </Typography>
          )}
          {intent.mode !== 'create' && (
            <Typography>
              Nhân viên:{' '}
              {name(
                intent.mode === 'period' ? intent.assignment?.staffUserId : current?.staffUserId,
              )}
            </Typography>
          )}
          {(intent.mode === 'create' || intent.mode === 'replace') && (
            <TextField
              select
              required
              label={intent.mode === 'replace' ? 'Nhân viên thay thế' : 'Nhân viên phụ trách'}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              {staff
                .filter(
                  (item) =>
                    item.isActive &&
                    (intent.mode !== 'replace' || item.userId !== current?.staffUserId),
                )
                .map((item) => (
                  <MenuItem key={item.userId} value={item.userId}>
                    {item.fullName || 'Chưa cập nhật tên'} · {item.email}
                  </MenuItem>
                ))}
            </TextField>
          )}
          {intent.mode === 'period' && (
            <Typography sx={{ fontSize: 13 }}>
              Thời hạn hiện tại:{' '}
              {chosen
                ? `${assignmentDate(chosen.startDate)} – ${assignmentDate(chosen.endDate)}`
                : 'Không tìm thấy phân công'}
            </Typography>
          )}
          {period ? (
            <>
              <TextField
                required
                type="date"
                label="Ngày bắt đầu"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <FormControlLabel
                label="Không xác định thời hạn"
                control={
                  <Checkbox
                    checked={end === '9999-12-31'}
                    onChange={(_, checked) => setEnd(checked ? '9999-12-31' : '')}
                  />
                }
              />
              <TextField
                required
                disabled={end === '9999-12-31'}
                type="date"
                label="Ngày kết thúc"
                value={end === '9999-12-31' ? '' : end}
                onChange={(event) => setEnd(event.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: start } }}
                error={!!invalid}
                helperText={invalid || (end === '9999-12-31' ? 'Không xác định thời hạn' : '')}
              />
            </>
          ) : (
            <Typography>Hiệu lực hôm nay: {assignmentDate(today)}</Typography>
          )}
          {periodInvalid && (
            <Alert severity="warning">
              Không thể sửa lịch sử đã kết thúc hoặc bỏ ngày hôm nay khỏi phân công đang hiệu lực.
            </Alert>
          )}
          {needsPreview && preview.data && <ResponsibilityPreview preview={preview.data} />}
          {intent.mode !== 'create' && (
            <TextField
              required
              multiline
              minRows={2}
              label="Lý do thay đổi"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          )}
          {review && (
            <Alert severity="warning">
              Dữ liệu đã thay đổi. Thông tin mới đã được tải; nội dung bạn nhập được giữ nguyên.
              <Button disabled={busy} onClick={() => setReview(false)}>
                Tôi đã kiểm tra lại
              </Button>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          Hủy
        </Button>
        <Button
          variant="contained"
          color={intent.mode === 'remove' ? 'error' : 'primary'}
          form="assignment-editor"
          type="submit"
          disabled={!!blocked}
        >
          {busy ? 'Đang xử lý…' : intent.mode === 'create' ? 'Tạo phân công' : 'Xác nhận'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
