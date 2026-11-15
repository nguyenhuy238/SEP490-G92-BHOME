import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { usePortal } from '../../app/PortalProvider';
import { usePortalData } from '../../hooks/usePortalData';

type DemoTask = 'meters' | 'payments' | 'debts';

/** Demo records are never presented as a live bank balance or published invoice. */
export function DemoFinanceTaskPanel({ kind }: { kind: DemoTask }) {
  const { data } = usePortalData();
  const portal = usePortal();
  if (!data) return null;

  const items = data.records[kind].filter(
    (item) => portal.locationId === 'all' || item.locationId === portal.locationId,
  );
  const open = items.filter((item) => {
    switch (kind) {
      case 'meters':
        return /Chờ|Đang/.test(item.status);
      case 'payments':
        return item.status === 'Chờ đối soát';
      case 'debts':
        return item.amount > item.paid;
    }
  }).length;
  const copy = {
    meters: {
      title: 'Nhiệm vụ ghi chỉ số chưa hoàn tất',
      next: '/billing-automation',
      nextText: 'Lịch hóa đơn',
    },
    payments: {
      title: 'Giao dịch chờ đối soát',
      next: '/debts',
      nextText: 'Xem công nợ',
    },
    debts: {
      title: 'Khoản còn phải thu',
      next: '/payments',
      nextText: 'Đối soát thanh toán',
    },
  }[kind];

  return (
    <Paper
      component="section"
      aria-label="Tóm tắt dữ liệu minh họa"
      variant="outlined"
      sx={{ mb: 2, px: { xs: 1.5, sm: 2 }, py: 1.25, borderRadius: 2 }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1.5, justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', minWidth: 0 }}>
          <Typography
            variant="h6"
            sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, minWidth: 26 }}
          >
            {open}
          </Typography>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {copy.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {items.length === 0
                ? 'Không có bản ghi ở cơ sở đã chọn.'
                : 'Chỉ tính trên dữ liệu demo của cơ sở đang chọn.'}
            </Typography>
          </Box>
        </Box>
        <Button
          component={RouterLink}
          to={copy.next}
          variant="text"
          size="small"
          sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, flexShrink: 0, minHeight: 40 }}
        >
          {copy.nextText}
        </Button>
      </Stack>
    </Paper>
  );
}
