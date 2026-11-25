import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import { ArrowRight, Info } from 'lucide-react';
import { Link as RouterLink } from 'react-router';
import { scopedFinancePath, useFinanceSearch } from './financeScope';

const financeWorkspaces = [
  {
    label: 'Lập hóa đơn',
    tabs: [
      { path: '/invoices', label: 'Hóa đơn' },
      { path: '/meters', label: 'Chỉ số điện nước' },
      { path: '/billing-automation', label: 'Lịch lập hóa đơn' },
      { path: '/pricing', label: 'Giá & biểu phí' },
      { path: '/invoice-adjustments', label: 'Điều chỉnh hóa đơn' },
    ],
  },
  {
    label: 'Thu tiền & công nợ',
    tabs: [
      { path: '/payments', label: 'Thanh toán & đối soát' },
      { path: '/tenant-refund-requests', label: 'Yêu cầu hoàn tiền' },
      { path: '/debts', label: 'Công nợ' },
    ],
  },
  {
    label: 'Chi phí & báo cáo',
    tabs: [
      { path: '/reports', label: 'Báo cáo' },
      { path: '/expenses', label: 'Chi phí & đầu tư' },
      { path: '/what-if', label: 'Kịch bản' },
    ],
  },
] as const;

const guidance: Record<string, { purpose: string; next: string; nextPath: string; note?: string }> =
  {
    '/pricing': {
      purpose: 'Chọn cơ sở, kiểm tra giá và ngày hiệu lực trước khi tính hóa đơn.',
      note: 'Giá mới không tự sửa hóa đơn đã phát hành.',
      next: 'Theo dõi chỉ số điện nước',
      nextPath: '/meters',
    },
    '/meters': {
      purpose: 'Owner theo dõi nhiệm vụ và chỉ số điện nước; Staff xác nhận số đo thực tế.',
      note: 'Chỉ số chưa được xác nhận không nên dùng làm căn cứ tính tiền.',
      next: 'Xem hóa đơn',
      nextPath: '/invoices',
    },
    '/billing-automation': {
      purpose: 'Thiết lập lịch có hiệu lực và kiểm tra từng công việc của một kỳ thử.',
      note: 'Kỳ dùng để thử không tự thay đổi lịch đã cấu hình.',
      next: 'Xem hóa đơn',
      nextPath: '/invoices',
    },
    '/invoices': {
      purpose: 'Chọn kỳ và phòng, rà soát bản nháp trước khi Owner phát hành hóa đơn.',
      note: 'Nếu dữ liệu chưa đủ, hãy kiểm tra chỉ số hoặc giá áp dụng trước.',
      next: 'Kiểm tra chỉ số điện nước',
      nextPath: '/meters',
    },
    '/invoice-adjustments': {
      purpose: 'Xem yêu cầu điều chỉnh, kiểm tra bằng chứng và tác động trước khi quyết định.',
      note: 'Điều chỉnh không ghi đè hóa đơn đã phát hành.',
      next: 'Xem danh sách hóa đơn',
      nextPath: '/invoices',
    },
    '/payments': {
      purpose: 'Kiểm tra giao dịch đã nhận và xác minh hóa đơn trước khi phân bổ tiền.',
      note: 'Chỉ ghi nhận từ sao kê thủ công nếu ngân hàng đã nhận tiền nhưng BHOME chưa có giao dịch.',
      next: 'Theo dõi công nợ',
      nextPath: '/debts',
    },
    '/tenant-refund-requests': {
      purpose:
        'Xem yêu cầu Tenant gửi và đối chiếu nguồn tiền, hợp đồng liên quan trước khi quyết định.',
      note: 'Sau khi chuyển khoản thật, Owner tải chứng từ và ghi nhận. BHOME không tự chuyển khoản.',
      next: 'Đối soát giao dịch',
      nextPath: '/payments',
    },
    '/debts': {
      purpose: 'Tìm hóa đơn còn phải thu, quá hạn và xem lịch sử thu tiền.',
      note: 'Số đã thanh toán được xác định từ giao dịch đã đối soát.',
      next: 'Đối soát giao dịch',
      nextPath: '/payments',
    },
    '/expenses': {
      purpose: 'Ghi nhận, quản lý khoản đầu tư và chi phí thực tế theo phạm vi.',
      note: 'Ghi chi phí khác với xác nhận khoản tiền khách thuê đã thanh toán.',
      next: 'Xem báo cáo kinh doanh',
      nextPath: '/reports',
    },
    '/reports': {
      purpose: 'Chọn cơ sở và kỳ, sau đó bấm Xem báo cáo để tải kết quả kinh doanh.',
      note: 'Số liệu đang hiển thị thuộc bộ lọc đã tải, không tự đổi khi đang sửa bộ lọc.',
      next: 'Thử kịch bản What-if',
      nextPath: '/what-if',
    },
    '/what-if': {
      purpose: 'Thử các giả định về giá, lấp đầy và chi phí để so sánh kết quả.',
      note: 'Phân tích tạo kết quả thử; Lưu kịch bản để xem lại. Không thay đổi sổ tài chính thực tế.',
      next: 'Về báo cáo thực tế',
      nextPath: '/reports',
    },
  };

const matchesPath = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export function FinanceWorkflowStrip({ pathname }: { pathname: string }) {
  const locationId = useFinanceSearch().get('locationId');
  const workspace = financeWorkspaces.find(({ tabs }) =>
    tabs.some((tab) => matchesPath(pathname, tab.path)),
  );
  if (!workspace) return null;

  const activeTab = workspace.tabs.find((tab) => matchesPath(pathname, tab.path));
  const help = activeTab ? guidance[activeTab.path] : undefined;

  return (
    <Box sx={{ mb: { xs: 1.5, md: 2 }, minWidth: 0 }}>
      <Stack
        direction="row"
        useFlexGap
        sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}
      >
        <Button
          component={RouterLink}
          to="/finance"
          size="small"
          variant="text"
          sx={{ px: 0.5, minHeight: 34, fontWeight: 650 }}
        >
          Tổng quan tài chính
        </Button>
        <Typography variant="body2" color="text.secondary" aria-hidden="true">
          /
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {workspace.label}
        </Typography>
      </Stack>
      <Box
        component="nav"
        aria-label={`${workspace.label}: các mục`}
        sx={{ borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}
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
              to={
                workspace.label === 'Chi phí & báo cáo'
                  ? scopedFinancePath(tab.path, locationId)
                  : tab.path
              }
              value={tab.path}
              label={tab.label}
              aria-current={activeTab?.path === tab.path ? 'page' : undefined}
            />
          ))}
        </Tabs>
      </Box>
      {help && (
        <Box
          component="section"
          aria-label="Hướng dẫn sử dụng mục này"
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'flex-start', md: 'center' },
            justifyContent: 'space-between',
            gap: 1.5,
            minWidth: 0,
            px: { xs: 1.5, md: 2 },
            py: 1.5,
            mt: 1.25,
            bgcolor: 'primary.light',
            borderRadius: 2,
          }}
        >
          <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
            <Info size={19} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.5 }}>
                {help.purpose}
              </Typography>
              {help.note && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.25 }}
                >
                  {help.note}
                </Typography>
              )}
            </Box>
          </Stack>
          <Button
            component={RouterLink}
            to={
              workspace.label === 'Chi phí & báo cáo'
                ? scopedFinancePath(help.nextPath, locationId)
                : help.nextPath
            }
            size="small"
            variant="outlined"
            endIcon={<ArrowRight size={15} aria-hidden="true" />}
            sx={{ flexShrink: 0, minHeight: { xs: 44, md: 36 }, bgcolor: 'background.paper' }}
          >
            {help.next}
          </Button>
        </Box>
      )}
    </Box>
  );
}
