import type { ReactNode } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { X } from 'lucide-react';
import { OwnerFeedback, OwnerTable } from '../../../components/common/OwnerWorkspace';
import { todayVietnam, type Staff } from '../staffContracts';

const staffName = (staff: Staff) => staff.fullName?.trim() || 'Chưa cập nhật tên';
const staffDate = (date: string | null) =>
  date ? date.split('-').reverse().join('/') : 'Không xác định thời hạn';
function Initials({ staff }: { staff: Staff }) {
  return (
    <Avatar sx={{ width: 40, height: 40, bgcolor: '#edf2ff', color: 'primary.main', fontSize: 15 }}>
      {staff.fullName
        ?.trim()
        .split(/\s+/)
        .slice(-2)
        .map((word) => word[0])
        .join('')
        .toUpperCase() || '?'}
    </Avatar>
  );
}
export function AccountBadge({ active }: { active: boolean }) {
  return (
    <Chip
      size="small"
      label={active ? 'Đang hoạt động' : 'Đã ngừng hoạt động'}
      color={active ? 'success' : 'default'}
      variant="outlined"
      sx={{ fontSize: 12, height: 28 }}
    />
  );
}
export function EmploymentBadge({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      label={status === 'Active' ? 'Đang làm việc' : status === 'Ended' ? 'Đã kết thúc' : status}
      color={status === 'Active' ? 'success' : 'default'}
      sx={{ fontSize: 12, height: 26 }}
    />
  );
}
function ExpiryHint({ staff }: { staff: Staff }) {
  const employment = staff.employment;
  if (!employment?.endDate || employment.status !== 'Active') return null;
  const days = Math.round((Date.parse(employment.endDate) - Date.parse(todayVietnam())) / 86400000);
  return days >= 0 && days <= 30 ? (
    <Typography sx={{ fontSize: 12, color: 'warning.dark' }}>Hết hạn trong {days} ngày</Typography>
  ) : null;
}
export function StaffTable({
  rows,
  select,
  loading,
  error,
  retry,
}: {
  rows: Staff[];
  select: (staff: Staff) => void;
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const mobile = useMediaQuery('(max-width:599px)');
  if (mobile && rows.length && !error)
    return (
      <Stack divider={<Divider />}>
        {rows.map((staff) => (
          <Stack key={staff.userId} spacing={1.5} sx={{ p: 2 }}>
            <Stack direction="row" spacing={1.5}>
              <Initials staff={staff} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{staffName(staff)}</Typography>
                <Typography sx={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                  {staff.email}
                </Typography>
              </Box>
            </Stack>
            <Typography sx={{ fontSize: 14 }}>
              Điện thoại: {staff.phone || 'Chưa cập nhật'}
            </Typography>
            <Field label="Tài khoản">
              <AccountBadge active={staff.isActive} />
            </Field>
            <Field label="Hợp đồng">
              {staff.employment ? (
                <Stack spacing={0.5}>
                  <EmploymentBadge status={staff.employment.status} />
                  <Typography sx={{ fontSize: 12 }}>
                    {staffDate(staff.employment.startDate)} – {staffDate(staff.employment.endDate)}
                  </Typography>
                  <ExpiryHint staff={staff} />
                </Stack>
              ) : (
                'Chưa có hợp đồng'
              )}
            </Field>
            <Button variant="outlined" onClick={() => select(staff)}>
              Chi tiết
            </Button>
          </Stack>
        ))}
      </Stack>
    );
  return (
    <OwnerTable
      rows={rows}
      id={(row) => row.userId}
      select={select}
      selectLabel="Chi tiết"
      label="Danh sách nhân viên"
      loading={loading}
      error={error}
      retry={retry}
      columns={[
        {
          label: 'Nhân viên',
          render: (staff) => (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Initials staff={staff} />
              <Box sx={{ minWidth: 180 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{staffName(staff)}</Typography>
                <Typography
                  sx={{ fontSize: 13, color: 'text.secondary', overflowWrap: 'anywhere' }}
                >
                  {staff.email}
                </Typography>
              </Box>
            </Stack>
          ),
        },
        { label: 'Liên hệ', render: (staff) => staff.phone || 'Chưa cập nhật' },
        {
          label: 'Hợp đồng làm việc',
          render: (staff) =>
            staff.employment ? (
              <Stack spacing={0.75} sx={{ alignItems: 'flex-start' }}>
                <EmploymentBadge status={staff.employment.status} />
                <ExpiryHint staff={staff} />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {staffDate(staff.employment.startDate)} – {staffDate(staff.employment.endDate)}
                </Typography>
              </Stack>
            ) : (
              'Chưa có hợp đồng'
            ),
        },
        { label: 'Tài khoản', render: (staff) => <AccountBadge active={staff.isActive} /> },
      ]}
    />
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '145px minmax(0,1fr)', gap: 1, py: 0.75 }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ fontSize: 14, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}
export function StaffDetailDrawer({
  open,
  staff,
  busy,
  error,
  notice,
  close,
  edit,
  invite,
  retry,
  actionBusy,
}: {
  open: boolean;
  staff?: Staff;
  busy: boolean;
  error: unknown;
  notice: string;
  close: () => void;
  edit: (staff: Staff) => void;
  invite: () => void;
  retry: () => void;
  actionBusy: boolean;
}) {
  const employment = staff?.employment;
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={close}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': 'Chi tiết nhân viên',
          sx: { width: { xs: '100%', sm: 500 }, maxWidth: '100vw' },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', p: 2.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {staff && <Initials staff={staff} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>
            {staff ? staffName(staff) : 'Chi tiết nhân viên'}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Staff</Typography>
        </Box>
        <IconButton aria-label="Đóng chi tiết" onClick={close}>
          <X size={20} />
        </IconButton>
      </Stack>
      <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto' }}>
        <OwnerFeedback busy={busy} error={error} notice={notice} />
        {!!error && <Button onClick={retry}>Tải lại hồ sơ</Button>}
        {staff && (
          <Stack spacing={2.5} divider={<Divider />}>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Thông tin tài khoản
              </Typography>
              <Field label="Họ và tên">{staffName(staff)}</Field>
              <Field label="Email">{staff.email}</Field>
              <Field label="Số điện thoại">{staff.phone || 'Chưa cập nhật'}</Field>
              <Field label="Tài khoản">
                <AccountBadge active={staff.isActive} />
              </Field>
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Hợp đồng làm việc
              </Typography>
              {employment ? (
                <>
                  <Field label="Mã hợp đồng">{employment.contractNumber || 'Chưa cập nhật'}</Field>
                  <Field label="Loại công việc">{employment.employmentType}</Field>
                  <Field label="Trạng thái hợp đồng">
                    <EmploymentBadge status={employment.status} />
                  </Field>
                  <Field label="Ngày bắt đầu">{staffDate(employment.startDate)}</Field>
                  <Field label="Ngày kết thúc">{staffDate(employment.endDate)}</Field>
                </>
              ) : (
                <Typography sx={{ fontSize: 14 }} color="text.secondary">
                  Chưa có hợp đồng
                </Typography>
              )}
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Chính sách lương
              </Typography>
              <Field label="Hình thức lương">{employment?.salaryType || 'Chưa thiết lập'}</Field>
              <Field label="Mức lương">
                {employment?.baseRate != null
                  ? `${employment.baseRate.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} VND`
                  : 'Chưa thiết lập'}
              </Field>
            </Box>
          </Stack>
        )}
      </Box>
      {staff && (
        <Stack
          spacing={1}
          sx={{
            p: 2.5,
            borderTop: 1,
            borderColor: 'divider',
            '& .MuiButton-root': { minHeight: 40, borderRadius: '8px', fontSize: 14 },
          }}
        >
          <Button variant="contained" disabled={busy} onClick={() => edit(staff)}>
            Chỉnh sửa hồ sơ
          </Button>
          <Button variant="outlined" disabled={actionBusy || !staff.isActive} onClick={invite}>
            Gửi thông tin tài khoản
          </Button>
          {!staff.isActive && (
            <Typography sx={{ fontSize: 12 }} color="text.secondary">
              Chỉ gửi thông tin cho tài khoản đang hoạt động.
            </Typography>
          )}
          <Button href={`/staff-assignments?staffUserId=${encodeURIComponent(staff.userId)}`}>
            Xem phân công cơ sở
          </Button>
        </Stack>
      )}
    </Drawer>
  );
}
