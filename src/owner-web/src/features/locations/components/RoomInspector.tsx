import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
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
  const owner = session?.roles.includes('Owner') ?? false;
  const configurationView = useQuery({
    queryKey: [
      'property-setup',
      'room-configuration',
      session?.userId,
      room.data?.locationId,
      roomId,
    ],
    queryFn: ({ signal }) =>
      locationSetupClient(api.request).roomConfiguration(room.data!.locationId, roomId, signal),
    enabled: !!room.data?.locationId && owner,
  });
  const configuration = configurationView.data?.provenance?.data;
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
    enabled: tab === 0 && !owner,
  });
  const rent = owner
    ? configurationView.data?.rent
    : prices.data?.charges.find((charge) => charge.category === 0);
  const scheduledRent = configurationView.data?.scheduledRent;
  const rentQuery = owner ? configurationView : prices;
  const inventory = useQuery({
    queryKey: ['property-setup', 'inventory', session?.userId, roomId],
    queryFn: ({ signal }) => api.inventory(roomId, signal),
    enabled: tab === 1 && !owner,
  });
  const inventoryData = owner ? configurationView.data?.inventory : inventory.data;
  const inventoryQuery = owner ? configurationView : inventory;
  const desired = inventoryData?.desired.find((item) => item.id === inventoryData.currentDesiredId);
  const history = useQuery({
    queryKey: ['property-setup', 'room-history', session?.userId, roomId, page],
    queryFn: ({ signal }) =>
      api.request<{
        items: { id: string; summary: string; occurredAt: string }[];
        totalCount: number;
        limitations: string[];
      }>(`/api/v1/rooms/${roomId}/history?page=${page}&pageSize=20`, { signal }),
    enabled: tab === 2,
  });
  return (
    <Drawer
      anchor="right"
      open
      onClose={close}
      slotProps={{
        paper: {
          'aria-labelledby': 'room-inspector-title',
          sx: { width: { xs: '100%', sm: 560 }, bgcolor: 'background.paper' },
        },
      }}
    >
      <Stack spacing={2} sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              id="room-inspector-title"
              variant="h5"
              sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}
            >
              Phòng {room.data?.roomNumber ?? ''}
            </Typography>
            {room.data && (
              <Typography variant="body2" color="text.secondary">
                {room.data.floor ? `Tầng ${room.data.floor}` : 'Chưa phân tầng'} ·{' '}
                {room.data.capacity} người
              </Typography>
            )}
          </Box>
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
          <Tab label="Thông tin" />
          <Tab label="Tài sản" />
          <Tab label="Lịch sử" />
        </Tabs>
        {tab === 0 ? (
          room.isPending ? (
            <LoadingState />
          ) : room.error ? (
            <ErrorState error={room.error} retry={() => void room.refetch()} />
          ) : (
            <Stack spacing={2}>
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
                  <Button
                    variant="contained"
                    disabled={!configurationView.data?.canEdit || configurationView.isFetching}
                    onClick={() => edit(configurationView.data?.room ?? room.data)}
                    sx={{ minHeight: { xs: 44, sm: 36 } }}
                  >
                    Chỉnh sửa phòng
                  </Button>
                )}
              </Stack>
              {owner && configurationView.data && !configurationView.data.canEdit && (
                <Alert severity="info">
                  {configurationView.data.lockReason === 'location_inactive'
                    ? 'Cơ sở đã ngừng hoạt động. Không thể chỉnh sửa cấu hình phòng.'
                    : configurationView.data.lockReason === 'room_has_obligations'
                      ? 'Phòng còn nghĩa vụ chưa hoàn tất. Cấu hình được giữ nguyên.'
                      : 'Phòng đang có hợp đồng chưa kết thúc. Cấu hình và giá thuê được giữ nguyên.'}
                </Alert>
              )}
              <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: '12px' }}>
                {rentQuery.error ? (
                  <Alert
                    severity="warning"
                    action={<Button onClick={() => void rentQuery.refetch()}>Thử lại</Button>}
                  >
                    Chưa tải được giá thuê hiệu lực.
                  </Alert>
                ) : (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {rent?.effectiveFrom && rent.effectiveFrom > effectiveOn
                        ? 'Giá thuê sắp hiệu lực'
                        : 'Giá thuê cấu hình'}
                    </Typography>
                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontSize: rent ? 22 : 15,
                        fontVariantNumeric: 'tabular-nums',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {rent
                        ? `${formatBillingDecimal(rent.rate)} đ / tháng`
                        : rentQuery.isPending
                          ? 'Đang tải…'
                          : 'Chưa có giá thuê hiệu lực'}
                    </Typography>
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary">
                  {rent?.effectiveFrom
                    ? `Hiệu lực từ ${rent.effectiveFrom.split('-').reverse().join('/')}`
                    : `Theo ngày ${effectiveOn.split('-').reverse().join('/')}`}
                  {' · Cho hợp đồng tương lai'}
                </Typography>
                {scheduledRent && scheduledRent.id !== rent?.id && (
                  <Box sx={{ pt: 1.5, mt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" color="text.secondary">
                      Giá thuê sắp hiệu lực
                    </Typography>
                    <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatBillingDecimal(scheduledRent.rate)} đ / tháng
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Từ ngày {scheduledRent.effectiveFrom.split('-').reverse().join('/')}
                    </Typography>
                  </Box>
                )}
                {(room.data.status === 1 || room.data.status === 2) && (
                  <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
                    Giá thực thu theo hợp đồng; các khoản đã chốt được giữ nguyên.
                  </Typography>
                )}
              </Box>
              {owner && (
                <Stack spacing={1}>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Cấu hình phòng
                  </Typography>
                  {configurationView.error ? (
                    <Alert
                      severity="warning"
                      action={
                        <Button onClick={() => void configurationView.refetch()}>Thử lại</Button>
                      }
                    >
                      Chưa tải được cấu hình.
                    </Alert>
                  ) : configurationView.isPending ? (
                    <Typography color="text.secondary">Đang tải cấu hình…</Typography>
                  ) : configuration ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                        gap: 1.5,
                      }}
                    >
                      <RoomFact label="Loại phòng" value={configuration.name || 'Chưa phân loại'} />
                      <RoomFact
                        label="Diện tích"
                        value={
                          configuration.area === null ? 'Chưa ghi nhận' : `${configuration.area} m²`
                        }
                      />
                      <RoomFact
                        label="Tiện nghi"
                        value={configuration.amenities.join(', ') || 'Chưa thiết lập'}
                      />
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Chưa ghi nhận cấu hình bổ sung.
                    </Typography>
                  )}
                </Stack>
              )}
              <Divider />
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
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
                    Số người hiện tại
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
              </Stack>
              <Divider />
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Sự cố đang mở
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
                    <Box
                      key={report.id}
                      sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
                    >
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
                    </Box>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {operations.incidents.data?.complete
                      ? 'Không có báo cáo sự cố đang mở.'
                      : 'Đang tải hoặc chưa đủ dữ liệu sự cố.'}
                  </Typography>
                )}
              </Stack>
            </Stack>
          )
        ) : tab === 1 ? (
          inventoryQuery.isPending ? (
            <LoadingState />
          ) : inventoryQuery.error ? (
            <ErrorState error={inventoryQuery.error} retry={() => void inventoryQuery.refetch()} />
          ) : (
            <Stack spacing={2}>
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Định mức mong muốn
                </Typography>
                {desired ? (
                  desired.data.items.map((item) => (
                    <Stack
                      key={item.id}
                      direction="row"
                      sx={{
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 1,
                        py: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                          {item.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.category}
                        </Typography>
                      </Box>
                      <Typography sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {item.quantity}
                      </Typography>
                    </Stack>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có định mức được áp dụng.
                  </Typography>
                )}
              </Stack>
              <Stack spacing={1}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Tài sản thực tế
                </Typography>
                {inventoryData?.physical.length ? (
                  inventoryData.physical.map((asset) => (
                    <Stack
                      key={asset.id}
                      direction="row"
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 1,
                        py: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                          {asset.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {asset.code || 'Chưa có mã'} · {asset.condition}
                        </Typography>
                      </Box>
                      <Typography sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {inventoryData.metadata?.[asset.id]?.quantity ?? '—'}
                      </Typography>
                    </Stack>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Chưa ghi nhận tài sản vật lý.
                  </Typography>
                )}
                {!!inventoryData?.discrepancies?.length && (
                  <Alert severity="warning">
                    {inventoryData.discrepancies.length} tài sản cần đối chiếu khi kiểm kê.
                  </Alert>
                )}
                {room.data && (
                  <Button
                    component={Link}
                    to={`/locations/${room.data.locationId}/assets`}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Quản lý & kiểm kê tài sản
                  </Button>
                )}
              </Stack>
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
              <Box
                key={item.id}
                sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant="caption" color="text.secondary">
                  {formatInstant(item.occurredAt)}
                </Typography>
                <Typography sx={{ mt: 1 }}>{item.summary}</Typography>
              </Box>
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

function RoomFact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}
