import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  TablePagination,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { MoneyField } from '../../../components/common/MoneyField';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { ConflictReload } from '../../locations/components/ConflictReload';
import {
  RoomTypeMasterDetail,
  RoomDefaultsDetails,
  type LocalRoomDefaults,
} from './RoomTypeMasterDetail';

const emptyForm = {
  name: '',
  description: '',
  capacity: '1',
  area: '',
  amenities: '',
  referenceRent: '',
  assetTemplateId: '',
  reason: '',
  status: 'Recorded' as 'Recorded' | 'Archived',
};

export function RoomTypesApiPage() {
  const { locationId: routeLocation = '' } = useParams();
  const portal = usePortal();
  const locationId = routeLocation || (portal.locationId === 'all' ? '' : portal.locationId);
  return <RoomDefaultsWorkspace key={locationId} locationId={locationId} />;
}

function RoomDefaultsWorkspace({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const setup = locationSetupClient(api.request);
  const lock = useRef(false);
  const cache = useQueryClient();
  const { session } = useAuth();
  const canManage = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<LocalRoomDefaults | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [inspecting, setInspecting] = useState<LocalRoomDefaults | null>(null);
  const [form, setForm] = useState(emptyForm);
  const query = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, locationId],
    queryFn: ({ signal }) => setup.localRoomDefaults(locationId, signal),
    enabled: canManage && !!locationId,
  });
  const templates = useQuery({
    queryKey: ['property-setup', 'asset-templates', session?.userId, locationId],
    queryFn: ({ signal }) => api.templates(locationId, signal),
    enabled: canManage && !!locationId && open,
  });
  const history = useQuery({
    queryKey: [
      'property-setup',
      'room-defaults-history',
      session?.userId,
      locationId,
      inspecting?.id,
    ],
    queryFn: ({ signal }) => setup.localRoomDefaultsHistory(locationId, inspecting!.id, signal),
    enabled: canManage && !!inspecting,
  });
  const filtered = (query.data ?? []).filter((item) =>
    item.data.name.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')),
  );
  const valid =
    form.name.trim().length >= 2 &&
    Number.isInteger(Number(form.capacity)) &&
    Number(form.capacity) >= 1 &&
    Number(form.capacity) <= 32767 &&
    !!form.area.trim() &&
    Number.isFinite(Number(form.area)) &&
    Number(form.area) > 0 &&
    (!form.referenceRent.trim() ||
      (Number.isFinite(Number(form.referenceRent)) && Number(form.referenceRent) >= 0)) &&
    (!editing || !!form.reason.trim());
  const save = useMutation({
    mutationFn: () =>
      setup.saveLocalRoomDefaults(locationId, editing?.id ?? null, {
        name: form.name.trim(),
        description: form.description.trim(),
        defaults: {
          capacity: Number(form.capacity),
          area: Number(form.area),
          amenities: [
            ...new Set(
              form.amenities
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ],
          referenceRent: form.referenceRent.trim() ? form.referenceRent : null,
        },
        assetTemplateId: form.assetTemplateId || null,
        expectedVersion: editing?.version ?? 0,
        reason: form.reason.trim(),
        status: form.status,
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      setOpen(false);
    },
  });
  const edit = (item: LocalRoomDefaults | null) => {
    save.reset();
    setEditing(item);
    setForm(
      item
        ? {
            name: item.data.name,
            description: item.data.description ?? '',
            capacity: String(item.data.defaults.capacity),
            area: item.data.defaults.area == null ? '' : String(item.data.defaults.area),
            amenities: item.data.defaults.amenities.join(', '),
            referenceRent:
              item.data.defaults.referenceRent == null
                ? ''
                : String(item.data.defaults.referenceRent),
            assetTemplateId: item.data.assetTemplateId ?? '',
            reason: '',
            status: item.status === 'Archived' ? 'Archived' : 'Recorded',
          }
        : emptyForm,
    );
    setOpen(true);
  };
  const field = (
    key: keyof typeof emptyForm,
    label: string,
    props: React.ComponentProps<typeof TextField> = {},
  ) => (
    <TextField
      label={label}
      value={form[key]}
      onChange={(e) => setForm((old) => ({ ...old, [key]: e.target.value }))}
      {...props}
    />
  );
  return (
    <Stack spacing={2}>
      <PageHeader
        group={null}
        title="Gợi ý tạo phòng"
        subtitle="Cấu hình riêng của cơ sở dùng để tạo phòng nhanh. Có thể sửa độc lập sau khi nạp từ thư viện hoặc sao chép."
        actions={
          canManage ? (
            <Button variant="contained" disabled={!locationId} onClick={() => edit(null)}>
              Thêm gợi ý tạo phòng
            </Button>
          ) : undefined
        }
      />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            fullWidth
            label="Tìm gợi ý tạo phòng"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <Button
            disabled={query.isFetching || !canManage || !locationId}
            onClick={() => void query.refetch()}
          >
            Làm mới
          </Button>
        </Stack>
      </Paper>
      {!canManage ? (
        <Alert severity="info">Owner quản lý cấu hình gợi ý tạo phòng.</Alert>
      ) : !locationId ? (
        <Alert severity="info">Chọn cơ sở để quản lý gợi ý tạo phòng.</Alert>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !filtered.length ? (
        <Alert severity="info">
          {search
            ? 'Không tìm thấy gợi ý phù hợp.'
            : 'Cơ sở chưa có gợi ý tạo phòng. Bạn có thể tạo mới hoặc nạp từ thư viện mẫu chung.'}
        </Alert>
      ) : (
        <RoomTypeMasterDetail
          items={filtered.slice(page * 20, page * 20 + 20)}
          total={filtered.length}
          canManage={canManage}
          edit={edit}
          inspect={setInspecting}
        />
      )}
      {canManage && filtered.length > 20 && (
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          rowsPerPage={20}
          rowsPerPageOptions={[20]}
          onPageChange={(_, value) => setPage(value)}
          labelRowsPerPage="Số dòng"
        />
      )}
      {canManage && locationId && (
        <Button
          component={Link}
          to={`/locations/${locationId}/rooms`}
          sx={{ alignSelf: 'flex-start' }}
        >
          Đi đến danh sách phòng
        </Button>
      )}
      <Dialog open={!!inspecting} onClose={() => setInspecting(null)} fullWidth maxWidth="sm">
        <DialogTitle>{inspecting?.data.name}</DialogTitle>
        <DialogContent>
          {inspecting && <RoomDefaultsDetails item={inspecting} />}
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 3, mb: 1 }}>
            Lịch sử phiên bản
          </Typography>
          {history.isPending ? (
            <LoadingState />
          ) : history.error ? (
            <ErrorState error={history.error} retry={() => void history.refetch()} />
          ) : (
            <Stack spacing={1}>
              {history.data?.map((item) => (
                <Paper key={`${item.id}-${item.version}`} variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="body2">
                    Phiên bản {item.version} · {item.data.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.data.defaults.capacity} người · {item.data.defaults.area} m²
                  </Typography>
                </Paper>
              ))}
              {!history.data?.length && (
                <Typography variant="body2" color="text.secondary">
                  Chưa có lịch sử phiên bản.
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspecting(null)}>Đóng</Button>
          {canManage && inspecting && (
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
      <Dialog open={open} onClose={() => !save.isPending && setOpen(false)} fullWidth maxWidth="sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || !canManage || lock.current) return;
            lock.current = true;
            void save
              .mutateAsync()
              .catch(() => {})
              .finally(() => {
                lock.current = false;
              });
          }}
        >
          <DialogTitle>
            {editing ? 'Chỉnh sửa gợi ý tạo phòng' : 'Thêm gợi ý tạo phòng'}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {field('name', 'Tên gợi ý', { required: true })}
              {field('description', 'Mô tả', { multiline: true })}
              {field('capacity', 'Sức chứa mặc định', {
                type: 'number',
                required: true,
                slotProps: { htmlInput: { min: 1, max: 32767, step: 1 } },
              })}
              {field('area', 'Diện tích (m²)', {
                type: 'number',
                required: true,
                slotProps: { htmlInput: { min: 0.01, max: 999999.99, step: 0.01 } },
              })}
              {field('amenities', 'Tiện nghi, phân cách bằng dấu phẩy', {
                helperText: 'Ví dụ: Điều hòa, Ban công, Bếp riêng',
              })}
              <MoneyField
                label="Giá thuê tham khảo (VND)"
                allowDecimal
                value={form.referenceRent}
                onValueChange={(raw) => setForm((old) => ({ ...old, referenceRent: raw }))}
              />
              {templates.error && (
                <ErrorState error={templates.error} retry={() => void templates.refetch()} />
              )}
              <TextField
                select
                label="Bộ mẫu trang bị tại cơ sở"
                value={form.assetTemplateId}
                onChange={(e) => setForm((old) => ({ ...old, assetTemplateId: e.target.value }))}
              >
                <MenuItem value="">Không liên kết</MenuItem>
                {form.assetTemplateId &&
                  !templates.data?.some((item) => item.id === form.assetTemplateId) && (
                    <MenuItem value={form.assetTemplateId}>Gói đã liên kết</MenuItem>
                  )}
                {templates.data?.map((item) => (
                  <MenuItem key={item.id} value={item.id} disabled={item.status !== 'Published'}>
                    {item.data.name} · {item.status === 'Published' ? 'Đã công bố' : 'Chưa công bố'}
                  </MenuItem>
                ))}
              </TextField>
              {editing && (
                <TextField
                  select
                  label="Trạng thái gợi ý"
                  value={form.status}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      status: e.target.value as 'Recorded' | 'Archived',
                    }))
                  }
                >
                  <MenuItem value="Recorded">Đang sử dụng</MenuItem>
                  <MenuItem value="Archived">Ngừng sử dụng</MenuItem>
                </TextField>
              )}
              {field('reason', 'Lý do / ghi chú', { required: !!editing })}
              <Alert severity="info">
                Lưu gợi ý riêng tại cơ sở. Giá tham khảo không tự tạo biểu phí; bộ trang bị không
                phải tài sản đã lắp đặt.
              </Alert>
              {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
              {editing && (
                <ConflictReload
                  error={save.error}
                  reload={async () => {
                    const latest = (await setup.localRoomDefaults(locationId)).find(
                      (item) => item.id === editing.id,
                    );
                    if (!latest) throw new Error('Gợi ý không còn khả dụng.');
                    edit(latest);
                  }}
                />
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={save.isPending} onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={save.isPending || !valid || !canManage}
            >
              Lưu
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  );
}
