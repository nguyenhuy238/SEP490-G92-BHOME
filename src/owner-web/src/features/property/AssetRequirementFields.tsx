import { Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Plus, Trash2 } from 'lucide-react';
import type { LocalAssetItem } from '../../../../../packages/client-core/src/propertySetup';
import { ASSET_UNITS } from '../../../../../packages/client-core/src/assetUnits';

export function AssetRequirementFields({
  items,
  onChange,
  disabled,
}: {
  items: LocalAssetItem[];
  onChange: (items: LocalAssetItem[]) => void;
  disabled?: boolean;
}) {
  const update = (id: string, changes: Partial<LocalAssetItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  return (
    <Stack spacing={1.5}>
      {!items.length && (
        <Typography variant="body2" color="text.secondary">
          Chưa có thiết bị trong định mức.
        </Typography>
      )}
      {items.map((item, index) => (
        <Box
          key={item.id}
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr 1fr',
              md: 'minmax(0, 1.5fr) minmax(100px, 1fr) 100px auto',
            },
            gap: 1,
            alignItems: 'center',
            pb: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <TextField
            required
            disabled={disabled}
            size="small"
            label={`Tên tài sản ${index + 1}`}
            value={item.name}
            onChange={(event) => update(item.id, { name: event.target.value })}
            sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}
          />
          <TextField
            select
            disabled={disabled}
            size="small"
            label={`Đơn vị ${index + 1}`}
            value={item.unit ?? ''}
            onChange={(event) => update(item.id, { unit: event.target.value || null })}
          >
            <MenuItem value="">Chưa ghi nhận</MenuItem>
            {item.unit && !ASSET_UNITS.some((unit) => unit === item.unit) && (
              <MenuItem value={item.unit}>{item.unit}</MenuItem>
            )}
            {ASSET_UNITS.map((unit) => (
              <MenuItem key={unit} value={unit}>
                {unit}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            required
            disabled={disabled}
            size="small"
            type="number"
            label={`Số lượng ${index + 1}`}
            value={item.quantity || ''}
            slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
            onChange={(event) => update(item.id, { quantity: Number(event.target.value) })}
          />
          <Button
            disabled={disabled}
            color="error"
            startIcon={<Trash2 size={16} />}
            onClick={() => onChange(items.filter((row) => row.id !== item.id))}
            aria-label={`Bỏ tài sản ${index + 1}`}
            sx={{ minHeight: { xs: 44, md: 36 }, justifySelf: { xs: 'end', md: 'auto' } }}
          >
            Bỏ
          </Button>
        </Box>
      ))}
      <Button
        disabled={disabled || items.length >= 100}
        startIcon={<Plus size={16} />}
        sx={{ alignSelf: 'flex-start', minHeight: { xs: 44, sm: 36 } }}
        onClick={() =>
          onChange([
            ...items,
            {
              id: crypto.randomUUID(),
              name: '',
              category: 'Khác',
              unit: 'Cái',
              trackingMode: 'Serialized',
              quantity: 1,
            },
          ])
        }
      >
        Thêm tài sản
      </Button>
    </Stack>
  );
}
