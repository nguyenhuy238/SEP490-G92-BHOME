import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { useSharedConfigurationApi } from '../../configuration/useSharedConfigurationApi';

export function RoomTypesApiPage() {
  const { locationId: routeLocation = '' } = useParams();
  const portal = usePortal();
  const locationId = routeLocation || (portal.locationId === 'all' ? '' : portal.locationId);
  const api = useSharedConfigurationApi();
  const { session } = useAuth();
  const canManage = session?.roles.includes('Owner') ?? false;
  const query = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomDefaults(locationId, signal),
    enabled: !!locationId && canManage,
  });
  return (
    <Stack spacing={2}>
      <PageHeader title="Gợi ý tạo phòng" subtitle="Cấu hình đã áp dụng riêng tại cơ sở" />
      {!canManage ? (
        <Alert severity="info">Owner quản lý cấu hình gợi ý tạo phòng.</Alert>
      ) : !locationId ? (
        <Alert severity="info">Chọn một cơ sở để xem cấu hình gợi ý.</Alert>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <Alert severity="info">
            Chọn cấu hình gợi ý khi thêm phòng; xác nhận sức chứa và giá thu thực tế riêng cho từng
            phòng.
          </Alert>
          {!query.data.length && <Typography>Chưa có cấu hình gợi ý tại cơ sở này.</Typography>}
          {query.data.map((item) => (
            <Paper key={item.id} sx={{ p: 2 }}>
              <Typography variant="h6">{item.data.name}</Typography>
              <Typography>Sức chứa gợi ý: {item.data.defaults.capacity} người</Typography>
              <Typography>Diện tích tham khảo: {item.data.defaults.area} m²</Typography>
              <Typography>
                Tiện ích: {item.data.defaults.amenities.join(', ') || 'Chưa khai báo'}
              </Typography>
            </Paper>
          ))}
        </>
      )}
      {canManage && (
        <Button component={Link} to="/configuration/room-types">
          Mở thư viện mẫu và áp dụng vào cơ sở
        </Button>
      )}
    </Stack>
  );
}
