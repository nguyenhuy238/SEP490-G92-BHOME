import { useState } from 'react';
import {
  Alert,
  Box,
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
import { ConfirmDialog } from '../../../components/common/PortalUI';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { useOwnerAction } from '../../../hooks/useOwnerWorkspace';
import { todayVietnam, type Employment, type Staff } from '../staffContracts';
import { ApiError } from '../../../../../../packages/client-core/src/api';
export function StaffEditor({ staff, close }: { staff: Staff | null; close: () => void }) {
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const dateError =
    employment.endDate && employment.endDate < employment.startDate
      ? 'Ngày kết thúc không được trước ngày bắt đầu.'
      : '';
  const fieldError = (field: string) => ({
    error: !!fieldErrors[field],
    helperText: fieldErrors[field],
  });
  const set = <K extends keyof Employment>(key: K, value: Employment[K]) =>
    setEmployment((x) => ({ ...x, [key]: value }));
  async function save() {
    if (dateError) {
      setConfirm(false);
      return;
    }
    setFieldErrors({});
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
      await action.run(async () => {
        try {
          return await action.command(
            staff ? `/api/v1/staff/${staff.userId}` : '/api/v1/staff',
            staff ? 'PUT' : 'POST',
            body,
          );
        } catch (error) {
          if (error instanceof ApiError)
            setFieldErrors(
              Object.fromEntries(
                Object.entries(error.problem?.errors ?? {}).map(([key, messages]) => [
                  key.split('.').pop()!.toLowerCase(),
                  messages.join(' '),
                ]),
              ),
            );
          throw error;
        }
      })
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
      maxWidth="md"
      slotProps={{
        paper: {
          sx: {
            borderRadius: '12px',
            '& .MuiInputBase-root, & .MuiInputLabel-root': { fontSize: 14 },
            '& .MuiButton-root': { fontSize: 14, borderRadius: '8px', minHeight: 40 },
          },
        },
      }}
    >
      <DialogTitle>{staff ? 'Chỉnh sửa nhân viên' : 'Thêm nhân viên'}</DialogTitle>
      <DialogContent>
        <form
          id="staff-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (dateError) return;
            setConfirm(true);
          }}
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <OwnerFeedback {...action} />
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Thông tin tài khoản</Typography>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              <TextField
                required
                label="Họ tên"
                {...fieldError('fullname')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                slotProps={{ htmlInput: { minLength: 2, maxLength: 150 } }}
              />
              <TextField
                required
                type="email"
                label="Email"
                {...fieldError('email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextField
                label="Số điện thoại"
                {...fieldError('phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Box>
            {!staff && (
              <Alert severity="info">
                Nhân viên tự đặt mật khẩu qua lời mời email. Sau khi tạo, chọn Gửi thông tin tài
                khoản trong chi tiết nhân viên.
              </Alert>
            )}
            {staff && (
              <FormControlLabel
                label="Tài khoản hoạt động"
                control={<Checkbox checked={active} onChange={(_, v) => setActive(v)} />}
              />
            )}
            <Divider />
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Hợp đồng làm việc</Typography>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              <TextField
                label="Số hợp đồng lao động"
                {...fieldError('contractnumber')}
                value={employment.contractNumber ?? ''}
                onChange={(e) => set('contractNumber', e.target.value || null)}
              />
              <TextField
                required
                label="Loại công việc"
                {...fieldError('employmenttype')}
                value={employment.employmentType}
                onChange={(e) => set('employmentType', e.target.value)}
              />
              <TextField
                required
                type="date"
                label="Ngày bắt đầu"
                {...fieldError('startdate')}
                value={employment.startDate}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(e) => set('startDate', e.target.value)}
              />
              <TextField
                type="date"
                required={employment.status === 'Ended'}
                label="Ngày kết thúc"
                error={!!dateError || !!fieldErrors.enddate}
                helperText={
                  dateError || fieldErrors.enddate || 'Để trống nếu không xác định thời hạn.'
                }
                value={employment.endDate ?? ''}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { min: employment.startDate },
                }}
                onChange={(e) => set('endDate', e.target.value || null)}
              />
              <TextField
                label="Hình thức lương"
                {...fieldError('salarytype')}
                value={employment.salaryType ?? ''}
                onChange={(e) => set('salaryType', e.target.value || null)}
              />
              <TextField
                type="number"
                label="Mức lương thỏa thuận (VND)"
                {...fieldError('baserate')}
                value={employment.baseRate ?? ''}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                onChange={(e) =>
                  set('baseRate', e.target.value === '' ? null : Number(e.target.value))
                }
              />
              <TextField
                select
                label="Trạng thái công việc"
                {...fieldError('status')}
                value={employment.status}
                onChange={(e) => set('status', e.target.value)}
              >
                <MenuItem value="Active">Đang làm việc</MenuItem>
                <MenuItem value="Ended">Đã kết thúc</MenuItem>
              </TextField>
            </Box>
            {staff && (
              <>
                <TextField
                  required
                  label="Lý do cập nhật"
                  {...fieldError('reason')}
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
        <Button variant="contained" form="staff-editor" type="submit" disabled={action.busy}>
          {action.busy ? 'Đang lưu…' : staff ? 'Lưu thay đổi' : 'Tạo nhân viên'}
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
