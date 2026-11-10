import { useState } from 'react';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerTable } from '../../components/common/OwnerWorkspace';
import {
  useOwnerAction,
  useOwnerQuery,
  type OwnerLocation,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import {
  todayVietnam,
  type Staff,
  type StaffAssignment,
  type StaffAssignmentDetail,
  type StaffChangePreview,
} from './staffContracts';

export function StaffAssignments({ staff }: { staff: Staff }) {
  const action = useOwnerAction();
  const [location, setLocation] = useState('');
  const [start, setStart] = useState(todayVietnam()),
    [end, setEnd] = useState('');
  const [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(''),
    [replacementStaffId, setReplacementStaffId] = useState(''),
    [editingAssignmentId, setEditingAssignmentId] = useState('');
  const locations = useOwnerQuery<OwnerPage<OwnerLocation>>(
    ['assignment-locations'],
    '/api/v1/locations?page=1&pageSize=100',
  );
  const selected = useOwnerQuery<OwnerLocation>(
    ['assignment-location', location],
    `/api/v1/locations/${location}`,
    !!location,
  );
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['staff-assignments', location],
    `/api/v1/staff-location-assignments?locationId=${location}`,
    !!location,
  );
  const staffAssignments = useOwnerQuery<StaffAssignmentDetail[]>(
    ['staff-all-assignments', staff.userId],
    `/api/v1/staff-location-assignments/by-staff?staffUserId=${staff.userId}`,
  );
  const changePreview = useOwnerQuery<StaffChangePreview>(
    ['staff-change-preview', location],
    `/api/v1/locations/${location}/staff-change-preview`,
    !!location,
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['assignment-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
  );
  const today = todayVietnam();
  const current = assignments.data?.find((x) => x.startDate <= today && x.endDate >= today);
  const editingAssignment = staffAssignments.data?.find((x) => x.id === editingAssignmentId);
  const staffName = (userId: string) =>
    staffDirectory.data?.items.find((item) => item.userId === userId)?.fullName ?? userId;
  async function save() {
    const base = '/api/v1/staff-location-assignments';
    const ok = await action.run(() =>
      action.command(
        confirm === 'assign'
          ? base
          : confirm === 'period'
            ? `${base}/assignment/${editingAssignmentId}`
            : `${base}/${location}`,
        confirm === 'assign' ? 'POST' : confirm === 'remove' ? 'DELETE' : 'PUT',
        confirm === 'assign'
          ? { locationId: location, staffUserId: staff.userId, startDate: start, endDate: end }
          : confirm === 'period'
            ? { startDate: start, endDate: end, locationVersion: selected.data!.version, reason }
          : {
              ...(confirm === 'replace' ? { staffUserId: replacementStaffId } : {}),
              effectiveFrom: today,
              locationVersion: selected.data!.version,
              reason,
            },
      ),
    );
    if (ok) {
      setConfirm('');
      setReason('');
      setEditingAssignmentId('');
      await Promise.all([
        staffAssignments.refetch(),
        selected.refetch(),
        assignments.refetch(),
        changePreview.refetch(),
      ]);
    } else {
      // A 409 means the server state/version may have changed. Refresh all
      // assignment inputs before the Owner retries the operation.
      await Promise.all([selected.refetch(), assignments.refetch(), changePreview.refetch()]);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Phân công cơ sở · {staff.fullName}</Typography>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Các cơ sở đã được phân công
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Danh sách lấy trực tiếp từ dữ liệu phân công, gồm ngày bắt đầu và ngày kết thúc hiệu lực.
            </Typography>
            {staffAssignments.data?.length ? (
              <OwnerTable
                rows={staffAssignments.data}
                id={(x) => x.id}
                select={(x) => {
                  setLocation(x.locationId);
                  setStart(x.startDate);
                  setEnd(x.endDate);
                  setEditingAssignmentId(x.id);
                  setReplacementStaffId('');
                  setReason('');
                }}
                selectLabel="Chỉnh sửa"
                columns={[
                  { label: 'Cơ sở', render: (x) => x.locationName },
                  { label: 'Hiệu lực từ', render: (x) => x.startDate },
                  { label: 'Hiệu lực đến', render: (x) => x.endDate },
                  {
                    label: 'Trạng thái',
                    render: (x) =>
                      x.startDate <= today && today <= x.endDate
                        ? 'Đang hiệu lực'
                        : x.startDate > today
                          ? 'Sắp hiệu lực'
                          : 'Đã kết thúc',
                  },
                ]}
              />
            ) : (
              <Typography variant="body2">Nhân viên chưa có phân công cơ sở.</Typography>
            )}
          </Stack>
        </Paper>
        <OwnerFeedback
          busy={
            locations.isFetching ||
            selected.isFetching ||
            assignments.isFetching ||
            staffAssignments.isFetching ||
            changePreview.isFetching ||
            staffDirectory.isFetching ||
            action.busy
          }
          error={
            action.error ||
            locations.error ||
            selected.error ||
            assignments.error ||
            staffAssignments.error ||
            changePreview.error
          }
          notice={action.notice}
        />
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Chỉnh sửa phân công
            </Typography>
        <TextField
          select
          label="Cơ sở cần xem hoặc phân công"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            setReplacementStaffId('');
            setEditingAssignmentId('');
            setStart(today);
            setEnd('');
          }}
        >
          <MenuItem value="">Chọn cơ sở</MenuItem>
          {locations.data?.items.map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.name}
            </MenuItem>
          ))}
        </TextField>
        {location && (
          <>
            {changePreview.data && !changePreview.data.canRemove && (
              <Alert severity="warning">
                Chưa thể gỡ người phụ trách vì Location còn trách nhiệm đang mở. Hãy xử lý hoặc
                phân công lại các trách nhiệm trước khi gỡ.
                {changePreview.data.openResponsibilities.length > 0 && (
                  <Typography component="span" sx={{ display: 'block' }}>
                    {changePreview.data.openResponsibilities
                      .map((item) => `${item.code}: ${item.count}`)
                      .join(' · ')}
                  </Typography>
                )}
              </Alert>
            )}
            <Alert severity="info">
              {current
                ? `Nhân viên đang phụ trách: ${staffName(current.staffUserId)}`
                : 'Chưa có người phụ trách trong ngày hiện tại.'}{' '}
              Thay hoặc gỡ phân công có hiệu lực hôm nay; máy chủ kiểm tra và cập nhật công việc còn
              mở.
            </Alert>
            {current && !editingAssignment && (
              <TextField
                select
                label="Người phụ trách mới"
                value={replacementStaffId}
                onChange={(e) => setReplacementStaffId(e.target.value)}
              >
                <MenuItem value="">Chọn Staff thay thế</MenuItem>
                {staffDirectory.data?.items
                  .filter((item) => item.isActive && item.userId !== current.staffUserId)
                  .map((item) => (
                    <MenuItem key={item.userId} value={item.userId}>
                      {item.fullName} · {item.email}
                    </MenuItem>
                  ))}
              </TextField>
            )}
            <OwnerTable
              rows={assignments.data ?? []}
              id={(x) => x.id}
              columns={[
                {
                  label: 'Nhân viên',
                  render: (x) =>
                    x.staffUserId === staff.userId ? staff.fullName : staffName(x.staffUserId),
                },
                { label: 'Từ ngày', render: (x) => x.startDate },
                { label: 'Đến ngày', render: (x) => x.endDate },
              ]}
            />
            {(!current || editingAssignment) && (
              <>
                <TextField
                  required
                  type="date"
                  label="Hiệu lực từ"
                  value={start}
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(e) => setStart(e.target.value)}
                />
                <TextField
                  required
                  type="date"
                  label="Hiệu lực đến"
                  value={end}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: start } }}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </>
            )}
            {editingAssignment && editingAssignment.endDate < today && (
              <Alert severity="info">Phân công đã kết thúc được giữ nguyên để bảo toàn lịch sử.</Alert>
            )}
            <TextField
              label={editingAssignment ? 'Lý do cập nhật ngày hiệu lực' : 'Lý do thay / gỡ phân công'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {editingAssignment && (
                <Button
                  variant="contained"
                  disabled={
                    action.busy ||
                    editingAssignment.endDate < today ||
                    !selected.data ||
                    !start ||
                    !end ||
                    end < start ||
                    !reason.trim()
                  }
                  onClick={() => setConfirm('period')}
                >
                  Lưu ngày hiệu lực
                </Button>
              )}
              {!editingAssignment && (
                <>
                  <Button
                    disabled={
                      action.busy ||
                      !staff.isActive ||
                      !selected.data?.isActive ||
                      !!assignments.error ||
                      assignments.isFetching ||
                      !assignments.data ||
                      !!current ||
                      !start ||
                      !end ||
                      end < start
                    }
                    onClick={() => setConfirm('assign')}
                  >
                    Phân công nhân viên này
                  </Button>
                  <Button
                    disabled={
                      action.busy ||
                      !staff.isActive ||
                      !selected.data ||
                      !!assignments.error ||
                      assignments.isFetching ||
                      !current ||
                      !replacementStaffId ||
                      !reason.trim()
                    }
                    onClick={() => setConfirm('replace')}
                  >
                    Thay người phụ trách
                  </Button>
                </>
              )}
              {editingAssignment && (
                <Button
                  onClick={() => {
                    setEditingAssignmentId('');
                    setReason('');
                    setStart(today);
                    setEnd('');
                  }}
                >
                  Hủy chỉnh sửa
                </Button>
              )}
              {!editingAssignment && <Button
                color="error"
                disabled={
                  action.busy ||
                  !selected.data ||
                  !!assignments.error ||
                  !!changePreview.error ||
                  !changePreview.data?.canRemove ||
                  assignments.isFetching ||
                  current?.staffUserId !== staff.userId ||
                  !reason.trim()
                }
                onClick={() => setConfirm('remove')}
              >
                Gỡ phân công hiện tại
              </Button>}
            </Stack>
          </>
        )}
          </Stack>
        </Paper>
        <ConfirmDialog
          error={action.error}
          open={!!confirm}
          title={confirm === 'period' ? 'Xác nhận cập nhật ngày hiệu lực' : 'Xác nhận thay đổi người phụ trách'}
          busy={action.busy}
          onClose={() => setConfirm('')}
          onConfirm={() => void save()}
        >
          Máy chủ sẽ kiểm tra khoảng ngày, trách nhiệm còn mở và phiên bản cơ sở. Thay đổi được ghi vào lịch sử.
        </ConfirmDialog>
      </Stack>
    </Paper>
  );
}
