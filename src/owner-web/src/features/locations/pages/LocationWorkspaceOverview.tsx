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
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  DoorOpen,
  CalendarClock,
  Wallet,
  Receipt,
} from 'lucide-react';
import {
  formatFinanceMoney,
  type FinancialReport,
} from '../../../../../../packages/client-core/src/finance';

import { RoomOccupancyDistribution } from '../../../components/common/RoomOccupancyDistribution';

export type LocationOverviewSummary = {
  rooms?: number;
  available?: number;
  occupied?: number;
  onHold?: number;
  unavailable?: number;
  openIncidents?: number;
  asOf?: string;
};

const number = (value?: number) => (value == null ? '—' : value.toLocaleString('vi-VN'));
const dateLabel = (date: string) => date.split('-').reverse().join('/');
const money = (value?: string) => (typeof value === 'string' ? formatFinanceMoney(value) : '—');

type Finance = {
  data?: FinancialReport;
  loading: boolean;
  error?: string;
  retry: () => void;
  from: string;
  to: string;
};

export function LocationWorkspaceOverview({
  id,
  summary,
  active,
  loading,
  owner,
  finance,
}: {
  id: string;
  summary?: LocationOverviewSummary;
  active: boolean;
  loading: boolean;
  owner: boolean;
  finance?: Finance;
}) {
  const roomPath = `/locations/${id}/rooms`;
  const metrics = [
    {
      label: 'Đã thu (đã xác minh)',
      value: money(finance?.data?.total.verifiedCollections),
      icon: Wallet,
    },
    {
      label: 'Công nợ hiện tại',
      value: money(finance?.data?.total.outstandingNow),
      detail: 'Hóa đơn thuộc kỳ báo cáo',
      icon: Receipt,
    },
    {
      label: 'Chi phí vận hành trong kỳ',
      value: money(finance?.data?.total.operatingExpenses),
      icon: Wallet,
    },
  ];
  const followups = [
    {
      title: 'Phòng đang giữ chỗ',
      count: summary?.onHold,
      quietLabel: 'Không có phòng giữ chỗ',
      icon: CalendarClock,
      to: `${roomPath}?roomStatus=1`,
      action: 'Xem giữ chỗ',
    },
    {
      title: 'Sự cố đang mở',
      count: summary?.openIncidents,
      quietLabel: 'Không có sự cố đang mở',
      icon: CircleAlert,
      to: owner ? `/incidents?locationId=${encodeURIComponent(id)}` : undefined,
      action: 'Xem sự cố',
    },
    {
      title: 'Phòng không khai thác',
      count: summary?.unavailable,
      quietLabel: 'Không có phòng ngừng khai thác',
      icon: DoorOpen,
      to: `${roomPath}?roomStatus=3`,
      action: 'Xem phòng',
    },
  ];
  // Keep known zero states quiet, and never present missing data as a healthy state.
  const sortedFollowups = followups
    .filter((item) => item.count !== 0)
    .sort((a, b) => Number((b.count ?? 0) > 0) - Number((a.count ?? 0) > 0));
  const quietFollowups = followups.filter((item) => item.count === 0);
  return (
    <Stack spacing={2} aria-busy={loading}>
      {owner && finance && (
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
          >
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={{ xs: 0.25, lg: 1.5 }}
              sx={{ alignItems: { lg: 'baseline' }, minWidth: 0 }}
            >
              <Typography component="h2" variant="h2">
                Tình hình kinh doanh
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Kỳ báo cáo: {dateLabel(finance.from)} – {dateLabel(finance.to)}
              </Typography>
            </Stack>
            <Button
              component={Link}
              to={`/locations/${id}/investment`}
              endIcon={<ArrowRight size={17} />}
            >
              Vốn & chi phí
            </Button>
          </Stack>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            {finance.loading && <LinearProgress aria-label="Đang tải số liệu tài chính" />}
            {finance.error && (
              <Alert severity="warning" action={<Button onClick={finance.retry}>Thử lại</Button>}>
                {finance.error}
              </Alert>
            )}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(3,minmax(0,1fr))' },
              }}
            >
              {metrics.map(({ label, value, detail, icon: Icon }, i) => (
                <Box
                  key={label}
                  sx={{
                    p: 1.5,
                    minWidth: 0,
                    borderColor: 'divider',
                    borderBottom: { xs: i < metrics.length - 1 ? 1 : 0, sm: 0 },
                    borderRight: { xs: 0, sm: i < metrics.length - 1 ? 1 : 0 },
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                      {label}
                    </Typography>
                    <Box sx={{ color: 'text.secondary', flexShrink: 0, display: 'flex' }}>
                      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                    </Box>
                  </Stack>
                  <Typography
                    sx={{
                      fontSize: { xs: '1.35rem', md: '1.625rem' },
                      lineHeight: 1.25,
                      fontWeight: 750,
                      letterSpacing: '-0.025em',
                      fontVariantNumeric: 'tabular-nums',
                      overflowWrap: 'anywhere',
                      mt: 0.5,
                    }}
                  >
                    {value}
                  </Typography>
                  {detail && (
                    <Typography variant="caption" color="text.secondary">
                      {detail}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Paper>
        </Stack>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) minmax(0,1fr)' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
          >
            <Box>
              <Typography component="h2" variant="h2">
                Tình trạng phòng
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary?.asOf ? `Ngày ${dateLabel(summary.asOf)}` : 'Trạng thái hiện tại'}
              </Typography>
            </Box>
            <Button
              component={Link}
              to={roomPath}
              endIcon={<ArrowRight size={16} />}
              sx={{ flexShrink: 0 }}
            >
              Xem tất cả
            </Button>
          </Stack>
          <RoomOccupancyDistribution counts={summary} roomPath={roomPath} loading={loading} />
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <Typography component="h2" variant="h2">
            {active ? 'Công việc cần theo dõi' : 'Chuẩn bị vận hành'}
          </Typography>
          {!active && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Kiểm tra điều kiện trước khi mở lại cơ sở.
            </Typography>
          )}
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {sortedFollowups.map(({ title, count, icon: Icon, to, action }) => {
              const hasItems = count != null && count > 0;
              return (
                <Stack
                  key={title}
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: 'center',
                    minWidth: 0,
                    p: 1,
                    borderRadius: 1.5,
                    bgcolor: hasItems ? 'background.default' : 'transparent',
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 28,
                      height: 28,
                      flexShrink: 0,
                      borderRadius: '10px',
                      bgcolor: hasItems ? '#fff4df' : 'background.default',
                      color: hasItems ? 'warning.dark' : 'text.secondary',
                    }}
                  >
                    <Icon size={16} />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
                    {count == null && (
                      <Typography variant="body2" color="text.secondary">
                        Chưa có số liệu
                      </Typography>
                    )}
                  </Box>
                  {count != null && (
                    <Typography
                      sx={{
                        fontWeight: 750,
                        fontSize: 20,
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >
                      {number(count)}
                    </Typography>
                  )}
                  {to && (
                    <Button
                      component={Link}
                      to={to}
                      size="small"
                      aria-label={action}
                      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {action}
                    </Button>
                  )}
                </Stack>
              );
            })}
          </Stack>
          {quietFollowups.length > 0 && (
            <Stack divider={<Divider />} spacing={0} sx={{ mt: sortedFollowups.length ? 1 : 0 }}>
              {quietFollowups.map(({ quietLabel, to, action }) => (
                <Stack
                  key={quietLabel}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', minWidth: 0, py: 0.25 }}
                >
                  <Box sx={{ color: 'success.dark', display: 'flex', flexShrink: 0 }}>
                    <CircleCheck size={16} aria-hidden="true" />
                  </Box>
                  {to ? (
                    <Typography
                      component={Link}
                      to={to}
                      variant="body2"
                      aria-label={`${quietLabel} · ${action}`}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        minHeight: { xs: 44, sm: 28 },
                        color: 'text.secondary',
                        textDecoration: 'none',
                        textUnderlineOffset: 3,
                        '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                        '@media (pointer:coarse)': { minHeight: 44 },
                      }}
                    >
                      {quietLabel}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {quietLabel}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
