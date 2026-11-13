import { useEffect, useState } from 'react';
import { LocationWorkspaceOverview } from './LocationWorkspaceOverview';
import { LocationWorkspaceSettings } from './LocationWorkspaceSettings';
import {
  Alert,
  MenuItem,
  Box,
  Button,
  Chip,
  Autocomplete,
  Divider,
  TablePagination,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';

import { ErrorState, LoadingState } from '../../../components/common/PortalUI';
import {
  Building2,
  DoorOpen,
  Package,
  Coins,
  ScrollText,
  History,
  Settings,
  Wallet,
} from 'lucide-react';
import { ApiConfigurationCopy } from '../../configuration/ApiConfigurationCopy';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { LocationAssetsWorkspace } from './LocationAssetsWorkspace';
import { LocationPricingWorkspace } from './LocationPricingWorkspace';
import { OperatingPoliciesPanel } from '../../property/OperatingPoliciesPanel';
import { usePortal } from '../../../app/PortalProvider';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';
import { LocationSection, LocationEmpty } from '../components/LocationSection';
import type { OccupancySummary } from '../../property-api/propertyApi';
import { financeClient, financeError } from '../../../../../../packages/client-core/src/finance';
import { todayVietnam } from '../../staff/staffContracts';
import { locationRoomCounts } from './locationOverviewData';

const tabs = [
  ['overview', 'Tổng quan'],
  ['rooms', 'Phòng'],
  ['assets', 'Tài sản'],
  ['pricing', 'Giá & Phí'],
  ['rules', 'Nội quy'],
  ['history', 'Lịch sử phòng'],
  ['settings', 'Thiết lập'],
  ['investment', 'Vốn & Chi phí'],
];
const tabIcons: Record<string, typeof Building2> = {
  overview: Building2,
  rooms: DoorOpen,
  assets: Package,
  pricing: Coins,
  rules: ScrollText,
  history: History,
  settings: Settings,
  investment: Wallet,
};

export function LocationApiWorkspace() {
  const { locationId = '' } = useParams();
  const route = useLocation();
  const api = usePropertySetupApi();
  const portal = usePortal();
  useEffect(() => {
    if (portal.locationId !== locationId) portal.setLocationId(locationId);
  }, [locationId, portal]);
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const active = route.pathname.split('/')[3] || 'overview';
  const activeTab = active === 'room-types' ? 'rooms' : active === 'utilities' ? 'pricing' : active;
  const location = useQuery({
    queryKey: ['property-setup', 'location', session?.userId, locationId],
    queryFn: ({ signal }) => api.location(locationId, signal),
  });
  const metadata = useQuery({
    queryKey: ['property-setup', 'setup-metadata', session?.userId, locationId],
    queryFn: ({ signal }) => locationSetupClient(api.request).metadata(locationId, signal),
    enabled: owner && !!locationId,
  });
  const occupancy = useQuery({
    queryKey: ['property-setup', 'location-occupancy', session?.userId, locationId],
    queryFn: ({ signal }) =>
      api.request<OccupancySummary>(
        `/api/v1/locations/${encodeURIComponent(locationId)}/occupancy-summary`,
        { signal },
      ),
    enabled: !!locationId,
  });
  const roomCounts = locationRoomCounts(occupancy.data);
  const summary = useQuery({
    queryKey: ['property-setup', 'location-summary', session?.userId, locationId],
    queryFn: async ({ signal }) => {
      const [assets, policies, rules, templates, incidents] = await Promise.allSettled([
        api.assets(locationId, 1, '', signal),
        api.request<{ totalCount: number }>(
          `/api/v1/billing-policies?locationId=${encodeURIComponent(locationId)}&page=1&pageSize=1`,
          { signal },
        ),
        owner ? api.policies(locationId, signal) : Promise.resolve(undefined),
        owner ? api.templates(locationId, signal) : Promise.resolve(undefined),
        Promise.all(
          [0, 1].map((status) =>
            api.request<{ totalCount: number }>(
              `/api/v1/incidents?locationId=${encodeURIComponent(locationId)}&status=${status}&page=1&pageSize=1`,
              { signal },
            ),
          ),
        ).then((rows) => {
          if (!rows.every((row) => Number.isSafeInteger(row.totalCount) && row.totalCount >= 0))
            throw new Error('Không đọc được số liệu sự cố');
          return rows.reduce((total, row) => total + row.totalCount, 0);
        }),
      ]);
      return {
        assets: assets.status === 'fulfilled' ? assets.value.totalCount : undefined,
        pricesAndFees: policies.status === 'fulfilled' ? policies.value.totalCount : undefined,
        rules: rules.status === 'fulfilled' ? rules.value?.length : undefined,
        assetTemplates: templates.status === 'fulfilled' ? templates.value?.length : undefined,
        openIncidents: incidents.status === 'fulfilled' ? incidents.value : undefined,
        incomplete: [assets, policies, rules, templates, incidents].some(
          (item) => item.status === 'rejected',
        ),
      };
    },
    enabled: active === 'overview' && !!locationId,
  });
  const today = todayVietnam();
  const financeFilter = { from: `${today.slice(0, 7)}-01`, to: today, locationId };
  const finance = useQuery({
    queryKey: ['financial-report', session?.userId, financeFilter],
    queryFn: ({ signal }) => financeClient(api.request).report(financeFilter, signal),
    enabled: owner && active === 'overview' && !!locationId,
  });
  if (location.isPending) return <LoadingState />;
  if (location.error)
    return <ErrorState error={location.error} retry={() => void location.refetch()} />;
  return (
    <Stack
      spacing={2.5}
      sx={{
        minWidth: 0,
        '& .MuiPaper-outlined': { borderRadius: '12px', boxShadow: 'none' },
        '& .MuiButton-root': {
          textTransform: 'none',
          borderRadius: '8px',
          fontSize: 14,
          minHeight: { xs: 44, sm: 40 },
        },
        '& .MuiTab-root': { fontSize: 14, minHeight: 44 },
        '& .MuiTableCell-head': { bgcolor: 'background.default' },
        '& .MuiTableRow-root.MuiTableRow-hover:hover': { bgcolor: 'action.hover' },
        '& .MuiTablePagination-toolbar': { flexWrap: 'wrap' },
        '& .MuiButtonBase-root:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '12px',
                bgcolor: 'primary.light',
                color: 'primary.main',
              }}
            >
              <Building2 size={28} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" variant="h1" sx={{ overflowWrap: 'anywhere' }}>
                {location.data.name}
              </Typography>
              <Typography
                sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5, overflowWrap: 'anywhere' }}
              >
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
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
            {owner && <ApiConfigurationCopy sourceLocationId={locationId} />}
            <Button component={Link} to="/locations" variant="outlined">
              Danh sách cơ sở
            </Button>
          </Stack>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ mt: 1.5, ml: { md: '64px' }, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Chip
            size="small"
            label={location.data.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
            sx={
              location.data.isActive
                ? { bgcolor: '#eaf7ef', color: '#176b43', fontWeight: 700 }
                : undefined
            }
          />
          {owner && metadata.data?.data && (
            <Chip
              size="small"
              variant="outlined"
              label={
                metadata.data.data.setupStatus === 'Completed'
                  ? 'Đã lưu thiết lập ban đầu'
                  : 'Đã ghi nhận thông tin'
              }
            />
          )}
          <Chip
            size="small"
            variant="outlined"
            label={
              roomCounts.rooms != null
                ? `${roomCounts.rooms} phòng`
                : occupancy.isPending
                  ? 'Đang tải số liệu phòng'
                  : 'Chưa có số liệu phòng'
            }
          />
          {owner && (
            <Button component={Link} to={`/locations/${locationId}/settings`} size="small">
              Chỉnh sửa cơ sở
            </Button>
          )}
        </Stack>
      </Paper>
      {owner && metadata.error && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void metadata.refetch()}>Thử lại</Button>}
        >
          Chưa tải được thông tin thiết lập cơ sở.
        </Alert>
      )}
      {!location.data.isActive && (
        <Alert severity="info">
          Cơ sở đang ngừng hoạt động. Việc mở lại cơ sở không tự động chuyển các phòng ngừng khai
          thác thành phòng trống.
        </Alert>
      )}
      <Paper
        component="nav"
        aria-label="Các phân hệ cơ sở"
        variant="outlined"
        sx={{ minWidth: 0, p: 0.5, position: 'sticky', top: { xs: 64, md: 75 }, zIndex: 5 }}
      >
        <Tabs
          value={tabs.some(([key]) => key === activeTab) ? activeTab : 'overview'}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Quản lý cơ sở"
          sx={{
            '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' },
            '& .MuiTab-root': {
              minHeight: 44,
              py: 1,
              px: 1.5,
              borderRadius: '6px 6px 0 0',
              textTransform: 'none',
              fontWeight: 600,
              color: 'text.secondary',
            },
            '& .Mui-selected': { bgcolor: 'primary.light', color: 'primary.main' },
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
          {occupancy.isError && (
            <Alert
              severity="warning"
              action={<Button onClick={() => void occupancy.refetch()}>Thử lại</Button>}
            >
              Chưa tải được trạng thái khai thác phòng.
            </Alert>
          )}
          {summary.data?.incomplete && (
            <Alert
              severity="warning"
              action={<Button onClick={() => void summary.refetch()}>Tải lại</Button>}
            >
              Một số số liệu chưa tải được. Các mục đã tải thành công vẫn có thể xem và quản lý.
            </Alert>
          )}
          <LocationWorkspaceOverview
            id={locationId}
            summary={{ ...summary.data, ...roomCounts }}
            active={location.data.isActive}
            loading={summary.isPending || occupancy.isPending}
            owner={owner}
            metadata={metadata.data?.data}
            finance={{
              data: finance.data,
              loading: finance.isPending,
              error: finance.isError ? financeError(finance.error) : undefined,
              retry: () => void finance.refetch(),
              from: financeFilter.from,
              to: financeFilter.to,
            }}
          />
        </>
      ) : active === 'settings' ? (
        <LocationWorkspaceSettings key={locationId} location={location.data} />
      ) : (
        <>
          {active === 'assets' ? (
            <LocationAssetsWorkspace key={locationId} locationId={locationId} />
          ) : ['room-types', 'rooms', 'investment'].includes(active) ? (
            <Outlet />
          ) : activeTab === 'pricing' ? (
            <LocationPricingWorkspace
              key={`${locationId}:${active}`}
              locationId={locationId}
              initialTab={active === 'utilities' ? 3 : 0}
            />
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
                    <Chip
                      label={
                        roomCounts.rooms == null
                          ? 'Chưa có số liệu phòng'
                          : `${roomCounts.rooms} phòng`
                      }
                    />
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

const historyEventLabels: Record<string, string> = {
  RoomStatusOrConfiguration: 'Cấu hình / trạng thái phòng',
  HoldingActivated: 'Kích hoạt hợp đồng giữ chỗ',
  HoldingExpired: 'Hợp đồng giữ chỗ hết hạn',
  HoldingCancelled: 'Hủy hợp đồng giữ chỗ',
  HoldingConverted: 'Chuyển đổi hợp đồng giữ chỗ',
  ContractActivated: 'Kích hoạt hợp đồng thuê',
  ContractEnded: 'Kết thúc kỳ thuê',
  OccupancyStarted: 'Bắt đầu thời gian cư trú',
  OccupancyEnded: 'Kết thúc thời gian cư trú',
};
const historySummaryLabels: Record<string, string> = {
  Created: 'Tạo phòng',
  Updated: 'Cập nhật phòng',
  'A Holding Contract was activated.': 'Hợp đồng giữ chỗ được kích hoạt.',
  'A Main Tenancy Contract was activated.': 'Hợp đồng thuê chính thức được kích hoạt.',
  'A Holding Contract became Expired.': 'Hợp đồng giữ chỗ đã hết hạn.',
  'A Holding Contract became Cancelled.': 'Hợp đồng giữ chỗ đã bị hủy.',
  'A Holding Contract became Converted.': 'Hợp đồng giữ chỗ đã được chuyển đổi.',
  'A Main Tenancy Contract occupancy period ended.':
    'Thời gian cư trú của hợp đồng thuê đã kết thúc.',
  'A resident occupancy interval started.': 'Một khoảng thời gian cư trú bắt đầu.',
  'A resident occupancy interval ended.': 'Một khoảng thời gian cư trú kết thúc.',
};

export function LocationRoomHistory({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const roomId = params.get('roomId') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const eventType = params.get('eventType') ?? '';
  const validDates =
    (!from || /^\d{4}-\d{2}-\d{2}$/.test(from)) &&
    (!to || /^\d{4}-\d{2}-\d{2}$/.test(to)) &&
    (!from || !to || from <= to);
  const [page, setPage] = useState(1);
  const changeFilter = (name: string, value: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
    setPage(1);
  };
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomOptions(locationId, signal),
  });
  const history = useQuery({
    queryKey: [
      'property-setup',
      'history',
      session?.userId,
      locationId,
      roomId,
      page,
      from,
      to,
      eventType,
    ],
    queryFn: ({ signal }) =>
      api.request<{
        items: {
          id: string;
          summary: string;
          occurredAt: string;
          eventType?: string;
          source?: string;
        }[];
        totalCount: number;
        limitations: string[];
      }>(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/history?${new URLSearchParams({ page: String(page), pageSize: '20', ...(from ? { from } : {}), ...(to ? { to } : {}), ...(eventType ? { eventType } : {}) })}`,
        {
          signal,
        },
      ),
    enabled: validDates && !!roomId && !!rooms.data?.some((room) => room.id === roomId),
  });
  return (
    <LocationSection
      title="Lịch sử vận hành phòng"
      description="Tra cứu các sự kiện đã được hệ thống ghi nhận theo từng phòng."
    >
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Autocomplete
            options={rooms.data ?? []}
            value={rooms.data?.find((room) => room.id === roomId) ?? null}
            getOptionLabel={(room) => room.label}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={rooms.isPending}
            onChange={(_, value) => {
              changeFilter('roomId', value?.id ?? '');
            }}
            renderInput={(props) => (
              <TextField {...props} label="Phòng xem lịch sử" placeholder="Tìm theo số phòng" />
            )}
            sx={{ maxWidth: 420 }}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            <TextField
              type="date"
              label="Từ ngày"
              value={from}
              onChange={(e) => changeFilter('from', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label="Đến ngày"
              value={to}
              onChange={(e) => changeFilter('to', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={!validDates}
              helperText={!validDates ? 'Khoảng ngày không hợp lệ' : undefined}
            />
            <TextField
              select
              label="Loại sự kiện"
              value={eventType}
              onChange={(e) => changeFilter('eventType', e.target.value)}
            >
              <MenuItem value="">Tất cả sự kiện</MenuItem>
              {Object.entries(historyEventLabels).map(([key, label]) => (
                <MenuItem key={key} value={key}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          {(from || to || eventType) && (
            <Button
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setParams(roomId ? { roomId } : {}, { replace: true });
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          )}
        </Stack>
      </Paper>
      {rooms.error && <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />}
      {!roomId && (
        <LocationEmpty
          title="Chọn phòng để tra cứu"
          description="Tìm và chọn một phòng tại cơ sở để xem các sự kiện đã ghi nhận."
        />
      )}
      {roomId && rooms.data && !rooms.data.some((room) => room.id === roomId) && (
        <Alert severity="warning">
          Phòng không có trong danh sách của cơ sở này. Hãy chọn lại.
        </Alert>
      )}
      {validDates &&
        roomId &&
        rooms.data?.some((room) => room.id === roomId) &&
        (history.isPending ? (
          <LoadingState />
        ) : history.error ? (
          <ErrorState error={history.error} retry={() => void history.refetch()} />
        ) : (
          <>
            {history.data.limitations.map((item) => (
              <Alert key={item} severity="info">
                {item ===
                'Property audit predating the current append-only capture may be incomplete.'
                  ? 'Lịch sử trước thời điểm bắt đầu ghi nhật ký thay đổi có thể chưa đầy đủ.'
                  : item}
              </Alert>
            ))}
            {!history.data.items.length ? (
              <LocationEmpty
                title="Chưa có lịch sử phù hợp"
                description="Các sự kiện đã ghi nhận sẽ xuất hiện ở đây."
              />
            ) : (
              <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
                <Typography component="h3" variant="h2" sx={{ mb: 2 }}>
                  Sự kiện đã ghi nhận
                </Typography>
                <Stack
                  component="ol"
                  divider={<Divider />}
                  spacing={2}
                  sx={{ listStyle: 'none', p: 0, m: 0 }}
                >
                  {history.data.items.map((item) => (
                    <Stack
                      component="li"
                      key={item.id}
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'flex-start' }}
                    >
                      <Box sx={{ color: 'primary.main', mt: 0.5 }}>
                        <History size={19} aria-hidden="true" />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="time"
                          dateTime={item.occurredAt}
                        >
                          {formatInstant(item.occurredAt)}
                        </Typography>
                        {item.eventType && (
                          <Typography sx={{ mt: 0.25, fontWeight: 700 }}>
                            {historyEventLabels[item.eventType] ?? item.eventType}
                          </Typography>
                        )}
                        <Typography sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
                          {historySummaryLabels[item.summary] ?? item.summary}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
                <TablePagination
                  component="div"
                  count={history.data.totalCount}
                  page={page - 1}
                  rowsPerPage={20}
                  rowsPerPageOptions={[20]}
                  onPageChange={(_, next) => setPage(next + 1)}
                />
              </Paper>
            )}
          </>
        ))}
    </LocationSection>
  );
}
