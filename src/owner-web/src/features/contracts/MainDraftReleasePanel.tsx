import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  contractError,
  mutationKeys,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  type MainDraftView,
} from '../../../../../packages/client-core/src/mainDrafts';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { useContractsApi, useMainDraftApi } from './useContractsApi';

export function MainDraftReleasePanel({
  draft,
  disabled,
  onReleased,
}: {
  draft: MainDraftView;
  disabled: boolean;
  onReleased: () => void;
}) {
  const api = useMainDraftApi(),
    contracts = useContractsApi();
  const { session } = useAuth();
  const accounts = useQuery({
    queryKey: ['contract-tenant-accounts', session?.userId],
    queryFn: ({ signal }) => contracts.tenantAccounts(signal),
  });
  const [tenant, setTenant] = useState(''),
    [file, setFile] = useState<PreviewDocument | null>(null),
    [url, setUrl] = useState('');
  const [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    active = useRef(true),
    objectUrl = useRef('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  function message(e: unknown) {
    const code = (e as { code?: string })?.code;
    return (code && mainDraftMessages[code]) || contractError(e);
  }
  async function preview() {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setReviewed(false);
    try {
      const next = await api.signingReview(draft.id);
      const bytes = await api.file(draft.id, next.id);
      try {
        if (active.current) {
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          setFile(next);
          setUrl(objectUrl.current);
        }
      } finally {
        bytes.fill(0);
      }
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function release() {
    if (lock.current || disabled || !file || !reviewed || !tenant) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const input = {
      tenantUserId: tenant,
      expectedVersion: draft.version,
      reviewedFileId: file.id,
      humanReviewed: true,
    };
    try {
      await api.release(draft.id, input, keys.get('main-draft-release', input));
      keys.confirmed('main-draft-release', input);
      if (active.current) onReleased();
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Chuyển bản nháp sang ký</Typography>
      <Alert severity="info">
        Owner duyệt PDF của phiên bản đã lưu và chọn tài khoản Tenant đại diện. Chuyển sang ký chưa
        có nghĩa đã ký hoặc đã thanh toán; backend tiếp tục kiểm tra trước khi kích hoạt.
      </Alert>
      {disabled && (
        <Alert severity="info">Lưu thay đổi bản nháp trước khi tạo tài liệu đưa đi ký.</Alert>
      )}
      {(error || accounts.error) && (
        <Alert severity="error">{error || message(accounts.error)}</Alert>
      )}
      <TextField
        select
        label="Tài khoản Tenant đại diện"
        value={tenant}
        disabled={busy || disabled || accounts.isPending}
        onChange={(e) => {
          setTenant(e.target.value);
          setReviewed(false);
        }}
      >
        <MenuItem value="" disabled>
          Chọn tài khoản Tenant
        </MenuItem>
        {accounts.data?.map((a) => (
          <MenuItem key={a.id} value={a.id}>
            {a.label}
          </MenuItem>
        ))}
      </TextField>
      {accounts.data?.length === 0 && (
        <Alert severity="warning">
          Chưa có tài khoản Tenant đang hoạt động để liên kết. Không tự tạo tài khoản từ bản nháp.
        </Alert>
      )}
      <Button disabled={busy || disabled} onClick={() => void preview()}>
        {busy ? 'Đang xử lý…' : 'Tạo và xem PDF đưa đi ký'}
      </Button>
      {file?.developmentOnly && (
        <Alert severity="warning">
          Tài liệu kiểm thử; mẫu chưa được duyệt cho production. Không coi đây là hợp đồng đã ký hợp
          pháp.
        </Alert>
      )}
      {url && (
        <iframe
          title="PDF được chọn để đưa đi ký"
          src={url}
          style={{ width: '100%', height: 600, border: 0 }}
        />
      )}
      <FormControlLabel
        label="Tôi đã xem đúng PDF trên và xác nhận tài khoản Tenant đại diện"
        control={
          <Checkbox
            checked={reviewed}
            disabled={!url || !tenant || busy || disabled}
            onChange={(_, value) => setReviewed(value)}
          />
        }
      />
      <Button
        variant="contained"
        disabled={!reviewed || !tenant || !file || busy || disabled}
        onClick={() => void release()}
      >
        Xác nhận chuyển sang ký
      </Button>
    </Stack>
  );
}
