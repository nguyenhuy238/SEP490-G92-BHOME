import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type { RoomConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';
import { useRoomOperations } from './useRoomOperations';
import { Link } from 'react-router';
import {
  formatBillingDecimal,
  type Policy,
} from '../../../../../../packages/client-core/src/invoices';
import { todayVietnam } from '../../staff/staffContracts';
import { ErrorState, LoadingState } from '../../../components/common/PortalUI';

export function RoomInspector({
  roomId,
  close,
  edit,
}: {
  roomId: string;
  close: () => void;
  edit?: (room: RoomConfiguration) => void;
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const room = useQuery({
    queryKey: ['property-setup', 'room', session?.userId, roomId],
    queryFn: ({ signal }) => api.request<RoomConfiguration>(`/api/v1/rooms/${roomId}`, { signal }),
  });
  const operations = useRoomOperations(room.data?.locationId ?? '', [roomId]);
  const provenance = useQuery({
    queryKey: ['property-setup', 'room-provenance', session?.userId, room.data?.locationId],
    queryFn: ({ signal }) =>
      locationSetupClient(api.request).roomProvenance(room.data!.locationId, signal),
    enabled: !!room.data?.locationId && !!session?.roles.includes('Owner'),
  });
  const configuration = provenance.data?.find((item) => item.data.roomId === roomId)?.data;
  const occupancy = operations.occupancy.data?.items.find((item) => item.roomId === roomId);
  const reports =
    operations.incidents.data?.items.filter(
      (item) => item.roomId === roomId && ['Submitted', 'InProgress'].includes(item.status),
    ) ?? [];
  const effectiveOn = todayVietnam();
  const prices = useQuery({
    queryKey: ['property-setup', 'room-prices', session?.userId, roomId, effectiveOn],
    queryFn: ({ signal }) =>
      api.request<{ charges: Policy[]; missingRequiredCharges: string[] }>(
        `/api/v1/rooms/${roomId}/prices?effectiveOn=${effectiveOn}`,
        { signal },
      ),
    enabled: tab === 0,
  });
  const rent = prices.data?.charges.find((charge) => charge.category === 0);
  const history = useQuery({
    queryKey: ['property-setup', 'room-history', session?.userId, roomId, page],
    queryFn: ({ signal }) =>
      api.request<{
        items: { id: string; summary: string; occurredAt: string }[];
        totalCount: number;
        limitations: string[];
      }>(`/api/v1/rooms/${roomId}/history?page=${page}&pageSize=20`, { signal }),
    enabled: tab === 1,
  });
  return (
    <Drawer
      anchor="right"
      open
      onClose={close}
      slotProps={{
        paper: {
          'aria-labelledby': 'room-inspector-title',
          sx: { width: { xs: '100%', sm: 560 }, p: { xs: 2, sm: 3 }, bgcolor: 'background.paper' },
        },
      }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
        >
          <Typography
            id="room-inspector-title"
            variant="h5"
            sx={{ fontWeight: 800, fontSize: '1.5rem', overflowWrap: 'anywhere' }}
          >
            Phòng {room.data?.roomNumber ?? ''}
          </Typography>
          <Button onClick={close} sx={{ minHeight: 44, flexShrink: 0 }}>
            Đóng
          </Button>
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, value: number) => setTab(value)}
          aria-label="Chi tiết phòng"
          variant="fullWidth"
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab label="Thông tin phòng" />
          <Tab label="Lịch sử" />
        </Tabs>
        {tab === 0 ? (
          room.isPending ? (
            <LoadingState />
          ) : room.error ? (
            <ErrorState error={room.error} retry={() => void room.refetch()} />
          ) : (
            <Stack spacing={2.5}>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  flexWrap: 'wrap',
                }}
              >
                <Chip
                  size="small"
                  color={
                    room.data.status === 0
                      ? 'success'
                      : room.data.status === 1
                        ? 'warning'
                        : room.data.status === 2
                          ? 'info'
                          : 'default'
                  }
                  label={
                    ['Trống khai thác', 'Đang giữ chỗ', 'Đang có khách thuê', 'Ngừng khai thác'][
                      room.data.status
                    ] ?? 'Chưa xác định'
                  }
                />
                {edit && (
                  <Button variant="contained" onClick={() => edit(room.data)}>
                    Chỉnh sửa phòng
                  </Button>
                )}
              </Stack>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 2,
                  p: 2,
                  bgcolor: 'background.default',
                  borderRadius: '10px',
                }}
              >
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Tầng
                  </Typography>
                  <Typography sx={{ fontWeight: 750, fontSize: 18, overflowWrap: 'anywhere' }}>
                    {room.data.floor ?? 'Chưa phân tầng'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Sức chứa
                  </Typography>
                  <Typography sx={{ fontWeight: 750, fontSize: 18 }}>
                    {room.data.capacity} người
                  </Typography>
                </Box>
              </Box>
              <Divider />
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Cấu hình khi tạo phòng
                </Typography>
                {session?.roles.includes('Owner') &&
                  (configuration ? (
                    <>
                      <Typography>
                        Gợi ý khi tạo phòng: {configuration.name} (phiên bản{' '}
                        {configuration.roomDefaultsVersion})
                      </Typography>
                      <Typography>
                        Diện tích: {configuration.area} m² · Sức chứa mặc định:{' '}
                        {configuration.defaultCapacity}
                      </Typography>
                      <Typography>
                        Tiện nghi: {configuration.amenities.join(', ') || 'Chưa thiết lập'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Bản lưu khi tạo phòng; thay đổi gợi ý không cập nhật bản ghi này.
                      </Typography>
                    </>
                  ) : provenance.error ? (
                    <Alert
                      severity="warning"
                      action={<Button onClick={() => void provenance.refetch()}>Thử lại</Button>}
                    >
                      Chưa tải được cấu hình nguồn của phòng.
                    </Alert>
                  ) : provenance.isPending ? (
                    <Typography color="text.secondary">Đang tải cấu hình nguồn…</Typography>
                  ) : (
                    <Typography color="text.secondary">
                      Phòng không có cấu hình nguồn được ghi nhận.
                    </Typography>
                  ))}
              </Stack>
              <Divider />
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Giá thuê
                </Typography>
                {prices.error ? (
                  <Alert
                    severity="warning"
                    action={<Button onClick={() => void prices.refetch()}>Thử lại</Button>}
                  >
                    Chưa tải được giá thuê hiệu lực.
                  </Alert>
                ) : (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Giá thuê cấu hình (cho hợp đồng tương lai)
                    </Typography>
                    <Typography
                      sx={{
                        fontWeight: 750,
                        fontSize: rent ? 22 : 15,
                        fontVariantNumeric: 'tabular-nums',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {rent
                        ? `${formatBillingDecimal(rent.rate)} đ / tháng`
                        : prices.isPending
                          ? 'Đang tải…'
                          : 'Chưa có giá thuê hiệu lực'}
                    </Typography>
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary">
                  Giá cấu hình theo ngày {effectiveOn.split('-').reverse().join('/')}.
                </Typography>
                {(room.data.status === 1 || room.data.status === 2) && (
                  <Alert severity="info">
                    Phòng đang có ràng buộc hợp đồng. Giá và phí thực thu xem tại hợp đồng; biểu giá
                    cấu hình không thay đổi các khoản đã chốt.
                  </Alert>
                )}
              </Stack>
              <Divider />
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Người ở theo hợp đồng
                </Typography>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 1,
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Người ở theo hợp đồng hiện tại
                  </Typography>
                  <Typography
                    sx={{
                      fontWeight: 750,
                      fontSize: occupancy ? 20 : 14,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {occupancy
                      ? `${occupancy.occupants.length}/${room.data.capacity}`
                      : 'Chưa tải được số liệu'}
                  </Typography>
                </Stack>
                {operations.occupancy.error && (
                  <Alert
                    severity="warning"
                    action={
                      <Button onClick={() => void operations.occupancy.refetch()}>Thử lại</Button>
                    }
                  >
                    Chưa tải được số người ở. Sức chứa phòng không phải số người đang ở.
                  </Alert>
                )}
                {occupancy?.occupants.map((person) => (
                  <Typography key={person.residentId} variant="body2">
                    {person.displayLabel} ·{' '}
                    {person.role === 'Representative' ? 'Đại diện' : 'Người cùng ở'}
                  </Typography>
                ))}
                <Typography variant="caption" color="text.secondary">
                  Trạng thái giữ chỗ và có khách được cập nhật qua quy trình hợp đồng và kích hoạt
                  tương ứng.
                </Typography>
              </Stack>
              <Divider />
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Báo cáo sự cố đang mở
                </Typography>
                {operations.incidents.data && !operations.incidents.data.complete && (
                  <Alert severity="warning">Danh sách sự cố chưa đầy đủ.</Alert>
                )}
                {operations.incidents.error ? (
                  <Alert
                    severity="warning"
                    action={
                      <Button onClick={() => void operations.incidents.refetch()}>Thử lại</Button>
                    }
                  >
                    Chưa tải được báo cáo sự cố.
                  </Alert>
                ) : reports.length ? (
                  reports.map((report) => (
                    <Paper key={report.id} variant="outlined" sx={{ p: 2 }}>
                      <Typography sx={{ fontWeight: 700 }}>
                        {report.code} ·{' '}
                        {report.severity === 'Emergency' ? 'Khẩn cấp' : 'Thông thường'}
                      </Typography>
                      <Typography variant="body2" sx={{ my: 1 }}>
                        {report.description}
                      </Typography>
                      <Button
                        component={Link}
                        to={`/incidents?incidentId=${encodeURIComponent(report.id)}`}
                      >
                        Xem báo cáo
                      </Button>
                    </Paper>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {operations.incidents.data?.complete
                      ? 'Không có báo cáo sự cố đang mở.'
                      : 'Đang tải hoặc chưa đủ dữ liệu sự cố.'}
                  </Typography>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Phiên bản phòng: {room.data.version}
              </Typography>
            </Stack>
          )
        ) : history.isPending ? (
          <LoadingState />
        ) : history.error ? (
          <ErrorState error={history.error} retry={() => void history.refetch()} />
        ) : (
          <>
            {history.data.limitations.map((text) => (
              <Alert key={text} severity="info">
                {text}
              </Alert>
            ))}
            {!history.data.items.length && (
              <Alert severity="info">Chưa có lịch sử được ghi nhận.</Alert>
            )}
            {history.data.items.map((item) => (
              <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  {formatInstant(item.occurredAt)}
                </Typography>
                <Typography sx={{ mt: 1 }}>{item.summary}</Typography>
              </Paper>
            ))}
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                Trang {page}
              </Typography>
              <Button
                disabled={page * 20 >= history.data.totalCount}
                onClick={() => setPage(page + 1)}
              >
                Trang sau
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Drawer>
  );
}
