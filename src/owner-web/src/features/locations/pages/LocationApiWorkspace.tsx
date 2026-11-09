import { useState } from 'react';
import {
  Alert,
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

import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { ApiConfigurationCopy } from '../../configuration/ApiConfigurationCopy';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { UtilityWorkspace } from '../../property/UtilityWorkspace';
import { usePortalData } from '../../../hooks/usePortalData';
import { LocationAssetsTab } from '../components/tabs/LocationAssetsTab';
import { LocationPricingTab } from '../components/tabs/LocationPricingTab';
import { LocationRulesTab } from '../components/tabs/LocationRulesTab';

const tabs = [
  ['overview', 'Tổng quan'],
  ['room-types', 'Loại phòng'],
  ['rooms', 'Phòng'],
  ['assets', 'Tài sản'],
  ['pricing', 'Giá & Phí'],
  ['utilities', 'Điện & Nước'],
  ['rules', 'Nội quy'],
  ['history', 'Lịch sử phòng'],
  ['settings', 'Thiết lập'],
  ['investment', 'Vốn & Chi phí'],
];

export function LocationApiWorkspace() {
  const { locationId = '' } = useParams();
  const route = useLocation();
  const api = usePropertySetupApi();
  const portalData = usePortalData();
  const { session } = useAuth();
  const active = route.pathname.split('/')[3] || 'overview';
  const location = useQuery({
    queryKey: ['property-setup', 'location', session?.userId, locationId],
    queryFn: ({ signal }) => api.location(locationId, signal),
  });
  const portalLocation = portalData.data?.records.locations.find((item) => item.id === locationId);
  const summary = useQuery({
    queryKey: ['property-setup', 'location-summary', session?.userId, locationId],
    queryFn: async ({ signal }) => {
      const [roomTypes, rooms, assets, policies, rules, templates] = await Promise.all([
        api.roomTypes(locationId, 1, '', signal),
        api.rooms(locationId, 1, '', signal),
        api.assets(locationId, 1, '', signal),
        api.request<{ totalCount: number }>(
          `/api/v1/billing-policies?locationId=${encodeURIComponent(locationId)}&page=1&pageSize=1`,
          { signal },
        ),
        api.policies(locationId, signal),
        api.templates(locationId, signal),
      ]);
      return {
        roomTypes: roomTypes.totalCount,
        rooms: rooms.totalCount,
        assets: assets.totalCount,
        pricesAndFees: policies.totalCount,
        rules: rules.length,
        assetTemplates: templates.length,
      };
    },
  });
  if (location.isPending) return <LoadingState />;
  if (location.error)
    return <ErrorState error={location.error} retry={() => void location.refetch()} />;
  return (
    <Stack spacing={2}>
      <PageHeader
        title={location.data.name}
        subtitle={location.data.address}
        actions={
          <Stack direction="row">
            <ApiConfigurationCopy sourceLocationId={locationId} />
            <Button component={Link} to="/locations">
              Danh sách cơ sở
            </Button>
          </Stack>
        }
      />
      <Tabs
        value={tabs.some(([key]) => key === active) ? active : 'overview'}
        variant="scrollable"
        scrollButtons="auto"
      >
        {tabs.map(([key, label]) => (
          <Tab
            key={key}
            value={key}
            label={label}
            component={Link}
            to={`/locations/${locationId}/${key}`}
          />
        ))}
      </Tabs>
      {active === 'assets' ? (
        portalData.data && portalLocation ? (
          <LocationAssetsTab db={portalData.data} location={portalLocation} />
        ) : (
          <LoadingState />
        )
      ) : ['room-types', 'rooms', 'investment'].includes(active) ? (
        <Outlet />
      ) : active === 'pricing' ? (
        portalData.data && portalLocation ? (
          <LocationPricingTab db={portalData.data} location={portalLocation} />
        ) : (
          <LoadingState />
        )
      ) : active === 'utilities' ? (
        <UtilityWorkspace locationId={locationId} />
      ) : active === 'rules' ? (
        <LocationRulesTab locationId={locationId} />
      ) : active === 'history' ? (
        <LocationRoomHistory locationId={locationId} />
      ) : (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography>Địa chỉ: {location.data.address}</Typography>
            <Typography>{location.data.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}</Typography>
            <Typography>
              Cấu hình phòng, tài sản, giá và nội quy được quản lý riêng cho cơ sở này. Thay đổi
              trạng thái do máy chủ kiểm tra theo nghĩa vụ đang mở.
            </Typography>
            {summary.data && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
                <Chip label={`${summary.data.roomTypes} loại phòng`} />
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
                  {new Date(item.occurredAt).toLocaleString('vi-VN')} · {item.summary}
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
