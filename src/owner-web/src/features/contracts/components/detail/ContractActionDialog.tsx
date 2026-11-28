import { TextField } from '../../../../components/common/ValidatedForm';
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import {
  actionPayload,
  contractError,
  type ContractAction,
  type ContractClient,
  type ContractView,
  type mutationKeys,
} from '../../../../../../../packages/client-core/src/contracts';
import { MoneyField } from '../../../../components/common/MoneyField';

export function ContractActionDialog({
  api,
  contract,
  action,
  keys,
  onClose,
  onSuccess,
  onConflict,
}: {
  api: ContractClient;
  contract: ContractView;
  action: ContractAction;
  keys: ReturnType<typeof mutationKeys>;
  actorId: string;
  onClose: () => void;
  onSuccess: (id?: string) => void;
  onConflict?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const [conflicted, setConflicted] = useState(false);
  async function submit() {
    if (lock.current || conflicted) return;
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
      onSuccess(
        ['renewals', 'holding-conversion'].includes(action.operation) ? result.id : undefined,
      );
    } catch (e) {
      setError(contractError(e));
      if (
        (e as { status?: number })?.status === 409 &&
        (action.operation.startsWith('move-out/') || action.operation === 'expiry-move-out')
      ) {
        setConflicted(true);
        onConflict?.();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => !busy && onClose()}
    >
      <DialogTitle>{action.label}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
            Hồ sơ phòng {contract.roomNumber || 'đang xem'}
          </Typography>
          {!!action.warning && <Alert severity="warning">{action.warning}</Alert>}
          {action.fields.map((field) =>
            field.type === 'money' ? (
              <MoneyField
                key={field.name}
                label={field.label}
                disabled={busy}
                value={values[field.name] ?? ''}
                maxRawLength={field.max ?? 18}
                slotProps={{ inputLabel: { shrink: true } }}
                onValueChange={(raw) =>
                  setValues((v) => ({
                    ...v,
                    [field.name]: raw,
                    humanConfirmed:
                      action.operation === 'holding-cancellation' ? '' : v.humanConfirmed,
                  }))
                }
              />
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
                    maxLength: field.max,
                  },
                }}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [field.name]: e.target.value,
                    humanConfirmed:
                      action.operation === 'holding-cancellation' ? '' : v.humanConfirmed,
                  }))
                }
              />
            ),
          )}
          {action.operation === 'holding-cancellation' && (
            <>
              <TextField
                select
                label="Nguyên nhân hủy giữ chỗ"
                value={values.cause ?? ''}
                disabled={busy}
                onChange={(e) =>
                  setValues((v) => ({ ...v, cause: e.target.value, humanConfirmed: '' }))
                }
              >
                <MenuItem value="0">Tenant tự nguyện hủy — mất cọc</MenuItem>
                <MenuItem value="1">Owner không cung cấp được phòng — phải hoàn cọc</MenuItem>
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={values.humanConfirmed === 'true'}
                    disabled={busy || !['0', '1'].includes(values.cause)}
                    onChange={(_, checked) =>
                      setValues((v) => ({ ...v, humanConfirmed: checked ? 'true' : '' }))
                    }
                  />
                }
                label="Tôi đã đối chiếu nguyên nhân hủy, người yêu cầu và trách nhiệm xử lý cọc"
              />
            </>
          )}
          {!!error && <Alert severity="error">{error}</Alert>}
          {conflicted && (
            <Alert severity="warning">
              Đóng cửa sổ này và xem lại hồ sơ mới nhất trước khi xác nhận lại.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Đóng và tải lại
        </Button>
        <Button
          variant="contained"
          disabled={busy || conflicted}
          onClick={() => void submit()}
        >
          {busy ? 'Đang xử lý…' : 'Xác nhận'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
