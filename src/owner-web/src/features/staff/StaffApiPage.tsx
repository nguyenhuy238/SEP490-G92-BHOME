import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Checkbox,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { PageHeader, StatusChip, ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { StaffAssignments } from './StaffAssignments';
import { todayVietnam, type Employment, type Staff } from './staffContracts';

export function StaffApiPage() {
  const [search, setSearch] = useState(''),
    [active, setActive] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<Staff | null | undefined>();
  const [invite, setInvite] = useState(false);
  const action = useOwnerAction();
  const list = useOwnerQuery<OwnerPage<Staff>>(
    ['staff', search, active, page],
    '/api/v1/staff?' + ownerQuery({ search, isActive: active, page, pageSize: 20 }),
  );
  const detail = useOwnerQuery<Staff>(
    ['staff-detail', selected],
    `/api/v1/staff/${selected}`,
    !!selected,
  );
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Quản lý nhân viên"
        subtitle="Tài khoản, hồ sơ công việc và cơ sở phụ trách."
        actions={
          <Button variant="contained" onClick={() => setEditor(null)}>
            Thêm nhân viên
          </Button>
        }
      />
      <OwnerFeedback
        busy={list.isFetching || detail.isFetching || action.busy}
        error={action.error || list.error || detail.error}
        notice={action.notice}
      />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          label="Tìm nhân viên"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <TextField
          select
          label="Trạng thái tài khoản"
          value={active}
          onChange={(e) => {
            setActive(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả</MenuItem>
          <MenuItem value="true">Đang hoạt động</MenuItem>
          <MenuItem value="false">Đã ngừng hoạt động</MenuItem>
        </TextField>
        <Button
          onClick={() => {
            void list.refetch();
            if (selected) void detail.refetch();
          }}
        >
          Tải lại
        </Button>
      </Stack>
      <Paper>
        <OwnerTable
          rows={list.data?.items ?? []}
          id={(x) => x.userId}
          select={(x) => setSelected(x.userId)}
          columns={[
            { label: 'Nhân viên', render: (x) => x.fullName },
            { label: 'Liên hệ', render: (x) => `${x.email} · ${x.phone ?? ''}` },
            { label: 'Công việc', render: (x) => x.employment?.employmentType ?? 'Chưa có' },
            {
              label: 'Tài khoản',
              render: (x) => (
                <StatusChip label={x.isActive ? 'Đang hoạt động' : 'Đã ngừng hoạt động'} />
              ),
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
      {detail.data && (
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">{detail.data.fullName}</Typography>
            <Typography>
              {detail.data.email} · {detail.data.phone}
            </Typography>
            <Typography>
              Công việc: {detail.data.employment?.employmentType} · {detail.data.employment?.status}{' '}
              · {detail.data.employment?.startDate} –{' '}
              {detail.data.employment?.endDate ?? 'Chưa kết thúc'}
            </Typography>
            <Typography>
              Lương / phụ cấp thỏa thuận:{' '}
              {detail.data.employment?.baseRate?.toLocaleString('vi-VN') ?? 'Chưa khai báo'} ·{' '}
              {detail.data.employment?.salaryType}
            </Typography>
            <Stack direction="row">
              <Button onClick={() => setEditor(detail.data)}>
                Chỉnh sửa tài khoản và công việc
              </Button>
              <Button
                disabled={action.busy || !detail.data.isActive}
                onClick={() => setInvite(true)}
              >
                Gửi lời mời tài khoản
              </Button>
              <Button onClick={() => setSelected('')}>Đóng chi tiết</Button>
            </Stack>
            <StaffAssignments key={selected} staff={detail.data} />
          </Stack>
        </Paper>
      )}
      <ConfirmDialog
        error={action.error}
        open={invite}
        title="Gửi lời mời tài khoản"
        busy={action.busy}
        onClose={() => setInvite(false)}
        onConfirm={() => {
          void action
            .run(() => action.command(`/api/v1/staff/${selected}/invitation`, 'POST'))
            .then((ok) => {
              if (ok) setInvite(false);
            });
        }}
      >
        Gửi lời mời đến địa chỉ email hiện tại của nhân viên.
      </ConfirmDialog>
      {editor !== undefined && <StaffEditor staff={editor} close={() => setEditor(undefined)} />}
    </Stack>
  );
}
function StaffEditor({ staff, close }: { staff: Staff | null; close: () => void }) {
  const action = useOwnerAction();
  const [name, setName] = useState(staff?.fullName ?? ''),
    [email, setEmail] = useState(staff?.email ?? ''),
    [phone, setPhone] = useState(staff?.phone ?? ''),
    [password, setPassword] = useState(''),
    [reason, setReason] = useState(''),
    [active, setActive] = useState(staff?.isActive ?? true);
  const [employment, setEmployment] = useState<Employment>(
    staff?.employment ?? {
      contractNumber: null,
      employmentType: '',
      startDate: todayVietnam(),
      endDate: null,
      salaryType: null,
      baseRate: null,
      status: 'Active',
    },
  );
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof Employment>(key: K, value: Employment[K]) =>
    setEmployment((x) => ({ ...x, [key]: value }));
  async function save() {
    const { id: _id, ...work } = employment;
    const body = {
      fullName: name.trim(),
      email: email.trim(),
      phone: phone || null,
      employment: work,
      ...(staff
        ? { accountVersion: staff.accountVersion, isActive: active, reason }
        : { initialPassword: password }),
    };
    if (
      await action.run(() =>
        action.command(
          staff ? `/api/v1/staff/${staff.userId}` : '/api/v1/staff',
          staff ? 'PUT' : 'POST',
          body,
        ),
      )
    )
      close();
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!action.busy) close();
      }}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{staff ? 'Chỉnh sửa nhân viên' : 'Thêm nhân viên'}</DialogTitle>
      <DialogContent>
        <form
          id="staff-editor"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirm(true);
          }}
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <OwnerFeedback {...action} />
            <TextField
              required
              label="Họ tên"
              value={name}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { minLength: 2, maxLength: 150 } }}
            />
            <TextField
              required
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Số điện thoại"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {!staff && (
              <TextField
                required
                type="password"
                autoComplete="new-password"
                label="Mật khẩu khởi tạo"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                slotProps={{ htmlInput: { minLength: 12, maxLength: 256 } }}
              />
            )}
            <TextField
              label="Số hợp đồng lao động"
              value={employment.contractNumber ?? ''}
              onChange={(e) => set('contractNumber', e.target.value || null)}
            />
            <TextField
              required
              label="Loại công việc"
              value={employment.employmentType}
              onChange={(e) => set('employmentType', e.target.value)}
            />
            <TextField
              required
              type="date"
              label="Ngày bắt đầu"
              value={employment.startDate}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(e) => set('startDate', e.target.value)}
            />
            <TextField
              type="date"
              required={employment.status === 'Ended'}
              label="Ngày kết thúc"
              value={employment.endDate ?? ''}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: employment.startDate } }}
              onChange={(e) => set('endDate', e.target.value || null)}
            />
            <TextField
              label="Hình thức lương"
              value={employment.salaryType ?? ''}
              onChange={(e) => set('salaryType', e.target.value || null)}
            />
            <TextField
              type="number"
              label="Mức lương thỏa thuận (VND)"
              value={employment.baseRate ?? ''}
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
              onChange={(e) =>
                set('baseRate', e.target.value === '' ? null : Number(e.target.value))
              }
            />
            <TextField
              select
              label="Trạng thái công việc"
              value={employment.status}
              onChange={(e) => set('status', e.target.value)}
            >
              <MenuItem value="Active">Đang làm việc</MenuItem>
              <MenuItem value="Ended">Đã kết thúc</MenuItem>
            </TextField>
            {staff && (
              <>
                <FormControlLabel
                  label="Tài khoản hoạt động"
                  control={<Checkbox checked={active} onChange={(_, v) => setActive(v)} />}
                />
                <TextField
                  required
                  label="Lý do cập nhật"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
              </>
            )}
          </Stack>
        </form>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button form="staff-editor" type="submit" disabled={action.busy}>
          Kiểm tra và lưu
        </Button>
      </DialogActions>
      <ConfirmDialog
        error={action.error}
        open={confirm}
        title="Xác nhận lưu hồ sơ"
        busy={action.busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void save()}
      >
        {active
          ? 'Lưu thông tin tài khoản và công việc.'
          : 'Ngừng tài khoản. Máy chủ sẽ từ chối nếu còn trách nhiệm chưa giải quyết.'}
      </ConfirmDialog>
    </Dialog>
  );
}
