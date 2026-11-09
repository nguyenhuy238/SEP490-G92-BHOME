import { useState } from 'react';
import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';

import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { ApiConfigurationCopy } from '../../configuration/ApiConfigurationCopy';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { BillingConfigurationPage } from '../../invoices/BillingConfigurationPage';
import { OperatingPoliciesPanel } from '../../property/OperatingPoliciesPanel';
import { LocalAssetSetup } from '../../property/LocalAssetSetup';
import { UtilityWorkspace } from '../../property/UtilityWorkspace';

const tabs = [
  ['overview', 'Tổng quan'],
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
  const { session } = useAuth();
  const active = route.pathname.split('/')[3] || 'overview';
  const location = useQuery({
    queryKey: ['property-setup', 'location', session?.userId, locationId],
    queryFn: ({ signal }) => api.location(locationId, signal),
  });
  if (active === 'room-types') return <Navigate replace to={`/locations/${locationId}/rooms`} />;
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
        <Stack spacing={3}>
          <Outlet />
          <LocalAssetSetup locationId={locationId} />
        </Stack>
      ) : ['rooms', 'investment'].includes(active) ? (
        <Outlet />
      ) : active === 'pricing' ? (
        <BillingConfigurationPage initialLocationId={locationId} />
      ) : active === 'utilities' ? (
        <UtilityWorkspace locationId={locationId} />
      ) : active === 'rules' ? (
        <OperatingPoliciesPanel locationId={locationId} />
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
