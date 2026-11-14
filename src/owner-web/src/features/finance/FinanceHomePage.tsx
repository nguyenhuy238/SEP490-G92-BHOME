import { useState } from 'react';
import { Box, Button, Chip, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  ArrowRight,
  BadgeCheck,
  BanknoteArrowDown,
  CalendarClock,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileClock,
  FilePenLine,
  FileText,
  Gauge,
  Lightbulb,
  ReceiptText,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/common/PortalUI';

type TaskLink = {
  title: string;
  description: string;
  action: string;
  to: string;
  icon: LucideIcon;
};

const billingSteps: TaskLink[] = [
  {
    title: 'Kiểm tra chỉ số điện nước',
    description: 'Xem nhiệm vụ ghi chỉ số và kết quả Staff đã xác nhận.',
    action: 'Xem chỉ số',
    to: '/meters',
    icon: Gauge,
  },
  {
    title: 'Kiểm tra lịch tự động',
    description: 'Xem lịch, kết quả chạy, bản nháp và trường hợp thiếu dữ liệu.',
    action: 'Xem lịch tự động',
    to: '/billing-automation',
    icon: CalendarClock,
  },
  {
    title: 'Chuẩn bị hóa đơn',
    description: 'Kiểm tra hóa đơn nháp và các khoản tiền trước khi phát hành.',
    action: 'Xem hóa đơn',
    to: '/invoices',
    icon: ReceiptText,
  },
  {
    title: 'Đối soát tiền nhận',
    description: 'Kiểm tra giao dịch ngân hàng, xác minh và phân bổ khoản thu.',
    action: 'Đến thanh toán',
    to: '/payments',
    icon: BanknoteArrowDown,
  },
];

const followUps: TaskLink[] = [
  {
    title: 'Theo dõi công nợ',
    description: 'Xem hóa đơn còn phải thu, đã trả một phần và khoản đến hạn.',
    action: 'Xem công nợ',
    to: '/debts',
    icon: Wallet,
  },
  {
    title: 'Duyệt yêu cầu điều chỉnh',
    description: 'Xem lý do, số tiền và bằng chứng trước khi quyết định.',
    action: 'Xem yêu cầu',
    to: '/invoice-adjustments',
    icon: FilePenLine,
  },
  {
    title: 'Kiểm tra giá & biểu phí',
    description: 'Xem chính sách tính tiền đang áp dụng cho các cơ sở.',
    action: 'Xem biểu phí',
    to: '/pricing',
    icon: SlidersHorizontal,
  },
];

const management: TaskLink[] = [
  {
    title: 'Ghi nhận đầu tư & chi phí',
    description: 'Ghi khoản chi thực tế và liên kết chứng từ khi cần.',
    action: 'Quản lý khoản chi',
    to: '/expenses',
    icon: FileText,
  },
  {
    title: 'Xem báo cáo kinh doanh',
    description: 'Đối chiếu tiền phải thu, đã thu, chi phí và hoàn vốn theo kỳ.',
    action: 'Mở báo cáo',
    to: '/reports',
    icon: ChartNoAxesCombined,
  },
  {
    title: 'Thử kịch bản What-if',
    description: 'Thay đổi giả định, xem kết quả dự kiến mà không sửa số liệu thực.',
    action: 'Phân tích kịch bản',
    to: '/what-if',
    icon: FileClock,
  },
];

function TaskCard({
  task,
  number,
  prominent = false,
}: {
  task: TaskLink;
  number?: number;
  prominent?: boolean;
}) {
  const Icon = task.icon;
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        height: '100%',
        borderRadius: 2.5,
        borderColor: prominent ? '#cfddff' : 'divider',
        bgcolor: prominent ? '#f8faff' : 'background.paper',
        transition: 'border-color .15s, box-shadow .15s',
        '&:hover': { borderColor: 'primary.main', boxShadow: '0 6px 22px rgba(37,93,222,.08)' },
        '&:focus-within': { borderColor: 'primary.main' },
      }}
    >
      <Stack spacing={1.5} sx={{ height: '100%' }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 42,
              height: 42,
              borderRadius: 2,
              bgcolor: prominent ? '#e7efff' : 'background.default',
              color: 'primary.main',
            }}
          >
            <Icon size={21} aria-hidden="true" />
          </Box>
          {number !== undefined && (
            <Chip size="small" variant="outlined" label={`Bước ${number}`} />
          )}
        </Stack>
        <Box sx={{ flex: 1 }}>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
            {task.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
            {task.description}
          </Typography>
        </Box>
        <Button
          component={Link}
          to={task.to}
          variant={prominent ? 'contained' : 'outlined'}
          fullWidth
          endIcon={<ArrowRight size={16} />}
          sx={{ justifyContent: 'space-between', minHeight: 42 }}
        >
          {task.action}
        </Button>
      </Stack>
    </Paper>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {description}
      </Typography>
    </Box>
  );
}

export default function FinanceHomePage() {
  const [activeArea, setActiveArea] = useState<'billing' | 'issues' | 'management'>('billing');
  return (
    <>
      <PageHeader
        group="KHÔNG GIAN LÀM VIỆC"
        title="Tài chính & Hóa đơn"
        subtitle="Bạn muốn thực hiện công việc nào? Chọn việc cần làm bên dưới thay vì tìm từng chức năng trong menu."
      />
      <Paper
        sx={{
          p: { xs: 2, md: 3 },
          mb: 3,
          border: '1px solid #dce6fb',
          borderRadius: 3,
          background: 'linear-gradient(115deg, #eaf1ff 0%, #f8fbff 70%)',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{ alignItems: { md: 'center' }, gap: 2 }}
        >
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.75 }}>
              <ClipboardCheck size={20} color="#255dde" aria-hidden="true" />
              <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                Bắt đầu từ công việc của bạn
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ lineHeight: 1.8, maxWidth: 760 }}>
              Trong một kỳ thu tiền, bạn thường kiểm tra chỉ số, chuẩn bị hóa đơn, theo dõi phát
              hành rồi đối soát thanh toán. Bạn có thể mở trực tiếp bất kỳ bước nào; hệ thống vẫn
              kiểm tra các điều kiện nghiệp vụ như trước.
            </Typography>
          </Box>
          <Button
            component={Link}
            to="/invoices"
            variant="contained"
            size="large"
            endIcon={<ArrowRight size={17} />}
          >
            Mở danh sách hóa đơn
          </Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 2, overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 2, md: 2.5 }, pb: 0 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>
            Hôm nay bạn cần làm gì?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
            Chọn một nhóm công việc. Bạn chỉ cần xem các thao tác liên quan đến việc đang làm.
          </Typography>
        </Box>
        <Tabs
          aria-label="Chọn nhóm công việc tài chính"
          value={activeArea}
          onChange={(_, next: 'billing' | 'issues' | 'management') => setActiveArea(next)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ px: { xs: 1, md: 1.5 }, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab
            id="finance-tab-billing"
            aria-controls="finance-panel-billing"
            value="billing"
            label="Lập hóa đơn & thu tiền"
          />
          <Tab
            id="finance-tab-issues"
            aria-controls="finance-panel-issues"
            value="issues"
            label="Xử lý phát sinh"
          />
          <Tab
            id="finance-tab-management"
            aria-controls="finance-panel-management"
            value="management"
            label="Quản lý & báo cáo"
          />
        </Tabs>
      </Paper>

      {activeArea === 'billing' && (
        <Box
          role="tabpanel"
          component="section"
          id="finance-panel-billing"
          aria-labelledby="finance-tab-billing"
          sx={{ mb: 4 }}
        >
          <SectionHeader
            title="Chu kỳ hóa đơn"
            description="Các bước thường làm theo thứ tự; đây là hướng dẫn điều hướng, không phải trạng thái xử lý tự động."
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(4, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {billingSteps.map((step, index) => (
              <TaskCard task={step} number={index + 1} prominent={index === 2} key={step.to} />
            ))}
          </Box>
        </Box>
      )}

      {activeArea === 'issues' && (
        <Box
          role="tabpanel"
          component="section"
          id="finance-panel-issues"
          aria-labelledby="finance-tab-issues"
          sx={{ mb: 4 }}
        >
          <SectionHeader
            title="Có vấn đề cần xử lý?"
            description="Chuyển thẳng đến đúng nơi khi cần xử lý công nợ, điều chỉnh hoặc kiểm tra chính sách phí."
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {followUps.map((task) => (
              <TaskCard task={task} key={task.to} />
            ))}
          </Box>
        </Box>
      )}

      {activeArea === 'management' && (
        <Box
          role="tabpanel"
          component="section"
          id="finance-panel-management"
          aria-labelledby="finance-tab-management"
          sx={{ mb: 3 }}
        >
          <SectionHeader
            title="Theo dõi kết quả kinh doanh"
            description="Ghi nhận khoản chi và xem số liệu thực tế; phân tích What-if là dự báo riêng, không ghi đè dữ liệu."
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {management.map((task) => (
              <TaskCard task={task} key={task.to} />
            ))}
          </Box>
        </Box>
      )}

      <Stack
        direction="row"
        sx={{ alignItems: 'flex-start', gap: 1, p: 2, bgcolor: '#fff', borderRadius: 2 }}
      >
        <Lightbulb size={18} color="#cb8b16" aria-hidden="true" />
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Khi chưa chắc nên bắt đầu ở đâu
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cần lập và phát hành tiền phòng: mở <strong>Hóa đơn</strong>. Đã nhận chuyển khoản: mở{' '}
            <strong>Thanh toán / Đối soát</strong>. Muốn biết ai còn nợ: mở <strong>Công nợ</strong>
            . Các quyết định tài chính vẫn được kiểm tra và xác nhận ở màn hình tương ứng.
          </Typography>
        </Box>
        <BadgeCheck size={17} color="#159a60" aria-hidden="true" />
      </Stack>
    </>
  );
}
