import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Chip, Drawer, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type { RoomConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
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
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 580 }, p: 3 } } }}
    >
      <Stack spacing={3}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 750 }}>
            Phòng {room.data?.roomNumber ?? ''}
          </Typography>
          <Button onClick={close}>Đóng</Button>
        </Stack>
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
          <Tab label="Thông tin phòng" />
          <Tab label="Lịch sử" />
        </Tabs>
        {tab === 0 ? (
          room.isPending ? (
            <LoadingState />
          ) : room.error ? (
            <ErrorState error={room.error} retry={() => void room.refetch()} />
          ) : (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Stack spacing={2}>
                <Chip
                  sx={{ alignSelf: 'flex-start' }}
                  label={
                    ['Trống khai thác', 'Đang giữ chỗ', 'Đang có khách thuê', 'Ngừng khai thác'][
                      room.data.status
                    ]
                  }
                />
                <Typography>Tầng: {room.data.floor ?? 'Chưa phân tầng'}</Typography>
                {prices.error ? (
                  <Alert
                    severity="warning"
                    action={<Button onClick={() => void prices.refetch()}>Thử lại</Button>}
                  >
                    Chưa tải được giá thuê hiệu lực.
                  </Alert>
                ) : (
                  <Typography>
                    Giá thuê cấu hình:{' '}
                    {rent
                      ? `${formatBillingDecimal(rent.rate)} đ / tháng`
                      : prices.isPending
                        ? 'Đang tải…'
                        : 'Chưa có giá thuê hiệu lực'}
                  </Typography>
                )}
                <Typography>Sức chứa: {room.data.capacity} người</Typography>
                <Typography>
                  Người ở theo hợp đồng hiện tại:{' '}
                  {occupancy
                    ? `${occupancy.occupants.length}/${room.data.capacity}`
                    : 'Chưa tải được số liệu'}
                </Typography>
                {occupancy?.occupants.map((person) => (
                  <Typography key={person.residentId} variant="body2">
                    {person.displayLabel} ·{' '}
                    {person.role === 'Representative' ? 'Đại diện' : 'Người cùng ở'}
                  </Typography>
                ))}
                <Typography>Phiên bản: {room.data.version}</Typography>
                <Alert severity="info">
                  Trạng thái giữ chỗ và có khách được cập nhật qua quy trình hợp đồng và kích hoạt
                  tương ứng.
                </Alert>
                {edit && (
                  <Button variant="contained" onClick={() => edit(room.data)}>
                    Chỉnh sửa phòng
                  </Button>
                )}
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                  Báo cáo sự cố đang mở
                </Typography>
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
            </Paper>
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
              <Paper
                key={item.id}
                variant="outlined"
                sx={{ p: 2, borderLeft: '3px solid', borderLeftColor: 'primary.main' }}
              >
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
