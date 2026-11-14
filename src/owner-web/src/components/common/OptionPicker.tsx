import { Autocomplete, TextField } from '@mui/material';

/** Search already-loaded authorized reference choices by their human-readable label. */
export function OptionPicker({
  label,
  options,
  value,
  change,
  disabled = false,
  loading = false,
  error = false,
  emptyLabel = 'Tất cả',
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  change: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;
  emptyLabel?: string;
}) {
  return (
    <Autocomplete
      options={options}
      value={
        value
          ? (options.find((o) => o.id === value) ?? { id: value, label: 'Lựa chọn hiện tại' })
          : null
      }
      onChange={(_, option) => change(option?.id ?? '')}
      getOptionKey={(o) => o.id}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      disabled={disabled}
      loading={loading}
      loadingText="Đang tải lựa chọn…"
      noOptionsText={error ? 'Không tải được lựa chọn' : 'Không có kết quả phù hợp'}
      clearText="Bỏ lựa chọn"
      openText="Mở lựa chọn"
      closeText="Đóng lựa chọn"
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={emptyLabel} error={error} />
      )}
    />
  );
}
