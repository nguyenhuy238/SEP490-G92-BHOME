import { Box, Tab, Tabs } from '@mui/material';
import { Link as RouterLink } from 'react-router';

const financeWorkspaces = [
  {
    label: 'Lập hóa đơn',
    tabs: [
      { path: '/invoices', label: 'Hóa đơn' },
      { path: '/meters', label: 'Chỉ số điện nước' },
      { path: '/billing-automation', label: 'Lịch tự động' },
      { path: '/invoice-adjustments', label: 'Điều chỉnh' },
    ],
  },
  {
    label: 'Thu tiền & công nợ',
    tabs: [
      { path: '/payments', label: 'Thanh toán & đối soát' },
      { path: '/debts', label: 'Công nợ' },
    ],
  },
  {
    label: 'Chi phí & báo cáo',
    tabs: [
      { path: '/reports', label: 'Báo cáo' },
      { path: '/expenses', label: 'Đầu tư & chi phí' },
      { path: '/what-if', label: 'Dự báo What-if' },
    ],
  },
] as const;

const matchesPath = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export function FinanceWorkflowStrip({ pathname }: { pathname: string }) {
  const workspace = financeWorkspaces.find(({ tabs }) =>
    tabs.some((tab) => matchesPath(pathname, tab.path)),
  );
  if (!workspace) return null;

  const activeTab = workspace.tabs.find((tab) => matchesPath(pathname, tab.path));

  return (
    <Box
      component="nav"
      aria-label={`${workspace.label}: các mục`}
      sx={{
        mb: { xs: 1.5, md: 2 },
        borderBottom: '1px solid',
        borderColor: 'divider',
        minWidth: 0,
      }}
    >
      <Tabs
        value={activeTab?.path}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label={`Chọn mục trong ${workspace.label.toLowerCase()}`}
        sx={{
          minHeight: { xs: 44, md: 42 },
          '& .MuiTab-root': {
            minHeight: { xs: 44, md: 42 },
            minWidth: 0,
            px: { xs: 1.5, md: 2 },
            textTransform: 'none',
            whiteSpace: 'nowrap',
            fontSize: 14,
            fontWeight: 600,
          },
          '& .MuiTab-root.Mui-selected': { fontWeight: 750 },
          '& .MuiTabs-indicator': { height: 2 },
          '& .Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          },
        }}
      >
        {workspace.tabs.map((tab) => (
          <Tab
            key={tab.path}
            component={RouterLink}
            to={tab.path}
            value={tab.path}
            label={tab.label}
            aria-current={activeTab?.path === tab.path ? 'page' : undefined}
          />
        ))}
      </Tabs>
    </Box>
  );
}
