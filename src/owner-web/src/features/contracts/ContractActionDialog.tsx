import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  actionPayload,
  canUseCertificate,
  contractError,
  type ContractAction,
  type ContractClient,
  type ContractView,
  type mutationKeys,
} from '../../../../../packages/client-core/src/contracts';

export function ContractActionDialog({
  api,
  contract,
  action,
  keys,
  actorId,
  onClose,
  onSuccess,
}: {
  api: ContractClient;
  contract: ContractView;
  action: ContractAction;
  keys: ReturnType<typeof mutationKeys>;
  actorId: string;
  onClose: () => void;
  onSuccess: (id?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const certs = useQuery({
    staleTime: 0,
    queryKey: ['contract-certificates', actorId],
    queryFn: ({ signal }) => api.certificates(signal),
    enabled: action.operation === 'signing',
  });
  async function submit() {
    if (lock.current) return;
    if (
      action.operation === 'signing' &&
      (certs.isFetching ||
        !!certs.error ||
        !certs.data?.some((c) => c.id === values.certificateId && canUseCertificate(c)))
    ) {
      setError('Chọn chứng thư còn hiệu lực, không khóa và tải lại trước khi ký.');
      return;
    }
    let body;
    try {
      body = actionPayload(action, values, contract);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const scope = contract.id + '/' + action.operation;
    try {
      const result = await api.mutate<{ id?: string }>(
        contract.id,
        action.operation,
        body,
        keys.get(scope, body),
      );
      keys.confirmed(scope, body);
      onSuccess(action.operation === 'renewals' ? result.id : undefined);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => !busy && onClose()}>
      <DialogTitle>{action.label}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
            Hợp đồng {contract.id}
          </Typography>
          <Alert severity="warning">{action.warning}</Alert>
          {action.fields.map((field) =>
            field.type === 'certificate' ? (
              <TextField
                key={field.name}
                select
                label={field.label}
                value={values[field.name] ?? ''}
                disabled={busy || certs.isFetching}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              >
                {(certs.data ?? []).filter(canUseCertificate).map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.provider} · {c.serialNumber} · {c.providerUserIdHint}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                key={field.name}
                label={field.label}
                type={
                  field.type === 'date'
                    ? 'date'
                    : field.type === 'schedule'
                      ? 'datetime-local'
                      : 'text'
                }
                multiline={field.type === 'multiline'}
                minRows={field.type === 'multiline' ? 3 : undefined}
                disabled={busy}
                value={values[field.name] ?? ''}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: {
                    maxLength: field.max ?? (field.type === 'money' ? 18 : undefined),
                    inputMode: field.type === 'money' ? 'numeric' : undefined,
                  },
                }}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
            ),
          )}
          {action.operation === 'signing' &&
            !certs.isFetching &&
            !certs.error &&
            !certs.data?.some(canUseCertificate) && (
              <Alert severity="info">
                Chưa có chứng thư dùng được. Đóng hộp thoại và khai báo chứng thư MySign của bạn.
              </Alert>
            )}
          {certs.error && (
            <Alert severity="error">
              {contractError(certs.error)}
              <Button onClick={() => void certs.refetch()}>Tải lại chứng thư</Button>
            </Alert>
          )}
          {action.operation === 'signing' && !certs.error && (
            <Button
              disabled={busy || certs.isFetching}
              onClick={() => {
                setValues({});
                void certs.refetch();
              }}
            >
              Tải lại chứng thư
            </Button>
          )}
          {!!error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Đóng và tải lại
        </Button>
        <Button
          variant="contained"
          disabled={
            busy ||
            (action.operation === 'signing' &&
              (certs.isFetching ||
                !!certs.error ||
                !certs.data?.some((c) => c.id === values.certificateId && canUseCertificate(c))))
          }
          onClick={() => void submit()}
        >
          {busy ? 'Đang xử lý…' : 'Xác nhận'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
