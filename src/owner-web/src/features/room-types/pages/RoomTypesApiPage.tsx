import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  MenuItem,
  TablePagination,
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
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { ConflictReload } from '../../locations/components/ConflictReload';
import { RoomTypeMasterDetail } from './RoomTypeMasterDetail';

const emptyForm = {
  name: '',
  description: '',
  capacity: '1',
  area: '',
  amenities: '',
  reason: '',
  active: 'true',
};

export function RoomTypesApiPage() {
  const { locationId: routeLocation = '' } = useParams();
  const portal = usePortal();
  const locationId = routeLocation || (portal.locationId === 'all' ? '' : portal.locationId);
  const api = usePropertySetupApi();
  const lock = useRef(false);
  const cache = useQueryClient();
  const { session } = useAuth();
  const canManage = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<RoomTypeConfiguration | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [inspecting, setInspecting] = useState<RoomTypeConfiguration | null>(null);
  const [form, setForm] = useState(emptyForm);
  const query = useQuery({
    queryKey: ['property-setup', 'room-types', session?.userId, locationId, page, search],
    queryFn: ({ signal }) => api.roomTypes(locationId, page + 1, search, signal),
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
        isActive: form.active === 'true',
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
            active: String(value.isActive),
          }
        : emptyForm,
    );
    setOpen(true);
  };
  return (
    <Stack spacing={2}>
      <PageHeader
        group={null}
        title="Loại phòng"
        subtitle="Quản lý sức chứa, diện tích và tiện nghi để cấu hình phòng nhất quán."
        actions={
          canManage ? (
            <Button variant="contained" disabled={!locationId} onClick={() => edit(null)}>
              Thêm loại phòng
            </Button>
          ) : undefined
        }
      />
      <Paper variant="outlined" sx={{ p: 2, borderRadius: '10px' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            fullWidth
            label="Tìm loại phòng"
            placeholder="Nhập tên loại phòng…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
            Làm mới
          </Button>
        </Stack>
      </Paper>
      {!locationId ? (
        <Alert severity="info">Chọn cơ sở để quản lý loại phòng.</Alert>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <Alert severity="info">
          {search
            ? 'Không tìm thấy loại phòng phù hợp. Hãy thử từ khóa khác.'
            : 'Cơ sở chưa có loại phòng. Thêm loại phòng đầu tiên để bắt đầu cấu hình.'}
        </Alert>
      ) : (
        <RoomTypeMasterDetail
          items={query.data.items}
          total={query.data.totalCount}
          canManage={canManage}
          edit={edit}
          inspect={setInspecting}
        />
      )}
      {query.data && (
        <TablePagination
          component="div"
          count={query.data.totalCount}
          page={page}
          rowsPerPage={100}
          rowsPerPageOptions={[100]}
          onPageChange={(_, value) => setPage(value)}
          labelRowsPerPage="Số dòng"
          getItemAriaLabel={(type) =>
            type === 'next'
              ? 'Tới trang tiếp theo'
              : type === 'previous'
                ? 'Tới trang trước'
                : type === 'first'
                  ? 'Trang đầu'
                  : 'Trang cuối'
          }
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} trong ${count}`}
        />
      )}
      <Dialog open={!!inspecting} onClose={() => setInspecting(null)} fullWidth maxWidth="sm">
        <DialogTitle>{inspecting?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>{inspecting?.description || 'Chưa có mô tả.'}</Typography>
            <Typography>
              Sức chứa: {inspecting?.defaultCapacity} người · Diện tích:{' '}
              {inspecting?.areaM2 ?? 'Chưa khai báo'} m²
            </Typography>
            <Typography>
              Tiện nghi: {inspecting?.amenities.join(', ') || 'Chưa khai báo'}
            </Typography>
            <Chip label={inspecting?.isActive ? 'Đang sử dụng' : 'Ngừng sử dụng'} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspecting(null)}>Đóng</Button>
          {canManage && (
            <Button
              variant="contained"
              onClick={() => {
                edit(inspecting);
                setInspecting(null);
              }}
            >
              Chỉnh sửa
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={open}
        onClose={() => !save.isPending && setOpen(false)}
        fullWidth
        maxWidth="md"
        slotProps={{ paper: { sx: { borderRadius: '12px' } } }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.current) return;
            lock.current = true;
            void save
              .mutateAsync()
              .catch(() => {})
              .finally(() => {
                lock.current = false;
              });
          }}
        >
          <DialogTitle>{editing ? 'Chỉnh sửa loại phòng' : 'Thêm loại phòng'}</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
                gap: 3,
                pt: 1,
              }}
            >
              <Stack spacing={2}>
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                  Thông tin loại phòng
                </Typography>
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
                  slotProps={{ htmlInput: { min: 1, max: 32767, step: 1 } }}
                  value={form.capacity}
                  onChange={(event) => setForm((old) => ({ ...old, capacity: event.target.value }))}
                />
              </Stack>
              <Stack spacing={2} sx={{ p: 2.5, bgcolor: '#f5f7fb', borderRadius: '10px' }}>
                <Typography sx={{ fontWeight: 750 }}>Tiện nghi & áp dụng</Typography>
                <TextField
                  type="number"
                  label="Diện tích (m²)"
                  slotProps={{ htmlInput: { min: 0.01, max: 999999.99, step: 0.01 } }}
                  value={form.area}
                  onChange={(event) => setForm((old) => ({ ...old, area: event.target.value }))}
                />
                <TextField
                  label="Tiện nghi, phân cách bằng dấu phẩy"
                  helperText="Ví dụ: Điều hòa, Ban công, Bếp riêng. Mỗi mục sẽ hiển thị thành nhãn để dễ xem."
                  value={form.amenities}
                  onChange={(event) =>
                    setForm((old) => ({ ...old, amenities: event.target.value }))
                  }
                />
                <TextField
                  select
                  label="Trạng thái sử dụng"
                  value={form.active}
                  onChange={(e) => setForm((old) => ({ ...old, active: e.target.value }))}
                >
                  <MenuItem value="true">Đang sử dụng</MenuItem>
                  <MenuItem value="false">Ngừng sử dụng</MenuItem>
                </TextField>
                <TextField
                  required={!!editing}
                  label="Lý do / ghi chú"
                  value={form.reason}
                  onChange={(event) => setForm((old) => ({ ...old, reason: event.target.value }))}
                />
                {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
                {editing && (
                  <ConflictReload
                    error={save.error}
                    reload={async () =>
                      edit(
                        await api.request<RoomTypeConfiguration>(
                          `/api/v1/room-types/${encodeURIComponent(editing.id)}`,
                        ),
                      )
                    }
                  />
                )}
              </Stack>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button disabled={save.isPending} onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="contained" disabled={save.isPending}>
              Lưu
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  );
}
