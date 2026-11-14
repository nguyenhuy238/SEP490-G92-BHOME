import { useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
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
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Bell,
  Building2,
  CalendarDays,
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
  PanelLeftClose,
  PanelLeftOpen,
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
    'Thư viện cấu hình dùng chung',
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
  'configuration/assets': 'Tài sản dùng chung',
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
const sidebarPreference = 'bhome.owner.sidebar-collapsed';
const headerHeight = 64;

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false),
    [resetOpen, setResetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(sidebarPreference) === 'true';
    } catch {
      return false;
    }
  });
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null);
  const { data, isError } = usePortalData();
  const portal = usePortal();
  const action = usePortalAction();
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceParts = location.pathname.split('/');
  const current = workspaceParts[1] || 'dashboard';
  const currentKey = current === 'configuration' ? workspaceParts.slice(1, 3).join('/') : current;
  const inLocationWorkspace = workspaceParts[1] === 'locations' && Boolean(workspaceParts[2]);
  const locations = data?.records.locations ?? [];
  const locationValue = inLocationWorkspace ? workspaceParts[2] : portal.locationId;
  const locationUnavailableLabel = isError ? 'Không tải được danh sách cơ sở' : 'Đang tải cơ sở…';
  const missingLocation =
    locationValue !== 'all' && !locations.some((row) => row.id === locationValue);
  const showLocationSelector = isMockMode || inLocationWorkspace;
  const sidebarWidth = collapsed ? 72 : 248;
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(sidebarPreference, String(next));
    } catch {
      // The navigation remains usable when browser storage is unavailable.
    }
  };
  const nav = (compact: boolean) => (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'white' }}>
      <Stack
        direction="row"
        sx={{
          height: headerHeight,
          flexShrink: 0,
          px: compact ? 1 : 2,
          alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start',
          gap: 1.2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Avatar
          variant="rounded"
          sx={{ bgcolor: 'primary.main', width: 36, height: 36, fontSize: 21 }}
        >
          B
        </Avatar>
        {!compact && (
          <Box>
            <Typography sx={{ fontWeight: 850, fontSize: 17 }}>BHOME</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Owner Portal</Typography>
          </Box>
        )}
      </Stack>
      <Box
        component="nav"
        aria-label="Điều hướng chính"
        sx={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0, flex: 1, py: 1 }}
      >
        {navGroups.map(([group, items]) => (
          <Box key={group} sx={{ mb: compact ? 0.5 : 0.75 }}>
            {compact ? (
              <Divider sx={{ mx: 2, my: 1 }} />
            ) : (
              <Typography
                sx={{
                  px: 2,
                  pt: 0.75,
                  pb: 0.5,
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1.4,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                }}
              >
                {group}
              </Typography>
            )}
            <List dense disablePadding>
              {items.map((key) => {
                const Icon = iconMap[key];
                return (
                  <Tooltip
                    key={key}
                    title={compact ? navLabels[key] : ''}
                    placement="right"
                    disableInteractive
                  >
                    <ListItemButton
                      component={NavLink}
                      to={`/${key}`}
                      aria-label={navLabels[key]}
                      onClick={() => {
                        setMobileOpen(false);
                        portal.setSearch('');
                      }}
                      sx={{
                        mx: 1,
                        my: 0.25,
                        borderRadius: 1.25,
                        minHeight: { xs: 44, lg: 36 },
                        '@media (pointer:coarse)': { minHeight: 44 },
                        px: compact ? 1 : 1.25,
                        justifyContent: compact ? 'center' : 'flex-start',
                        py: 0.375,
                        color: '#53657f',
                        '&:hover': { bgcolor: '#f4f7fc' },
                        '&.active': {
                          bgcolor: 'primary.light',
                          color: 'primary.dark',
                          '& .MuiListItemText-primary': { fontWeight: 700 },
                        },
                        '&.Mui-focusVisible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: compact ? 0 : 30, color: 'inherit' }}>
                        <Icon size={18} aria-hidden="true" />
                      </ListItemIcon>
                      {!compact && (
                        <ListItemText
                          primary={navLabels[key]}
                          sx={{ my: 0 }}
                          slotProps={{ primary: { sx: { fontSize: 14, lineHeight: 1.35 } } }}
                        />
                      )}
                    </ListItemButton>
                  </Tooltip>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>
      <Divider />
      {isMockMode && !compact && (
        <ListItemButton
          onClick={() => {
            setMobileOpen(false);
            setResetOpen(true);
          }}
          sx={{
            display: { xs: 'flex', sm: 'none' },
            mx: 1,
            my: 0.5,
            borderRadius: 1,
            minHeight: 44,
          }}
        >
          <ListItemIcon sx={{ minWidth: 30 }}>
            <RotateCcw size={18} />
          </ListItemIcon>
          <ListItemText primary="Khôi phục dữ liệu demo" />
        </ListItemButton>
      )}
      {!compact && (
        <Typography variant="caption" sx={{ px: 2, py: 1, color: 'text.secondary' }}>
          BHOME • Owner Workspace
        </Typography>
      )}
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
          width: sidebarWidth,
          top: 0,
          bottom: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          zIndex: 1200,
        }}
      >
        {nav(collapsed)}
      </Box>
      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { lg: 'none' }, '& .MuiDrawer-paper': { width: 280, maxWidth: '90vw' } }}
      >
        {nav(false)}
      </Drawer>
      <Box sx={{ ml: { lg: `${sidebarWidth}px` }, minWidth: 0 }}>
        <Paper
          component="header"
          square
          elevation={0}
          sx={{
            height: headerHeight,
            minHeight: headerHeight,
            display: 'flex',
            alignItems: 'center',
            px: { xs: 1, sm: 2, lg: 3 },
            gap: { xs: 0.5, sm: 1.25 },
            minWidth: 0,
            flexWrap: 'nowrap',
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            zIndex: 1100,
          }}
        >
          <IconButton
            aria-label="Mở điều hướng"
            aria-expanded={mobileOpen}
            sx={{ display: { lg: 'none' }, flexShrink: 0 }}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </IconButton>
          <Tooltip title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}>
            <IconButton
              aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              aria-expanded={!collapsed}
              onClick={toggleSidebar}
              sx={{ display: { xs: 'none', lg: 'inline-flex' }, flexShrink: 0 }}
            >
              {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </IconButton>
          </Tooltip>
          <Typography
            noWrap
            sx={{
              fontSize: 14,
              fontWeight: 700,
              minWidth: 0,
              display: { xs: showLocationSelector ? 'none' : 'block', md: 'block' },
            }}
          >
            {inLocationWorkspace
              ? 'Cơ sở'
              : navLabels[currentKey] ||
                featureDefinitions.find((f) => f.kind === (current as ResourceKind))?.title ||
                'BHOME Portal'}
          </Typography>
          {isMockMode && !inLocationWorkspace && (
            <TextField
              size="small"
              placeholder="Tìm kiếm phòng, khách, hợp đồng..."
              value={portal.search}
              onChange={(e) => portal.setSearch(e.target.value)}
              sx={{ display: { xs: 'none', md: 'flex' }, maxWidth: 340, flex: 1, minWidth: 130 }}
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
          {isMockMode && !inLocationWorkspace && (
            <>
              <Tooltip title="Tìm kiếm toàn trang">
                <IconButton
                  aria-label="Mở tìm kiếm toàn trang"
                  aria-expanded={Boolean(searchAnchor)}
                  onClick={(event) => setSearchAnchor(event.currentTarget)}
                  sx={{ display: { xs: 'inline-flex', md: 'none' }, flexShrink: 0 }}
                >
                  <Search size={19} />
                </IconButton>
              </Tooltip>
              <Popover
                open={Boolean(searchAnchor)}
                anchorEl={searchAnchor}
                onClose={() => setSearchAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              >
                <Box sx={{ p: 2, width: 300, maxWidth: 'calc(100vw - 32px)' }}>
                  <TextField
                    autoFocus
                    placeholder="Tìm kiếm phòng, khách, hợp đồng..."
                    value={portal.search}
                    onChange={(event) => portal.setSearch(event.target.value)}
                    slotProps={{ htmlInput: { 'aria-label': 'Tìm kiếm toàn trang' } }}
                  />
                </Box>
              </Popover>
            </>
          )}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: { xs: showLocationSelector ? 'none' : 'block', md: 'block' },
            }}
          />
          {isMockMode && (
            <Box
              sx={{
                display: { xs: 'none', lg: 'block' },
                px: 1.25,
                py: 0.65,
                borderRadius: 10,
                bgcolor: '#fffae8',
                border: '1px solid #f0e4ae',
                color: '#845d00',
                fontSize: 11,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              DEMO · KHÔNG GỬI API
            </Box>
          )}
          {showLocationSelector && (
            <TextField
              select
              size="small"
              disabled={!data}
              value={locationValue}
              slotProps={{ select: { SelectDisplayProps: { 'aria-label': 'Chọn cơ sở' } } }}
              onChange={(e) => {
                const nextLocationId = e.target.value;
                portal.setLocationId(nextLocationId);
                portal.setSearch('');
                if (inLocationWorkspace) {
                  if (nextLocationId === 'all') navigate('/locations');
                  else navigate(`/locations/${nextLocationId}/${workspaceParts[3] || 'overview'}`);
                }
              }}
              sx={{
                flex: { xs: '1 1 0', md: '0 1 260px' },
                minWidth: 0,
                maxWidth: 260,
                '& .MuiSelect-select': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <MenuItem value="all">
                {data
                  ? isMockMode
                    ? `Tất cả cơ sở (${locations.length})`
                    : 'Tất cả cơ sở'
                  : locationUnavailableLabel}
              </MenuItem>
              {missingLocation && (
                <MenuItem value={locationValue} disabled>
                  {data ? 'Cơ sở hiện tại' : locationUnavailableLabel}
                </MenuItem>
              )}
              {locations.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {isMockMode ? `${row.code} • ` : ''}
                  {row.name}
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
              <IconButton
                aria-label="Khôi phục demo"
                onClick={() => setResetOpen(true)}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                <RotateCcw size={17} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Quản lý tài khoản">
            <IconButton
              aria-label="Mở quản lý tài khoản"
              onClick={() => navigate('/account/profile')}
              sx={{ flexShrink: 0 }}
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
          sx={{
            px: { xs: 1.5, md: 2.5, xl: 3 },
            py: { xs: 1.5, md: 2 },
            minWidth: 0,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
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
