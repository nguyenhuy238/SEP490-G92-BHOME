import { Alert, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageHeader } from '../../../components/common/PortalUI';
import { propertyError, usePropertyApi } from '../../property-api/propertyApi';

export default function LiveDashboardPage() {
  const api = usePropertyApi();
  const query = useQuery({
    queryKey: ['owner-property-dashboard'],
    queryFn: async ({ signal }) => {
      const [locations, rooms, occupied, available] = await Promise.all([
        api.locations(signal),
        api.request<{ totalCount: number }>('/api/v1/rooms?page=1&pageSize=1', { signal }),
        api.request<{ totalCount: number }>('/api/v1/rooms?page=1&pageSize=1&roomStatus=2', {
          signal,
        }),
        api.request<{ totalCount: number }>('/api/v1/rooms?page=1&pageSize=1&roomStatus=0', {
          signal,
        }),
      ]);
      return {
        locations: locations.totalCount,
        rooms: rooms.totalCount,
        occupied: occupied.totalCount,
        available: available.totalCount,
      };
    },
  });
  return (
    <>
      <PageHeader
        title="Tổng quan BHOME"
        subtitle="Số liệu cơ sở và phòng được tải trực tiếp từ Backend."
        actions={
          <Button component={Link} to="/locations" variant="contained">
            Quản lý cơ sở
          </Button>
        }
      />
      {query.isPending && <LinearProgress aria-label="Đang tải tổng quan" />}
      {query.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        >
          {propertyError(query.error)}
        </Alert>
      )}
      {query.data && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {Object.entries({
            'Cơ sở': query.data.locations,
            'Tổng phòng': query.data.rooms,
            'Phòng đang ở': query.data.occupied,
            'Phòng còn trống': query.data.available,
            'Tỷ lệ trạng thái Occupied': query.data.rooms
              ? `${((query.data.occupied / query.data.rooms) * 100).toFixed(1)}%`
              : '0.0%',
          }).map(([label, value]) => (
            <Paper key={label} variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography color="text.secondary">{label}</Typography>
              <Typography variant="h4">{value}</Typography>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}
