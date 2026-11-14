import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { X } from 'lucide-react';
import type { Staff, StaffAssignment } from '../staffContracts';
import { assignmentDate, assignmentState, type AssignmentRow } from '../useLocationAssignments';
import type { AssignmentIntent } from './AssignmentDialog';

export function AssignmentStatusChip({ state }: { state: string }) {
  const label =
    {
      current: 'Đang hiệu lực',
      future: 'Sắp hiệu lực',
      past: 'Đã kết thúc',
      empty: 'Chưa có người phụ trách',
    }[state] ?? state;
  return (
    <Chip
      label={label}
      size="small"
      color={state === 'current' ? 'success' : state === 'empty' ? 'warning' : 'default'}
      variant="outlined"
      sx={{ height: 28, fontSize: 12 }}
    />
  );
}
export function AssignedStaff({ staff, id }: { staff: Staff[]; id: string }) {
  const person = staff.find((item) => item.userId === id);
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Avatar
        sx={{ bgcolor: '#edf2ff', color: 'primary.main', width: 36, height: 36, fontSize: 14 }}
      >
        {person?.fullName
          ?.trim()
          .split(/\s+/)
          .slice(-2)
          .map((word) => word[0])
          .join('') || '?'}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
          {person?.fullName || person?.email || id}
        </Typography>
        {person?.fullName?.trim() && person.email && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {person.email}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
export function AssignmentDetailDrawer({
  row,
  staff,
  today,
  close,
  act,
}: {
  row?: AssignmentRow;
  staff: Staff[];
  today: string;
  close: () => void;
  act: (intent: AssignmentIntent) => void;
}) {
  const current = row?.assignments?.find((item) => assignmentState(item, today) === 'current');
  const sorted = [...(row?.assignments ?? [])]
    .filter((item) => item.id !== current?.id)
    .sort((a, b) => {
      const rank = (item: StaffAssignment) =>
        ({ current: 0, future: 1, past: 2 })[assignmentState(item, today)];
      return (
        rank(a) - rank(b) ||
        (rank(a) === 2
          ? b.endDate.localeCompare(a.endDate)
          : a.startDate.localeCompare(b.startDate))
      );
    });
  return (
    <Drawer
      anchor="right"
      open={!!row}
      onClose={close}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': 'Chi tiết phân công',
          sx: { width: { xs: '100%', sm: 480 }, maxWidth: '100vw' },
        },
      }}
    >
      <Stack
        direction="row"
        sx={{ p: 2.5, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Chi tiết phân công</Typography>
          <Typography>{row?.location.name}</Typography>
        </Box>
        <IconButton aria-label="Đóng chi tiết" onClick={close}>
          <X size={20} />
        </IconButton>
      </Stack>
      <Stack spacing={2} sx={{ p: 2.5, flex: 1, overflowY: 'auto' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Người phụ trách hiện tại</Typography>
        {current ? (
          <>
            <AssignedStaff staff={staff} id={current.staffUserId} />
            <Typography sx={{ fontSize: 14 }}>
              {assignmentDate(current.startDate)} – {assignmentDate(current.endDate)}
            </Typography>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <AssignmentStatusChip state="current" />
              <Button
                onClick={() =>
                  act({ mode: 'period', locationId: row!.location.id, assignment: current })
                }
              >
                Chỉnh thời hạn
              </Button>
            </Stack>
            <Button
              href={`/operational-tasks?locationId=${encodeURIComponent(row!.location.id)}`}
              sx={{ alignSelf: 'flex-start' }}
            >
              Xem công việc tại cơ sở
            </Button>
          </>
        ) : (
          <Alert severity="info">
            Cơ sở này chưa có nhân viên phụ trách tại thời điểm hiện tại.
          </Alert>
        )}
        <Divider />
        <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Phân công sắp tới và lịch sử</Typography>
        {sorted.length === 0 && (
          <Typography color="text.secondary" variant="body2">
            Chưa có phân công khác.
          </Typography>
        )}
        {sorted.map((item) => (
          <Stack
            key={item.id}
            spacing={1}
            sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <AssignedStaff staff={staff} id={item.staffUserId} />
            <Typography sx={{ fontSize: 13 }}>
              {assignmentDate(item.startDate)} – {assignmentDate(item.endDate)}
            </Typography>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <AssignmentStatusChip state={assignmentState(item, today)} />
              {item.endDate >= today && (
                <Button
                  onClick={() =>
                    act({ mode: 'period', locationId: row!.location.id, assignment: item })
                  }
                >
                  Chỉnh thời hạn
                </Button>
              )}
              {item.startDate > today && (
                <Button
                  color="error"
                  onClick={() =>
                    act({ mode: 'cancelFuture', locationId: row!.location.id, assignment: item })
                  }
                >
                  Hủy lịch
                </Button>
              )}
            </Stack>
          </Stack>
        ))}
      </Stack>
      <Stack
        spacing={1}
        sx={{
          p: 2,
          borderTop: 1,
          borderColor: 'divider',
          '& .MuiButton-root': { minHeight: 40, borderRadius: '8px' },
        }}
      >
        {current && (
          <Button
            variant="contained"
            onClick={() => act({ mode: 'replace', locationId: row!.location.id })}
          >
            Thay người phụ trách
          </Button>
        )}
        <Button
          variant={current ? 'outlined' : 'contained'}
          disabled={row?.location.isActive === false}
          onClick={() => act({ mode: 'create', locationId: row!.location.id })}
        >
          {current ? 'Lên lịch phân công' : 'Tạo phân công'}
        </Button>
        {current && (
          <Button
            color="error"
            onClick={() => act({ mode: 'remove', locationId: row!.location.id })}
          >
            Gỡ phân công
          </Button>
        )}
      </Stack>
    </Drawer>
  );
}
