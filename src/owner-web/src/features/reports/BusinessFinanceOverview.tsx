import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import type { FinanceTotals } from '../../../../../packages/client-core/src/finance';
import { managementMoney } from '../finance/managementMoney';

export function BusinessFinanceOverview({ totals }: { totals: FinanceTotals }) {
  const value = totals.management;
  if (!value) return null;
  return (
    <Stack component="section" aria-label="Tóm tắt kinh doanh" spacing={1.5}>
      <Paper
        component="dl"
        variant="outlined"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(3,minmax(0,1fr))' },
          overflow: 'hidden',
        }}
      >
        {[
          ['Doanh thu', value.revenue],
          ['Chi phí vận hành', totals.operatingExpenses],
          ['Lợi nhuận vận hành', totals.operatingProfit],
        ].map(([label, amount]) => (
          <Box
            key={label}
            sx={{
              p: 2,
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography component="dt" variant="body2">
              {label}
            </Typography>
            <Typography
              component="dd"
              sx={{
                m: 0,
                fontSize: { xs: 20, md: 24 },
                fontWeight: 750,
                fontVariantNumeric: 'tabular-nums',
                overflowWrap: 'anywhere',
                maxWidth: '100%',
              }}
            >
              {managementMoney(amount)}
            </Typography>
          </Box>
        ))}
      </Paper>
      <Typography variant="body2" color="text.secondary">
        Lợi nhuận = doanh thu − chi phí vận hành, trước khấu hao.
      </Typography>
      <Box component="dl" sx={{ m: 0, display: 'flex', flexWrap: 'wrap', columnGap: 3, rowGap: 1 }}>
        {[
          ['Thực thu kinh doanh', value.actualBusinessCollections],
          ['Đã chi vận hành', value.operatingPaymentsConfirmed],
          ['Còn phải thu', value.currentOutstanding],
        ].map(([label, amount]) => (
          <Stack
            key={label}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}
          >
            <Typography component="dt" variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              sx={{
                m: 0,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                overflowWrap: 'anywhere',
              }}
            >
              {managementMoney(amount)}
            </Typography>
          </Stack>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Tiền cọc theo dõi riêng, không tính vào doanh thu.
      </Typography>
      {value.cashFlowUnavailableReason && (
        <Alert severity="warning">
          {value.cashFlowUnavailableReason === 'refund_classification_required'
            ? 'Dòng tiền chưa xác định: còn khoản hoàn tiền cần phân loại.'
            : value.cashFlowUnavailableReason === 'expense_payment_history_required'
              ? 'Dòng tiền chưa xác định: thiếu lịch sử xác nhận chi tiền.'
              : 'Chưa đủ dữ liệu xác định dòng tiền.'}
        </Alert>
      )}
    </Stack>
  );
}
