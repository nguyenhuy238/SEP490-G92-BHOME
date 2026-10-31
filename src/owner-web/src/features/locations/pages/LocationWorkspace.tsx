import { useEffect, type ReactNode } from 'react';
import { Box, Button, Chip, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  ArrowLeft,
  BadgeDollarSign,
  BedDouble,
  Building2,
  DoorOpen,
  Layers3,
  PackagePlus,
  Plus,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePortalData } from '../../../hooks/usePortalData';
import type { DemoDatabase, PortalRecord } from '../../../types/portal';
import { roomStatus, roomStatuses, roomSummary, type RoomStatus } from '../../property/model';
import { currency } from '../../property/propertyUtils';

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

  const manager =
    db.records.staff.find((staff) => staff.id === selected.staffId)?.name ||
    db.records.staff.find((staff) => staff.locationId === selected.id)?.name ||
    'Chưa phân công';

  return (
    <>
      <PageHeader
        group="KHÔNG GIAN QUẢN LÝ CƠ SỞ"
        title={selected.name}
        subtitle={`${selected.attributes.address || 'Chưa cập nhật địa chỉ'} · Phụ trách: ${manager}`}
        actions={
          <Button
            component={Link}
            to="/locations"
            variant="outlined"
            startIcon={<ArrowLeft size={15} />}
          >
            Danh sách cơ sở
          </Button>
        }
      />
      <Tabs
        value={workspaceTabs.some(([key]) => key === activeTab) ? activeTab : false}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
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

function WorkspaceMetric({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <Paper sx={{ p: 2.75, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: 750 }}>
          {label}
        </Typography>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.25,
            bgcolor: '#edf3ff',
            color: 'primary.main',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {icon}
        </Box>
      </Stack>
      <Typography sx={{ mt: 1.5, fontSize: 31, fontWeight: 850, letterSpacing: '-0.04em' }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    </Paper>
  );
}

function StatusSummary({ rooms }: { rooms: PortalRecord[] }) {
  const statuses: RoomStatus[] = ['OCCUPIED', 'ON_HOLD', 'AVAILABLE', 'UNAVAILABLE'];
  const occupied = rooms.filter((room) => roomStatus(room) === 'OCCUPIED').length;
  const occupancy = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0;
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 1 }}
      >
        <Typography component="h2" sx={{ fontSize: 17, fontWeight: 820 }}>
          Tình trạng khai thác
        </Typography>
        <Chip
          label={`Lấp đầy ${occupancy}%`}
          size="small"
          sx={{ bgcolor: '#ebf2ff', color: 'primary.main', fontWeight: 800 }}
        />
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(4,1fr)' },
          gap: 1,
        }}
      >
        {statuses.map((status) => {
          const config = roomStatuses[status];
          const count = rooms.filter((room) => roomStatus(room) === status).length;
          return (
            <Box
              key={status}
              sx={{
                p: 1.5,
                textAlign: 'center',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.25,
              }}
            >
              <Typography sx={{ fontSize: 20, fontWeight: 850, color: config.color }}>
                {count}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {config.label}
              </Typography>
            </Box>
          );
        })}
      </Box>
      <Box
        sx={{ mt: 2, p: 1.5, border: '1px solid #d6e5ff', bgcolor: '#f1f7ff', borderRadius: 1.25 }}
      >
        <Typography variant="caption" sx={{ color: '#49668e', lineHeight: 1.6 }}>
          Phòng đang thuê/giữ chỗ được xác định từ hợp đồng và xác nhận cọc, không đổi bằng nút
          trạng thái tùy ý.
        </Typography>
      </Box>
    </Paper>
  );
}

function SetupShortcuts({ locationId }: { locationId: string }) {
  const shortcuts = [
    {
      label: 'Quản lý loại phòng',
      icon: <Layers3 size={15} />,
      to: `/locations/${locationId}/room-types`,
    },
    {
      label: 'Tạo phòng hàng loạt',
      icon: <Plus size={15} />,
      to: `/locations/${locationId}/rooms/new`,
      primary: true,
    },
    {
      label: 'Nhập kho & phân bổ',
      icon: <PackagePlus size={15} />,
      to: `/locations/${locationId}/assets`,
    },
    {
      label: 'Giá & biểu phí',
      icon: <BadgeDollarSign size={15} />,
      to: `/locations/${locationId}/pricing`,
    },
  ];
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Typography component="h2" sx={{ fontSize: 17, fontWeight: 820, mb: 2 }}>
        Thiết lập cơ sở
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
        {shortcuts.map((item) => (
          <Button
            key={item.label}
            component={Link}
            to={item.to}
            variant={item.primary ? 'contained' : 'outlined'}
            startIcon={item.icon}
          >
            {item.label}
          </Button>
        ))}
      </Box>
    </Paper>
  );
}

function RoomCard({ db, room }: { db: DemoDatabase; room: PortalRecord }) {
  const status = roomStatus(room);
  const config = roomStatuses[status];
  const summary = roomSummary(db, room);
  const type = db.records['room-types'].find((item) => item.id === room.category);
  return (
    <Box
      component={Link}
      to={`/rooms/${room.id}`}
      aria-label={`Mở phòng ${room.code}`}
      sx={{
        display: 'block',
        minWidth: 0,
        p: 2,
        color: 'inherit',
        textDecoration: 'none',
        bgcolor: config.background,
        border: '1px solid',
        borderColor: `${config.color}35`,
        borderRadius: 1.25,
        transition: 'transform .15s ease, box-shadow .15s ease',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 8px 18px rgba(31,57,91,.08)' },
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 850 }}>{room.code}</Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: 'block',
          mt: 0.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {type?.name || 'Chưa gán loại phòng'} · Tầng {room.attributes.floor || '—'}
      </Typography>
      <Typography sx={{ mt: 1.25, fontSize: 15, fontWeight: 850 }}>
        {currency(room.amount)}
        <Typography component="span" variant="caption">
          /tháng
        </Typography>
      </Typography>
      <Typography sx={{ mt: 1, fontSize: 10, fontWeight: 850, color: config.color }}>
        ● {config.label}
      </Typography>
      <Stack
        direction="row"
        sx={{ mt: 1, alignItems: 'center', gap: 0.5, color: 'text.secondary' }}
      >
        <UsersRound size={12} />
        <Typography variant="caption">
          {summary.occupants.length}/{summary.capacity} người
        </Typography>
      </Stack>
      {summary.alerts.slice(0, 2).map((alert) => (
        <Typography
          key={alert.label}
          sx={{ mt: 0.75, fontSize: 10, fontWeight: 750, color: alert.color }}
        >
          {alert.label}
        </Typography>
      ))}
    </Box>
  );
}

export function LocationOverview() {
  const { locationId = '' } = useParams();
  const query = usePortalData();
  if (!query.data) return null;
  const db = query.data;
  const rooms = db.records.rooms.filter((room) => room.locationId === locationId);
  const occupied = rooms.filter((room) => roomStatus(room) === 'OCCUPIED').length;
  const available = rooms.filter((room) => roomStatus(room) === 'AVAILABLE').length;
  const occupants = db.records.tenants.filter(
    (tenant) => tenant.locationId === locationId && tenant.status === 'Đang ở',
  ).length;
  const needsAttention = rooms.filter((room) => roomSummary(db, room).alerts.length > 0).length;
  const floors = [...new Set(rooms.map((room) => room.attributes.floor || 'Chưa xếp tầng'))].sort(
    (a, b) => Number(b) - Number(a),
  );

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4,1fr)' },
          gap: 1.75,
          mb: 2.5,
        }}
      >
        <WorkspaceMetric
          label="Tổng phòng"
          value={rooms.length}
          hint="Phòng đã cấu hình"
          icon={<DoorOpen size={18} />}
        />
        <WorkspaceMetric
          label="Đang thuê"
          value={occupied}
          hint={`${occupants} người cư trú`}
          icon={<UsersRound size={18} />}
        />
        <WorkspaceMetric
          label="Trống khai thác"
          value={available}
          hint="Có thể tiếp nhận khách mới"
          icon={<BedDouble size={18} />}
        />
        <WorkspaceMetric
          label="Cần xử lý"
          value={needsAttention}
          hint="Phòng có cảnh báo vận hành"
          icon={<TriangleAlert size={18} />}
        />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.7fr) minmax(330px,1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        <StatusSummary rooms={rooms} />
        <SetupShortcuts locationId={locationId} />
      </Box>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 850 }}>
            Không gian phòng theo tầng
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Chọn một Room Card để mở hồ sơ phòng và các module liên quan.
          </Typography>
        </Box>
        <Button
          component={Link}
          to={`/locations/${locationId}/rooms`}
          variant="outlined"
          endIcon={<Building2 size={14} />}
        >
          Xem tất cả phòng
        </Button>
      </Stack>
      {floors.map((floor) => {
        const floorRooms = rooms.filter(
          (room) => (room.attributes.floor || 'Chưa xếp tầng') === floor,
        );
        return (
          <Box key={floor} sx={{ mb: 2.5 }}>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 850 }}>Sơ đồ tầng {floor}</Typography>
              <Chip
                size="small"
                label={`${floorRooms.length} phòng`}
                sx={{ bgcolor: '#f1f4f9', color: 'text.secondary' }}
              />
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2,minmax(0,1fr))',
                  sm: 'repeat(3,minmax(0,1fr))',
                  lg: 'repeat(6,minmax(0,1fr))',
                },
                gap: 1.25,
              }}
            >
              {floorRooms.map((room) => (
                <RoomCard key={room.id} db={db} room={room} />
              ))}
            </Box>
          </Box>
        );
      })}
    </>
  );
}
