import { MoneyField } from '../../../components/common/MoneyField';
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
import { useOwnerAction, useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import {
  todayVietnam,
  type Employment,
  type Staff,
  type StaffResponsibilities,
} from '../staffContracts';
import { StaffResponsibilitiesPanel } from './StaffPresentation';
import { ApiError } from '../../../../../../packages/client-core/src/api';
export function StaffEditor({
  staff,
  renewal = false,
  close,
}: {
  staff: Staff | null;
  renewal?: boolean;
  close: () => void;
}) {
  const action = useOwnerAction();
  const [name, setName] = useState(staff?.fullName ?? ''),
    [email, setEmail] = useState(staff?.email ?? ''),
    [phone, setPhone] = useState(staff?.phone ?? ''),
    [reason, setReason] = useState(''),
    [active, setActive] = useState(staff?.isActive ?? true);
  const [baseline, setBaseline] = useState(staff);
  const previousEnd = baseline?.employment?.endDate;
  const nextStart =
    previousEnd && previousEnd >= todayVietnam() && previousEnd !== '9999-12-31'
      ? new Date(Date.parse(previousEnd) + 86400000).toISOString().slice(0, 10)
      : todayVietnam();
  const [employment, setEmployment] = useState<Employment>(
    renewal
      ? {
          ...staff?.employment,
          contractNumber: null,
          employmentType: staff?.employment?.employmentType ?? '',
          startDate: nextStart,
          endDate: null,
          salaryType: staff?.employment?.salaryType ?? null,
          baseRate: staff?.employment?.baseRate ?? null,
          status: 'Active',
        }
      : (staff?.employment ?? {
          contractNumber: null,
          employmentType: '',
          startDate: todayVietnam(),
          endDate: null,
          salaryType: null,
          baseRate: null,
          status: 'Active',
        }),
  );
  const [baseRate, setBaseRate] = useState(String(staff?.employment?.baseRate ?? ''));
  const [confirm, setConfirm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const responsibilities = useOwnerQuery<StaffResponsibilities>(
    ['staff-responsibilities', staff?.userId],
    `/api/v1/staff/${staff?.userId}/responsibilities`,
    !!staff && !renewal && !active,
  );
  const [version, setVersion] = useState(staff?.accountVersion);
  const [stale, setStale] = useState(false);
  const [latest, setLatest] = useState<Staff>();
  const [reloadError, setReloadError] = useState('');
  const openEnded = renewal && !!baseline?.employment && !baseline.employment.endDate;
  const renewalOverlap = renewal && !!previousEnd && employment.startDate <= previousEnd;
  const blocked =
    !!openEnded ||
    !!renewalOverlap ||
    stale ||
    (!!staff && !renewal && !active && responsibilities.data?.canDeactivate === false);
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
    if (dateError || blocked) {
      setConfirm(false);
      return;
    }
    setFieldErrors({});
    const work = {
      ...employment,
      // ASP.NET's web JSON options accept decimal strings. Preserve large VND inputs
      // exactly while retaining the existing numeric payload for ordinary salaries.
      baseRate: baseRate === '' ? null : baseRate.length <= 14 ? Number(baseRate) : baseRate,
    };
    delete work.id;
    const body = renewal
      ? { accountVersion: version, employment: work, reason: reason.trim() }
      : {
          fullName: name.trim(),
          email: email.trim(),
          phone: phone || null,
          employment: work,
          ...(staff ? { accountVersion: version, isActive: active, reason } : {}),
        };
    if (
      await action.run(async () => {
        try {
          return await action.command(
            renewal
              ? `/api/v1/staff/${staff!.userId}/employments`
              : staff
                ? `/api/v1/staff/${staff.userId}`
                : '/api/v1/staff',
            staff && !renewal ? 'PUT' : 'POST',
            body,
          );
        } catch (error) {
          if (error instanceof ApiError) {
            if (error.problem?.code === 'stale_staff_version') {
              setStale(true);
              setLatest(undefined);
            }
            setFieldErrors(
              Object.fromEntries(
                Object.entries(error.problem?.errors ?? {}).map(([key, messages]) => [
                  key.split('.').pop()!.toLowerCase(),
                  messages.join(' '),
                ]),
              ),
            );
          }
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
      <DialogTitle>
        {renewal
          ? 'Tạo kỳ hợp đồng lao động mới'
          : staff
            ? 'Chỉnh sửa nhân viên'
            : 'Thêm nhân viên'}
      </DialogTitle>
      <DialogContent>
        <form
          id="staff-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (dateError || blocked) return;
            setConfirm(true);
          }}
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <OwnerFeedback {...action} />
            {stale && (
              <Alert severity="warning">
                Hồ sơ đã thay đổi trên máy chủ. Kiểm tra dữ liệu mới trước khi lưu lại. Nội dung
                đang nhập được giữ nguyên.
                {!latest ? (
                  <Button
                    onClick={() => {
                      setReloadError('');
                      void action
                        .request<Staff>(`/api/v1/staff/${staff!.userId}`)
                        .then(setLatest)
                        .catch(() => setReloadError('Không tải được hồ sơ mới.'));
                    }}
                  >
                    Tải hồ sơ mới
                  </Button>
                ) : (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      {latest.fullName} · {latest.email}
                    </Typography>
                    <Typography variant="body2">
                      {latest.employment?.contractNumber ||
                        latest.employment?.employmentType ||
                        'Chưa có hợp đồng'}{' '}
                      · {latest.employment?.startDate} –{' '}
                      {latest.employment?.endDate ?? 'Không xác định thời hạn'}
                    </Typography>
                    {!renewal && latest.employment?.id !== baseline?.employment?.id ? (
                      <Typography color="warning.dark" variant="body2">
                        Kỳ hợp đồng đã thay đổi. Đóng và mở lại hồ sơ để chỉnh sửa đúng kỳ hợp đồng.
                      </Typography>
                    ) : (
                      <Button
                        onClick={() => {
                          setBaseline(latest);
                          setVersion(latest.accountVersion);
                          setStale(false);
                        }}
                      >
                        Đã kiểm tra, tiếp tục chỉnh sửa
                      </Button>
                    )}
                  </Box>
                )}
                {reloadError && <Typography color="error.main">{reloadError}</Typography>}
              </Alert>
            )}
            {renewal ? (
              <>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {staff?.fullName || staff?.email}
                </Typography>
                <Alert severity={openEnded ? 'warning' : 'info'}>
                  {openEnded
                    ? 'Hợp đồng trước chưa có ngày kết thúc. Hãy chỉnh sửa hồ sơ để xác định ngày kết thúc trước khi tạo kỳ mới.'
                    : 'Tạo kỳ hợp đồng riêng, không ghi đè hợp đồng đã lưu. Trạng thái tài khoản và phân công không thay đổi.'}
                </Alert>
              </>
            ) : (
              <>
                <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Thông tin tài khoản</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                  }}
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
                {staff && !active && (
                  <StaffResponsibilitiesPanel
                    staffId={staff.userId}
                    data={responsibilities.data}
                    busy={responsibilities.isFetching}
                    error={responsibilities.error}
                    retry={() => void responsibilities.refetch()}
                  />
                )}
                <Divider />
              </>
            )}
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
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: {
                    min:
                      renewal && previousEnd && previousEnd !== '9999-12-31'
                        ? new Date(Date.parse(previousEnd) + 86400000).toISOString().slice(0, 10)
                        : undefined,
                  },
                }}
                error={!!renewalOverlap || !!fieldErrors.startdate}
                helperText={
                  renewalOverlap
                    ? 'Ngày bắt đầu kỳ mới phải sau ngày kết thúc kỳ trước.'
                    : fieldErrors.startdate
                }
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
              <MoneyField
                label="Mức lương thỏa thuận (VND)"
                {...fieldError('baserate')}
                value={baseRate}
                maxRawLength={18}
                onValueChange={setBaseRate}
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
        <Button
          variant="contained"
          form="staff-editor"
          type="submit"
          disabled={action.busy || blocked}
        >
          {action.busy
            ? 'Đang lưu…'
            : renewal
              ? 'Tạo kỳ hợp đồng'
              : staff
                ? 'Lưu thay đổi'
                : 'Tạo nhân viên'}
        </Button>
      </DialogActions>
      <ConfirmDialog
        error={action.error}
        open={confirm}
        title={stale ? 'Dữ liệu đã thay đổi' : 'Xác nhận lưu hồ sơ'}
        busy={action.busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => (stale ? setConfirm(false) : void save())}
      >
        {stale
          ? 'Quay về hồ sơ để kiểm tra dữ liệu mới trước khi lưu lại.'
          : renewal
            ? 'Lưu kỳ hợp đồng mới và giữ nguyên lịch sử các kỳ trước.'
            : active
              ? 'Lưu thông tin tài khoản và công việc.'
              : 'Ngừng tài khoản. Máy chủ sẽ từ chối nếu còn trách nhiệm chưa giải quyết.'}
      </ConfirmDialog>
    </Dialog>
  );
}
