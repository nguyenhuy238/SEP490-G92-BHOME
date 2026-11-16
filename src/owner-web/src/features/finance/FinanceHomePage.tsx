import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { ArrowRight, ChevronRight } from 'lucide-react';
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
  primaryAction: FinanceTask;
  tasks: FinanceTask[];
};

const workflow = [
  { label: 'Kiểm tra giá & phí', description: 'Đúng phạm vi và ngày hiệu lực' },
  { label: 'Kiểm tra chỉ số', description: 'Xem số đo Staff đã xác nhận' },
  { label: 'Lập và phát hành', description: 'Rà soát hóa đơn trước khi chốt' },
  { label: 'Đối soát thanh toán', description: 'Giao dịch và số dư còn phải thu' },
] as const;

const workAreas: FinanceWorkArea[] = [
  {
    id: 'billing',
    title: 'Lập hóa đơn',
    description: 'Chuẩn bị dữ liệu và hóa đơn cho từng kỳ thu tiền.',
    primaryAction: {
      label: 'Mở danh sách hóa đơn',
      description: 'Tạo, rà soát và phát hành theo quyền Owner',
      to: '/invoices',
    },
    tasks: [
      {
        label: 'Giá & biểu phí',
        description: 'Kiểm tra chính sách và thời điểm áp dụng',
        to: '/pricing',
      },
      {
        label: 'Chỉ số điện nước',
        description: 'Theo dõi nhiệm vụ và chỉ số đã xác nhận',
        to: '/meters',
      },
      {
        label: 'Lịch lập hóa đơn',
        description: 'Thiết lập, theo dõi lịch và kết quả chạy',
        to: '/billing-automation',
      },
      {
        label: 'Điều chỉnh hóa đơn',
        description: 'Xem và xử lý yêu cầu điều chỉnh',
        to: '/invoice-adjustments',
      },
    ],
  },
  {
    id: 'collections',
    title: 'Thu tiền & công nợ',
    description: 'Từ giao dịch ngân hàng đến số tiền còn phải thu.',
    primaryAction: {
      label: 'Đối soát thanh toán',
      description: 'Xác minh và phân bổ giao dịch đã nhận',
      to: '/payments',
    },
    tasks: [
      {
        label: 'Công nợ',
        description: 'Tìm hóa đơn chưa thanh toán hoặc quá hạn',
        to: '/debts',
      },
      {
        label: 'Yêu cầu hoàn tiền',
        description:
          'Xem đơn khách thuê gửi, duyệt hoặc từ chối và ghi nhận chứng từ chuyển khoản hoàn',
        to: '/tenant-refund-requests',
      },
    ],
  },
  {
    id: 'results',
    title: 'Chi phí & báo cáo',
    description: 'Theo dõi khoản chi, kết quả và giả định kế hoạch.',
    primaryAction: {
      label: 'Xem báo cáo',
      description: 'Đọc kết quả kinh doanh đã tổng hợp',
      to: '/reports',
    },
    tasks: [
      {
        label: 'Chi phí & đầu tư',
        description: 'Ghi nhận và quản lý các khoản chi thực tế',
        to: '/expenses',
      },
      {
        label: 'Kịch bản What-if',
        description: 'Thử giả định, không thay đổi sổ tài chính thực',
        to: '/what-if',
      },
    ],
  },
];

function FinanceTaskLink({ task }: { task: FinanceTask }) {
  return (
    <Box
      component={Link}
      to={task.to}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        minWidth: 0,
        minHeight: { xs: 64, md: 58 },
        px: 1,
        py: 1.25,
        borderTop: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        color: 'text.primary',
        textDecoration: 'none',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
          {task.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {task.description}
        </Typography>
      </Box>
      <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
    </Box>
  );
}

function FinanceArea({ area, featured = false }: { area: FinanceWorkArea; featured?: boolean }) {
  return (
    <Paper
      component="section"
      aria-labelledby={'finance-area-' + area.id}
      variant="outlined"
      sx={{
        minWidth: 0,
        borderRadius: 2,
        p: { xs: 1.75, md: 2.25 },
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: featured ? 'row' : 'column' }}
        sx={{
          alignItems: { xs: 'stretch', sm: featured ? 'flex-start' : 'stretch' },
          justifyContent: 'space-between',
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            id={'finance-area-' + area.id}
            component="h2"
            variant="h6"
            sx={{ fontWeight: 750, fontSize: { xs: 18, md: 20 }, lineHeight: 1.35 }}
          >
            {area.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.5 }}>
            {area.description}
          </Typography>
        </Box>
        {featured && (
          <Button
            component={Link}
            to={area.primaryAction.to}
            variant="contained"
            endIcon={<ArrowRight size={17} aria-hidden="true" />}
            sx={{
              flexShrink: 0,
              minHeight: { xs: 44, md: 40 },
              alignSelf: { xs: 'stretch', sm: 'flex-start' },
              textTransform: 'none',
            }}
          >
            {area.primaryAction.label}
          </Button>
        )}
      </Stack>
      <Box component="nav" aria-label={'Các công việc: ' + area.title} sx={{ minWidth: 0 }}>
        {!featured && <FinanceTaskLink task={area.primaryAction} />}
        {area.tasks.map((task) => (
          <FinanceTaskLink task={task} key={task.to} />
        ))}
      </Box>
    </Paper>
  );
}

export default function FinanceHomePage() {
  const [billing, collections, results] = workAreas;
  return (
    <>
      <PageHeader
        title="Tài chính & Hóa đơn"
        subtitle="Bắt đầu theo quy trình thường dùng, hoặc mở trực tiếp công việc bạn đang cần."
      />
      <Paper
        component="section"
        aria-labelledby="finance-workflow-title"
        variant="outlined"
        sx={{ p: { xs: 1.75, md: 2.25 }, mb: 2, borderRadius: 2 }}
      >
        <Typography
          component="h2"
          id="finance-workflow-title"
          variant="subtitle2"
          sx={{ fontWeight: 750, mb: 2 }}
        >
          Quy trình thu tiền thường gặp
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
            gap: { xs: 1.5, lg: 2 },
          }}
        >
          {workflow.map((step, i) => (
            <Stack direction="row" key={step.label} sx={{ gap: 1.25, alignItems: 'flex-start' }}>
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  color: 'primary.main',
                  bgcolor: 'primary.light',
                  fontWeight: 750,
                  flexShrink: 0,
                }}
                aria-label={'Giai đoạn ' + (i + 1)}
              >
                {i + 1}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.45 }}>
                  {step.label}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.25 }}
                >
                  {step.description}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      </Paper>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.35fr) minmax(0, 1fr)' },
          alignItems: 'start',
          gap: 2,
        }}
      >
        <FinanceArea area={billing!} featured />
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <FinanceArea area={collections!} />
          <FinanceArea area={results!} />
        </Stack>
      </Box>
    </>
  );
}
