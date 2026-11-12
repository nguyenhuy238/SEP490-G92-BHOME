import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { invoiceError, type Page } from '../../../../../packages/client-core/src/invoices';
import type {
  LocationConfiguration,
  PhysicalAsset,
  RoomConfiguration,
} from '../../../../../packages/client-core/src/propertySetup';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../../components/common/PortalUI';
import { usePortal } from '../../app/PortalProvider';
import { usePropertySetupApi } from './usePropertySetupApi';
import { AssetOperationsPanel } from './AssetOperationsPanel';
import { ApiConfigurationCopy } from '../configuration/ApiConfigurationCopy';
import { LocationRoomDefaultsPicker } from '../configuration/LocationRoomDefaultsPicker';
import { BulkRoomsDialog } from '../locations/components/BulkRoomsDialog';
import { RoomFloorCards } from '../locations/components/RoomFloorCards';
import { RoomInspector } from '../locations/components/RoomInspector';
import { ConflictReload } from '../locations/components/ConflictReload';

type Kind = 'locations' | 'rooms' | 'assets';
type Row = LocationConfiguration | RoomConfiguration | PhysicalAsset;
const titles: Record<Kind, string> = {
  locations: 'Quản lý cơ sở',
  rooms: 'Quản lý phòng',
  assets: 'Tài sản vật lý',
};
const roomLabels = ['Trống khai thác', 'Đang giữ chỗ', 'Đang có khách thuê', 'Ngừng khai thác'];
const assetLabels = ['Đang sử dụng', 'Hư hỏng', 'Đang sửa chữa', 'Đã ngừng sử dụng'];

export function PropertyApiPage({
  kind,
  createInitially = false,
}: {
  kind: Kind;
  createInitially?: boolean;
}) {
  const api = usePropertySetupApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const portal = usePortal();
  const params = useParams();
  const canManage = session?.roles.includes('Owner') ?? false;
  const [selectedLocation, setSelectedLocation] = useState(
    portal.locationId === 'all' ? '' : portal.locationId,
  );
  const location = params.locationId ?? selectedLocation;
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState(kind === 'rooms' ? 'cards' : 'table');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [inspectedRoom, setInspectedRoom] = useState('');
  const [open, setOpen] = useState(createInitially);
  const [confirmInactive, setConfirmInactive] = useState(false);
  const [inspectedAsset, setInspectedAsset] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const options = useQuery({
    queryKey: ['property-setup', 'locations-options', session?.userId],
    queryFn: ({ signal }) => api.locationOptions(signal),
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, location],
    queryFn: ({ signal }) => api.roomOptions(location, signal),
    enabled: kind === 'assets' && !!location,
  });
  const roomTypes = useQuery({
    queryKey: ['property-setup', 'room-types-options', session?.userId, location],
    queryFn: ({ signal }) => api.roomTypes(location, 1, '', signal),
    enabled: kind === 'rooms' && !!location,
  });
  const query = useQuery({
    queryKey: ['property-setup', kind, session?.userId, location, page, search, statusFilter],
    queryFn: async ({ signal }): Promise<Page<Row>> =>
      kind === 'locations'
        ? api.locations(page + 1, search, signal)
        : api.request<Page<Row>>(
            `/api/v1/${kind}?${new URLSearchParams({ locationId: location, page: String(page + 1), pageSize: '20', ...(search ? { search } : {}), ...(statusFilter ? { [kind === 'rooms' ? 'roomStatus' : 'assetStatus']: statusFilter } : {}) })}`,
            { signal },
          ),
    enabled: kind === 'locations' || !!location,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!canManage) throw new Error('Owner authorization is required.');
      const version = editing?.version ?? 0;
      const reason = values.reason ?? '';
      if (kind === 'locations')
        return api.saveLocation(editing?.id ?? null, {
          name: values.name?.trim() ?? '',
          address: values.address?.trim() ?? '',
          isActive: values.isActive !== 'false',
          version,
          reason,
        });
      if (kind === 'rooms')
        return api.saveRoom(editing?.id ?? null, {
          locationId: location,
          roomNumber: values.roomNumber?.trim() ?? '',
          floor: values.floor?.trim() || null,
          capacity: Number(values.capacity),
          status: Number(values.status ?? 0),
          version,
          reason,
        });
      return api.saveAsset(editing?.id ?? null, {
        locationId: location,
        roomId: values.roomId || null,
        commonArea: values.roomId ? null : values.commonArea?.trim() || null,
        code: values.code?.trim() || null,
        name: values.name?.trim() ?? '',
        category: values.category?.trim() ?? '',
        condition: values.condition?.trim() ?? '',
        status: Number(values.status ?? 0),
        version,
        reason,
      });
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      setOpen(false);
      setConfirmInactive(false);
      setNotice('Máy chủ đã lưu cấu hình.');
    },
  });
  const edit = (row: Row | null) => {
    save.reset();
    setEditing(row);
    setNotice('');
    setValues(
      row
        ? Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]),
          )
        : {},
    );
    setOpen(true);
  };
  const submit = () => {
    if (lock.current) return;
    lock.current = true;
    void save
      .mutateAsync()
      .catch(() => {})
      .finally(() => {
        lock.current = false;
      });
  };
  const field = (key: string, label: string, required = true, type = 'text') => (
    <TextField
      key={key}
      required={required}
      label={label}
      type={type}
      value={values[key] ?? ''}
      onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.value }))}
      slotProps={type === 'number' ? { htmlInput: { min: 1, max: 32767, step: 1 } } : undefined}
    />
  );
  return (
    <Stack spacing={2}>
      <PageHeader
        group={null}
        title={titles[kind]}
        subtitle={
          kind === 'rooms'
            ? 'Tìm phòng, xem sức chứa và quản lý trạng thái khai thác.'
            : kind === 'assets'
              ? 'Theo dõi thiết bị thực tế tại phòng và khu chung, kiểm tra tình trạng và lịch sử.'
              : 'Quản lý thông tin và cấu hình các cơ sở.'
        }
        actions={
          canManage ? (
            <Stack direction="row" spacing={1}>
              {kind === 'locations' && <ApiConfigurationCopy />}
              {kind === 'rooms' && (
                <Button variant="outlined" disabled={!location} onClick={() => setBulkOpen(true)}>
                  Tạo phòng hàng loạt
                </Button>
              )}
              <Button
                variant="contained"
                disabled={kind !== 'locations' && !location}
                onClick={() => edit(null)}
              >
                Thêm {kind === 'locations' ? 'cơ sở' : kind === 'rooms' ? 'phòng' : 'tài sản'}
              </Button>
            </Stack>
          ) : undefined
        }
      />
      {notice && <Alert severity="success">{notice}</Alert>}
      {kind !== 'locations' && !params.locationId && (
        <TextField
          select
          label="Cơ sở quản lý"
          value={selectedLocation}
          onChange={(event) => {
            setSelectedLocation(event.target.value);
            setPage(0);
          }}
        >
          <MenuItem value="">Chọn cơ sở</MenuItem>
          {options.data?.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {item.label}
            </MenuItem>
          ))}
        </TextField>
      )}
      {options.error && <ErrorState error={options.error} retry={() => void options.refetch()} />}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' } }}
        >
          <TextField
            fullWidth
            label="Tìm kiếm"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          {kind !== 'locations' && (
            <TextField
              select
              label="Trạng thái"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Tất cả trạng thái</MenuItem>
              {(kind === 'rooms' ? roomLabels : assetLabels).map((label, index) => (
                <MenuItem key={label} value={String(index)}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button
            disabled={query.isFetching || (kind !== 'locations' && !location)}
            onClick={() => void query.refetch()}
          >
            Tải lại danh sách
          </Button>
          {kind === 'rooms' && (
            <Button onClick={() => setView((old) => (old === 'cards' ? 'table' : 'cards'))}>
              {view === 'cards' ? 'Dạng bảng' : 'Sơ đồ phòng'}
            </Button>
          )}
        </Stack>
      </Paper>
      {kind !== 'locations' && !location ? (
        <Alert severity="info">Chọn cơ sở để quản lý cấu hình.</Alert>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <Paper>
          {!query.data?.items.length ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <EmptyState />
              <Typography color="text.secondary">
                {search || statusFilter
                  ? 'Thử đổi từ khóa hoặc trạng thái để xem dữ liệu khác.'
                  : 'Thêm bản ghi đầu tiên để bắt đầu quản lý.'}
              </Typography>
              {canManage && (
                <Button sx={{ mt: 2 }} variant="outlined" onClick={() => edit(null)}>
                  Thêm mới
                </Button>
              )}
            </Box>
          ) : kind === 'rooms' && view === 'cards' ? (
            <RoomFloorCards
              locationId={location}
              roomTypes={roomTypes.data?.items ?? []}
              rooms={query.data.items.filter((row): row is RoomConfiguration => 'capacity' in row)}
              total={query.data.totalCount}
              inspect={setInspectedRoom}
              edit={canManage ? edit : undefined}
            />
          ) : (
            <Stack sx={{ overflowX: 'auto' }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Tên / mã</TableCell>
                    <TableCell>Thông tin</TableCell>
                    <TableCell>Trạng thái</TableCell>
                    <TableCell>Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {query.data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{'roomNumber' in row ? row.roomNumber : row.name}</TableCell>
                      <TableCell>
                        {'address' in row
                          ? row.address
                          : 'capacity' in row
                            ? `${row.capacity} người · ${row.floor ?? 'Chưa có tầng'}`
                            : `${row.code ?? ''} · ${row.category} · ${row.condition}`}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={
                            'isActive' in row
                              ? row.isActive
                                ? 'Đang hoạt động'
                                : 'Ngừng hoạt động'
                              : 'capacity' in row
                                ? roomLabels[row.status]
                                : assetLabels[row.status]
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          {'condition' in row && (
                            <Button onClick={() => setInspectedAsset(row.id)}>
                              Thông tin & Lịch sử
                            </Button>
                          )}
                          {kind === 'locations' && (
                            <Button component={Link} to={`/locations/${row.id}/overview`}>
                              Quản lý cấu hình
                            </Button>
                          )}
                          {kind === 'rooms' && (
                            <Button onClick={() => setInspectedRoom(row.id)}>Chi tiết</Button>
                          )}
                          {canManage && <Button onClick={() => edit(row)}>Chỉnh sửa</Button>}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}
          <TablePagination
            component="div"
            count={query.data?.totalCount ?? 0}
            page={page}
            onPageChange={(_, value) => setPage(value)}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
            labelRowsPerPage="Số dòng"
          />
        </Paper>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!save.isPending) setOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              kind === 'locations' &&
              editing &&
              'isActive' in editing &&
              editing.isActive &&
              values.isActive === 'false'
            )
              setConfirmInactive(true);
            else submit();
          }}
        >
          <DialogTitle>{editing ? 'Chỉnh sửa cấu hình' : 'Thêm cấu hình'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                {kind === 'rooms'
                  ? 'Thông tin & cấu hình phòng'
                  : kind === 'assets'
                    ? 'Nhận diện & vị trí tài sản'
                    : 'Thông tin cơ sở'}
              </Typography>
              {kind === 'rooms' && roomTypes.error && (
                <ErrorState error={roomTypes.error} retry={() => void roomTypes.refetch()} />
              )}
              {kind === 'assets' && rooms.error && (
                <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />
              )}
              {kind === 'locations' ? (
                <>
                  {field('name', 'Tên cơ sở')}
                  {field('address', 'Địa chỉ cơ sở')}
                  <TextField
                    select
                    label="Hoạt động"
                    value={values.isActive ?? 'true'}
                    onChange={(event) =>
                      setValues((old) => ({ ...old, isActive: event.target.value }))
                    }
                  >
                    <MenuItem value="true">Đang hoạt động</MenuItem>
                    <MenuItem value="false">Ngừng hoạt động</MenuItem>
                  </TextField>
                </>
              ) : kind === 'rooms' ? (
                <>
                  {!editing && (
                    <LocationRoomDefaultsPicker
                      key={location}
                      location={location}
                      choose={(capacity) =>
                        setValues((old) => ({ ...old, capacity: String(capacity) }))
                      }
                    />
                  )}
                  {field('roomNumber', 'Số phòng')}
                  {field('floor', 'Tầng', false)}
                  {field('capacity', 'Sức chứa', true, 'number')}
                  <Alert severity="info">
                    Giữ chỗ và có khách thuê được xác nhận qua quy trình hợp đồng. Thay đổi sức chứa
                    hoặc ngừng khai thác sẽ được kiểm tra theo nghĩa vụ của phòng.
                  </Alert>
                </>
              ) : (
                <>
                  {field('name', 'Tên tài sản')}
                  {field('code', 'Mã tài sản', false)}
                  {field('category', 'Nhóm tài sản')}
                  {field('condition', 'Tình trạng')}
                  <TextField
                    select
                    label="Phòng đặt tài sản"
                    value={values.roomId ?? ''}
                    disabled={!!editing}
                    onChange={(event) =>
                      setValues((old) => ({ ...old, roomId: event.target.value }))
                    }
                  >
                    <MenuItem value="">Khu vực chung</MenuItem>
                    {rooms.data?.map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        {room.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {!values.roomId && field('commonArea', 'Tên khu vực chung')}
                </>
              )}
              {kind !== 'locations' && (
                <TextField
                  select
                  label="Trạng thái"
                  value={values.status ?? '0'}
                  onChange={(event) => setValues((old) => ({ ...old, status: event.target.value }))}
                >
                  {(kind === 'rooms' ? roomLabels : assetLabels).map((label, index) => (
                    <MenuItem
                      key={index}
                      value={String(index)}
                      disabled={kind === 'rooms' && (index === 1 || index === 2)}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {field('reason', 'Lý do / ghi chú', !!editing)}
              {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
              {editing && (
                <ConflictReload
                  error={save.error}
                  reload={async () => {
                    const latest = await api.request<Row>(
                      `/api/v1/${kind}/${encodeURIComponent(editing.id)}`,
                    );
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
              disabled={save.isPending || !canManage || (kind !== 'locations' && !location)}
            >
              Lưu cấu hình
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      {bulkOpen && <BulkRoomsDialog locationId={location} close={() => setBulkOpen(false)} />}
      {inspectedRoom && (
        <RoomInspector
          key={inspectedRoom}
          roomId={inspectedRoom}
          edit={
            canManage
              ? (room) => {
                  setInspectedRoom('');
                  edit(room);
                }
              : undefined
          }
          close={() => setInspectedRoom('')}
        />
      )}
      {query.data?.items
        .filter((row): row is PhysicalAsset => 'condition' in row && row.id === inspectedAsset)
        .map((asset) => (
          <AssetOperationsPanel
            key={asset.id}
            asset={asset}
            onClose={() => setInspectedAsset('')}
          />
        ))}
      <ConfirmDialog
        open={confirmInactive}
        title="Ngừng hoạt động cơ sở?"
        busy={save.isPending}
        onClose={() => setConfirmInactive(false)}
        onConfirm={submit}
      >
        Máy chủ sẽ kiểm tra các nghĩa vụ đang mở trước khi cho phép ngừng hoạt động. Lịch sử nghiệp
        vụ được giữ nguyên.
      </ConfirmDialog>
    </Stack>
  );
}

export function RoomApiDetails() {
  const { id = '' } = useParams();
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const room = useQuery({
    queryKey: ['property-setup', 'room', session?.userId, id],
    queryFn: ({ signal }) =>
      api.request<RoomConfiguration>(`/api/v1/rooms/${encodeURIComponent(id)}`, { signal }),
  });
  const history = useQuery({
    queryKey: ['property-setup', 'room-history', session?.userId, id],
    queryFn: ({ signal }) =>
      api.request<{
        items: { id: string; eventType: string; summary: string; occurredAt: string }[];
        completeness: string;
        limitations: string[];
      }>(`/api/v1/rooms/${encodeURIComponent(id)}/history?page=1&pageSize=20`, { signal }),
  });
  if (room.isPending) return <LoadingState />;
  if (room.error) return <ErrorState error={room.error} retry={() => void room.refetch()} />;
  return (
    <Stack spacing={2}>
      <PageHeader title={`Phòng ${room.data.roomNumber}`} />
      <Typography>
        {room.data.capacity} người · {roomLabels[room.data.status]}
      </Typography>
      <Button component={Link} to={`/locations/${room.data.locationId}/rooms`}>
        Quản lý phòng tại cơ sở
      </Button>
      {history.error ? (
        <ErrorState error={history.error} retry={() => void history.refetch()} />
      ) : (
        <>
          {history.data?.limitations.map((item) => (
            <Alert severity="info" key={item}>
              {item}
            </Alert>
          ))}
          {history.data?.items.map((item) => (
            <Paper key={item.id} sx={{ p: 2 }}>
              <Typography>
                {item.eventType} · {item.summary} ·{' '}
                {new Date(item.occurredAt).toLocaleString('vi-VN')}
              </Typography>
            </Paper>
          ))}
        </>
      )}
    </Stack>
  );
}
