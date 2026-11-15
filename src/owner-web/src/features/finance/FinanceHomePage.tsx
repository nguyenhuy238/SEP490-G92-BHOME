import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import {
  ArrowRight,
  ChartNoAxesCombined,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/common/PortalUI';

type FinanceTask = {
  label: string;
  description: string;
  to: string;
};

type FinanceWorkArea = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  primaryAction: { label: string; to: string };
  tasks: FinanceTask[];
};

const workAreas: FinanceWorkArea[] = [
  {
    id: 'billing',
    title: 'Lập hóa đơn',
    description: 'Kiểm tra dữ liệu và chuẩn bị hóa đơn cho kỳ thu tiền.',
    icon: ReceiptText,
    primaryAction: { label: 'Mở hóa đơn', to: '/invoices' },
    tasks: [
      {
        label: 'Chỉ số điện nước',
        description: 'Xem các chỉ số đã xác nhận',
        to: '/meters',
      },
      {
        label: 'Lịch lập hóa đơn',
        description: 'Theo dõi lịch và kết quả chạy',
        to: '/billing-automation',
      },
      {
        label: 'Giá & biểu phí',
        description: 'Kiểm tra chính sách tính tiền',
        to: '/pricing',
      },
      {
        label: 'Điều chỉnh hóa đơn',
        description: 'Xem và duyệt yêu cầu điều chỉnh',
        to: '/invoice-adjustments',
      },
    ],
  },
  {
    id: 'collections',
    title: 'Thu tiền & công nợ',
    description: 'Đối soát các khoản thu và xử lý số tiền còn phải thu.',
    icon: Wallet,
    primaryAction: { label: 'Đối soát thanh toán', to: '/payments' },
    tasks: [
      {
        label: 'Công nợ',
        description: 'Theo dõi khoản chưa thanh toán',
        to: '/debts',
      },
    ],
  },
  {
    id: 'results',
    title: 'Chi phí & báo cáo',
    description: 'Ghi nhận khoản chi và xem hiệu quả kinh doanh.',
    icon: ChartNoAxesCombined,
    primaryAction: { label: 'Xem báo cáo', to: '/reports' },
    tasks: [
      {
        label: 'Chi phí & đầu tư',
        description: 'Quản lý các khoản chi thực tế',
        to: '/expenses',
      },
      {
        label: 'Kịch bản What-if',
        description: 'Thử giả định, không đổi số liệu thực',
        to: '/what-if',
      },
    ],
  },
];

function FinanceArea({ area }: { area: FinanceWorkArea }) {
  const Icon = area.icon;

  return (
    <Paper
      component="section"
      aria-labelledby={'finance-area-' + area.id}
      variant="outlined"
      sx={{
        minWidth: 0,
        borderRadius: 2,
        p: { xs: 2, md: 2.25 },
        gridColumn: { md: area.id === 'results' ? 'span 2' : 'auto', xl: 'auto' },
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box
          sx={{
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: 1.5,
            bgcolor: 'primary.light',
            color: 'primary.main',
          }}
        >
          <Icon size={20} aria-hidden="true" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id={'finance-area-' + area.id}
            component="h2"
            variant="h6"
            sx={{ fontSize: 18, fontWeight: 750, lineHeight: 1.35 }}
          >
            {area.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.5 }}>
            {area.description}
          </Typography>
        </Box>
      </Stack>

      <Button
        component={Link}
        to={area.primaryAction.to}
        variant="contained"
        fullWidth
        endIcon={<ArrowRight size={17} aria-hidden="true" />}
        sx={{
          mt: 2,
          minHeight: { xs: 44, md: 38 },
          justifyContent: 'space-between',
          textAlign: 'left',
        }}
      >
        {area.primaryAction.label}
      </Button>

      <Box
        component="nav"
        aria-label={'Thao tác khác: ' + area.title}
        sx={{
          mt: 1.5,
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: area.id === 'results' ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
            xl: 'minmax(0, 1fr)',
          },
          columnGap: 2,
        }}
      >
        {area.tasks.map((task) => (
          <Box
            key={task.to}
            component={Link}
            to={task.to}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              minWidth: 0,
              minHeight: { xs: 58, md: 52 },
              py: 1,
              px: 0.5,
              mx: -0.5,
              borderRadius: 1,
              color: 'text.primary',
              textDecoration: 'none',
              '&:hover': { bgcolor: 'action.hover' },
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
                {task.label}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.25, lineHeight: 1.35 }}
              >
                {task.description}
              </Typography>
            </Box>
            <ArrowRight size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

export default function FinanceHomePage() {
  return (
    <>
      <PageHeader
        title="Tài chính & Hóa đơn"
        subtitle="Chọn công việc cần thực hiện trong ba nhóm dưới đây."
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(3, minmax(0, 1fr))',
          },
          alignItems: 'start',
          gap: 2,
        }}
      >
        {workAreas.map((area) => (
          <FinanceArea key={area.id} area={area} />
        ))}
      </Box>
    </>
  );
}
