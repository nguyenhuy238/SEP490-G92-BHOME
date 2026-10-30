import { useEffect } from 'react';
import { Box, Button, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { ArrowLeft, Building2, MapPin, UserRound } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePortalData } from '../../../hooks/usePortalData';
import { roomStatus } from '../../property/model';

const workspaceTabs = [
  ['overview', 'Tổng quan'],
  ['rooms', 'Phòng & Sơ đồ tầng'],
  ['room-types', 'Loại phòng'],
  ['assets', 'Tài sản'],
  ['pricing', 'Giá & Biểu phí'],
  ['investment', 'Vốn & Chi phí'],
] as const;

export function LocationWorkspace() {
  const { locationId = '' } = useParams();
  const route = useLocation();
  const portal = usePortal();
  const query = usePortalData();
  const activeTab = route.pathname.split('/')[3] || 'overview';

  useEffect(() => {
    if (locationId && portal.locationId !== locationId) {
      portal.setLocationId(locationId);
      portal.setSearch('');
    }
  }, [locationId, portal]);

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const db = query.data;
  const selected = db.records.locations.find((item) => item.id === locationId);
  if (!selected) return <Navigate to="/locations" replace />;

  const rooms = db.records.rooms.filter((room) => room.locationId === selected.id);
  const occupied = rooms.filter((room) => roomStatus(room) === 'OCCUPIED').length;
  const available = rooms.filter((room) => roomStatus(room) === 'AVAILABLE').length;
  const manager =
    db.records.staff.find((staff) => staff.id === selected.staffId)?.name ||
    db.records.staff.find((staff) => staff.locationId === selected.id)?.name ||
    'Chưa phân công';

  return (
    <>
      <Button component={Link} to="/locations" startIcon={<ArrowLeft size={15} />} sx={{ mb: 1.5 }}>
        Danh sách cơ sở
      </Button>
      <PageHeader
        group="LOCATION WORKSPACE"
        title={selected.name}
        subtitle={selected.attributes.address || 'Chưa cập nhật địa chỉ'}
        actions={
          <Chip
            label={selected.status}
            color={selected.status.includes('Đang') ? 'success' : 'default'}
          />
        }
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', lg: 'repeat(4,1fr)' },
          gap: 1.5,
          mb: 2.5,
        }}
      >
        {[
          { icon: Building2, label: 'Tổng số phòng', value: rooms.length },
          { icon: Building2, label: 'Đang thuê', value: occupied },
          { icon: Building2, label: 'Trống khai thác', value: available },
          {
            icon: UserRound,
            label: 'Người phụ trách',
            value: manager,
          },
        ].map(({ icon: Icon, label, value }) => (
          <Stack
            key={label}
            direction="row"
            sx={{
              gap: 1.5,
              p: 2,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            <Box sx={{ color: 'primary.main', pt: 0.25 }}>
              <Icon size={19} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {value}
              </Typography>
            </Box>
          </Stack>
        ))}
      </Box>
      <Stack
        direction="row"
        sx={{ gap: 0.75, alignItems: 'center', mb: 1, color: 'text.secondary' }}
      >
        <MapPin size={14} />
        <Typography variant="caption">
          Mọi tab bên dưới đang dùng chung cơ sở {selected.code}.
        </Typography>
      </Stack>
      <Tabs
        value={workspaceTabs.some(([key]) => key === activeTab) ? activeTab : false}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {workspaceTabs.map(([key, label]) => (
          <Tab
            key={key}
            value={key}
            label={label}
            component={Link}
            to={`/locations/${selected.id}/${key}`}
          />
        ))}
      </Tabs>
      <Outlet />
    </>
  );
}

export function LocationOverview() {
  const { locationId = '' } = useParams();
  const query = usePortalData();
  if (!query.data) return null;
  const db = query.data;
  const rooms = db.records.rooms.filter((room) => room.locationId === locationId);
  const statusCounts = ['AVAILABLE', 'ON_HOLD', 'OCCUPIED', 'UNAVAILABLE'].map((status) => ({
    status,
    count: rooms.filter((room) => roomStatus(room) === status).length,
  }));
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' }, gap: 2 }}>
      <Box
        sx={{
          p: 2.5,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Typography variant="h6" sx={{ mb: 2 }}>
          Tình trạng khai thác
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1.5 }}>
          {statusCounts.map(({ status, count }) => (
            <Box key={status} sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 1.5 }}>
              <Typography variant="h5">{count}</Typography>
              <Typography variant="caption" color="text.secondary">
                {status}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Box
        sx={{
          p: 2.5,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Typography variant="h6" sx={{ mb: 1 }}>
          Lối tắt cấu hình
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Cấu hình phòng, tài sản, giá và vốn luôn được giới hạn trong cơ sở hiện tại.
        </Typography>
        <Stack spacing={1}>
          {workspaceTabs.slice(1).map(([key, label]) => (
            <Button
              key={key}
              component={Link}
              to={`/locations/${locationId}/${key}`}
              variant="outlined"
            >
              {label}
            </Button>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
