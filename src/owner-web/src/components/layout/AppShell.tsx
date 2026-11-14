import { useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Breadcrumbs,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  FileText,
  FilePenLine,
  FlaskConical,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  RotateCcw,
  Search,
  Shapes,
  TriangleAlert,
  Users,
  Wallet,
  Wrench,
  ChartColumn,
  Coins,
  Contact,
  House,
  ShieldCheck,
  Tags,
  ScrollText,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { featureDefinitions } from '../../app/featureDefinitions';
import { usePortal } from '../../app/PortalProvider';
import { usePortalAction, usePortalData } from '../../hooks/usePortalData';
import { isMockMode } from '../../services/config';
import { ConfirmDialog } from '../common/PortalUI';
import type { ResourceKind } from '../../types/portal';
import { NotificationBell } from '../../features/notifications/NotificationBell';

const iconMap: Record<string, typeof Building2> = {
  dashboard: LayoutDashboard,
  notifications: Bell,
  locations: Building2,
  rooms: DoorOpen,
  'room-types': Shapes,
  assets: Package,
  'asset-allocation': Package,
  pricing: Coins,
  staff: Users,
  'staff-assignments': Building2,
  tasks: ClipboardList,
  'operational-tasks': ClipboardList,
  tenants: Contact,
  contracts: FileText,
  'digital-signing': FilePenLine,
  handovers: KeyRound,
  'temporary-residence': ShieldCheck,
  meters: Gauge,
  finance: ChartNoAxesCombined,
  invoices: Receipt,
  'billing-automation': CalendarDays,
  'invoice-adjustments': Receipt,
  payments: Wallet,
  debts: Wallet,
  incidents: TriangleAlert,
  maintenance: Wrench,
  expenses: Coins,
  reports: ChartColumn,
  'what-if': FlaskConical,
  'public-content': Globe,
  'configuration/room-types': Shapes,
  'configuration/assets': Package,
  'configuration/pricing-fees': Tags,
  'configuration/policies': ScrollText,
};
const navGroups = [
  ['Tổng quan', ['dashboard']],
  ['Cơ sở & Phòng', ['locations']],
  [
    'THƯ VIỆN CẤU HÌNH DÙNG CHUNG',
    [
      'configuration/room-types',
      'configuration/assets',
      'configuration/pricing-fees',
      'configuration/policies',
    ],
  ],
  ['Nhân sự & Vận hành', ['staff', 'staff-assignments', 'operational-tasks']],
  [
    'Khách thuê & Hợp đồng',
    ['tenants', 'contracts', 'digital-signing', 'handovers', 'temporary-residence'],
  ],
  [
    'Tài chính & Hóa đơn',
    [
      'finance',
      'meters',
      'invoices',
      'billing-automation',
      'invoice-adjustments',
      'payments',
      'debts',
      'expenses',
      'reports',
      'what-if',
    ],
  ],
  ['Sự cố & Bảo trì', ['incidents', 'maintenance']],
  ['Thông báo', ['notifications']],
  ['Hệ thống', ['public-content']],
] as const;
const navLabels: Record<string, string> = {
  dashboard: 'Tổng quan',
  account: 'Tài khoản',
  notifications: 'Thông báo',
  locations: 'Cơ sở',
  'configuration/room-types': 'Mẫu loại phòng',
  'configuration/assets': 'Danh mục tài sản',
  'configuration/pricing-fees': 'Mẫu giá & biểu phí',
  'configuration/policies': 'Nội quy & chính sách',
  rooms: 'Phòng',
  'room-types': 'Loại phòng',
  assets: 'Tài sản',
  'asset-allocation': 'Cấp phát tài sản',
  pricing: 'Giá thuê & Biểu phí',
  staff: 'Nhân viên',
  'staff-assignments': 'Phân công cơ sở',
  tasks: 'Công việc vận hành',
  'operational-tasks': 'Công việc vận hành',
  tenants: 'Khách thuê',
  contracts: 'Hợp đồng',
  'digital-signing': 'Ký số (MySign)',
  handovers: 'Bàn giao phòng',
  'temporary-residence': 'Đăng ký tạm trú',
  meters: 'Chỉ số điện nước',
  finance: 'Bắt đầu tại đây',
  invoices: 'Hóa đơn',
  'billing-automation': 'Lịch tự động',
  'invoice-adjustments': 'Điều chỉnh hóa đơn',
  payments: 'Thanh toán / Đối soát',
  debts: 'Công nợ',
  incidents: 'Quản lý sự cố',
  maintenance: 'Công việc bảo trì',
  expenses: 'Đầu tư & Chi phí',
  reports: 'Báo cáo kinh doanh',
  'what-if': 'Phân tích What-if',
  'public-content': 'Nội dung công khai',
};
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false),
    [resetOpen, setResetOpen] = useState(false);
  const [financeExpandedOverride, setFinanceExpandedOverride] = useState<boolean | null>(null);
  const { data } = usePortalData();
  const portal = usePortal();
  const action = usePortalAction();
  const navigate = useNavigate();
  const location = useLocation();
  const current = location.pathname.split('/')[1] || 'dashboard';
  const inFinanceArea = [
    'finance',
    'meters',
    'invoices',
    'billing-automation',
    'invoice-adjustments',
    'payments',
    'debts',
    'expenses',
    'reports',
    'what-if',
  ].includes(current);
  const financeExpanded = financeExpandedOverride ?? (inFinanceArea && current !== 'finance');
  const workspaceParts = location.pathname.split('/');
  const inLocationWorkspace = workspaceParts[1] === 'locations' && Boolean(workspaceParts[2]);
  const selectedLocation = data?.records.locations.find((row) => row.id === workspaceParts[2]);
  const nav = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'white' }}>
      <Stack
        direction="row"
        sx={{
          height: 76,
          px: 2.25,
          alignItems: 'center',
          gap: 1.2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Avatar variant="rounded" sx={{ bgcolor: '#255dde', width: 37, height: 37, fontSize: 21 }}>
          B
        </Avatar>
        <Box>
          <Typography sx={{ fontWeight: 850, fontSize: 17 }}>BHOME</Typography>
          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Owner Portal</Typography>
        </Box>
      </Stack>
      <Box
        component="nav"
        aria-label="Điều hướng chính"
        sx={{ overflowY: 'auto', flex: 1, py: 1.5 }}
      >
        {navGroups.map(([group, items]) => (
          <Box key={group} sx={{ mb: 1 }}>
            <Typography
              sx={{
                px: 2.25,
                pt: 1.5,
                pb: 0.5,
                fontSize: 10,
                letterSpacing: group === 'Tài chính & Hóa đơn' ? 0.5 : 1,
                textTransform: 'uppercase',
                color: group === 'Tài chính & Hóa đơn' ? 'primary.main' : 'text.secondary',
                fontWeight: group === 'Tài chính & Hóa đơn' ? 850 : 600,
              }}
            >
              {group}
            </Typography>
            <List dense disablePadding>
              {items
                .filter(
                  (key) => group !== 'Tài chính & Hóa đơn' || financeExpanded || key === 'finance',
                )
                .map((key) => {
                  const Icon = iconMap[key];
                  return (
                    <ListItemButton
                      component={NavLink}
                      to={`/${key}`}
                      key={key}
                      onClick={() => {
                        setMobileOpen(false);
                        portal.setSearch('');
                      }}
                      sx={{
                        mx: 1.25,
                        my: 0.25,
                        borderRadius: 1.25,
                        minHeight: 41,
                        py: 0.75,
                        color: '#53657f',
                        '&:hover': { bgcolor: '#f4f7fc' },
                        '&.active': { bgcolor: '#ebf2ff', color: 'primary.main', fontWeight: 800 },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                        <Icon size={17} />
                      </ListItemIcon>
                      <ListItemText
                        primary={navLabels[key]}
                        slotProps={{ primary: { sx: { fontSize: 12 } } }}
                      />
                    </ListItemButton>
                  );
                })}
              {group === 'Tài chính & Hóa đơn' && (
                <ListItemButton
                  aria-expanded={financeExpanded}
                  onClick={() => setFinanceExpandedOverride(!financeExpanded)}
                  sx={{
                    mx: 1.25,
                    my: 0.25,
                    minHeight: 41,
                    borderRadius: 1.25,
                    color: 'text.secondary',
                    '&:hover': { bgcolor: '#f4f7fc' },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                    {financeExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                  </ListItemIcon>
                  <ListItemText
                    primary={financeExpanded ? 'Thu gọn các mục' : 'Xem các chức năng khác'}
                    slotProps={{ primary: { sx: { fontSize: 12, fontWeight: 650 } } }}
                  />
                </ListItemButton>
              )}
            </List>
          </Box>
        ))}
      </Box>
      <Divider />
      <Typography variant="caption" sx={{ p: 2, color: 'text.secondary' }}>
        BHOME • Owner Workspace
      </Typography>
    </Box>
  );
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box component="a" href="#owner-main" className="skip-link">
        Đi đến nội dung chính
      </Box>
      <Box
        component="aside"
        sx={{
          display: { xs: 'none', lg: 'block' },
          position: 'fixed',
          width: 258,
          top: 0,
          bottom: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          zIndex: 1200,
        }}
      >
        {nav}
      </Box>
      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 258 } }}
      >
        {nav}
      </Drawer>
      <Box sx={{ ml: { lg: '258px' } }}>
        <Paper
          component="header"
          square
          elevation={0}
          sx={{
            height: { xs: 'auto', sm: 75 },
            minHeight: 75,
            py: { xs: 1, sm: 0 },
            display: 'flex',
            alignItems: 'center',
            px: { xs: 1.5, md: 3.75 },
            gap: { xs: 1, sm: 2 },
            flexWrap: { xs: 'wrap', md: 'nowrap' },
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            zIndex: 1100,
          }}
        >
          <IconButton
            aria-label="Mở điều hướng"
            sx={{ display: { lg: 'none' } }}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </IconButton>
          <Breadcrumbs sx={{ display: { xs: 'none', md: 'flex' }, fontSize: 11, flexShrink: 0 }}>
            <House size={13} />
            <Typography sx={{ fontSize: 11, fontWeight: 750, color: 'text.primary' }}>
              {inLocationWorkspace && selectedLocation
                ? `Cơ sở / ${selectedLocation.name}`
                : 'BHOME Portal'}
            </Typography>
          </Breadcrumbs>
          {isMockMode && !inLocationWorkspace && (
            <TextField
              size="small"
              placeholder="Tìm kiếm phòng, khách, hợp đồng..."
              value={portal.search}
              onChange={(e) => portal.setSearch(e.target.value)}
              sx={{ maxWidth: 340, flex: 1, minWidth: 130 }}
              slotProps={{
                htmlInput: { 'aria-label': 'Tìm kiếm toàn trang' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={15} />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
          <Box sx={{ flex: 1, display: { xs: isMockMode ? 'none' : 'block', md: 'block' } }} />
          {isMockMode && (
            <Box
              sx={{
                display: { xs: 'none', md: 'block' },
                px: 1.25,
                py: 0.65,
                borderRadius: 10,
                bgcolor: '#fffae8',
                border: '1px solid #f0e4ae',
                color: '#99732e',
                fontSize: 10,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              DEMO · KHÔNG GỬI API
            </Box>
          )}
          {(isMockMode || inLocationWorkspace) && (
            <TextField
              select
              size="small"
              aria-label="Chọn cơ sở"
              value={portal.locationId}
              onChange={(e) => {
                const nextLocationId = e.target.value;
                portal.setLocationId(nextLocationId);
                portal.setSearch('');
                if (inLocationWorkspace) {
                  if (nextLocationId === 'all') navigate('/locations');
                  else navigate(`/locations/${nextLocationId}/${workspaceParts[3] || 'overview'}`);
                }
              }}
              sx={{ minWidth: { xs: 115, sm: 180 }, maxWidth: 240 }}
            >
              <MenuItem value="all">Tất cả cơ sở ({data?.records.locations.length || 0})</MenuItem>
              {data?.records.locations.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {row.code} • {row.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {isMockMode ? (
            <IconButton aria-label="Thông báo" onClick={() => navigate('/notifications')}>
              <Badge
                badgeContent={
                  data?.records.notifications.filter((row) => row.status === 'Chưa đọc').length || 0
                }
                color="error"
              >
                <Bell size={19} />
              </Badge>
            </IconButton>
          ) : (
            <NotificationBell />
          )}
          {isMockMode && (
            <Tooltip title="Khôi phục dữ liệu demo">
              <IconButton aria-label="Khôi phục demo" onClick={() => setResetOpen(true)}>
                <RotateCcw size={17} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Quản lý tài khoản">
            <IconButton
              aria-label="Mở quản lý tài khoản"
              onClick={() => navigate('/account/profile')}
              sx={{ p: 0.5 }}
            >
              <Avatar
                sx={{
                  width: 30,
                  height: 30,
                  fontSize: 12,
                  bgcolor: 'primary.main',
                }}
              >
                <Contact size={17} />
              </Avatar>
            </IconButton>
          </Tooltip>
        </Paper>
        <Box
          component="main"
          id="owner-main"
          tabIndex={-1}
          sx={{ px: { xs: 2, md: 3 }, py: 3, maxWidth: 1680, mx: 'auto', minWidth: 0 }}
        >
          <Breadcrumbs sx={{ fontSize: 10, mb: 1 }}>
            <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>Hệ thống</Typography>
            {inFinanceArea && current !== 'finance' && (
              <Box
                component={NavLink}
                to="/finance"
                sx={{
                  fontSize: 11,
                  color: 'primary.main',
                  fontWeight: 700,
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                }}
              >
                Tài chính & Hóa đơn
              </Box>
            )}
            <Typography sx={{ fontSize: 10, color: 'primary.main' }}>
              {(current === 'finance' ? 'Bắt đầu tại đây' : navLabels[current]) ||
                featureDefinitions.find((f) => f.kind === (current as ResourceKind))?.title}
            </Typography>
          </Breadcrumbs>
          <Outlet />
        </Box>
      </Box>
      <ConfirmDialog
        open={resetOpen}
        title="Khôi phục dữ liệu minh họa?"
        busy={action.isPending}
        onClose={() => setResetOpen(false)}
        onConfirm={() =>
          action.mutate(() => portal.repository.reset(), {
            onSuccess: () => {
              portal.setLocationId('all');
              setResetOpen(false);
            },
          })
        }
      >
        Các thay đổi demo trên trình duyệt này sẽ được thay bằng bộ dữ liệu ban đầu.
      </ConfirmDialog>
    </Box>
  );
}
