import { useState } from 'react';
import { Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { LocalAssetItem } from '../../../../../packages/client-core/src/propertySetup';
import { ASSET_UNITS } from '../../../../../packages/client-core/src/assetUnits';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  assetCatalogSupportsScope,
  sharedConfigurationClient,
  type AssetCatalogData,
} from '../../../../../packages/client-core/src/sharedConfiguration';
import { usePropertySetupApi } from './usePropertySetupApi';

export function AssetRequirementFields({
  items,
  onChange,
  disabled,
}: {
  items: LocalAssetItem[];
  onChange: (items: LocalAssetItem[]) => void;
  disabled?: boolean;
}) {
  const { session } = useAuth();
  const api = sharedConfigurationClient(usePropertySetupApi().request);
  const [catalogId, setCatalogId] = useState('');
  const catalog = useQuery({
    queryKey: ['property-setup', 'shared-catalog-picker', session?.userId],
    queryFn: ({ signal }) => api.publishedCatalog(signal),
    enabled: !disabled && session?.roles.includes('Owner') === true,
  });
  const roomCatalog = (catalog.data ?? []).filter((doc) =>
    assetCatalogSupportsScope(doc.data as AssetCatalogData, 'Room'),
  );
  const update = (id: string, changes: Partial<LocalAssetItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  return (
    <Stack spacing={1.5}>
      {!items.length && (
        <Typography variant="body2" color="text.secondary">
          Chưa cấu hình tài sản cho phòng.
        </Typography>
      )}
      {items.map((item, index) => {
        const matching = roomCatalog.filter(
          (doc) =>
            doc.name.trim().toLocaleLowerCase('vi') === item.name.trim().toLocaleLowerCase('vi'),
        );
        const suggestedUnit =
          matching.length === 1 ? (matching[0].data as AssetCatalogData).unit : null;
        return (
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
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
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
            {!item.unit && suggestedUnit && !disabled && (
              <Button
                size="small"
                sx={{ gridColumn: '1 / -1', justifySelf: 'start' }}
                onClick={() => update(item.id, { unit: suggestedUnit })}
              >
                Dùng đơn vị mẫu {item.name}: {suggestedUnit}
              </Button>
            )}
          </Box>
        );
      })}
      {!disabled && roomCatalog.length > 0 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            select
            size="small"
            label="Tài sản mẫu theo phòng"
            value={catalogId}
            onChange={(event) => setCatalogId(event.target.value)}
            sx={{ flex: 1, minWidth: 0 }}
          >
            <MenuItem value="">Chọn tài sản mẫu</MenuItem>
            {roomCatalog.map((doc) => (
              <MenuItem key={doc.id} value={doc.id}>
                {doc.name} · {(doc.data as AssetCatalogData).unit}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            disabled={!catalogId || items.length >= 100}
            onClick={() => {
              const selected = roomCatalog.find((doc) => doc.id === catalogId);
              if (!selected) return;
              const data = selected.data as AssetCatalogData;
              onChange([
                ...items,
                {
                  id: crypto.randomUUID(),
                  name: selected.name,
                  category: data.category,
                  unit: data.unit,
                  trackingMode: 'BulkQuantity',
                  quantity: 1,
                },
              ]);
              setCatalogId('');
            }}
          >
            Thêm từ mẫu
          </Button>
        </Stack>
      )}
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
              trackingMode: 'BulkQuantity',
              quantity: 1,
            },
          ])
        }
      >
        Thêm tài sản riêng
      </Button>
    </Stack>
  );
}
