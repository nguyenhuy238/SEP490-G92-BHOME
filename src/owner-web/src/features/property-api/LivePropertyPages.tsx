/* oxlint-disable react/set-state-in-effect -- Dialog state is initialized when the selected server record changes. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { PageHeader } from '../../components/common/PortalUI';
import { usePortal } from '../../app/PortalProvider';
import {
  propertyError,
  usePropertyApi,
  type AssetDto,
  type LocationDto,
  type RoomDto,
  type RoomTypeDto,
  type Page,
} from './propertyApi';

function State({
  pending,
  error,
  retry,
  empty,
  children,
}: {
  pending: boolean;
  error: unknown;
  retry: () => void;
  empty?: boolean;
  children: ReactNode;
}) {
  if (pending) return <LinearProgress aria-label="Đang tải dữ liệu" />;
  if (error)
    return (
      <Alert severity="error" action={<Button onClick={retry}>Thử lại</Button>}>
        {propertyError(error)}
      </Alert>
    );
  if (empty) return <Alert severity="info">Chưa có dữ liệu phù hợp.</Alert>;
  return <>{children}</>;
}

function FormDialog({
  title,
  open,
  busy,
  error,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  open: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={onSubmit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {children}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function useLocationChoices() {
  const api = usePropertyApi();
  return useQuery({
    queryKey: ['property-locations'],
    queryFn: ({ signal }) => api.locations(signal),
  });
}

export function LiveLocationsPage() {
  const api = usePropertyApi(),
    qc = useQueryClient(),
    portal = usePortal();
  const query = useLocationChoices();
  const [editing, setEditing] = useState<LocationDto | 'new' | null>(null);
  const [values, setValues] = useState({ name: '', address: '', isActive: true, reason: '' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locations = query.data?.items ?? [];
  useEffect(() => {
    if (!editing) return;
    setValues(
      editing === 'new'
        ? { name: '', address: '', isActive: true, reason: '' }
        : { name: editing.name, address: editing.address, isActive: editing.isActive, reason: '' },
    );
    setError('');
  }, [editing]);
  const occupancy = useQuery({
    queryKey: ['property-occupancy-all', locations.map((x) => x.id).join(',')],
    enabled: locations.length > 0,
    queryFn: ({ signal }) =>
      Promise.all(locations.map((location) => api.occupancy(location.id, signal))),
  });
  const summaries = new Map((occupancy.data ?? []).map((x) => [x.locationId, x.snapshot]));
  return (
    <>
      <PageHeader
        title="Danh sách cơ sở"
        subtitle="Dữ liệu cơ sở và công suất phòng được lấy trực tiếp từ Backend."
        actions={
          <Button variant="contained" onClick={() => setEditing('new')}>
            Thêm cơ sở
          </Button>
        }
      />
      <State
        pending={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
        empty={locations.length === 0}
      >
        {occupancy.error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Không tải được công suất: {propertyError(occupancy.error)}
          </Alert>
        )}
        <Stack spacing={2}>
          {locations.map((location) => {
            const o = summaries.get(location.id);
            return (
              <Paper key={location.id} variant="outlined" sx={{ p: 2 }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Box>
                    <Typography
                      component={Link}
                      to={`/locations/${location.id}/overview`}
                      variant="h6"
                      color="primary"
                    >
                      {location.name}
                    </Typography>
                    <Typography color="text.secondary">{location.address}</Typography>
                  </Box>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Chip
                      label={location.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                      color={location.isActive ? 'success' : 'default'}
                    />
                    {o && <Chip label={`${o.occupiedRooms}/${o.totalRooms} phòng đang ở`} />}
                    <Button onClick={() => setEditing(location)}>Chỉnh sửa</Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      </State>
      <FormDialog
        title={editing === 'new' ? 'Thêm cơ sở' : 'Chỉnh sửa cơ sở'}
        open={!!editing}
        busy={busy}
        error={error}
        onClose={() => setEditing(null)}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const current = editing === 'new' ? undefined : (editing ?? undefined);
          void api
            .saveLocation({ ...values, version: current?.version ?? 0 }, current?.id)
            .then(
              async () => {
                await qc.invalidateQueries({ queryKey: ['property-locations'] });
                portal.notify(current ? 'Đã cập nhật cơ sở.' : 'Đã tạo cơ sở.');
                setEditing(null);
              },
              (x) => setError(propertyError(x)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <TextField
          required
          label="Tên cơ sở"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          slotProps={{ htmlInput: { minLength: 2, maxLength: 200 } }}
        />
        <TextField
          required
          multiline
          label="Địa chỉ"
          value={values.address}
          onChange={(e) => setValues({ ...values, address: e.target.value })}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        <TextField
          select
          label="Trạng thái"
          value={String(values.isActive)}
          onChange={(e) => setValues({ ...values, isActive: e.target.value === 'true' })}
        >
          <MenuItem value="true">Đang hoạt động</MenuItem>
          <MenuItem value="false">Ngừng hoạt động</MenuItem>
        </TextField>
        {editing !== 'new' && (
          <TextField
            label="Lý do thay đổi"
            value={values.reason}
            onChange={(e) => setValues({ ...values, reason: e.target.value })}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        )}
      </FormDialog>
    </>
  );
}

const roomStatus = ['Available', 'OnHold', 'Occupied', 'Unavailable'];
const assetStatus = ['Active', 'NeedsRepair', 'UnderRepair', 'Retired'];
const enumValue = (value: number | string, labels: string[]) =>
  typeof value === 'number' ? value : Math.max(0, labels.indexOf(value));

function LocationFilter({
  value,
  onChange,
  locations,
}: {
  value: string;
  onChange: (v: string) => void;
  locations: LocationDto[];
}) {
  return (
    <TextField
      select
      size="small"
      label="Cơ sở"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 240 }}
    >
      <MenuItem value="">Tất cả cơ sở</MenuItem>
      {locations.map((x) => (
        <MenuItem key={x.id} value={x.id}>
          {x.name}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function LiveRoomTypesPage({ forcedLocationId }: { forcedLocationId?: string } = {}) {
  const api = usePropertyApi(),
    qc = useQueryClient(),
    locationQuery = useLocationChoices(),
    portal = usePortal();
  const [locationId, setLocationId] = useState(forcedLocationId ?? '');
  const query = useQuery({
    queryKey: ['property-room-types', forcedLocationId ?? locationId],
    queryFn: ({ signal }) => api.roomTypes((forcedLocationId ?? locationId) || undefined, signal),
  });
  const [editing, setEditing] = useState<RoomTypeDto | 'new' | null>(null);
  const [v, setV] = useState({
    locationId: forcedLocationId ?? '',
    name: '',
    description: '',
    defaultCapacity: '1',
    areaM2: '',
    amenities: '',
    isActive: true,
    reason: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (editing) {
      const x = editing === 'new' ? null : editing;
      setV({
        locationId: forcedLocationId ?? x?.locationId ?? locationId,
        name: x?.name ?? '',
        description: x?.description ?? '',
        defaultCapacity: String(x?.defaultCapacity ?? 1),
        areaM2: x?.areaM2 == null ? '' : String(x.areaM2),
        amenities: x?.amenities.join(', ') ?? '',
        isActive: x?.isActive ?? true,
        reason: '',
      });
      setError('');
    }
  }, [editing, forcedLocationId, locationId]);
  const rows = query.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Loại phòng"
        subtitle="Cấu hình loại phòng theo từng cơ sở; Backend kiểm tra ràng buộc khi cập nhật."
        actions={
          <Button
            variant="contained"
            disabled={!forcedLocationId && !locationId}
            onClick={() => setEditing('new')}
          >
            Thêm loại phòng
          </Button>
        }
      />
      {!forcedLocationId && (
        <LocationFilter
          value={locationId}
          onChange={setLocationId}
          locations={locationQuery.data?.items ?? []}
        />
      )}
      {!forcedLocationId && !locationId ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          Chọn cơ sở để thêm hoặc lọc loại phòng.
        </Alert>
      ) : (
        <Box sx={{ mt: 2 }}>
          <State
            pending={query.isPending}
            error={query.error}
            retry={() => void query.refetch()}
            empty={rows.length === 0}
          >
            <SimpleTable
              headers={['Tên', 'Sức chứa', 'Diện tích', 'Tiện nghi', 'Trạng thái', '']}
              rows={rows.map((x) => [
                x.name,
                x.defaultCapacity,
                x.areaM2 ?? '—',
                x.amenities.join(', ') || '—',
                x.isActive ? 'Đang dùng' : 'Ngừng dùng',
                <Button key="edit" onClick={() => setEditing(x)}>
                  Sửa
                </Button>,
              ])}
            />
          </State>
        </Box>
      )}
      <FormDialog
        title={editing === 'new' ? 'Thêm loại phòng' : 'Chỉnh sửa loại phòng'}
        open={!!editing}
        busy={busy}
        error={error}
        onClose={() => setEditing(null)}
        onSubmit={(e) => {
          e.preventDefault();
          const current = editing === 'new' ? undefined : (editing ?? undefined);
          setBusy(true);
          setError('');
          void api
            .saveRoomType(
              {
                locationId: v.locationId,
                name: v.name,
                description: v.description || null,
                defaultCapacity: Number(v.defaultCapacity),
                areaM2: v.areaM2 ? Number(v.areaM2) : null,
                amenities: v.amenities
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
                isActive: v.isActive,
                version: current?.version ?? 0,
                reason: v.reason,
              },
              current?.id,
            )
            .then(
              async () => {
                await qc.invalidateQueries({ queryKey: ['property-room-types'] });
                portal.notify(current ? 'Đã cập nhật loại phòng.' : 'Đã tạo loại phòng.');
                setEditing(null);
              },
              (x) => setError(propertyError(x)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <TextField
          required
          select
          label="Cơ sở"
          disabled={!!forcedLocationId || editing !== 'new'}
          value={v.locationId}
          onChange={(e) => setV({ ...v, locationId: e.target.value })}
        >
          {(locationQuery.data?.items ?? []).map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          required
          label="Tên loại phòng"
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
        <TextField
          label="Mô tả"
          multiline
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
        <Stack direction="row" spacing={2}>
          <TextField
            required
            type="number"
            label="Sức chứa mặc định"
            value={v.defaultCapacity}
            onChange={(e) => setV({ ...v, defaultCapacity: e.target.value })}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <TextField
            type="number"
            label="Diện tích m²"
            value={v.areaM2}
            onChange={(e) => setV({ ...v, areaM2: e.target.value })}
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
          />
        </Stack>
        <TextField
          label="Tiện nghi (phân cách bằng dấu phẩy)"
          value={v.amenities}
          onChange={(e) => setV({ ...v, amenities: e.target.value })}
        />
        <TextField
          select
          label="Trạng thái"
          value={String(v.isActive)}
          onChange={(e) => setV({ ...v, isActive: e.target.value === 'true' })}
        >
          <MenuItem value="true">Đang dùng</MenuItem>
          <MenuItem value="false">Ngừng dùng</MenuItem>
        </TextField>
        {editing !== 'new' && (
          <TextField
            label="Lý do thay đổi"
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
          />
        )}
      </FormDialog>
    </>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
      <Table>
        <TableHead>
          <TableRow>
            {headers.map((x) => (
              <TableCell key={x}>{x}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell key={j}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export function LiveRoomsPage({ forcedLocationId }: { forcedLocationId?: string } = {}) {
  const api = usePropertyApi(),
    qc = useQueryClient(),
    locations = useLocationChoices(),
    portal = usePortal();
  const [locationId, setLocationId] = useState(forcedLocationId ?? '');
  const selected = forcedLocationId ?? locationId;
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const types = useQuery({
    queryKey: ['property-room-types', selected],
    enabled: !!selected,
    queryFn: ({ signal }) => api.roomTypes(selected, signal),
  });
  const query = useQuery({
    queryKey: ['property-rooms-page', selected, typeFilter, statusFilter, page],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (selected) params.set('locationId', selected);
      if (typeFilter) params.set('roomTypeId', typeFilter);
      if (statusFilter) params.set('roomStatus', statusFilter);
      return api.request<Page<RoomDto>>(`/api/v1/rooms?${params.toString()}`, { signal });
    },
  });
  const [editing, setEditing] = useState<RoomDto | 'new' | null>(null);
  const [v, setV] = useState({
    locationId: selected,
    roomTypeId: '',
    roomNumber: '',
    floor: '',
    capacity: '1',
    status: 0,
    reason: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (editing) {
      const x = editing === 'new' ? null : editing;
      setV({
        locationId: selected || x?.locationId || '',
        roomTypeId: x?.roomTypeId ?? '',
        roomNumber: x?.roomNumber ?? '',
        floor: x?.floor ?? '',
        capacity: String(x?.capacity ?? 1),
        status: x ? enumValue(x.status, roomStatus) : 0,
        reason: '',
      });
      setError('');
    }
  }, [editing, selected]);
  const rows = query.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Phòng"
        subtitle="Danh sách phòng thật từ Backend; trạng thái thuê không được suy đoán ở Frontend."
        actions={
          <Button variant="contained" disabled={!selected} onClick={() => setEditing('new')}>
            Thêm phòng
          </Button>
        }
      />
      {!forcedLocationId && (
        <LocationFilter
          value={locationId}
          onChange={(value) => {
            setLocationId(value);
            setTypeFilter('');
            setPage(1);
          }}
          locations={locations.data?.items ?? []}
        />
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
        <TextField
          select
          size="small"
          label="Loại phòng"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Tất cả loại phòng</MenuItem>
          {types.data?.items.map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Trạng thái phòng"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">Tất cả trạng thái</MenuItem>
          {roomStatus.map((x, i) => (
            <MenuItem key={x} value={String(i)}>
              {x}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Box sx={{ mt: 2 }}>
        <State
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          empty={rows.length === 0}
        >
          <SimpleTable
            headers={['Số phòng', 'Tầng', 'Loại phòng', 'Sức chứa', 'Trạng thái', '']}
            rows={rows.map((x) => [
              <Button key="detail" component={Link} to={`/rooms/${x.id}`}>
                {x.roomNumber}
              </Button>,
              x.floor || '—',
              types.data?.items.find((t) => t.id === x.roomTypeId)?.name ?? '—',
              x.capacity,
              roomStatus[enumValue(x.status, roomStatus)],
              <Button key="edit" onClick={() => setEditing(x)}>
                Sửa
              </Button>,
            ])}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
              Trang trước
            </Button>
            <Button
              disabled={!query.data || page * 20 >= query.data.totalCount}
              onClick={() => setPage((x) => x + 1)}
            >
              Trang sau
            </Button>
          </Stack>
        </State>
      </Box>
      <FormDialog
        title={editing === 'new' ? 'Thêm phòng' : 'Chỉnh sửa phòng'}
        open={!!editing}
        busy={busy}
        error={error}
        onClose={() => setEditing(null)}
        onSubmit={(e) => {
          e.preventDefault();
          const current = editing === 'new' ? undefined : (editing ?? undefined);
          setBusy(true);
          setError('');
          void api
            .saveRoom(
              {
                locationId: v.locationId,
                roomTypeId: v.roomTypeId,
                roomNumber: v.roomNumber,
                floor: v.floor || null,
                capacity: Number(v.capacity),
                status: v.status,
                version: current?.version ?? 0,
                reason: v.reason,
              },
              current?.id,
            )
            .then(
              async () => {
                await qc.invalidateQueries({ queryKey: ['property-rooms'] });
                await qc.invalidateQueries({ queryKey: ['property-rooms-page'] });
                portal.notify(current ? 'Đã cập nhật phòng.' : 'Đã tạo phòng.');
                setEditing(null);
              },
              (x) => setError(propertyError(x)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <TextField
          required
          select
          label="Loại phòng"
          value={v.roomTypeId}
          onChange={(e) => setV({ ...v, roomTypeId: e.target.value })}
        >
          {(types.data?.items ?? [])
            .filter((x) => x.isActive)
            .map((x) => (
              <MenuItem key={x.id} value={x.id}>
                {x.name}
              </MenuItem>
            ))}
        </TextField>
        <Stack direction="row" spacing={2}>
          <TextField
            required
            label="Số phòng"
            value={v.roomNumber}
            onChange={(e) => setV({ ...v, roomNumber: e.target.value })}
          />
          <TextField
            label="Tầng"
            value={v.floor}
            onChange={(e) => setV({ ...v, floor: e.target.value })}
          />
        </Stack>
        <TextField
          required
          type="number"
          label="Sức chứa"
          value={v.capacity}
          onChange={(e) => setV({ ...v, capacity: e.target.value })}
          slotProps={{ htmlInput: { min: 1 } }}
        />
        <TextField
          select
          label="Trạng thái"
          value={v.status}
          onChange={(e) => setV({ ...v, status: Number(e.target.value) })}
        >
          {roomStatus.map((x, i) => (
            <MenuItem value={i} key={x}>
              {x}
            </MenuItem>
          ))}
        </TextField>
        {editing !== 'new' && (
          <TextField
            label="Lý do thay đổi"
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
          />
        )}
      </FormDialog>
    </>
  );
}

export function LiveAssetsPage({ forcedLocationId }: { forcedLocationId?: string } = {}) {
  const api = usePropertyApi(),
    qc = useQueryClient(),
    locations = useLocationChoices(),
    portal = usePortal();
  const [locationId, setLocationId] = useState(forcedLocationId ?? '');
  const selected = forcedLocationId ?? locationId;
  const rooms = useQuery({
    queryKey: ['property-rooms', selected],
    enabled: !!selected,
    queryFn: ({ signal }) => api.rooms(selected, signal),
  });
  const query = useQuery({
    queryKey: ['property-assets', selected],
    queryFn: ({ signal }) => api.assets(selected || undefined, signal),
  });
  const [editing, setEditing] = useState<AssetDto | 'new' | null>(null);
  const [v, setV] = useState({
    locationId: selected,
    roomId: '',
    commonArea: '',
    code: '',
    name: '',
    category: '',
    condition: '',
    status: 0,
    reason: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (editing) {
      const x = editing === 'new' ? null : editing;
      setV({
        locationId: selected || x?.locationId || '',
        roomId: x?.roomId ?? '',
        commonArea: x?.commonArea ?? '',
        code: x?.code ?? '',
        name: x?.name ?? '',
        category: x?.category ?? '',
        condition: x?.condition ?? '',
        status: x ? enumValue(x.status, assetStatus) : 0,
        reason: '',
      });
      setError('');
    }
  }, [editing, selected]);
  const rows = query.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Tài sản"
        subtitle="Theo dõi tài sản theo phòng hoặc khu vực chung từ Backend."
        actions={
          <Button variant="contained" disabled={!selected} onClick={() => setEditing('new')}>
            Thêm tài sản
          </Button>
        }
      />
      {!forcedLocationId && (
        <LocationFilter
          value={locationId}
          onChange={setLocationId}
          locations={locations.data?.items ?? []}
        />
      )}
      <Box sx={{ mt: 2 }}>
        <State
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          empty={rows.length === 0}
        >
          <SimpleTable
            headers={['Mã', 'Tên', 'Nhóm', 'Vị trí', 'Hiện trạng', 'Trạng thái', '']}
            rows={rows.map((x) => [
              x.code || '—',
              x.name,
              x.category,
              x.roomId
                ? `Phòng ${rooms.data?.items.find((r) => r.id === x.roomId)?.roomNumber ?? ''}`
                : x.commonArea || '—',
              x.condition,
              assetStatus[enumValue(x.status, assetStatus)],
              <Button key="edit" onClick={() => setEditing(x)}>
                Sửa
              </Button>,
            ])}
          />
        </State>
      </Box>
      <FormDialog
        title={editing === 'new' ? 'Thêm tài sản' : 'Chỉnh sửa tài sản'}
        open={!!editing}
        busy={busy}
        error={error}
        onClose={() => setEditing(null)}
        onSubmit={(e) => {
          e.preventDefault();
          if (!v.roomId && !v.commonArea.trim()) {
            setError('Chọn phòng hoặc nhập khu vực chung.');
            return;
          }
          const current = editing === 'new' ? undefined : (editing ?? undefined);
          setBusy(true);
          setError('');
          void api
            .saveAsset(
              {
                locationId: v.locationId,
                roomId: v.roomId || null,
                commonArea: v.roomId ? null : v.commonArea,
                code: v.code || null,
                name: v.name,
                category: v.category,
                condition: v.condition,
                status: v.status,
                version: current?.version ?? 0,
                reason: v.reason,
              },
              current?.id,
            )
            .then(
              async () => {
                await qc.invalidateQueries({ queryKey: ['property-assets'] });
                portal.notify(current ? 'Đã cập nhật tài sản.' : 'Đã tạo tài sản.');
                setEditing(null);
              },
              (x) => setError(propertyError(x)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Stack direction="row" spacing={2}>
          <TextField
            label="Mã tài sản"
            value={v.code}
            onChange={(e) => setV({ ...v, code: e.target.value })}
          />
          <TextField
            required
            label="Tên tài sản"
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </Stack>
        <TextField
          required
          label="Nhóm tài sản"
          value={v.category}
          onChange={(e) => setV({ ...v, category: e.target.value })}
        />
        <TextField
          select
          label="Phòng (để trống nếu ở khu vực chung)"
          value={v.roomId}
          onChange={(e) =>
            setV({ ...v, roomId: e.target.value, commonArea: e.target.value ? '' : v.commonArea })
          }
        >
          <MenuItem value="">Khu vực chung</MenuItem>
          {(rooms.data?.items ?? []).map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.roomNumber}
            </MenuItem>
          ))}
        </TextField>
        {!v.roomId && (
          <TextField
            required
            label="Khu vực chung"
            value={v.commonArea}
            onChange={(e) => setV({ ...v, commonArea: e.target.value })}
          />
        )}
        <TextField
          required
          multiline
          label="Hiện trạng"
          value={v.condition}
          onChange={(e) => setV({ ...v, condition: e.target.value })}
        />
        <TextField
          select
          label="Trạng thái"
          value={v.status}
          onChange={(e) => setV({ ...v, status: Number(e.target.value) })}
        >
          {assetStatus.map((x, i) => (
            <MenuItem key={x} value={i}>
              {x}
            </MenuItem>
          ))}
        </TextField>
        {editing !== 'new' && (
          <TextField
            label="Lý do thay đổi"
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
          />
        )}
      </FormDialog>
    </>
  );
}

export function LiveLocationWorkspace() {
  const { locationId = '' } = useParams();
  const route = useLocation();
  const api = usePropertyApi();
  const location = useQuery({
    queryKey: ['property-location', locationId],
    enabled: !!locationId,
    queryFn: ({ signal }) =>
      api.request<LocationDto>(`/api/v1/locations/${encodeURIComponent(locationId)}`, { signal }),
  });
  if (location.isPending) return <LinearProgress />;
  if (location.error) return <Alert severity="error">{propertyError(location.error)}</Alert>;
  if (!location.data) return <Navigate to="/locations" replace />;
  return (
    <>
      <PageHeader
        title={location.data.name}
        subtitle={location.data.address}
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={Link} to={`/locations/${locationId}/overview`}>
              Tổng quan
            </Button>
            <Button component={Link} to={`/locations/${locationId}/rooms`}>
              Phòng
            </Button>
            <Button component={Link} to={`/locations/${locationId}/room-types`}>
              Loại phòng
            </Button>
            <Button component={Link} to={`/locations/${locationId}/assets`}>
              Tài sản
            </Button>
            <Button component={Link} to={`/locations/${locationId}/pricing`}>
              Biểu phí
            </Button>
            <Button component={Link} to="/locations">
              Danh sách cơ sở
            </Button>
          </Stack>
        }
      />
      {route.pathname.endsWith('/overview') ? <LiveLocationOverview /> : <Outlet />}
    </>
  );
}

export function LiveLocationOverview() {
  const { locationId = '' } = useParams();
  const api = usePropertyApi();
  const occupancy = useQuery({
    queryKey: ['property-occupancy', locationId],
    queryFn: ({ signal }) => api.occupancy(locationId, signal),
  });
  return (
    <State
      pending={occupancy.isPending}
      error={occupancy.error}
      retry={() => void occupancy.refetch()}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {occupancy.data &&
          Object.entries({
            'Tổng phòng': occupancy.data.snapshot.totalRooms,
            'Đang ở': occupancy.data.snapshot.occupiedRooms,
            'Còn trống': occupancy.data.snapshot.availableRooms,
            'Đang giữ': occupancy.data.snapshot.onHoldRooms,
            'Không khả dụng': occupancy.data.snapshot.unavailableRooms,
          }).map(([label, value]) => (
            <Paper key={label} variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography color="text.secondary">{label}</Typography>
              <Typography variant="h4">{value}</Typography>
            </Paper>
          ))}
      </Stack>
    </State>
  );
}

interface RoomHistoryPage {
  items: { id: string; eventType: string; source: string; occurredAt: string; summary: string }[];
  totalCount: number;
  completeness: string;
  limitations: string[];
}

export function LiveRoomDetail() {
  const { id = '' } = useParams();
  const api = usePropertyApi();
  const room = useQuery({
    queryKey: ['property-room', id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      api.request<RoomDto>(`/api/v1/rooms/${encodeURIComponent(id)}`, { signal }),
  });
  const history = useQuery({
    queryKey: ['property-room-history', id],
    enabled: !!id,
    queryFn: ({ signal }) =>
      api.request<RoomHistoryPage>(
        `/api/v1/rooms/${encodeURIComponent(id)}/history?page=1&pageSize=20`,
        { signal },
      ),
  });
  if (room.isPending) return <LinearProgress aria-label="Đang tải phòng" />;
  if (room.error)
    return (
      <Alert severity="error" action={<Button onClick={() => void room.refetch()}>Thử lại</Button>}>
        {propertyError(room.error)}
      </Alert>
    );
  if (!room.data) return <Navigate to="/rooms" replace />;
  return (
    <>
      <PageHeader
        title={`Phòng ${room.data.roomNumber}`}
        subtitle={`Tầng ${room.data.floor || '—'} · Sức chứa ${room.data.capacity} · Trạng thái ${roomStatus[enumValue(room.data.status, roomStatus)]}`}
        actions={
          <Button component={Link} to={`/locations/${room.data.locationId}/rooms`}>
            Danh sách phòng
          </Button>
        }
      />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Lịch sử phòng
        </Typography>
        {history.isPending && <LinearProgress />}
        {history.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void history.refetch()}>Thử lại</Button>}
          >
            {propertyError(history.error)}
          </Alert>
        )}
        {history.data?.items.length === 0 && (
          <Alert severity="info">Chưa có sự kiện lịch sử được Backend ghi nhận.</Alert>
        )}
        {history.data?.limitations.map((x) => (
          <Alert severity="warning" key={x} sx={{ mb: 1 }}>
            {x}
          </Alert>
        ))}
        <Stack spacing={1}>
          {history.data?.items.map((x) => (
            <Box key={x.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
              <Typography sx={{ fontWeight: 700 }}>{x.eventType}</Typography>
              <Typography variant="body2">{x.summary}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(x.occurredAt).toLocaleString('vi-VN')} · {x.source}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Paper>
    </>
  );
}

export function LocationRoomsRoute() {
  const { locationId } = useParams();
  return <LiveRoomsPage forcedLocationId={locationId} />;
}
export function LocationRoomTypesRoute() {
  const { locationId } = useParams();
  return <LiveRoomTypesPage forcedLocationId={locationId} />;
}
export function LocationAssetsRoute() {
  const { locationId } = useParams();
  return <LiveAssetsPage forcedLocationId={locationId} />;
}
