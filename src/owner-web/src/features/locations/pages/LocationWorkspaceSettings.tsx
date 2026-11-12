import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { LocationConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { ConfirmDialog } from '../../../components/common/PortalUI';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { ConflictReload } from '../components/ConflictReload';

export function LocationWorkspaceSettings({ location }: { location: LocationConfiguration }) {
  const api = usePropertySetupApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const canManage = session?.roles.includes('Owner') ?? false;
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [active, setActive] = useState(location.isActive);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(location.version);
  const closure = useQuery({
    queryKey: ['property-setup', 'closure-check', location.id],
    queryFn: ({ signal }) =>
      api.request<{ canClose: boolean; blockers: { code: string; count: number }[] }>(
        `/api/v1/locations/${location.id}/closure-check`,
        { signal },
      ),
    enabled: canManage && !active,
  });
  const save = useMutation({
    mutationFn: () =>
      api.saveLocation(location.id, {
        name: name.trim(),
        address: address.trim(),
        isActive: active,
        version,
        reason: reason.trim(),
      }),
    onSuccess: async (saved) => {
      setConfirm(false);
      setVersion(saved.version);
      setNotice('Đã lưu thông tin cơ sở.');
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
    },
  });
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, maxWidth: 920 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (location.isActive && !active) setConfirm(true);
          else save.mutate();
        }}
      >
        <Stack spacing={3}>
          <div>
            <Typography variant="h6" sx={{ fontWeight: 750 }}>
              Thông tin cơ sở
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Cập nhật thông tin nhận diện và trạng thái khai thác của cơ sở.
            </Typography>
          </div>
          <TextField
            required
            label="Tên cơ sở"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage}
          />
          <TextField
            required
            label="Địa chỉ"
            multiline
            minRows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={!canManage}
          />
          <TextField
            select
            label="Trạng thái hoạt động"
            value={String(active)}
            onChange={(e) => setActive(e.target.value === 'true')}
            disabled={!canManage}
          >
            <MenuItem value="true">Đang hoạt động</MenuItem>
            <MenuItem value="false">Ngừng hoạt động</MenuItem>
          </TextField>
          {!active && (
            <Alert severity="warning">
              Khi ngừng hoạt động, hệ thống sẽ kiểm tra các nghĩa vụ đang mở tại cơ sở trước khi
              lưu.
            </Alert>
          )}
          {!active && closure.data && !closure.data.canClose && (
            <Alert severity="warning">
              Cơ sở còn nghĩa vụ cần xử lý:{' '}
              {closure.data.blockers.map((item) => `${item.code}: ${item.count}`).join(' · ')}
            </Alert>
          )}
          {!active && closure.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void closure.refetch()}>Thử lại</Button>}
            >
              {invoiceError(closure.error)}
            </Alert>
          )}
          <TextField
            required
            label="Lý do thay đổi"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canManage}
          />
          {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
          {notice && <Alert severity="success">{notice}</Alert>}
          <ConflictReload
            error={save.error}
            reload={async () => {
              const current = await api.location(location.id);
              setName(current.name);
              setAddress(current.address);
              setActive(current.isActive);
              setVersion(current.version);
              setReason('');
              save.reset();
            }}
          />
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              disabled={save.isPending}
              onClick={() => {
                setName(location.name);
                setAddress(location.address);
                setActive(location.isActive);
                setReason('');
              }}
            >
              Khôi phục thông tin
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={!canManage || save.isPending || !reason.trim()}
            >
              Lưu thay đổi
            </Button>
          </Stack>
        </Stack>
      </form>
      <ConfirmDialog
        open={confirm}
        title="Ngừng hoạt động cơ sở?"
        busy={save.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() => save.mutate()}
      >
        Các nghĩa vụ đang mở sẽ được kiểm tra trước khi xác nhận thay đổi.
        {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
      </ConfirmDialog>
    </Paper>
  );
}
