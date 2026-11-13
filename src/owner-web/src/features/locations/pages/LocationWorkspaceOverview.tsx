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
import { Link } from 'react-router';
import { ArrowRight, DoorOpen, Package, Coins, ScrollText, CircleAlert } from 'lucide-react';
import type { LocationMetadata } from '../../../../../../packages/client-core/src/locationSetup';
import {
  formatFinanceMoney,
  type FinancialReport,
} from '../../../../../../packages/client-core/src/finance';

export type LocationOverviewSummary = {
  rooms?: number;
  assets?: number;
  pricesAndFees?: number;
  rules?: number;
  assetTemplates?: number;
  available?: number;
  occupied?: number;
  onHold?: number;
  unavailable?: number;
  openIncidents?: number;
  asOf?: string;
  incomplete?: boolean;
};

const states = [
  { key: 'occupied', title: 'Đang cho thuê', color: '#255dde' },
  { key: 'available', title: 'Phòng trống', color: '#18764a' },
  { key: 'onHold', title: 'Đang giữ chỗ', color: '#a6650c' },
  { key: 'unavailable', title: 'Không khai thác', color: '#64748b' },
] as const;

const number = (value?: number) => (value == null ? '—' : value.toLocaleString('vi-VN'));

export function LocationWorkspaceOverview({
  id,
  summary,
  active,
  loading,
  owner,
  metadata,
  finance,
}: {
  id: string;
  summary?: LocationOverviewSummary;
  active: boolean;
  loading: boolean;
  owner: boolean;
  metadata?: LocationMetadata;
  finance?: {
    data?: FinancialReport;
    loading: boolean;
    error?: string;
    retry: () => void;
    from: string;
    to: string;
  };
}) {
  const statusTotal = states.every(({ key }) => summary?.[key] != null)
    ? states.reduce((sum, { key }) => sum + (summary?.[key] ?? 0), 0)
    : undefined;
  const consistent = summary?.rooms != null && statusTotal === summary.rooms;
  const occupancy =
    consistent && summary.rooms! > 0
      ? Math.round((summary.occupied! / summary.rooms!) * 1000) / 10
      : undefined;
  const sections = [
    {
      path: 'rooms',
      title: 'Phòng cho thuê',
      count: summary?.rooms,
      icon: DoorOpen,
      description: 'Phòng thực tế và cấu hình loại phòng.',
    },
    {
      path: 'assets',
      title: 'Tài sản & trang thiết bị',
      count: summary?.assets,
      icon: Package,
      description:
        summary?.assetTemplates == null
          ? 'Tài sản thực tế; định mức và kiểm kê.'
          : `${number(summary.assetTemplates)} bộ định mức · tài sản thực tế`,
    },
    {
      path: 'pricing',
      title: 'Giá thuê & biểu phí',
      count: summary?.pricesAndFees,
      icon: Coins,
      description: 'Số bản ghi giá/phí, bao gồm lịch sử hiệu lực.',
    },
    ...(owner
      ? [
          {
            path: 'rules',
            title: 'Nội quy',
            count: summary?.rules,
            icon: ScrollText,
            description: 'Tài liệu và phiên bản nội quy.',
          },
        ]
      : []),
  ];
  const missing = sections.filter((section) => section.count === 0);
  return (
    <Stack spacing={3} aria-busy={loading}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography component="h2" variant="h2">
            Tình hình khai thác
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Trạng thái phòng tại cơ sở hiện tại
            {summary?.asOf ? ` · ${summary.asOf.split('-').reverse().join('/')}` : ''}.
          </Typography>
        </Box>
        <Button
          component={Link}
          to={`/locations/${id}/rooms`}
          variant="contained"
          endIcon={<ArrowRight size={17} />}
        >
          Quản lý phòng
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading && <LinearProgress aria-label="Đang tải số liệu cơ sở" />}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, minmax(0, 1fr))' },
          }}
        >
          {[
            { title: 'Tổng số phòng', value: summary?.rooms },
            ...states.map(({ key, title }) => ({ title, value: summary?.[key] })),
          ].map(({ title, value }, i) => (
            <Box
              key={title}
              sx={{
                px: { xs: 2, md: 2.5 },
                py: 2.5,
                borderStyle: 'solid',
                borderWidth: 0,
                gridColumn: { xs: i === 0 ? '1 / -1' : 'auto', md: 'auto' },
                borderRightWidth: { xs: i === 1 || i === 3 ? 1 : 0, md: i < 4 ? 1 : 0 },
                borderBottomWidth: { xs: i < 3 ? 1 : 0, md: 0 },
                borderColor: 'divider',
                minWidth: 0,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {title}
              </Typography>
              <Typography
                sx={{
                  fontSize: '1.85rem',
                  fontWeight: 750,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.4,
                  mt: 0.5,
                }}
              >
                {number(value)}
              </Typography>
            </Box>
          ))}
        </Box>
        <Divider />
        <Box sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}
          >
            <Typography sx={{ fontWeight: 700 }}>Phân bố trạng thái phòng</Typography>
            <Typography variant="body2" color="text.secondary">
              {occupancy == null
                ? summary?.rooms === 0
                  ? 'Chưa có phòng'
                  : 'Chưa đủ số liệu'
                : `${occupancy.toLocaleString('vi-VN')}% đang cho thuê`}
            </Typography>
          </Stack>
          {consistent && summary.rooms! > 0 && (
            <Box
              role="img"
              aria-label={states.map((s) => `${s.title}: ${number(summary[s.key])}`).join(', ')}
              sx={{
                display: 'flex',
                gap: '3px',
                height: 12,
                borderRadius: 1,
                overflow: 'hidden',
                my: 2,
              }}
            >
              {states
                .filter((s) => summary[s.key]! > 0)
                .map((s) => (
                  <Box key={s.key} sx={{ flex: summary[s.key], bgcolor: s.color }} />
                ))}
            </Box>
          )}
          {!consistent && !loading && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Chưa thể tính tỷ lệ từ số liệu hiện có. Hãy tải lại nếu các trạng thái vừa thay đổi.
            </Typography>
          )}
          <Stack direction="row" useFlexGap spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
            {states.map(({ key, title, color }) => (
              <Stack key={key} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: color }} />
                <Typography variant="caption" color="text.secondary">
                  {title}: {number(summary?.[key])}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            Tỷ lệ đang cho thuê tính trên tổng số phòng, không phải số người đang có mặt.
          </Typography>
        </Box>
      </Paper>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.3fr) minmax(0, 1fr)' },
          gap: 2.5,
          alignItems: 'start',
        }}
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography component="h2" variant="h2">
            {active ? 'Cần theo dõi' : 'Chuẩn bị vận hành'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            {active
              ? 'Các trạng thái cần xem xét, không phải kết luận phòng chưa đủ điều kiện.'
              : 'Kiểm tra cấu hình và điều kiện khai thác trước khi mở lại cơ sở.'}
          </Typography>
          <Stack divider={<Divider />} spacing={1.5}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircleAlert size={20} aria-hidden="true" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 650 }}>Sự cố đang mở</Typography>
                <Typography variant="body2" color="text.secondary">
                  {summary?.openIncidents == null
                    ? 'Chưa tải được số liệu'
                    : `${number(summary.openIncidents)} sự cố chờ hoặc đang xử lý`}
                </Typography>
              </Box>
              {owner && (
                <Button component={Link} to={`/incidents?locationId=${encodeURIComponent(id)}`}>
                  Xem sự cố
                </Button>
              )}
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircleAlert size={20} aria-hidden="true" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 650 }}>Phòng không khai thác</Typography>
                <Typography variant="body2" color="text.secondary">
                  {summary?.unavailable == null
                    ? 'Chưa có số liệu'
                    : `${number(summary.unavailable)} phòng · xem trạng thái chi tiết tại phòng`}
                </Typography>
              </Box>
              <Button component={Link} to={`/locations/${id}/rooms`}>
                Xem phòng
              </Button>
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Package size={20} aria-hidden="true" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 650 }}>Định mức và kiểm kê</Typography>
                <Typography variant="body2" color="text.secondary">
                  So sánh trang bị yêu cầu với tài sản đã xác nhận.
                </Typography>
              </Box>
              <Button component={Link} to={`/locations/${id}/assets`}>
                Kiểm tra
              </Button>
            </Stack>
            {owner && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Coins size={20} aria-hidden="true" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 650 }}>Giá và lịch hóa đơn</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Kiểm tra ngày hiệu lực và quy tắc thu tiền.
                  </Typography>
                </Box>
                <Button component={Link} to={`/locations/${id}/pricing`}>
                  Xem giá
                </Button>
              </Stack>
            )}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography component="h2" variant="h2">
            Dữ liệu cấu hình
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            Số bản ghi để tra cứu, không phải chỉ số sẵn sàng.
          </Typography>
          <Stack divider={<Divider />} spacing={1.5}>
            {sections.map(({ path, title, count, description, icon: Icon }) => (
              <Stack key={path} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Box sx={{ color: 'text.secondary', display: 'flex' }}>
                  <Icon size={19} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {description}
                  </Typography>
                </Box>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {number(count)}
                </Typography>
                <Button
                  component={Link}
                  to={`/locations/${id}/${path}`}
                  size="small"
                  aria-label={`Xem ${title.toLowerCase()}`}
                >
                  Xem
                </Button>
              </Stack>
            ))}
          </Stack>
          {!active && missing.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Một số mục chưa có bản ghi. Không phải mọi mục đều bắt buộc.
            </Typography>
          )}
        </Paper>
      </Box>
      {owner && finance && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 2 }}
          >
            <Box>
              <Typography component="h2" variant="h2">
                Tài chính trong kỳ
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Từ {finance.from.split('-').reverse().join('/')} đến{' '}
                {finance.to.split('-').reverse().join('/')}
              </Typography>
            </Box>
            <Button
              component={Link}
              to={`/locations/${id}/investment`}
              endIcon={<ArrowRight size={16} />}
            >
              Xem vốn & chi phí
            </Button>
          </Stack>
          {finance.loading && <LinearProgress aria-label="Đang tải tài chính cơ sở" />}
          {finance.error && (
            <Alert severity="warning" action={<Button onClick={finance.retry}>Thử lại</Button>}>
              {finance.error}
            </Alert>
          )}
          {finance.data && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              {[
                {
                  label: 'Đã thu (đã xác minh)',
                  value: finance.data.total.verifiedCollections,
                  detail: 'Khoản thu đã xác minh, được ghi nhận trong kỳ.',
                },
                {
                  label: 'Công nợ hiện tại',
                  value: finance.data.total.outstandingNow,
                  detail: 'Số dư hiện tại của hóa đơn thuộc kỳ.',
                },
                {
                  label: 'Chi phí vận hành',
                  value: finance.data.total.operatingExpenses,
                  detail: 'Khoản chi vận hành đã ghi nhận trong kỳ.',
                },
              ].map((metric) => (
                <Box
                  key={metric.label}
                  sx={{ minWidth: 0, borderTop: 1, borderColor: 'divider', pt: 1.5 }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {metric.label}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '1.25rem',
                      fontWeight: 750,
                      fontVariantNumeric: 'tabular-nums',
                      overflowWrap: 'anywhere',
                      my: 0.5,
                    }}
                  >
                    {typeof metric.value === 'string' ? formatFinanceMoney(metric.value) : '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {metric.detail}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}
      {owner && metadata && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" variant="h2">
                Thông tin thiết lập đã lưu
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere', mt: 0.5 }}
              >
                Email quản lý: {metadata.contactEmail || 'Chưa cập nhật'}
              </Typography>
              {metadata.description && (
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 1 }}
                >
                  {metadata.description}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                Thiết lập đã lưu không đồng nghĩa với mọi phòng đã đủ điều kiện nhận khách.
              </Typography>
            </Box>
            <Button component={Link} to={`/locations/${id}/settings`}>
              Xem thiết lập
            </Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
