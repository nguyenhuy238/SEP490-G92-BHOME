import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { LocationConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { ConfirmDialog } from '../../../components/common/PortalUI';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { ConflictReload } from '../components/ConflictReload';
import {
  locationSetupClient,
  type LocationMetadata,
} from '../../../../../../packages/client-core/src/locationSetup';

export function LocationWorkspaceSettings({ location }: { location: LocationConfiguration }) {
  const api = usePropertySetupApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const canManage = session?.roles.includes('Owner') ?? false;
  const setup = locationSetupClient(api.request);
  const metadata = useQuery({
    queryKey: ['property-setup', 'setup-metadata', session?.userId, location.id],
    queryFn: ({ signal }) => setup.metadata(location.id, signal),
    enabled: canManage,
  });
  const [metadataDraft, setMetadataDraft] = useState<Omit<LocationMetadata, 'setupStatus'> | null>(
    null,
  );
  const [metadataNotice, setMetadataNotice] = useState('');
  const metadataForm = metadataDraft ??
    metadata.data?.data ?? {
      code: '',
      floors: 1,
      contactPhone: '',
      contactEmail: '',
      description: '',
    };
  const validMetadata =
    /^[A-Za-z0-9_-]{1,50}$/.test(metadataForm.code.trim()) &&
    Number.isInteger(metadataForm.floors) &&
    metadataForm.floors >= 1 &&
    metadataForm.floors <= 100 &&
    metadataForm.contactPhone.trim().length <= 50 &&
    metadataForm.description.trim().length <= 2000 &&
    (!metadataForm.contactEmail.trim() ||
      (metadataForm.contactEmail.trim().length <= 200 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(metadataForm.contactEmail.trim())));
  const updateMetadata = (change: Partial<Omit<LocationMetadata, 'setupStatus'>>) => {
    setMetadataDraft({
      code: metadataForm.code,
      floors: metadataForm.floors,
      contactPhone: metadataForm.contactPhone,
      contactEmail: metadataForm.contactEmail,
      description: metadataForm.description,
      ...change,
    });
    setMetadataNotice('');
  };
  const saveMetadata = useMutation({
    mutationFn: () =>
      setup.saveMetadata(location.id, {
        code: metadataForm.code.trim(),
        floors: metadataForm.floors,
        contactPhone: metadataForm.contactPhone.trim(),
        contactEmail: metadataForm.contactEmail.trim(),
        description: metadataForm.description.trim(),
        expectedVersion: metadata.data?.version ?? 0,
      }),
    onSuccess: async () => {
      setMetadataDraft(null);
      setMetadataNotice('Đã lưu cấu hình thông tin cơ sở.');
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
    },
  });
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [active, setActive] = useState(location.isActive);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(location.version);
  const closure = useQuery({
    queryKey: ['property-setup', 'closure-check', session?.userId, location.id],
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
    <Stack spacing={2} sx={{ maxWidth: 920 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
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
                  setVersion(location.version);
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
      {canManage && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2}>
            <Typography variant="h6" sx={{ fontWeight: 750 }}>
              Thông tin cấu hình ban đầu
            </Typography>
            {metadata.isError ? (
              <Alert
                severity="error"
                action={<Button onClick={() => void metadata.refetch()}>Thử lại</Button>}
              >
                {invoiceError(metadata.error)}
              </Alert>
            ) : metadata.isPending ? (
              <Typography>Đang tải…</Typography>
            ) : (
              <>
                <TextField
                  label="Mã cơ sở"
                  helperText="Chữ cái không dấu, số, dấu - hoặc _; tối đa 50 ký tự"
                  error={!!metadataDraft && !/^[A-Za-z0-9_-]{1,50}$/.test(metadataForm.code.trim())}
                  value={metadataForm.code}
                  onChange={(e) => updateMetadata({ code: e.target.value })}
                />
                <TextField
                  label="Số tầng"
                  type="number"
                  value={metadataForm.floors}
                  onChange={(e) => updateMetadata({ floors: Number(e.target.value) })}
                  slotProps={{ htmlInput: { min: 1, max: 100 } }}
                />
                <TextField
                  label="Điện thoại liên hệ"
                  value={metadataForm.contactPhone}
                  onChange={(e) => updateMetadata({ contactPhone: e.target.value })}
                />
                <TextField
                  label="Email liên hệ"
                  type="email"
                  value={metadataForm.contactEmail}
                  onChange={(e) => updateMetadata({ contactEmail: e.target.value })}
                />
                <TextField
                  label="Mô tả và tiện ích"
                  multiline
                  minRows={3}
                  value={metadataForm.description}
                  onChange={(e) => updateMetadata({ description: e.target.value })}
                />
                {metadataNotice && <Alert severity="success">{metadataNotice}</Alert>}
                {saveMetadata.error && (
                  <Alert severity="error">{invoiceError(saveMetadata.error)}</Alert>
                )}
                <Button
                  sx={{ alignSelf: 'flex-end' }}
                  variant="contained"
                  disabled={!metadataDraft || !validMetadata || saveMetadata.isPending}
                  onClick={() => saveMetadata.mutate()}
                >
                  Lưu thông tin cấu hình
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
