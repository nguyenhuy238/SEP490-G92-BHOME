import { useEffect, useState } from 'react';
import {
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Plus, RefreshCw, Search, X, Users, UserCheck } from 'lucide-react';
import { ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerPagination } from '../../components/common/OwnerWorkspace';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import type { Staff } from './staffContracts';
import { StaffTable, StaffDetailDrawer } from './components/StaffPresentation';
import { StaffEditor } from './components/StaffEditor';

export function StaffApiPage() {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState({ search: '', active: '', page: 1 });
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<Staff | null | undefined>();
  const [invite, setInvite] = useState(false);
  const action = useOwnerAction();
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilter((current) =>
          current.search === input ? current : { ...current, search: input, page: 1 },
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [input]);
  const list = useOwnerQuery<OwnerPage<Staff>>(
    ['staff', filter.search, filter.active, filter.page],
    '/api/v1/staff?' +
      ownerQuery({
        search: filter.search,
        isActive: filter.active,
        page: filter.page,
        pageSize: 20,
      }),
  );
  const overview = useOwnerQuery<OwnerPage<Staff>>(
    ['staff-overview'],
    '/api/v1/staff?page=1&pageSize=1',
  );
  const activeOverview = useOwnerQuery<OwnerPage<Staff>>(
    ['staff-overview-active'],
    '/api/v1/staff?isActive=true&page=1&pageSize=1',
  );
  const detail = useOwnerQuery<Staff>(
    ['staff-detail', selected],
    `/api/v1/staff/${selected}`,
    !!selected,
  );
  const refresh = () => {
    void list.refetch();
    void overview.refetch();
    void activeOverview.refetch();
  };
  return (
    <Stack
      spacing={2.5}
      sx={{
        '& .MuiPaper-root': { borderRadius: '12px', boxShadow: 'none' },
        '& .MuiButton-root': { borderRadius: '8px', fontSize: 14, minHeight: 40 },
        '& .MuiInputBase-root, & .MuiInputLabel-root': { fontSize: 14 },
        '& .MuiTableCell-root': { fontSize: 14, py: 1.75 },
        '& .MuiTableHead-root .MuiTableCell-root': { bgcolor: '#f5f8fc', fontSize: 13, height: 44 },
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
            Quản lý nhân viên
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>
            Quản lý tài khoản, hợp đồng và trạng thái làm việc của nhân viên.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setEditor(null)}>
          Thêm nhân viên
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {[
          { label: 'Tổng nhân viên', query: overview, icon: <Users size={22} /> },
          {
            label: 'Tài khoản đang hoạt động',
            query: activeOverview,
            icon: <UserCheck size={22} />,
          },
        ].map(({ label, query, icon }) => (
          <Paper
            key={label}
            variant="outlined"
            sx={{ p: 2, flex: 1, minHeight: 88, display: 'flex', gap: 2, alignItems: 'center' }}
          >
            <Box
              sx={{
                color: 'primary.main',
                bgcolor: '#edf2ff',
                p: 1.25,
                borderRadius: '10px',
                display: 'flex',
              }}
            >
              {icon}
            </Box>
            <Box>
              <Typography sx={{ fontSize: 26, fontWeight: 700 }}>
                {query.isError ? '—' : (query.data?.totalCount ?? '…')}
              </Typography>
              <Typography sx={{ fontSize: 14 }} color="text.secondary">
                {label}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Stack>
      <OwnerFeedback error={overview.error || activeOverview.error} />
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ p: 2, alignItems: { sm: 'center' } }}
        >
          <TextField
            size="small"
            label="Tìm nhân viên"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={18} />
                  </InputAdornment>
                ),
                endAdornment: input ? (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label="Xóa tìm kiếm" onClick={() => setInput('')}>
                      <X size={16} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          <TextField
            size="small"
            select
            label="Trạng thái tài khoản"
            value={filter.active}
            onChange={(event) =>
              setFilter((current) => ({ ...current, active: event.target.value, page: 1 }))
            }
            sx={{ width: { xs: '100%', sm: 220 } }}
          >
            <MenuItem value="">Tất cả</MenuItem>
            <MenuItem value="true">Đang hoạt động</MenuItem>
            <MenuItem value="false">Đã ngừng hoạt động</MenuItem>
          </TextField>
          <Button startIcon={<RefreshCw size={17} />} disabled={list.isFetching} onClick={refresh}>
            Làm mới
          </Button>
        </Stack>
        <Box sx={{ minHeight: 4 }}>
          <OwnerFeedback busy={list.isFetching} />
        </Box>
        <StaffTable
          rows={list.data?.items ?? []}
          select={(staff) => setSelected(staff.userId)}
          loading={list.isPending}
          error={list.error}
          retry={() => void list.refetch()}
        />
        {list.data && (
          <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
            {list.data.totalCount > 20 ? (
              <OwnerPagination
                page={filter.page}
                total={list.data.totalCount}
                change={(page) => setFilter((current) => ({ ...current, page }))}
                busy={list.isFetching}
              />
            ) : (
              <Typography sx={{ fontSize: 13 }} color="text.secondary">
                {list.data.totalCount} nhân viên
              </Typography>
            )}
          </Box>
        )}
      </Paper>
      <StaffDetailDrawer
        open={!!selected}
        staff={detail.data}
        busy={detail.isFetching}
        error={detail.error || action.error}
        notice={action.notice}
        close={() => setSelected('')}
        edit={setEditor}
        invite={() => setInvite(true)}
        retry={() => void detail.refetch()}
        actionBusy={action.busy}
      />
      <ConfirmDialog
        error={action.error}
        open={invite}
        title="Gửi thông tin tài khoản"
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
    const work = { ...employment };
    delete work.id;
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
