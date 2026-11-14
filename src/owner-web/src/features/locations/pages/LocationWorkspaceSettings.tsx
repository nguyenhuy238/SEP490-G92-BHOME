import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
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

const blockerLabels: Record<string, string> = {
  operational_rooms: 'Phòng còn hoạt động',
  unresolved_residents: 'Cư dân chưa hoàn tất xử lý',
  active_or_pending_contracts: 'Hợp đồng đang hoạt động hoặc chờ xử lý',
  open_incidents: 'Sự cố chưa xử lý',
  open_tasks: 'Công việc chưa hoàn thành',
  pending_refunds: 'Yêu cầu hoàn tiền đang chờ',
  unsettled_holding_deposits: 'Tiền cọc giữ chỗ chưa quyết toán',
  outstanding_invoices: 'Hóa đơn còn công nợ',
};

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
  const [metadataVersion, setMetadataVersion] = useState(0);
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
    if (!metadataDraft) setMetadataVersion(metadata.data?.version ?? 0);
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
        expectedVersion: metadataVersion,
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
  const [baseline, setBaseline] = useState(location);
  const dirty =
    name.trim() !== baseline.name ||
    address.trim() !== baseline.address ||
    active !== baseline.isActive;
  const closing = baseline.isActive && !active;
  const closure = useQuery({
    queryKey: ['property-setup', 'closure-check', session?.userId, location.id],
    queryFn: ({ signal }) =>
      api.request<{ canClose: boolean; blockers: { code: string; count: number }[] }>(
        `/api/v1/locations/${location.id}/closure-check`,
        { signal },
      ),
    enabled: canManage && closing,
  });
  const closureReady =
    !closing || (!!closure.data?.canClose && !closure.isFetching && !closure.error);
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
      setBaseline(saved);
      setName(saved.name);
      setAddress(saved.address);
      setActive(saved.isActive);
      setVersion(saved.version);
      setReason('');
      setNotice('Đã lưu thông tin cơ sở.');
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
    },
  });
  const canSave =
    canManage &&
    dirty &&
    !!reason.trim() &&
    name.trim().length >= 2 &&
    !!address.trim() &&
    closureReady &&
    !save.isPending;
  function resetLocation(current: LocationConfiguration) {
    setConfirm(false);
    setBaseline(current);
    setName(current.name);
    setAddress(current.address);
    setActive(current.isActive);
    setVersion(current.version);
    setReason('');
    setNotice('');
    save.reset();
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))',
        gap: 2.5,
        alignItems: 'start',
        minWidth: 0,
      }}
    >
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            if (closing) setConfirm(true);
            else save.mutate();
          }}
        >
          <Stack spacing={3}>
            <div>
              <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>
                Thông tin cơ sở
              </Typography>
            </div>
            <TextField
              required
              label="Tên cơ sở"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNotice('');
              }}
              disabled={!canManage || save.isPending}
              slotProps={{ htmlInput: { minLength: 2, maxLength: 200 } }}
            />
            <TextField
              required
              label="Địa chỉ"
              multiline
              minRows={2}
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setNotice('');
              }}
              disabled={!canManage || save.isPending}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />
            <Divider />
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
              Trạng thái khai thác
            </Typography>
            <TextField
              select
              label="Trạng thái hoạt động"
              value={String(active)}
              onChange={(e) => {
                setActive(e.target.value === 'true');
                setNotice('');
              }}
              disabled={!canManage || save.isPending}
            >
              <MenuItem value="true">Đang hoạt động</MenuItem>
              <MenuItem value="false">Ngừng hoạt động</MenuItem>
            </TextField>
            {closing && (
              <Alert severity="warning">
                Khi ngừng hoạt động, hệ thống sẽ kiểm tra các nghĩa vụ đang mở tại cơ sở trước khi
                lưu.
              </Alert>
            )}
            {closing && closure.isFetching && (
              <Alert severity="info">Đang kiểm tra nghĩa vụ còn mở…</Alert>
            )}
            {closing && closure.data && !closure.data.canClose && (
              <Alert severity="warning">
                Cơ sở còn nghĩa vụ cần xử lý trước khi ngừng hoạt động.
                <Box component="ul" sx={{ my: 1, pl: 2 }}>
                  {closure.data.blockers.map((item) => (
                    <li key={item.code}>
                      {blockerLabels[item.code] ?? item.code}: {item.count}
                    </li>
                  ))}
                </Box>
                <Button onClick={() => void closure.refetch()}>Kiểm tra lại</Button>
              </Alert>
            )}
            {closing && closure.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void closure.refetch()}>Thử lại</Button>}
              >
                {invoiceError(closure.error)}
              </Alert>
            )}
            {closing && closureReady && (
              <Alert severity="success">
                Không phát hiện nghĩa vụ cản trở việc ngừng hoạt động. Máy chủ sẽ kiểm tra lại khi
                lưu.
              </Alert>
            )}
            <TextField
              required
              label="Lý do thay đổi"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canManage || save.isPending}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
            {notice && <Alert severity="success">{notice}</Alert>}
            <ConflictReload
              error={save.error}
              reload={async () => {
                const current = await api.location(location.id);
                resetLocation(current);
              }}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'flex-end' }}
            >
              <Typography
                variant="body2"
                color={dirty ? 'primary.main' : 'text.secondary'}
                sx={{ mr: 'auto', fontWeight: dirty ? 650 : 400 }}
              >
                {dirty ? 'Có thay đổi chưa lưu' : 'Đã lưu'}
              </Typography>
              <Button
                disabled={!canManage || save.isPending || (!dirty && !reason)}
                onClick={() => resetLocation(baseline)}
              >
                Khôi phục thông tin
              </Button>
              <Button type="submit" variant="contained" disabled={!canSave}>
                Lưu thay đổi
              </Button>
            </Stack>
          </Stack>
        </form>
        <ConfirmDialog
          open={confirm && closureReady}
          title="Ngừng hoạt động cơ sở?"
          busy={save.isPending}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            if (canSave && closing) save.mutate();
          }}
        >
          Cơ sở sẽ chuyển sang ngừng hoạt động. Máy chủ sẽ kiểm tra lại các nghĩa vụ đang mở trước
          khi lưu.
          {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
        </ConfirmDialog>
      </Paper>
      {canManage && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>
              Thông tin bổ sung
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
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                  }}
                >
                  <TextField
                    label="Mã cơ sở"
                    helperText="Chữ cái không dấu, số, dấu - hoặc _; tối đa 50 ký tự"
                    error={
                      !!metadataDraft && !/^[A-Za-z0-9_-]{1,50}$/.test(metadataForm.code.trim())
                    }
                    value={metadataForm.code}
                    onChange={(e) => updateMetadata({ code: e.target.value })}
                    disabled={saveMetadata.isPending}
                  />
                  <TextField
                    label="Số tầng"
                    type="number"
                    value={metadataForm.floors}
                    onChange={(e) => updateMetadata({ floors: Number(e.target.value) })}
                    slotProps={{ htmlInput: { min: 1, max: 100 } }}
                    disabled={saveMetadata.isPending}
                    error={
                      !!metadataDraft &&
                      (!Number.isInteger(metadataForm.floors) ||
                        metadataForm.floors < 1 ||
                        metadataForm.floors > 100)
                    }
                  />
                  <TextField
                    label="Điện thoại liên hệ"
                    value={metadataForm.contactPhone}
                    onChange={(e) => updateMetadata({ contactPhone: e.target.value })}
                    disabled={saveMetadata.isPending}
                    slotProps={{ htmlInput: { maxLength: 50 } }}
                  />
                  <TextField
                    label="Email liên hệ"
                    type="email"
                    value={metadataForm.contactEmail}
                    onChange={(e) => updateMetadata({ contactEmail: e.target.value })}
                    disabled={saveMetadata.isPending}
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                </Box>
                <TextField
                  label="Mô tả và tiện ích"
                  multiline
                  minRows={3}
                  value={metadataForm.description}
                  onChange={(e) => updateMetadata({ description: e.target.value })}
                  disabled={saveMetadata.isPending}
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
                {metadataNotice && <Alert severity="success">{metadataNotice}</Alert>}
                {saveMetadata.error && (
                  <Alert severity="error">{invoiceError(saveMetadata.error)}</Alert>
                )}
                <ConflictReload
                  error={saveMetadata.error}
                  reload={async () => {
                    const result = await metadata.refetch();
                    if (result.error) throw result.error;
                    setMetadataDraft(null);
                    saveMetadata.reset();
                  }}
                />
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { sm: 'center' }, justifyContent: 'flex-end' }}
                >
                  <Typography
                    variant="body2"
                    color={metadataDraft ? 'primary.main' : 'text.secondary'}
                    sx={{ mr: 'auto', fontWeight: metadataDraft ? 650 : 400 }}
                  >
                    {metadataDraft
                      ? 'Có cấu hình chưa lưu'
                      : metadata.data
                        ? 'Đã lưu'
                        : 'Chưa thiết lập'}
                  </Typography>
                  <Button
                    disabled={!metadataDraft || saveMetadata.isPending}
                    onClick={() => {
                      setMetadataDraft(null);
                      saveMetadata.reset();
                    }}
                  >
                    Khôi phục cấu hình
                  </Button>
                  <Button
                    variant="contained"
                    disabled={!metadataDraft || !validMetadata || saveMetadata.isPending}
                    onClick={() => saveMetadata.mutate()}
                  >
                    Lưu thông tin cấu hình
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
