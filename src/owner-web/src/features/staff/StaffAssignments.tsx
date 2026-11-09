import { useState } from 'react';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import {
  useOwnerAction,
  useOwnerQuery,
  type OwnerLocation,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { todayVietnam, type Staff, type StaffAssignment } from './staffContracts';

export function StaffAssignments({ staff }: { staff: Staff }) {
  const action = useOwnerAction();
  const [page, setPage] = useState(1),
    [location, setLocation] = useState('');
  const [start, setStart] = useState(todayVietnam()),
    [end, setEnd] = useState('');
  const [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState('');
  const locations = useOwnerQuery<OwnerPage<OwnerLocation>>(
    ['assignment-locations', page],
    `/api/v1/locations?page=${page}&pageSize=20`,
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
  const today = todayVietnam();
  const current = assignments.data?.find((x) => x.startDate <= today && x.endDate >= today);
  async function save() {
    const base = '/api/v1/staff-location-assignments';
    const ok = await action.run(() =>
      action.command(
        confirm === 'assign' ? base : `${base}/${location}`,
        confirm === 'assign' ? 'POST' : confirm === 'remove' ? 'DELETE' : 'PUT',
        confirm === 'assign'
          ? { locationId: location, staffUserId: staff.userId, startDate: start, endDate: end }
          : {
              ...(confirm === 'replace' ? { staffUserId: staff.userId } : {}),
              effectiveFrom: today,
              locationVersion: selected.data!.version,
              reason,
            },
      ),
    );
    if (ok) {
      setConfirm('');
      setReason('');
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Phân công cơ sở · {staff.fullName}</Typography>
        <OwnerFeedback
          busy={
            locations.isFetching || selected.isFetching || assignments.isFetching || action.busy
          }
          error={action.error || locations.error || selected.error || assignments.error}
          notice={action.notice}
        />
        <TextField
          select
          label="Cơ sở cần xem hoặc phân công"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <MenuItem value="">Chọn cơ sở</MenuItem>
          {locations.data?.items.map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.name}
            </MenuItem>
          ))}
        </TextField>
        <OwnerPagination
          page={page}
          total={locations.data?.totalCount ?? 0}
          change={setPage}
          busy={locations.isFetching}
        />
        {location && (
          <>
            <Alert severity="info">
              {current
                ? `Nhân viên đang phụ trách: ${current.staffUserId}`
                : 'Chưa có người phụ trách trong ngày hiện tại.'}{' '}
              Thay hoặc gỡ phân công có hiệu lực hôm nay; máy chủ kiểm tra và cập nhật công việc còn
              mở.
            </Alert>
            <OwnerTable
              rows={assignments.data ?? []}
              id={(x) => x.id}
              columns={[
                {
                  label: 'Nhân viên',
                  render: (x) => (x.staffUserId === staff.userId ? staff.fullName : x.staffUserId),
                },
                { label: 'Từ ngày', render: (x) => x.startDate },
                { label: 'Đến ngày', render: (x) => x.endDate },
              ]}
            />
            {!current && (
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
            <TextField
              label="Lý do thay / gỡ phân công"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Stack direction="row" spacing={1}>
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
                  current.staffUserId === staff.userId ||
                  !reason.trim()
                }
                onClick={() => setConfirm('replace')}
              >
                Thay người phụ trách bằng nhân viên này
              </Button>
              <Button
                color="error"
                disabled={
                  action.busy ||
                  !selected.data ||
                  !!assignments.error ||
                  assignments.isFetching ||
                  current?.staffUserId !== staff.userId ||
                  !reason.trim()
                }
                onClick={() => setConfirm('remove')}
              >
                Gỡ phân công hiện tại
              </Button>
            </Stack>
          </>
        )}
        <ConfirmDialog
          error={action.error}
          open={!!confirm}
          title="Xác nhận thay đổi người phụ trách"
          busy={action.busy}
          onClose={() => setConfirm('')}
          onConfirm={() => void save()}
        >
          Máy chủ sẽ kiểm tra trách nhiệm còn mở và phiên bản cơ sở. Thay đổi được ghi vào lịch sử.
        </ConfirmDialog>
      </Stack>
    </Paper>
  );
}
