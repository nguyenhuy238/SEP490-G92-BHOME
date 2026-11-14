import type { Dispatch, SetStateAction } from 'react';
import { Alert, Checkbox, FormControlLabel, MenuItem, TextField } from '@mui/material';
import type { UtilityValues } from './utilityFormValues';
import { MoneyField } from '../../components/common/MoneyField';

export interface UtilityFieldDefinition {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'month' | 'number' | 'check' | 'money';
  optional?: boolean;
  options?: { id: string; label: string }[];
  disabled?: boolean;
}
export function UtilityField({
  field,
  values,
  setValues,
}: {
  field: UtilityFieldDefinition;
  values: UtilityValues;
  setValues: Dispatch<SetStateAction<UtilityValues>>;
}) {
  if (field.type === 'check')
    return (
      <FormControlLabel
        label={field.label}
        control={
          <Checkbox
            required={!field.optional}
            checked={values[field.name] === 'true'}
            onChange={(event) =>
              setValues((old) => ({ ...old, [field.name]: String(event.target.checked) }))
            }
          />
        }
      />
    );
  if (field.type === 'money')
    return (
      <MoneyField
        required={!field.optional}
        disabled={field.disabled}
        label={field.label}
        value={values[field.name] ?? ''}
        onValueChange={(raw) => setValues((old) => ({ ...old, [field.name]: raw }))}
      />
    );
  return (
    <TextField
      required={!field.optional}
      disabled={field.disabled}
      select={!!field.options}
      label={field.label}
      type={field.options ? undefined : (field.type ?? 'text')}
      value={values[field.name] ?? ''}
      onChange={(event) => setValues((old) => ({ ...old, [field.name]: event.target.value }))}
      slotProps={
        field.type === 'date' || field.type === 'month'
          ? { inputLabel: { shrink: true } }
          : undefined
      }
    >
      {field.options && [
        <MenuItem value="" key="empty">
          Chọn
        </MenuItem>,
        ...field.options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        )),
      ]}
    </TextField>
  );
}
export function SetupActionFeedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
    </>
  );
}
