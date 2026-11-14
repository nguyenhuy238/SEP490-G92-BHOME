import type { ReactNode } from 'react';
import {
  Avatar,
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import { ChevronDown, X } from 'lucide-react';
import { OwnerFeedback, OwnerTable } from '../../../components/common/OwnerWorkspace';
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import {
  todayVietnam,
  type Staff,
  type EmploymentPeriod,
  type StaffResponsibilities,
} from '../staffContracts';

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
export function EmploymentBadge({
  status,
  startDate,
  endDate,
}: {
  status: string;
  startDate?: string;
  endDate?: string | null;
}) {
  const today = todayVietnam();
  const future = status === 'Active' && !!startDate && startDate > today;
  const expired = status === 'Active' && !!endDate && endDate < today;
  return (
    <Chip
      size="small"
      label={
        future
          ? 'Sắp hiệu lực'
          : expired
            ? 'Đã hết hạn'
            : status === 'Active'
              ? 'Đang làm việc'
              : status === 'Ended'
                ? 'Đã kết thúc'
                : status
      }
      color={future ? 'info' : expired ? 'warning' : status === 'Active' ? 'success' : 'default'}
      sx={{ fontSize: 12, height: 26 }}
    />
  );
}
function ExpiryHint({ staff }: { staff: Staff }) {
  const employment = staff.employment;
  if (!employment?.endDate || employment.status !== 'Active') return null;
  const days = Math.round((Date.parse(employment.endDate) - Date.parse(todayVietnam())) / 86400000);
  return days < 0 || days <= 30 ? (
    <Typography sx={{ fontSize: 12, color: 'warning.dark' }}>
      {days < 0 ? 'Đã quá ngày kết thúc' : `Hết hạn trong ${days} ngày`}
    </Typography>
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
                  <EmploymentBadge {...staff.employment} />
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
                <EmploymentBadge {...staff.employment} />
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
  renew,
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
  renew: (staff: Staff) => void;
  invite: () => void;
  retry: () => void;
  actionBusy: boolean;
}) {
  const employment = staff?.employment;
  const responsibilities = useOwnerQuery<StaffResponsibilities>(
    ['staff-responsibilities', staff?.userId],
    `/api/v1/staff/${staff?.userId}/responsibilities`,
    open && !!staff,
  );
  const periods = useOwnerQuery<EmploymentPeriod[]>(
    ['staff-employments', staff?.userId],
    `/api/v1/staff/${staff?.userId}/employments`,
    open && !!staff,
  );
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
          {staff && <AccountBadge active={staff.isActive} />}
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
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1,
                }}
              >
                <Typography variant="h6" sx={{ fontSize: 16 }}>
                  Trách nhiệm vận hành
                </Typography>
                <Button href={`/staff-assignments?staffUserId=${encodeURIComponent(staff.userId)}`}>
                  Xem phân công cơ sở
                </Button>
              </Stack>
              <StaffResponsibilitiesPanel
                staffId={staff.userId}
                data={responsibilities.data}
                busy={responsibilities.isFetching}
                error={responsibilities.error}
                retry={() => void responsibilities.refetch()}
              />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                Thông tin tài khoản
              </Typography>
              <Field label="Họ và tên">{staffName(staff)}</Field>
              <Field label="Email">{staff.email}</Field>
              <Field label="Số điện thoại">{staff.phone || 'Chưa cập nhật'}</Field>
            </Box>
            <Box>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1,
                }}
              >
                <Typography variant="h6" sx={{ fontSize: 16 }}>
                  Hợp đồng lao động
                </Typography>
                <Button
                  onClick={() => renew(staff)}
                  disabled={busy || periods.isFetching || !!periods.error}
                >
                  {employment ? 'Tạo kỳ hợp đồng mới' : 'Thêm hợp đồng'}
                </Button>
              </Stack>
              {employment ? (
                <>
                  <Field label="Mã hợp đồng">{employment.contractNumber || 'Chưa cập nhật'}</Field>
                  <Field label="Loại công việc">{employment.employmentType}</Field>
                  <Field label="Trạng thái hợp đồng">
                    <EmploymentBadge {...employment} />
                  </Field>
                  <Field label="Ngày bắt đầu">{staffDate(employment.startDate)}</Field>
                  <Field label="Ngày kết thúc">{staffDate(employment.endDate)}</Field>
                  <ExpiryHint staff={staff} />
                  {employment.startDate > todayVietnam() && (
                    <Typography color="warning.dark" variant="body2">
                      Hợp đồng chưa đến ngày bắt đầu.
                    </Typography>
                  )}
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
              <EmploymentHistory
                data={periods.data}
                busy={periods.isFetching}
                error={periods.error}
                retry={() => void periods.refetch()}
              />
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
          <Button href={`/operational-tasks?staffUserId=${encodeURIComponent(staff.userId)}`}>
            Xem công việc vận hành
          </Button>
        </Stack>
      )}
    </Drawer>
  );
}

const responsibilityLabels: Record<string, string> = {
  GENERAL: 'Vận hành',
  METER_READ: 'Điện nước',
  WORK_ORDER: 'Bảo trì',
};
const responsibilityLink = (task: StaffResponsibilities['tasks'][number]) => {
  const location = encodeURIComponent(task.locationId);
  const id = encodeURIComponent(task.id);
  if (task.taskType === 'GENERAL') return `/operational-tasks?locationId=${location}&taskId=${id}`;
  if (task.taskType === 'METER_READ') return `/meters?locationId=${location}&taskId=${id}`;
  if (task.taskType === 'WORK_ORDER')
    return `/maintenance?locationId=${location}&workOrderId=${id}`;
  return undefined;
};
export function StaffResponsibilitiesPanel({
  staffId,
  data,
  busy,
  error,
  retry,
}: {
  staffId: string;
  data?: StaffResponsibilities;
  busy: boolean;
  error: unknown;
  retry: () => void;
}) {
  const ready =
    data &&
    Array.isArray(data.assignments) &&
    Array.isArray(data.tasks) &&
    Array.isArray(data.moveOuts);
  return (
    <Stack spacing={1.25} sx={{ mt: 1 }}>
      <OwnerFeedback busy={busy} error={error} />
      {!!error && <Button onClick={retry}>Tải lại trách nhiệm</Button>}
      {ready && (
        <>
          <Typography
            variant="body2"
            color={data.canDeactivate ? 'text.secondary' : 'warning.dark'}
          >
            {data.canDeactivate
              ? 'Không còn trách nhiệm chưa xử lý.'
              : 'Cần giải quyết các trách nhiệm sau trước khi ngừng tài khoản.'}
          </Typography>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip label={`${data.assignments.length} phân công`} size="small" />
            <Chip label={`${data.tasks.length} công việc mở`} size="small" />
            <Chip label={`${data.moveOuts.length} kiểm tra trả phòng`} size="small" />
          </Stack>
          {!!data.assignments.length && (
            <Accordion disableGutters elevation={0} variant="outlined">
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                Cơ sở đang/sắp phụ trách ({data.assignments.length})
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1} divider={<Divider />}>
                  {data.assignments.map((item) => (
                    <Stack key={item.id} direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {item.locationName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {staffDate(item.startDate)} –{' '}
                          {item.endDate === '9999-12-31'
                            ? 'Không xác định thời hạn'
                            : staffDate(item.endDate)}
                        </Typography>
                      </Box>
                      <Button
                        href={`/staff-assignments?staffUserId=${encodeURIComponent(staffId)}&locationId=${encodeURIComponent(item.locationId)}`}
                      >
                        Xử lý
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
          {!!(data.tasks.length + data.moveOuts.length) && (
            <Accordion disableGutters elevation={0} variant="outlined">
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                Công việc chưa kết thúc ({data.tasks.length + data.moveOuts.length})
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1} divider={<Divider />}>
                  {data.tasks.map((item) => (
                    <Stack key={item.id} direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.locationName} ·{' '}
                          {responsibilityLabels[item.taskType] ?? item.taskType}
                        </Typography>
                      </Box>
                      {responsibilityLink(item) && (
                        <Button href={responsibilityLink(item)}>Xem</Button>
                      )}
                    </Stack>
                  ))}
                  {data.moveOuts.map((item) => (
                    <Stack
                      key={item.contractId}
                      direction="row"
                      sx={{ alignItems: 'center', gap: 1 }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Kiểm tra trả phòng {item.roomNumber}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.locationName}
                        </Typography>
                      </Box>
                      <Button href={`/contracts?contractId=${encodeURIComponent(item.contractId)}`}>
                        Xem
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
        </>
      )}
      {!ready && !busy && !error && (
        <Alert severity="info">
          Chưa tải được dữ liệu trách nhiệm. Kiểm tra lại trước khi ngừng tài khoản.
          <Button onClick={retry}>Tải lại</Button>
        </Alert>
      )}
    </Stack>
  );
}
function EmploymentHistory({
  data,
  busy,
  error,
  retry,
}: {
  data?: EmploymentPeriod[];
  busy: boolean;
  error: unknown;
  retry: () => void;
}) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
        Lịch sử hợp đồng
      </Typography>
      <OwnerFeedback busy={busy} error={error} />
      {!!error && <Button onClick={retry}>Tải lại hợp đồng</Button>}
      {Array.isArray(data) &&
        (data.length ? (
          data.map((period) => (
            <Accordion
              key={period.id}
              disableGutters
              elevation={0}
              variant="outlined"
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {period.contractNumber || period.employmentType}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {staffDate(period.startDate)} – {staffDate(period.endDate)}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  <EmploymentBadge {...period} />
                  <Typography variant="body2">
                    {period.employmentType} ·{' '}
                    {period.salaryType || 'Chưa thiết lập hình thức lương'}
                    {period.baseRate != null
                      ? ` · ${period.baseRate.toLocaleString('vi-VN')} VND`
                      : ''}
                  </Typography>
                  {period.history.map((entry, index) => (
                    <Box key={`${entry.occurredAt}-${index}`}>
                      <Typography variant="caption" color="text.secondary">
                        {formatInstant(entry.occurredAt)} ·{' '}
                        {entry.action === 'Created'
                          ? 'Tạo hợp đồng'
                          : entry.action === 'Updated'
                            ? 'Cập nhật'
                            : entry.action}
                      </Typography>
                      {entry.reason && <Typography variant="body2">{entry.reason}</Typography>}
                      {entry.before && entry.after && (
                        <Typography variant="caption" sx={{ display: 'block' }}>
                          {staffDate(entry.before.startDate)} – {staffDate(entry.before.endDate)} →{' '}
                          {staffDate(entry.after.startDate)} – {staffDate(entry.after.endDate)}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))
        ) : (
          <Typography variant="body2" color="text.secondary">
            Chưa có kỳ hợp đồng.
          </Typography>
        ))}
    </Box>
  );
}
