import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type { RoomTypeConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';

const emptyForm = {
  name: '',
  description: '',
  capacity: '1',
  area: '',
  amenities: '',
  reason: '',
};

export function RoomTypesApiPage() {
  const { locationId: routeLocation = '' } = useParams();
  const portal = usePortal();
  const locationId = routeLocation || (portal.locationId === 'all' ? '' : portal.locationId);
  const api = usePropertySetupApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const canManage = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<RoomTypeConfiguration | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const query = useQuery({
    queryKey: ['property-setup', 'room-types', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomTypes(locationId, 1, '', signal),
    enabled: !!locationId,
  });
  const save = useMutation({
    mutationFn: () =>
      api.saveRoomType(editing?.id ?? null, {
        locationId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        defaultCapacity: Number(form.capacity),
        areaM2: form.area ? Number(form.area) : null,
        amenities: form.amenities
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        isActive: editing?.isActive ?? true,
        version: editing?.version ?? 0,
        reason: form.reason.trim(),
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      setOpen(false);
    },
  });
  const edit = (value: RoomTypeConfiguration | null) => {
    save.reset();
    setEditing(value);
    setForm(
      value
        ? {
            name: value.name,
            description: value.description ?? '',
            capacity: String(value.defaultCapacity),
            area: value.areaM2 == null ? '' : String(value.areaM2),
            amenities: value.amenities.join(', '),
            reason: '',
          }
        : emptyForm,
    );
    setOpen(true);
  };
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Loại phòng"
        subtitle="Loại phòng của cơ sở được đọc và lưu trực tiếp trên Backend."
        actions={
          canManage ? (
            <Button variant="contained" disabled={!locationId} onClick={() => edit(null)}>
              Thêm loại phòng
            </Button>
          ) : undefined
        }
      />
      {!locationId ? (
        <Alert severity="info">Chọn cơ sở để quản lý loại phòng.</Alert>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <Alert severity="info">Cơ sở chưa có loại phòng.</Alert>
      ) : (
        <Stack spacing={1.5}>
          {query.data.items.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Typography sx={{ fontWeight: 800 }}>{item.name}</Typography>
                  <Typography color="text.secondary">
                    {item.defaultCapacity} người · {item.areaM2 ?? 'Chưa có'} m² ·{' '}
                    {item.amenities.join(' · ')}
                  </Typography>
                </div>
                {canManage && <Button onClick={() => edit(item)}>Chỉnh sửa</Button>}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      <Dialog open={open} onClose={() => !save.isPending && setOpen(false)} fullWidth maxWidth="sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogTitle>{editing ? 'Chỉnh sửa loại phòng' : 'Thêm loại phòng'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                required
                label="Tên loại phòng"
                value={form.name}
                onChange={(event) => setForm((old) => ({ ...old, name: event.target.value }))}
              />
              <TextField
                label="Mô tả"
                multiline
                value={form.description}
                onChange={(event) =>
                  setForm((old) => ({ ...old, description: event.target.value }))
                }
              />
              <TextField
                required
                type="number"
                label="Sức chứa mặc định"
                value={form.capacity}
                onChange={(event) => setForm((old) => ({ ...old, capacity: event.target.value }))}
              />
              <TextField
                type="number"
                label="Diện tích (m²)"
                value={form.area}
                onChange={(event) => setForm((old) => ({ ...old, area: event.target.value }))}
              />
              <TextField
                label="Tiện nghi, phân cách bằng dấu phẩy"
                value={form.amenities}
                onChange={(event) => setForm((old) => ({ ...old, amenities: event.target.value }))}
              />
              <TextField
                required={!!editing}
                label="Lý do / ghi chú"
                value={form.reason}
                onChange={(event) => setForm((old) => ({ ...old, reason: event.target.value }))}
              />
              {save.error && (
                <Alert severity="error">
                  {save.error instanceof Error ? save.error.message : 'Không thể lưu loại phòng.'}
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Hủy</Button>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              Lưu
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  );
}
