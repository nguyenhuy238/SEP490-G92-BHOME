import {
  Alert,
  Box,
  Button,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, Building2, ClipboardList, DoorOpen, Receipt, Wallet } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  financeClient,
  financeError,
  formatFinanceMoney,
} from '../../../../../../packages/client-core/src/finance';
import { PageHeader, KPIGrid } from '../../../components/common/PortalUI';
import { RoomOccupancyDistribution } from '../../../components/common/RoomOccupancyDistribution';
import { formatRoomCount } from '../../../components/common/roomOccupancy';
import { propertyError, usePropertyApi } from '../../property-api/propertyApi';
import { todayVietnam } from '../../staff/staffContracts';

const money = (amount?: string) => (typeof amount === 'string' ? formatFinanceMoney(amount) : '—');
const dateLabel = (date: string) => date.split('-').reverse().join('/');

export default function LiveDashboardPage() {
  const api = usePropertyApi();
  const { session } = useAuth();
  const actor = session?.userId;
  const query = useQuery({
    queryKey: ['owner-property-dashboard', actor],
    queryFn: async ({ signal }) => {
      const count = (status?: number) =>
        api.request<{ totalCount: number }>(
          `/api/v1/rooms?page=1&pageSize=1${status == null ? '' : `&roomStatus=${status}`}`,
          { signal },
        );
      const [locations, rooms, occupied, available, onHold, unavailable] = await Promise.all([
        api.locations(signal),
        count(),
        count(2),
        count(0),
        count(1),
        count(3),
      ]);
      return {
        locations: locations.totalCount,
        rooms: rooms.totalCount,
        occupied: occupied.totalCount,
        available: available.totalCount,
        onHold: onHold.totalCount,
        unavailable: unavailable.totalCount,
      };
    },
  });
  const today = todayVietnam();
  const filter = { from: `${today.slice(0, 7)}-01`, to: today };
  const finance = useQuery({
    queryKey: ['financial-report', actor, filter],
    queryFn: ({ signal }) => financeClient(api.request).report(filter, signal),
    enabled: session?.roles.includes('Owner') ?? false,
  });
  const counts = query.isError ? undefined : query.data;
  const totals = finance.isError ? undefined : finance.data?.total;
  const quickLinks = [
    {
      title: 'Danh sách cơ sở',
      detail: 'Phòng, tài sản và thiết lập',
      to: '/locations',
      icon: Building2,
    },
    {
      title: 'Hợp đồng',
      detail: 'Ký, xác minh cọc, gia hạn và trả phòng',
      to: '/contracts',
      icon: ClipboardList,
    },
    { title: 'Hóa đơn', detail: 'Kiểm tra và phát hành', to: '/invoices', icon: Receipt },
    { title: 'Thanh toán', detail: 'Đối soát giao dịch', to: '/payments', icon: Wallet },
    {
      title: 'Công việc vận hành',
      detail: 'Phân công và nghiệm thu',
      to: '/operational-tasks',
      icon: DoorOpen,
    },
  ];
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <PageHeader
        title="Tổng quan BHOME"
        actions={
          <Button
            component={Link}
            to="/locations"
            variant="contained"
            startIcon={<Building2 size={17} />}
          >
            Quản lý cơ sở
          </Button>
        }
      />
      <Box component="section" aria-label="Tình hình khai thác">
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
            mb: 1.25,
          }}
        >
          <Typography component="h2" variant="h2">
            Tình hình khai thác
          </Typography>
          <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
            Tải lại
          </Button>
        </Stack>
        {query.isFetching && <LinearProgress aria-label="Đang tải tổng quan" />}
        {query.error && (
          <Alert
            severity="warning"
            sx={{ mb: 1 }}
            action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
          >
            {propertyError(query.error)}
          </Alert>
        )}
        <KPIGrid
          items={[
            {
              label: 'Cơ sở',
              value: formatRoomCount(counts?.locations),
              hint: 'Trong phạm vi quản lý',
            },
            { label: 'Tổng phòng', value: formatRoomCount(counts?.rooms) },
            {
              label: 'Phòng đang cho thuê',
              value: formatRoomCount(counts?.occupied),
              tone: 'primary',
            },
            { label: 'Phòng trống', value: formatRoomCount(counts?.available), tone: 'success' },
          ]}
        />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' },
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}
          >
            <Typography component="h2" variant="h2">
              Tình trạng phòng
            </Typography>
            <Button component={Link} to="/locations" endIcon={<ArrowRight size={16} />}>
              Xem cơ sở
            </Button>
          </Stack>
          <RoomOccupancyDistribution counts={counts} loading={query.isPending} />
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <Typography component="h2" variant="h2" sx={{ mb: 1 }}>
            Truy cập nhanh
          </Typography>
          <Stack divider={<Divider />} spacing={0}>
            {quickLinks.map(({ title, detail, to, icon: Icon }) => (
              <Button
                key={to}
                component={Link}
                to={to}
                color="inherit"
                sx={{
                  display: 'flex',
                  textAlign: 'left',
                  justifyContent: 'space-between',
                  py: 0.75,
                  px: 0.5,
                  gap: 1,
                  minHeight: 44,
                }}
              >
                <Box sx={{ color: 'primary.dark', display: 'flex', flexShrink: 0 }}>
                  <Icon size={18} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {detail}
                  </Typography>
                </Box>
                <ArrowRight size={16} />
              </Button>
            ))}
          </Stack>
        </Paper>
      </Box>
      {session?.roles.includes('Owner') && (
        <Box component="section" aria-label="Tình hình kinh doanh">
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              flexWrap: 'wrap',
              mb: 1.25,
            }}
          >
            <Box>
              <Typography component="h2" variant="h2">
                Tình hình kinh doanh
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Kỳ báo cáo: {dateLabel(filter.from)} – {dateLabel(filter.to)}
              </Typography>
            </Box>
            <Button component={Link} to="/reports" endIcon={<ArrowRight size={16} />}>
              Xem báo cáo
            </Button>
          </Stack>
          {finance.isFetching && <LinearProgress aria-label="Đang tải tài chính" />}
          {finance.error && (
            <Alert
              severity="warning"
              sx={{ mb: 1 }}
              action={<Button onClick={() => void finance.refetch()}>Thử lại</Button>}
            >
              {financeError(finance.error)}
            </Alert>
          )}
          <KPIGrid
            items={[
              {
                label: 'Khoản phải thu',
                value: money(totals?.issued),
                hint: 'Hóa đơn / khoản phải thu trong kỳ',
              },
              {
                label: 'Đã thu (đã xác minh)',
                value: money(totals?.verifiedCollections),
                hint: 'Khoản thu trong kỳ',
              },
              {
                label: 'Công nợ hiện tại',
                value: money(totals?.outstandingNow),
                hint: 'Số dư thuộc kỳ báo cáo',
              },
              {
                label: 'Chi phí vận hành',
                value: money(totals?.operatingExpenses),
                hint: 'Chi phí trong kỳ',
              },
            ]}
          />
        </Box>
      )}
    </Stack>
  );
}
