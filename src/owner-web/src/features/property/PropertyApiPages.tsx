import { MoneyField } from '../../components/common/MoneyField';
import { useEffect, useRef, useState } from 'react';
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
  IconButton,
  Menu,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ChevronDown, MoreVertical } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { ASSET_UNITS } from '../../../../../packages/client-core/src/assetUnits';
import { invoiceError, type Page } from '../../../../../packages/client-core/src/invoices';
import { getFieldErrors } from '../../../../../packages/client-core/src/api';
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
import { locationSetupClient } from '../../../../../packages/client-core/src/locationSetup';
import { todayVietnam } from '../staff/staffContracts';
import { BulkRoomsDialog } from '../locations/components/BulkRoomsDialog';
import { RoomFloorCards } from '../locations/components/RoomFloorCards';
import { RoomInspector } from '../locations/components/RoomInspector';
import { useRoomOperations } from '../locations/components/useRoomOperations';
import { ConflictReload } from '../locations/components/ConflictReload';
import { RoomConfigurationEditor } from './RoomConfigurationEditor';

type Kind = 'locations' | 'rooms' | 'assets';
type Row = LocationConfiguration | RoomConfiguration | PhysicalAsset;
const titles: Record<Kind, string> = {
  locations: 'Quản lý cơ sở',
  rooms: 'Quản lý phòng',
  assets: 'Tài sản thực tế',
};
const roomLabels = ['Trống khai thác', 'Đang giữ chỗ', 'Đang có khách thuê', 'Ngừng khai thác'];
const assetLabels = ['Đang sử dụng', 'Cần sửa chữa', 'Đang sửa chữa', 'Đã ngừng sử dụng'];

export function PropertyApiPage({
  kind,
  createInitially = false,
  embedded = false,
  onAssetInventory,
}: {
  kind: Kind;
  createInitially?: boolean;
  embedded?: boolean;
  onAssetInventory?: (scope?: 'rooms' | 'common') => void;
}) {
  const api = usePropertySetupApi();
  const setup = locationSetupClient(api.request);
  const cache = useQueryClient();
  const { session } = useAuth();
  const portal = usePortal();
  const params = useParams();
  const { key: routeKey } = useLocation();
  const [urlParams, setUrlParams] = useSearchParams();
  const canManage = session?.roles.includes('Owner') ?? false;
  const [selectedLocation, setSelectedLocation] = useState(
    portal.locationId === 'all' ? '' : portal.locationId,
  );
  const location = params.locationId ?? selectedLocation;
  const [search, setSearch] = useState('');
  const [assetScope, setAssetScope] = useState('');
  const [expandedAssetGroup, setExpandedAssetGroup] = useState({ location: '', id: '' });
  const groupedAssets = kind === 'assets' && canManage;
  const activeAssetGroup =
    groupedAssets && expandedAssetGroup.location === location ? expandedAssetGroup.id : '';
  const assetQueryScope = groupedAssets ? activeAssetGroup : assetScope;
  const [localStatusFilter, setLocalStatusFilter] = useState('');
  const scopedRooms = kind === 'rooms' && !!params.locationId;
  const urlStatus = urlParams.get('roomStatus') ?? '';
  const statusFilter = scopedRooms
    ? /^[0-3]$/.test(urlStatus)
      ? urlStatus
      : ''
    : localStatusFilter;
  // Reset pagination before the next query runs, including URL-driven navigation.
  const pageScope = JSON.stringify([kind, location, statusFilter, search, assetQueryScope]);
  const [pagination, setPagination] = useState({ scope: pageScope, page: 0 });
  if (pagination.scope !== pageScope) {
    setPagination({ scope: pageScope, page: 0 });
  }
  const page = pagination.scope === pageScope ? pagination.page : 0;
  const setPage = (value: number) => setPagination({ scope: pageScope, page: value });
  function setStatusFilter(value: string) {
    if (!scopedRooms) {
      setLocalStatusFilter(value);
      return;
    }
    setUrlParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set('roomStatus', value);
        else next.delete('roomStatus');
        return next;
      },
      { replace: true },
    );
  }
  const [view, setView] = useState(kind === 'rooms' ? 'cards' : 'table');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [inspectedRoom, setInspectedRoom] = useState('');
  const [editingRoom, setEditingRoom] = useState<RoomConfiguration | null>(null);
  const [open, setOpen] = useState(createInitially);
  const [confirmInactive, setConfirmInactive] = useState(false);
  const [inspectedAsset, setInspectedAsset] = useState('');
  const [assetMenu, setAssetMenu] = useState<{
    anchor: HTMLElement;
    asset: PhysicalAsset;
  } | null>(null);
  const [retiringAsset, setRetiringAsset] = useState<PhysicalAsset | null>(null);
  const [retirementReason, setRetirementReason] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.keys(fieldErrors).length)
      editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);
  const [newCommonArea, setNewCommonArea] = useState('');
  const [notice, setNotice] = useState('');
  const createIntent = scopedRooms && urlParams.get('action') === 'create' ? routeKey : null;
  const [handledIntent, setHandledIntent] = useState<string | null>(null);
  // A new navigation intent initializes the same editor state as the manual action.
  // Adjust during render so the next committed editor is never a stale edit form.
  if (createIntent !== handledIntent) {
    setHandledIntent(createIntent);
    if (createIntent && canManage && location) {
      setEditing(null);
      setNotice('');
      setValues({});
      setOpen(true);
    }
  }
  const lock = useRef(false);
  const consumedIntent = useRef<string | null>(null);
  const configuredKey = useRef({ payload: '', key: '' });
  const defaults = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, location],
    queryFn: ({ signal }) => setup.localRoomDefaults(location, signal),
    enabled: kind === 'rooms' && canManage && !!location,
  });
  const provenance = useQuery({
    queryKey: ['property-setup', 'room-provenance', session?.userId, location],
    queryFn: ({ signal }) => setup.roomProvenance(location, signal),
    enabled: kind === 'rooms' && canManage && !!location,
  });
  const chosenDefaults = defaults.data?.find((item) => item.id === values.roomDefaultsId);
  const staleDefaults =
    !!values.roomDefaultsId &&
    (!chosenDefaults ||
      chosenDefaults.status === 'Archived' ||
      String(chosenDefaults.version) !== values.roomDefaultsVersion);
  const options = useQuery({
    queryKey: ['property-setup', 'locations-options', session?.userId],
    queryFn: ({ signal }) => api.locationOptions(signal),
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, location, groupedAssets],
    queryFn: async ({ signal }) => {
      const options = await api.roomOptions(location, signal);
      // The capture endpoint caps its room options at 100.
      if (!groupedAssets || options.length < 100) return options;

      const allRooms: { id: string; label: string }[] = [];
      const pageSize = 100;
      for (let page = 1; ; page += 1) {
        const result = await api.request<Page<RoomConfiguration>>(
          `/api/v1/rooms?${new URLSearchParams({ locationId: location, page: String(page), pageSize: String(pageSize) })}`,
          { signal },
        );
        allRooms.push(...result.items.map((room) => ({ id: room.id, label: room.roomNumber })));
        if (!result.items.length || page * pageSize >= result.totalCount) return allRooms;
      }
    },
    enabled: kind === 'assets' && !!location,
  });
  const assetGroups = [
    ...(assetScope === 'common'
      ? []
      : (rooms.data ?? []).filter(
          (room) => !assetScope || assetScope === 'rooms' || assetScope === room.id,
        )),
    ...(!assetScope || assetScope === 'common'
      ? [{ id: 'common', label: 'Tài sản khu vực chung' }]
      : []),
  ];
  const activeGroupIndex = assetGroups.findIndex((group) => group.id === activeAssetGroup);
  const commonAreas = useQuery({
    queryKey: ['property-setup', 'common-area-options', session?.userId, location],
    queryFn: ({ signal }) =>
      api.request<string[]>(
        `/api/v1/operational-tasks/targets/common-areas?${new URLSearchParams({ locationId: location })}`,
        { signal },
      ),
    enabled: kind === 'assets' && canManage && !!location,
  });
  const commonRequirements = useQuery({
    queryKey: ['property-setup', 'common-asset-requirements', session?.userId, location],
    queryFn: ({ signal }) => setup.commonAssetRequirements(location, signal),
    enabled: kind === 'assets' && canManage && !!location,
  });
  const commonAreaNames = [
    ...new Set([
      ...(commonAreas.data ?? []),
      ...(commonRequirements.data?.data?.items.map((item) => item.commonArea) ?? []),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'vi'));
  const query = useQuery({
    queryKey: [
      'property-setup',
      kind,
      session?.userId,
      location,
      page,
      search,
      statusFilter,
      assetQueryScope,
    ],
    queryFn: async ({ signal }): Promise<Page<Row>> =>
      kind === 'locations'
        ? api.locations(page + 1, search, signal)
        : api.request<Page<Row>>(
            `/api/v1/${kind}?${new URLSearchParams({ locationId: location, page: String(page + 1), pageSize: '20', ...(search ? { search } : {}), ...(statusFilter ? { [kind === 'rooms' ? 'roomStatus' : 'assetStatus']: statusFilter } : {}), ...(kind === 'assets' && assetQueryScope ? (assetQueryScope === 'common' ? { commonAreaOnly: 'true' } : assetQueryScope === 'rooms' ? { roomAssetsOnly: 'true' } : { roomId: assetQueryScope }) : {}) })}`,
            { signal },
          ),
    enabled: kind === 'locations' || (!!location && (!groupedAssets || activeGroupIndex >= 0)),
  });
  const lastAssetPage = query.data ? Math.max(0, Math.ceil(query.data.totalCount / 20) - 1) : page;
  if (groupedAssets && page > lastAssetPage) {
    setPagination({ scope: pageScope, page: lastAssetPage });
  }
  const tableOperations = useRoomOperations(
    kind === 'rooms' && view === 'table' ? location : '',
    kind === 'rooms' && view === 'table' ? (query.data?.items ?? []).map((row) => row.id) : [],
  );
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
      if (kind === 'rooms' && !editing && values.roomDefaultsId) {
        const type = defaults.data?.find((item) => item.id === values.roomDefaultsId);
        if (
          !type ||
          type.status === 'Archived' ||
          String(type.version) !== values.roomDefaultsVersion ||
          !values.rent?.trim() ||
          !Number.isFinite(Number(values.rent)) ||
          Number(values.rent) < 0 ||
          (values.effectiveFrom || todayVietnam()) < todayVietnam()
        )
          throw new Error(
            'Gợi ý đã thay đổi hoặc giá thuê chưa hợp lệ. Chọn lại gợi ý trước khi lưu.',
          );
        const input = {
          rooms: [
            {
              roomNumber: values.roomNumber?.trim() ?? '',
              floor: values.floor?.trim() || null,
              roomDefaultsId: type.id,
              expectedVersion: Number(values.roomDefaultsVersion),
              rent: values.rent,
            },
          ],
          effectiveFrom: values.effectiveFrom || todayVietnam(),
        };
        const payload = JSON.stringify(input);
        if (configuredKey.current.payload !== payload)
          configuredKey.current = { payload, key: crypto.randomUUID() };
        return (await setup.createConfiguredRooms(location, input, configuredKey.current.key))
          .rooms[0];
      }
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
      const commonArea = values.roomId
        ? null
        : values.commonArea === '__new__'
          ? newCommonArea.trim() || null
          : values.commonArea?.trim() || null;
      if (!values.roomId && !commonArea)
        throw new Error('Chọn khu vực chung hoặc nhập tên khu vực mới.');
      const quantity = Number(values.quantity);
      if (!editing && (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000))
        throw new Error('Số lượng phải là số nguyên từ 1 đến 10.000.');
      return api.saveAsset(editing?.id ?? null, {
        locationId: location,
        roomId: values.roomId || null,
        commonArea,
        code: values.code?.trim() || null,
        name: values.name?.trim() ?? '',
        category: values.category?.trim() || 'Khác',
        condition: values.condition?.trim() ?? '',
        status: Number(values.status ?? 0),
        version,
        reason,
        ...(!editing
          ? {
              initialUnit: values.unit || 'Cái',
              initialTrackingMode: 'BulkQuantity',
              initialQuantity: quantity,
            }
          : {}),
      });
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      setOpen(false);
      setConfirmInactive(false);
      setNotice('Máy chủ đã lưu cấu hình.');
    },
    onError: (error) => {
      setFieldErrors(getFieldErrors(error));
      setConfirmInactive(false);
    },
  });
  const retire = useMutation({
    mutationFn: async () => {
      if (!canManage || !retiringAsset || !retirementReason.trim())
        throw new Error('Nhập lý do ngừng sử dụng tài sản.');
      const { id, locationId, roomId, commonArea, code, name, category, condition, version } =
        retiringAsset;
      return api.saveAsset(id, {
        locationId,
        roomId,
        commonArea,
        code,
        name,
        category,
        condition,
        version,
        status: 3,
        reason: retirementReason.trim(),
      });
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      setRetiringAsset(null);
      setNotice('Đã ngừng sử dụng tài sản. Lịch sử được giữ nguyên.');
    },
  });
  const edit = (row: Row | null) => {
    if (row && 'capacity' in row) {
      setNotice('');
      setEditingRoom(row);
      return;
    }
    save.reset();
    setFieldErrors({});
    setEditing(row);
    setNotice('');
    setNewCommonArea('');
    const nextValues = row
      ? Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]),
        )
      : {};
    setValues(
      kind === 'assets'
        ? {
            ...nextValues,
            commonArea: nextValues.commonArea || (nextValues.roomId ? '' : '__new__'),
            ...(!row ? { quantity: '1' } : {}),
          }
        : nextValues,
    );
    setOpen(true);
  };
  // Overview's add-room shortcut opens the same editor as the list action.
  // Consume the intent once; neither the URL nor opening the form writes data.
  const resetSave = save.reset;
  useEffect(() => {
    if (!createIntent) {
      consumedIntent.current = null;
      return;
    }
    if (consumedIntent.current === createIntent) return;
    consumedIntent.current = createIntent;
    if (canManage && location) resetSave();
    setUrlParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('action');
        return next;
      },
      { replace: true },
    );
  }, [createIntent, canManage, location, resetSave, setUrlParams]);
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
      name={key}
      required={required}
      label={label}
      type={type}
      value={values[key] ?? ''}
      error={!!fieldErrors[key]}
      helperText={fieldErrors[key]}
      onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.value }))}
      slotProps={type === 'number' ? { htmlInput: { min: 1, max: 32767, step: 1 } } : undefined}
    />
  );
  const actions = canManage ? (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {kind === 'locations' && <ApiConfigurationCopy />}
      {kind === 'rooms' && (
        <>
          {location && (
            <Button component={Link} to={`/locations/${location}/room-types`} variant="outlined">
              Cấu hình mẫu phòng
            </Button>
          )}
          <Button variant="outlined" disabled={!location} onClick={() => setBulkOpen(true)}>
            Tạo phòng hàng loạt
          </Button>
        </>
      )}
      <Button
        variant="contained"
        disabled={kind !== 'locations' && !location}
        onClick={() => edit(null)}
      >
        Thêm {kind === 'locations' ? 'cơ sở' : kind === 'rooms' ? 'phòng' : 'tài sản'}
      </Button>
    </Stack>
  ) : undefined;
  const renderAssetGroup = ({ id, label }: { id: string; label: string }) => (
    <Button
      key={id}
      variant="outlined"
      aria-expanded={activeAssetGroup === id}
      endIcon={<ChevronDown size={16} />}
      onClick={() => setExpandedAssetGroup({ location, id: activeAssetGroup === id ? '' : id })}
      sx={{
        justifyContent: 'space-between',
        minHeight: 44,
        textAlign: 'left',
        borderColor: 'divider',
        bgcolor: activeAssetGroup === id ? 'action.selected' : 'background.paper',
        '&[aria-expanded="true"] .MuiButton-endIcon': { transform: 'rotate(180deg)' },
      }}
    >
      {label}
    </Button>
  );
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {embedded ? (
        actions && <Box sx={{ alignSelf: { sm: 'flex-end' } }}>{actions}</Box>
      ) : (
        <PageHeader
          group={null}
          headingLevel={params.locationId ? 'h2' : 'h1'}
          title={titles[kind]}
          actions={actions}
        />
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
      {kind !== 'locations' && !params.locationId && (
        <TextField
          select
          label="Cơ sở quản lý"
          value={selectedLocation}
          onChange={(event) => {
            setSelectedLocation(event.target.value);
            setAssetScope('');
            setExpandedAssetGroup({ location: '', id: '' });
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
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          useFlexGap
          sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}
        >
          <TextField
            fullWidth
            size="small"
            label="Tìm kiếm"
            sx={{ flex: { md: '1 1 220px' }, minWidth: 0 }}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          {kind !== 'locations' && (
            <TextField
              select
              size="small"
              label="Trạng thái"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: { xs: 0, md: 200 }, width: { xs: '100%', md: 'auto' } }}
            >
              <MenuItem value="">Tất cả trạng thái</MenuItem>
              {(kind === 'rooms' ? roomLabels : assetLabels).map((label, index) => (
                <MenuItem key={label} value={String(index)}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {kind === 'assets' && (
            <TextField
              select
              size="small"
              label="Vị trí tài sản"
              value={assetScope}
              onChange={(event) => {
                setAssetScope(event.target.value);
                setExpandedAssetGroup({ location: '', id: '' });
              }}
              sx={{ minWidth: { xs: 0, md: 180 }, width: { xs: '100%', md: 'auto' } }}
            >
              <MenuItem value="">Tất cả vị trí</MenuItem>
              <MenuItem value="rooms">Tất cả tài sản trong phòng</MenuItem>
              <MenuItem value="common">Tài sản chung cơ sở</MenuItem>
              {rooms.data?.map((room) => (
                <MenuItem key={room.id} value={room.id}>
                  {room.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, flexShrink: 0 }}>
            <Button
              disabled={
                (kind !== 'locations' && !location) ||
                (groupedAssets && activeGroupIndex < 0 ? rooms.isFetching : query.isFetching)
              }
              onClick={() =>
                void (groupedAssets && activeGroupIndex < 0 ? rooms.refetch() : query.refetch())
              }
            >
              Tải lại
            </Button>
            {(search || statusFilter || assetScope) && (
              <Button
                onClick={() => {
                  setSearch('');
                  setAssetScope('');
                  setExpandedAssetGroup({ location: '', id: '' });
                  setStatusFilter('');
                  setPage(0);
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
            {kind === 'rooms' && (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                onChange={(_, value: string | null) => {
                  if (value) setView(value);
                }}
                aria-label="Cách hiển thị phòng"
              >
                <ToggleButton value="cards">Theo tầng</ToggleButton>
                <ToggleButton value="table">Dạng bảng</ToggleButton>
              </ToggleButtonGroup>
            )}
          </Stack>
        </Stack>
      </Paper>
      {groupedAssets && location && (
        <>
          {assetScope !== 'common' && rooms.isPending && <LoadingState />}
          {assetScope !== 'common' && rooms.error && (
            <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />
          )}
          {assetScope === 'rooms' && rooms.isSuccess && !assetGroups.length && (
            <EmptyState message="Cơ sở chưa có phòng." />
          )}
          {assetGroups
            .slice(0, activeGroupIndex < 0 ? undefined : activeGroupIndex + 1)
            .map(renderAssetGroup)}
        </>
      )}
      {kind !== 'locations' && !location ? (
        <Alert severity="info">Chọn cơ sở để quản lý cấu hình.</Alert>
      ) : groupedAssets && activeGroupIndex < 0 ? null : query.isPending ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <Paper
          variant={kind === 'rooms' && view === 'cards' ? 'elevation' : 'outlined'}
          elevation={0}
          sx={{
            minWidth: 0,
            ...(kind === 'rooms' &&
              view === 'cards' && { bgcolor: 'transparent', boxShadow: 'none' }),
          }}
        >
          {!query.data?.items.length ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <EmptyState
                message={
                  search || statusFilter || (!groupedAssets && assetScope)
                    ? 'Không có dữ liệu phù hợp. Thử đổi từ khóa hoặc trạng thái.'
                    : groupedAssets
                      ? 'Vị trí này chưa có tài sản thực tế được ghi nhận sau kiểm kê.'
                      : kind === 'assets'
                        ? 'Chưa có tài sản thực tế. Chọn kiểm kê theo cấu hình để xác nhận tài sản.'
                        : kind === 'rooms'
                          ? 'Chưa có phòng. Thêm phòng đầu tiên để bắt đầu quản lý.'
                          : 'Chưa có bản ghi. Thêm bản ghi đầu tiên để bắt đầu quản lý.'
                }
              />
              {canManage && kind !== 'assets' && !search && !statusFilter && !assetScope && (
                <Stack
                  direction="row"
                  sx={{ mt: 2, gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}
                >
                  <Button variant="outlined" onClick={() => edit(null)}>
                    Thêm mới
                  </Button>
                </Stack>
              )}
              {canManage && kind === 'assets' && onAssetInventory && !search && !statusFilter && (
                <Button
                  sx={{ mt: 2 }}
                  variant="contained"
                  onClick={() => onAssetInventory(assetScope === 'common' ? 'common' : 'rooms')}
                >
                  {assetScope === 'common' ? 'Kiểm kê tài sản chung' : 'Kiểm kê tài sản theo phòng'}
                </Button>
              )}
            </Box>
          ) : kind === 'rooms' && view === 'cards' ? (
            <RoomFloorCards
              locationId={location}
              rooms={query.data.items.filter((row): row is RoomConfiguration => 'capacity' in row)}
              provenance={provenance.data}
              inspect={setInspectedRoom}
              edit={canManage ? edit : undefined}
            />
          ) : (
            <Stack sx={{ overflowX: 'auto', minWidth: 0 }}>
              {kind === 'rooms' && tableOperations.occupancy.error && (
                <Alert
                  severity="warning"
                  action={
                    <Button onClick={() => void tableOperations.occupancy.refetch()}>
                      Thử lại
                    </Button>
                  }
                >
                  Chưa tải được số người ở theo hợp đồng.
                </Alert>
              )}
              {kind === 'rooms' && tableOperations.incidents.error && (
                <Alert
                  severity="warning"
                  action={
                    <Button onClick={() => void tableOperations.incidents.refetch()}>
                      Thử lại
                    </Button>
                  }
                >
                  Chưa tải được báo cáo sự cố.
                </Alert>
              )}
              <Table
                size="small"
                aria-label={titles[kind]}
                sx={{ minWidth: kind === 'rooms' ? 820 : 650 }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>
                      {kind === 'rooms' ? 'Số phòng' : kind === 'assets' ? 'Tài sản' : 'Tên cơ sở'}
                    </TableCell>
                    {kind === 'rooms' ? (
                      <>
                        <TableCell>Gợi ý đã áp dụng</TableCell>
                        <TableCell>Tầng</TableCell>
                        <TableCell align="right">Sức chứa</TableCell>
                        <TableCell align="right">Người ở</TableCell>
                        <TableCell>Sự cố mở</TableCell>
                      </>
                    ) : kind === 'assets' ? (
                      <>
                        <TableCell>Vị trí thực tế</TableCell>
                        <TableCell align="right">Số lượng</TableCell>
                        <TableCell>Hiện trạng</TableCell>
                      </>
                    ) : (
                      <TableCell>Địa chỉ</TableCell>
                    )}
                    <TableCell>Trạng thái</TableCell>
                    <TableCell>Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {query.data.items.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
                        >
                          {'roomNumber' in row ? row.roomNumber : row.name}
                        </Typography>
                        {kind !== 'assets' && 'code' in row && (
                          <Typography variant="caption" color="text.secondary">
                            {row.code || 'Chưa có mã'}
                          </Typography>
                        )}
                      </TableCell>
                      {'address' in row ? (
                        <TableCell>{row.address}</TableCell>
                      ) : 'capacity' in row ? (
                        <>
                          <TableCell>
                            {(() => {
                              const source = provenance.data?.find(
                                (item) => item.data.roomId === row.id,
                              )?.data;
                              return source
                                ? source.name || 'Chưa phân loại'
                                : !canManage
                                  ? '—'
                                  : provenance.isPending
                                    ? 'Đang tải…'
                                    : provenance.error
                                      ? 'Chưa tải được'
                                      : 'Chưa ghi nhận';
                            })()}
                          </TableCell>
                          <TableCell>{row.floor ?? 'Chưa phân tầng'}</TableCell>
                          <TableCell align="right">{row.capacity} người</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {tableOperations.occupancy.data?.items.find(
                              (item) => item.roomId === row.id,
                            )?.occupants.length ?? '—'}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const reports =
                                tableOperations.incidents.data?.items.filter(
                                  (item) =>
                                    item.roomId === row.id &&
                                    ['Submitted', 'InProgress'].includes(item.status),
                                ) ?? [];
                              return reports.length ? (
                                <Typography
                                  variant="body2"
                                  color={
                                    reports.some((item) => item.severity === 'Emergency')
                                      ? 'error.main'
                                      : 'warning.dark'
                                  }
                                >
                                  {reports.length}
                                  {tableOperations.incidents.data?.complete ? '' : '+'}
                                </Typography>
                              ) : tableOperations.incidents.data?.complete ? (
                                '0'
                              ) : (
                                '—'
                              );
                            })()}
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>
                            {row.roomId
                              ? (rooms.data?.find((item) => item.id === row.roomId)?.label ??
                                'Phòng (chưa tải được tên)')
                              : row.commonArea || 'Chưa ghi nhận khu vực'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {row.quantity == null
                              ? '—'
                              : `${row.quantity}${row.unit ? ` ${row.unit}` : ''}`}
                          </TableCell>
                          <TableCell>{row.condition}</TableCell>
                        </>
                      )}
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={
                            'capacity' in row
                              ? row.status === 0
                                ? 'success'
                                : row.status === 1
                                  ? 'warning'
                                  : row.status === 2
                                    ? 'info'
                                    : 'default'
                              : 'condition' in row && row.status === 0
                                ? 'success'
                                : 'condition' in row && row.status === 1
                                  ? 'warning'
                                  : 'condition' in row && row.status === 2
                                    ? 'info'
                                    : 'default'
                          }
                          label={
                            'isActive' in row
                              ? row.isActive
                                ? 'Đang hoạt động'
                                : 'Ngừng hoạt động'
                              : 'capacity' in row
                                ? (roomLabels[row.status] ?? 'Chưa xác định')
                                : (assetLabels[row.status] ?? 'Chưa xác định')
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {'condition' in row ? (
                          <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <Button
                              size="small"
                              onClick={() => setInspectedAsset(row.id)}
                              sx={{ whiteSpace: 'nowrap' }}
                            >
                              Thông tin & Lịch sử
                            </Button>
                            {canManage && (
                              <>
                                <Tooltip title={`Thao tác tài sản ${row.name}`}>
                                  <IconButton
                                    size="small"
                                    aria-label={`Thao tác tài sản ${row.name}`}
                                    aria-haspopup="menu"
                                    aria-expanded={
                                      assetMenu?.asset.id === row.id ? 'true' : undefined
                                    }
                                    onClick={(event) =>
                                      setAssetMenu({ anchor: event.currentTarget, asset: row })
                                    }
                                  >
                                    <MoreVertical size={18} />
                                  </IconButton>
                                </Tooltip>
                                <Menu
                                  anchorEl={
                                    assetMenu?.asset.id === row.id ? assetMenu.anchor : null
                                  }
                                  open={assetMenu?.asset.id === row.id}
                                  onClose={() => setAssetMenu(null)}
                                >
                                  <MenuItem
                                    onClick={() => {
                                      setAssetMenu(null);
                                      edit(row);
                                    }}
                                  >
                                    Chỉnh sửa
                                  </MenuItem>
                                  {row.status !== 3 && (
                                    <MenuItem
                                      disabled={row.status === 2}
                                      onClick={() => {
                                        setAssetMenu(null);
                                        retire.reset();
                                        setRetirementReason('');
                                        setRetiringAsset(row);
                                      }}
                                    >
                                      Ngừng sử dụng
                                    </MenuItem>
                                  )}
                                </Menu>
                              </>
                            )}
                          </Stack>
                        ) : (
                          <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                          >
                            {kind === 'locations' && (
                              <Button
                                size="small"
                                component={Link}
                                to={`/locations/${row.id}/overview`}
                              >
                                Quản lý cấu hình
                              </Button>
                            )}
                            {kind === 'rooms' && (
                              <Button size="small" onClick={() => setInspectedRoom(row.id)}>
                                Chi tiết
                              </Button>
                            )}
                            {canManage && (
                              <Button size="small" onClick={() => edit(row)}>
                                Chỉnh sửa
                              </Button>
                            )}
                          </Stack>
                        )}
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
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count} bản ghi`}
            sx={{
              borderTop: '1px solid',
              borderColor: 'divider',
              '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', gap: 1 },
            }}
          />
        </Paper>
      )}
      {groupedAssets &&
        location &&
        activeGroupIndex >= 0 &&
        assetGroups.slice(activeGroupIndex + 1).map(renderAssetGroup)}
      <Dialog
        open={open}
        onClose={() => {
          if (!save.isPending) setOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <form
          ref={editorRef}
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
          <DialogTitle>
            {kind === 'assets'
              ? editing
                ? 'Chỉnh sửa tài sản'
                : 'Thêm tài sản thực tế'
              : editing
                ? 'Chỉnh sửa cấu hình'
                : 'Thêm cấu hình'}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                {kind === 'rooms'
                  ? 'Thông tin & cấu hình phòng'
                  : kind === 'assets'
                    ? 'Nhận diện & vị trí tài sản'
                    : 'Thông tin cơ sở'}
              </Typography>
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
                    <>
                      <TextField
                        select
                        label="Gợi ý tạo phòng"
                        value={values.roomDefaultsId ?? ''}
                        onChange={(e) => {
                          const type = defaults.data?.find((item) => item.id === e.target.value);
                          setValues((old) => ({
                            ...old,
                            roomDefaultsId: e.target.value,
                            roomDefaultsVersion: type ? String(type.version) : '',
                            ...(type
                              ? {
                                  capacity: String(type.data.defaults.capacity),
                                  rent: String(type.data.defaults.referenceRent ?? ''),
                                  status: '0',
                                }
                              : {}),
                          }));
                        }}
                      >
                        <MenuItem value="">Nhập trực tiếp</MenuItem>
                        {values.roomDefaultsId &&
                          (!chosenDefaults || chosenDefaults.status === 'Archived') && (
                            <MenuItem value={values.roomDefaultsId} disabled>
                              Gợi ý đã ngừng sử dụng hoặc chưa tải được
                            </MenuItem>
                          )}
                        {defaults.data
                          ?.filter((item) => item.status !== 'Archived')
                          .map((item) => (
                            <MenuItem key={item.id} value={item.id}>
                              {item.data.name} · v{item.version}
                            </MenuItem>
                          ))}
                      </TextField>
                      {defaults.error && (
                        <Alert
                          severity="warning"
                          action={<Button onClick={() => void defaults.refetch()}>Thử lại</Button>}
                        >
                          Chưa tải được gợi ý. Bạn có thể nhập trực tiếp hoặc tải lại.
                        </Alert>
                      )}
                      {staleDefaults && (
                        <Alert
                          severity="warning"
                          action={
                            chosenDefaults &&
                            chosenDefaults.status !== 'Archived' && (
                              <Button
                                onClick={() =>
                                  setValues((old) => ({
                                    ...old,
                                    roomDefaultsVersion: String(chosenDefaults.version),
                                    capacity: String(chosenDefaults.data.defaults.capacity),
                                    rent: String(chosenDefaults.data.defaults.referenceRent ?? ''),
                                  }))
                                }
                              >
                                Nạp phiên bản mới
                              </Button>
                            )
                          }
                        >
                          Gợi ý đã thay đổi hoặc ngừng sử dụng. Chọn gợi ý khác hoặc nạp phiên bản
                          mới để xác nhận lại giá.
                        </Alert>
                      )}
                      {values.roomDefaultsId && (
                        <>
                          <Alert severity="info">
                            Sức chứa và định mức lấy từ phiên bản {values.roomDefaultsVersion}.
                            Phòng đã tạo giữ bản cấu hình riêng. Xác nhận giá thuê và ngày hiệu lực
                            trước khi tạo.
                          </Alert>
                          <MoneyField
                            allowDecimal
                            required
                            label="Giá thuê xác nhận (VND)"
                            value={values.rent ?? ''}
                            onValueChange={(raw) => setValues((old) => ({ ...old, rent: raw }))}
                          />
                          <TextField
                            type="date"
                            label="Ngày hiệu lực"
                            value={values.effectiveFrom || todayVietnam()}
                            onChange={(e) =>
                              setValues((old) => ({ ...old, effectiveFrom: e.target.value }))
                            }
                            slotProps={{
                              inputLabel: { shrink: true },
                              htmlInput: { min: todayVietnam() },
                            }}
                          />
                        </>
                      )}
                    </>
                  )}
                  {field('roomNumber', 'Số phòng')}
                  {field('floor', 'Tầng', false)}
                  {!editing && values.roomDefaultsId ? (
                    <TextField
                      label="Sức chứa"
                      value={values.capacity ?? ''}
                      disabled
                      helperText="Lấy từ gợi ý đã chọn"
                    />
                  ) : (
                    field('capacity', 'Sức chứa', true, 'number')
                  )}
                  <Alert severity="info">
                    Giữ chỗ và có khách thuê được xác nhận qua quy trình hợp đồng. Thay đổi sức chứa
                    hoặc ngừng khai thác sẽ được kiểm tra theo nghĩa vụ của phòng.
                  </Alert>
                </>
              ) : (
                <>
                  {field('name', 'Tên tài sản')}
                  {field('code', 'Mã tài sản', false)}
                  <TextField
                    select
                    label="Nhóm tài sản"
                    value={values.category ?? ''}
                    onChange={(event) =>
                      setValues((old) => ({ ...old, category: event.target.value }))
                    }
                  >
                    {![
                      'Furniture',
                      'ElectricalEquipment',
                      'FireSafetyEquipment',
                      'SafetyEquipment',
                      'TechnicalEquipment',
                      'Other',
                    ].includes(values.category ?? '') && (
                      <MenuItem value={values.category ?? ''}>
                        {values.category || 'Chọn nhóm tài sản'}
                      </MenuItem>
                    )}
                    <MenuItem value="Furniture">Nội thất</MenuItem>
                    <MenuItem value="ElectricalEquipment">Thiết bị điện</MenuItem>
                    <MenuItem value="FireSafetyEquipment">Thiết bị PCCC</MenuItem>
                    <MenuItem value="SafetyEquipment">Thiết bị an toàn</MenuItem>
                    <MenuItem value="TechnicalEquipment">Thiết bị kỹ thuật</MenuItem>
                    <MenuItem value="Other">Khác</MenuItem>
                  </TextField>
                  {!editing && (
                    <>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                        <TextField
                          required
                          type="number"
                          label="Số lượng"
                          value={values.quantity ?? '1'}
                          onChange={(event) =>
                            setValues((old) => ({ ...old, quantity: event.target.value }))
                          }
                          slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                        />
                        <TextField
                          select
                          label="Đơn vị"
                          value={values.unit || 'Cái'}
                          onChange={(event) =>
                            setValues((old) => ({ ...old, unit: event.target.value }))
                          }
                        >
                          {ASSET_UNITS.map((unit) => (
                            <MenuItem key={unit} value={unit}>
                              {unit}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Box>
                    </>
                  )}
                  {field('condition', 'Tình trạng')}
                  <TextField
                    select
                    label="Vị trí tài sản"
                    value={values.roomId ?? ''}
                    disabled={!!editing}
                    onChange={(event) =>
                      setValues((old) => ({ ...old, roomId: event.target.value }))
                    }
                  >
                    <MenuItem value="">Tài sản chung cơ sở</MenuItem>
                    {rooms.data?.map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        {room.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {!values.roomId && (
                    <>
                      <TextField
                        select
                        label="Khu vực chung"
                        value={values.commonArea || '__new__'}
                        onChange={(event) => {
                          const selected = event.target.value;
                          setValues((old) => ({ ...old, commonArea: selected }));
                          if (selected === '__new__') setNewCommonArea('');
                        }}
                        helperText={
                          commonAreas.isPending
                            ? 'Đang tải khu vực đã ghi nhận tại cơ sở…'
                            : values.commonArea === '__new__'
                              ? 'Khu vực mới được ghi nhận khi lưu tài sản đầu tiên.'
                              : 'Chọn khu vực đã có hoặc tạo tên khu vực mới.'
                        }
                      >
                        <MenuItem value="__new__">+ Tạo khu vực mới</MenuItem>
                        {commonAreaNames.map((area) => (
                          <MenuItem key={area} value={area}>
                            {area}
                          </MenuItem>
                        ))}
                        {values.commonArea &&
                          values.commonArea !== '__new__' &&
                          !commonAreaNames.includes(values.commonArea) && (
                            <MenuItem value={values.commonArea}>
                              {values.commonArea} · hiện tại
                            </MenuItem>
                          )}
                      </TextField>
                      {values.commonArea === '__new__' && (
                        <TextField
                          required
                          label="Tên khu vực mới"
                          value={newCommonArea}
                          onChange={(event) => setNewCommonArea(event.target.value)}
                          slotProps={{ htmlInput: { maxLength: 120 } }}
                        />
                      )}
                      {commonAreas.isError && (
                        <Alert severity="warning">
                          Chưa tải được danh sách khu vực đã có. Bạn vẫn có thể tạo khu vực mới.
                        </Alert>
                      )}
                    </>
                  )}
                </>
              )}
              {kind !== 'locations' && !(kind === 'rooms' && !editing && values.roomDefaultsId) && (
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
                      disabled={
                        kind === 'rooms'
                          ? index === 1 || index === 2
                          : kind === 'assets' &&
                            (index === 2 || index === 3) &&
                            String(index) !== values.status
                      }
                    >
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {field('reason', 'Lý do / ghi chú', !!editing)}
              {save.error && (
                <Alert
                  severity="error"
                  action={
                    kind === 'rooms' && !editing && values.roomDefaultsId ? (
                      <Button
                        disabled={defaults.isFetching}
                        onClick={() => void defaults.refetch()}
                      >
                        Tải lại gợi ý
                      </Button>
                    ) : undefined
                  }
                >
                  {invoiceError(save.error)}
                </Alert>
              )}
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
              disabled={
                save.isPending ||
                !canManage ||
                (kind !== 'locations' && !location) ||
                (kind === 'rooms' && !editing && staleDefaults)
              }
            >
              Lưu cấu hình
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      {bulkOpen && <BulkRoomsDialog locationId={location} close={() => setBulkOpen(false)} />}
      {editingRoom && canManage && (
        <RoomConfigurationEditor
          key={editingRoom.id}
          locationId={editingRoom.locationId}
          roomId={editingRoom.id}
          close={() => setEditingRoom(null)}
          saved={() => {
            setEditingRoom(null);
            setNotice('Máy chủ đã lưu cấu hình.');
          }}
        />
      )}
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
      {retiringAsset && (
        <Dialog
          open
          fullWidth
          maxWidth="sm"
          onClose={retire.isPending ? undefined : () => setRetiringAsset(null)}
          aria-labelledby="retire-asset-title"
        >
          <DialogTitle id="retire-asset-title">Ngừng sử dụng {retiringAsset.name}?</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Typography variant="body2">
                Tài sản không còn được sử dụng cho công việc mới. Dữ liệu bàn giao, sự cố và lịch sử
                vẫn được giữ nguyên.
              </Typography>
              <TextField
                required
                label="Lý do ngừng sử dụng"
                value={retirementReason}
                disabled={retire.isPending}
                onChange={(event) => setRetirementReason(event.target.value)}
              />
              {retire.error && <Alert severity="error">{invoiceError(retire.error)}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={retire.isPending} onClick={() => setRetiringAsset(null)}>
              Hủy
            </Button>
            <Button
              variant="contained"
              color="error"
              disabled={retire.isPending || !retirementReason.trim()}
              onClick={() => retire.mutate()}
            >
              Ngừng sử dụng
            </Button>
          </DialogActions>
        </Dialog>
      )}
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
