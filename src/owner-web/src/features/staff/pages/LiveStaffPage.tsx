import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PortalUI';
import { usePortal } from '../../../app/PortalProvider';
import { propertyError, usePropertyApi } from '../../property-api/propertyApi';

export default function LiveStaffPage() {
  const api = usePropertyApi(),
    qc = useQueryClient(),
    portal = usePortal();
  const staff = useQuery({
    queryKey: ['staff-accounts'],
    queryFn: ({ signal }) => api.staff(signal),
  });
  const locations = useQuery({
    queryKey: ['property-locations'],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const [locationId, setLocationId] = useState('');
  const assignments = useQuery({
    queryKey: ['staff-assignments', locationId],
    enabled: !!locationId,
    queryFn: ({ signal }) => api.assignments(locationId, signal),
  });
  const [staffOpen, setStaffOpen] = useState(false),
    [assignmentOpen, setAssignmentOpen] = useState(false);
  const [account, setAccount] = useState({ userName: '', email: '', password: '' });
  const [assignment, setAssignment] = useState({ staffUserId: '', startDate: '', endDate: '' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = (event: FormEvent, action: () => Promise<unknown>, done: () => void) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    void action()
      .then(done, (x) => setError(propertyError(x)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <PageHeader
        title="Nhân viên & phân công cơ sở"
        subtitle="Tài khoản Staff và khoảng thời gian phân công được lưu tại Backend."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={() => {
                setError('');
                setStaffOpen(true);
              }}
            >
              Tạo Staff
            </Button>
            <Button
              variant="contained"
              disabled={!locationId}
              onClick={() => {
                setError('');
                setAssignmentOpen(true);
              }}
            >
              Phân công cơ sở
            </Button>
          </Stack>
        }
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Backend hiện chưa có API sửa/vô hiệu hóa tài khoản Staff hoặc sửa/xóa phân công. Giao diện
        không hiển thị thao tác giả.
      </Alert>
      {(staff.isPending || locations.isPending) && <LinearProgress />}
      {(staff.error || locations.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void staff.refetch();
                void locations.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {propertyError(staff.error || locations.error)}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Tài khoản Staff
        </Typography>
        {staff.data?.length === 0 ? (
          <Alert severity="info">Chưa có tài khoản Staff.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tên đăng nhập</TableCell>
                <TableCell>Mã tài khoản</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {staff.data?.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>{x.label}</TableCell>
                  <TableCell>{x.id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: 'center', mb: 2 }}
        >
          <Typography variant="h6" sx={{ flex: 1 }}>
            Phân công theo cơ sở
          </Typography>
          <TextField
            select
            size="small"
            label="Cơ sở"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            sx={{ minWidth: 260 }}
          >
            <MenuItem value="">Chọn cơ sở</MenuItem>
            {locations.data?.items.map((x) => (
              <MenuItem key={x.id} value={x.id}>
                {x.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {!locationId ? (
          <Alert severity="info">Chọn cơ sở để xem phân công.</Alert>
        ) : assignments.isPending ? (
          <LinearProgress />
        ) : assignments.error ? (
          <Alert
            severity="error"
            action={<Button onClick={() => void assignments.refetch()}>Thử lại</Button>}
          >
            {propertyError(assignments.error)}
          </Alert>
        ) : assignments.data?.length === 0 ? (
          <Alert severity="info">Cơ sở chưa có phân công.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Staff</TableCell>
                <TableCell>Từ ngày</TableCell>
                <TableCell>Đến ngày</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.data?.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    {staff.data?.find((s) => s.id === x.staffUserId)?.label ?? x.staffUserId}
                  </TableCell>
                  <TableCell>{x.startDate}</TableCell>
                  <TableCell>{x.endDate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      <Dialog
        open={staffOpen}
        onClose={busy ? undefined : () => setStaffOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              () => api.createStaff(account),
              async () => {
                await qc.invalidateQueries({ queryKey: ['staff-accounts'] });
                portal.notify('Đã tạo tài khoản Staff.');
                setStaffOpen(false);
                setAccount({ userName: '', email: '', password: '' });
              },
            )
          }
        >
          <DialogTitle>Tạo tài khoản Staff</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                label="Tên đăng nhập"
                value={account.userName}
                onChange={(e) => setAccount({ ...account, userName: e.target.value })}
              />
              <TextField
                required
                type="email"
                label="Email"
                value={account.email}
                onChange={(e) => setAccount({ ...account, email: e.target.value })}
              />
              <TextField
                required
                type="password"
                label="Mật khẩu ban đầu"
                helperText="Tối thiểu 12 ký tự; không hiển thị lại sau khi tạo."
                value={account.password}
                onChange={(e) => setAccount({ ...account, password: e.target.value })}
                slotProps={{ htmlInput: { minLength: 12 } }}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setStaffOpen(false)} disabled={busy}>
              Hủy
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              Tạo tài khoản
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog
        open={assignmentOpen}
        onClose={busy ? undefined : () => setAssignmentOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <form
          onSubmit={(e) =>
            submit(
              e,
              () => api.createAssignment({ locationId, ...assignment }),
              async () => {
                await qc.invalidateQueries({ queryKey: ['staff-assignments', locationId] });
                portal.notify('Đã phân công Staff vào cơ sở.');
                setAssignmentOpen(false);
                setAssignment({ staffUserId: '', startDate: '', endDate: '' });
              },
            )
          }
        >
          <DialogTitle>Phân công Staff vào cơ sở</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                required
                select
                label="Staff"
                value={assignment.staffUserId}
                onChange={(e) => setAssignment({ ...assignment, staffUserId: e.target.value })}
              >
                {staff.data?.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                required
                type="date"
                label="Từ ngày"
                value={assignment.startDate}
                onChange={(e) => setAssignment({ ...assignment, startDate: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                required
                type="date"
                label="Đến ngày"
                value={assignment.endDate}
                onChange={(e) => setAssignment({ ...assignment, endDate: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAssignmentOpen(false)} disabled={busy}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={busy || assignment.endDate < assignment.startDate}
            >
              Phân công
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
