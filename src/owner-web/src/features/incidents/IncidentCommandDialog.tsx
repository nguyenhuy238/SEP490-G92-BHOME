import { useState } from 'react';
import { Alert, MenuItem, Stack, TextField } from '@mui/material';
import { ConfirmDialog } from '../../components/common/PortalUI';
import { useOwnerAction } from '../../hooks/useOwnerWorkspace';
import { guid, vnd } from '../../../../../packages/client-core/src/contracts';
import { vietnamInstant } from '../tasks/taskContracts';
export interface CommandField {
  name: string;
  label: string;
  type?: 'text' | 'money' | 'guid' | 'instant' | 'asset';
  optional?: boolean;
}
export interface IncidentCommand {
  title: string;
  path: string;
  version: number;
  fields: CommandField[];
  extra?: Record<string, unknown>;
}
export function IncidentCommandDialog({
  command: c,
  close,
}: {
  command: IncidentCommand;
  close: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({ assetStatus: '0' });
  const [validation, setValidation] = useState('');
  const action = useOwnerAction();
  async function save() {
    try {
      const body: Record<string, unknown> = { version: c.version, ...c.extra };
      for (const f of c.fields) {
        const value = values[f.name]?.trim() ?? '';
        if (!value && !f.optional) throw new Error(`Nhập ${f.label.toLocaleLowerCase('vi-VN')}.`);
        body[f.name] = !value
          ? null
          : f.type === 'guid'
            ? guid(value)
            : f.type === 'money'
              ? vnd(value)
              : f.type === 'instant'
                ? vietnamInstant(value)
                : f.type === 'asset'
                  ? Number(value)
                  : value;
      }
      setValidation('');
      if (await action.run(() => action.command(c.path, 'POST', body))) close();
    } catch (e) {
      setValidation((e as Error).message);
    }
  }
  return (
    <ConfirmDialog
      open
      title={c.title}
      busy={action.busy}
      error={validation || action.error}
      onClose={close}
      onConfirm={() => void save()}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Alert severity="info">
          Quyết định trên phiên bản {c.version}. Máy chủ kiểm tra quyền, bằng chứng, chi phí và
          trạng thái trước khi lưu.
        </Alert>
        {c.fields.map((f) => (
          <TextField
            key={f.name}
            required={!f.optional}
            label={f.label}
            value={values[f.name] ?? ''}
            disabled={action.busy}
            select={f.type === 'asset'}
            type={f.type === 'instant' ? 'datetime-local' : f.type === 'money' ? 'number' : 'text'}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { maxLength: 4000, ...(f.type === 'money' ? { min: 0, step: 1 } : {}) },
            }}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          >
            {f.type === 'asset' && [
              <MenuItem key="0" value="0">
                Hoạt động
              </MenuItem>,
              <MenuItem key="1" value="1">
                Cần sửa
              </MenuItem>,
              <MenuItem key="3" value="3">
                Ngừng sử dụng
              </MenuItem>,
            ]}
          </TextField>
        ))}
      </Stack>
    </ConfirmDialog>
  );
}
