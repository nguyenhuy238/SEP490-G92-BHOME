import { useEffect, useState } from 'react';
import { LocationWorkspaceOverview } from './LocationWorkspaceOverview';
import { LocationWorkspaceSettings } from './LocationWorkspaceSettings';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';

import { ErrorState, LoadingState } from '../../../components/common/PortalUI';
import {
  Building2,
  Shapes,
  DoorOpen,
  Package,
  Coins,
  Zap,
  ScrollText,
  History,
  Settings,
  Wallet,
} from 'lucide-react';
import { ApiConfigurationCopy } from '../../configuration/ApiConfigurationCopy';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { useSharedConfigurationApi } from '../../configuration/useSharedConfigurationApi';
import { UtilityWorkspace } from '../../property/UtilityWorkspace';
import { LocationAssetsWorkspace } from './LocationAssetsWorkspace';
import { LocationPricingWorkspace } from './LocationPricingWorkspace';
import { OperatingPoliciesPanel } from '../../property/OperatingPoliciesPanel';
import { usePortal } from '../../../app/PortalProvider';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';

const tabs = [
  ['overview', 'Tổng quan'],
  ['room-types', 'Gợi ý tạo phòng'],
  ['rooms', 'Phòng'],
  ['assets', 'Tài sản'],
  ['pricing', 'Giá & Phí'],
  ['utilities', 'Điện & Nước'],
  ['rules', 'Nội quy'],
  ['history', 'Lịch sử phòng'],
  ['settings', 'Thiết lập'],
  ['investment', 'Vốn & Chi phí'],
];
const tabIcons: Record<string, typeof Building2> = {
  overview: Building2,
  'room-types': Shapes,
  rooms: DoorOpen,
  assets: Package,
  pricing: Coins,
  utilities: Zap,
  rules: ScrollText,
  history: History,
  settings: Settings,
  investment: Wallet,
};

export function LocationApiWorkspace() {
  const { locationId = '' } = useParams();
  const route = useLocation();
  const api = usePropertySetupApi();
  const sharedApi = useSharedConfigurationApi();
  const portal = usePortal();
  useEffect(() => {
    if (portal.locationId !== locationId) portal.setLocationId(locationId);
  }, [locationId, portal]);
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const active = route.pathname.split('/')[3] || 'overview';
  const location = useQuery({
    queryKey: ['property-setup', 'location', session?.userId, locationId],
    queryFn: ({ signal }) => api.location(locationId, signal),
  });
  const metadata = useQuery({
    queryKey: ['property-setup', 'setup-metadata', session?.userId, locationId],
    queryFn: ({ signal }) => locationSetupClient(api.request).metadata(locationId, signal),
    enabled: owner && !!locationId,
  });
  const summary = useQuery({
    queryKey: ['property-setup', 'location-summary', session?.userId, locationId],
    queryFn: async ({ signal }) => {
      const [roomDefaults, rooms, assets, policies, rules, templates] = await Promise.allSettled([
        owner ? sharedApi.roomDefaults(locationId, signal) : Promise.resolve(undefined),
        api.rooms(locationId, 1, '', signal),
        api.assets(locationId, 1, '', signal),
        api.request<{ totalCount: number }>(
          `/api/v1/billing-policies?locationId=${encodeURIComponent(locationId)}&page=1&pageSize=1`,
          { signal },
        ),
        owner ? api.policies(locationId, signal) : Promise.resolve(undefined),
        owner ? api.templates(locationId, signal) : Promise.resolve(undefined),
      ]);
      return {
        roomDefaults: roomDefaults.status === 'fulfilled' ? roomDefaults.value?.length : undefined,
        rooms: rooms.status === 'fulfilled' ? rooms.value.totalCount : undefined,
        assets: assets.status === 'fulfilled' ? assets.value.totalCount : undefined,
        pricesAndFees: policies.status === 'fulfilled' ? policies.value.totalCount : undefined,
        rules: rules.status === 'fulfilled' ? rules.value?.length : undefined,
        assetTemplates: templates.status === 'fulfilled' ? templates.value?.length : undefined,
        incomplete: [roomDefaults, rooms, assets, policies, rules, templates].some(
          (item) => item.status === 'rejected',
        ),
      };
    },
  });
  if (location.isPending) return <LoadingState />;
  if (location.error)
    return <ErrorState error={location.error} retry={() => void location.refetch()} />;
  return (
    <Stack
      spacing={2.5}
      sx={{
        '& .MuiPaper-root': { borderRadius: '12px', boxShadow: 'none' },
        '& .MuiButton-root': { textTransform: 'none', borderRadius: '8px', fontSize: 14 },
        '& .MuiTab-root': { fontSize: 14 },
        '& .MuiTableHead-root': { bgcolor: '#f3f6fb' },
        '& .MuiTableRow-root:hover': { bgcolor: '#f8faff' },
      }}
    >
      <Paper variant="outlined" sx={{ p: 2.5, borderColor: '#dce4ef' }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '12px',
                bgcolor: '#edf3ff',
                color: 'primary.main',
              }}
            >
              <Building2 size={28} />
            </Box>
            <Box>
              <Typography component="h1" sx={{ fontSize: 23, fontWeight: 800, lineHeight: 1.3 }}>
                {location.data.name}
              </Typography>
              <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>
                {location.data.address}
              </Typography>
              {owner && metadata.data?.data && (
                <Typography variant="body2" color="text.secondary">
                  Mã {metadata.data.data.code} · {metadata.data.data.floors} tầng
                  {metadata.data.data.contactPhone ? ' · ' + metadata.data.data.contactPhone : ''}
                </Typography>
              )}
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            {owner && <ApiConfigurationCopy sourceLocationId={locationId} />}
            <Button component={Link} to="/locations" variant="outlined">
              Danh sách cơ sở
            </Button>
          </Stack>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 1.5, ml: { md: '68px' }, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Chip
            size="small"
            color={location.data.isActive ? 'success' : 'default'}
            label={location.data.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
          />
          {owner && metadata.data?.data && <Chip size="small" variant="outlined" label={metadata.data.data.setupStatus === 'Completed' ? 'Đã lưu thiết lập ban đầu' : 'Đã ghi nhận thông tin'} />}
          <Chip
            size="small"
            variant="outlined"
            label={
              summary.data?.rooms != null ? `${summary.data.rooms} phòng` : 'Chưa có số liệu phòng'
            }
          />
          {owner && <Button component={Link} to={`/locations/${locationId}/settings`} size="small">
            Chỉnh sửa cơ sở
          </Button>}
        </Stack>
      </Paper>
      {owner && metadata.error && <Alert severity="warning" action={<Button onClick={() => void metadata.refetch()}>Thử lại</Button>}>Chưa tải được thông tin thiết lập cơ sở.</Alert>}
      {!location.data.isActive && <Alert severity="info">Cơ sở đang ngừng hoạt động. Việc mở lại cơ sở không tự động chuyển các phòng ngừng khai thác thành phòng trống.</Alert>}
      <Paper variant="outlined" sx={{ p: 0.75, position: 'sticky', top: 75, zIndex: 5 }}>
        <Tabs
          value={tabs.some(([key]) => key === active) ? active : 'overview'}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              minHeight: 44,
              py: 1,
              px: 1.5,
              borderRadius: '6px',
              textTransform: 'none',
              fontWeight: 650,
            },
            '& .Mui-selected': { bgcolor: '#eaf1ff' },
          }}
        >
          {tabs.map(([key, label]) => (
            <Tab
              key={key}
              value={key}
              label={label}
              icon={(() => {
                const Icon = tabIcons[key];
                return <Icon size={16} />;
              })()}
              iconPosition="start"
              component={Link}
              to={`/locations/${locationId}/${key}`}
            />
          ))}
        </Tabs>
      </Paper>
      {active === 'overview' ? (
        <>
          {summary.error && (
            <ErrorState error={summary.error} retry={() => void summary.refetch()} />
          )}
          {summary.data?.incomplete && (
            <Alert
              severity="warning"
              action={<Button onClick={() => void summary.refetch()}>Tải lại</Button>}
            >
              Một số số liệu chưa tải được. Các mục đã tải thành công vẫn có thể xem và quản lý.
            </Alert>
          )}
          <LocationWorkspaceOverview id={locationId} summary={summary.data} metadata={metadata.data?.data} />
        </>
      ) : active === 'settings' ? (
        <LocationWorkspaceSettings key={locationId} location={location.data} />
      ) : (
        <>
          {active === 'assets' ? (
            <LocationAssetsWorkspace key={locationId} locationId={locationId} />
          ) : ['room-types', 'rooms', 'investment'].includes(active) ? (
            <Outlet />
          ) : active === 'pricing' ? (
            <LocationPricingWorkspace key={locationId} locationId={locationId} />
          ) : active === 'utilities' ? (
            <UtilityWorkspace key={locationId} locationId={locationId} />
          ) : active === 'rules' ? (
            <OperatingPoliciesPanel key={locationId} locationId={locationId} />
          ) : active === 'history' ? (
            <LocationRoomHistory key={locationId} locationId={locationId} />
          ) : (
            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography>Địa chỉ: {location.data.address}</Typography>
                <Typography>
                  {location.data.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                </Typography>
                <Typography>
                  Cấu hình phòng, tài sản, giá và nội quy được quản lý riêng cho cơ sở này. Thay đổi
                  trạng thái do máy chủ kiểm tra theo nghĩa vụ đang mở.
                </Typography>
                {summary.data && (
                  <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
                    <Chip label={`${summary.data.roomDefaults ?? '—'} gợi ý tạo phòng`} />
                    <Chip label={`${summary.data.rooms} phòng`} />
                    <Chip label={`${summary.data.assets} tài sản thực tế`} />
                    <Chip label={`${summary.data.assetTemplates} bộ mẫu tài sản`} />
                    <Chip label={`${summary.data.pricesAndFees} chính sách giá & phí`} />
                    <Chip label={`${summary.data.rules} nội quy`} />
                  </Stack>
                )}
                <Button component={Link} to="/locations">
                  Chỉnh sửa thông tin cơ sở
                </Button>
              </Stack>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function LocationRoomHistory({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [roomId, setRoomId] = useState('');
  const [page, setPage] = useState(1);
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomOptions(locationId, signal),
  });
  const history = useQuery({
    queryKey: ['property-setup', 'history', session?.userId, roomId, page],
    queryFn: ({ signal }) =>
      api.request<{
        items: { id: string; summary: string; occurredAt: string }[];
        totalCount: number;
        limitations: string[];
      }>(`/api/v1/rooms/${encodeURIComponent(roomId)}/history?page=${page}&pageSize=20`, {
        signal,
      }),
    enabled: !!roomId,
  });
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6">Lịch sử vận hành phòng</Typography>
        <Typography variant="body2" color="text.secondary">
          Chọn phòng để tra cứu các thay đổi đã được ghi nhận theo thời gian.
        </Typography>
      </Paper>
      <TextField
        select
        label="Phòng xem lịch sử"
        value={roomId}
        onChange={(event) => {
          setRoomId(event.target.value);
          setPage(1);
        }}
      >
        <MenuItem value="">Chọn phòng</MenuItem>
        {rooms.data?.map((room) => (
          <MenuItem key={room.id} value={room.id}>
            {room.label}
          </MenuItem>
        ))}
      </TextField>
      {rooms.error && <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />}
      {!roomId && <Alert severity="info">Chọn một phòng trong danh sách để xem lịch sử.</Alert>}
      {roomId &&
        (history.isPending ? (
          <LoadingState />
        ) : history.error ? (
          <ErrorState error={history.error} retry={() => void history.refetch()} />
        ) : (
          <>
            {history.data.limitations.map((item) => (
              <Alert key={item} severity="info">
                {item}
              </Alert>
            ))}
            {!history.data.items.length && <Typography>Chưa có lịch sử phù hợp.</Typography>}
            {history.data.items.map((item) => (
              <Paper key={item.id} sx={{ p: 2 }}>
                <Typography>
                  {formatInstant(item.occurredAt)} · {item.summary}
                </Typography>
              </Paper>
            ))}
            <Stack direction="row">
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <Button
                disabled={page * 20 >= history.data.totalCount}
                onClick={() => setPage(page + 1)}
              >
                Trang sau
              </Button>
            </Stack>
          </>
        ))}
    </Stack>
  );
}
