import { useState } from 'react';
import {
  Alert,
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
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' } }}
        >
          <TextField
            sx={{ minWidth: 260, flex: 1 }}
            label="Tìm nhân viên"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <TextField
            sx={{ minWidth: 230 }}
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
      </Paper>
      <Paper>
        <OwnerTable
          rows={list.data?.items ?? []}
          id={(x) => x.userId}
          select={(x) => setSelected(x.userId)}
          selectLabel="Quản lý"
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
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{ justifyContent: 'space-between', gap: 1 }}
            >
              <Stack spacing={0.5}>
                <Typography variant="h5">{detail.data.fullName}</Typography>
                <Typography color="text.secondary">Hồ sơ nhân viên và phạm vi phụ trách</Typography>
              </Stack>
              <StatusChip label={detail.data.isActive ? 'Đang hoạt động' : 'Đã ngừng hoạt động'} />
            </Stack>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Thông tin tài khoản
                  </Typography>
                  <Typography>Email: {detail.data.email}</Typography>
                  <Typography>Điện thoại: {detail.data.phone || 'Chưa khai báo'}</Typography>
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Thông tin công việc
                  </Typography>
                  <Typography>
                    Loại công việc: {detail.data.employment?.employmentType || 'Chưa khai báo'}
                  </Typography>
                  <Typography>
                    Trạng thái: {detail.data.employment?.status || 'Chưa khai báo'}
                  </Typography>
                  <Typography>
                    Hiệu lực: {detail.data.employment?.startDate || 'Chưa có'} –{' '}
                    {detail.data.employment?.endDate ?? 'Chưa kết thúc'}
                  </Typography>
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Lương thỏa thuận
                  </Typography>
                  <Typography>
                    Mức lương:{' '}
                    {detail.data.employment?.baseRate?.toLocaleString('vi-VN') ?? 'Chưa khai báo'}{' '}
                    VND
                  </Typography>
                  <Typography>
                    Hình thức: {detail.data.employment?.salaryType || 'Chưa khai báo'}
                  </Typography>
                </Stack>
              </Paper>
            </Stack>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.default' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button variant="contained" onClick={() => setEditor(detail.data)}>
                  Chỉnh sửa hồ sơ
                </Button>
                <Button
                  variant="outlined"
                  disabled={action.busy || !detail.data.isActive}
                  onClick={() => setInvite(true)}
                >
                  Gửi thông tin tài khoản
                </Button>
                <Button onClick={() => setSelected('')}>Đóng chi tiết</Button>
              </Stack>
            </Paper>
            <StaffAssignments key={selected} staff={detail.data} />
          </Stack>
        </Paper>
      )}
      <ConfirmDialog
        error={action.error}
        open={invite}
        title="Gửi thông tin tài khoản"
        busy={action.busy}
        onClose={() => setInvite(false)}
        onConfirm={() => {
          void action
            .run(
              () => action.command(`/api/v1/staff/${selected}/invitation`, 'POST'),
              'Đã tiếp nhận yêu cầu lời mời. Email đang chờ xử lý; chưa phải xác nhận đã giao thư.',
            )
            .then((ok) => {
              if (ok) setInvite(false);
            });
        }}
      >
        Gửi liên kết dùng một lần để nhân viên tự đặt mật khẩu đến email hiện tại. Không gửi mật
        khẩu rõ.
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
    const work = { ...employment };
    delete work.id;
    const body = {
      fullName: name.trim(),
      email: email.trim(),
      phone: phone || null,
      employment: work,
      ...(staff ? { accountVersion: staff.accountVersion, isActive: active, reason } : {}),
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
              <Alert severity="info">
                Nhân viên tự đặt mật khẩu qua lời mời email. Sau khi tạo, chọn Gửi thông tin tài
                khoản trong chi tiết nhân viên.
              </Alert>
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
