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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { BillingConfigurationPage } from '../../invoices/BillingConfigurationPage';

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
          <Button component={Link} to="/locations">
            Danh sách cơ sở
          </Button>
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
      {['rooms', 'assets', 'investment'].includes(active) ? (
        <Outlet />
      ) : active === 'pricing' ? (
        <BillingConfigurationPage initialLocationId={locationId} />
      ) : active === 'rules' ? (
        <LocationPolicySummary locationId={locationId} />
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

export function LocationPolicySummary({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const cache = useQueryClient();
  const policies = useQuery({
    queryKey: ['property-setup', 'policies', session?.userId, locationId],
    queryFn: ({ signal }) => api.policies(locationId, signal),
  });
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.savePolicy(null, { locationId, title, content, effectiveFrom: date, expectedVersion: 0 }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup', 'policies'] });
      setTitle('');
      setContent('');
    },
  });
  if (policies.isPending) return <LoadingState />;
  if (policies.error)
    return <ErrorState error={policies.error} retry={() => void policies.refetch()} />;
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Công bố nội quy mới không thay thế nội quy đã ký. Hợp đồng cũ chỉ thay đổi qua phụ lục được
        ký và Owner áp dụng.
      </Alert>
      {!policies.data.length && <Alert severity="info">Chưa có nội quy.</Alert>}
      {policies.data.map((policy) => (
        <Paper key={policy.id} sx={{ p: 2 }}>
          <Typography variant="h6">{policy.data.title}</Typography>
          <Typography>
            {policy.status} · {policy.data.effectiveFrom}
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{policy.data.content}</Typography>
        </Paper>
      ))}
      {session?.roles.includes('Owner') && (
        <Paper sx={{ p: 2 }}>
          <Stack
            component="form"
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              if (!save.isPending) save.mutate();
            }}
          >
            <TextField
              required
              label="Tên nội quy"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <TextField
              required
              multiline
              minRows={4}
              label="Nội dung nội quy"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <TextField
              required
              type="date"
              label="Ngày hiệu lực"
              slotProps={{ inputLabel: { shrink: true } }}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            {save.error && <Alert severity="error">{invoiceError(save.error)}</Alert>}
            {save.isSuccess && <Alert severity="success">Máy chủ đã lưu bản nháp nội quy.</Alert>}
            <Button type="submit" variant="contained" disabled={save.isPending}>
              Lưu bản nháp
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
