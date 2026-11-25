import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import type { FinanceManagementTotals } from '../../../../../packages/client-core/src/finance';
import { managementMoney } from '../finance/managementMoney';

const percentage = (value: string | null | undefined) =>
  value == null ? 'Chưa xác định' : `${value}%`;

export function ManagementFinanceSummary({
  value,
  compact = false,
}: {
  value?: FinanceManagementTotals | null;
  compact?: boolean;
}) {
  if (!value)
    return (
      <Alert severity="info">
        Máy chủ chưa cung cấp chỉ tiêu quản trị mới cho phạm vi này. Không thể suy ra tiền thực thu,
        thực chi hoặc dòng tiền từ các chỉ tiêu đối chiếu cũ.
      </Alert>
    );
  const groups = [
    {
      title: 'Doanh thu & thu tiền',
      metrics: [
        ['Doanh thu trong kỳ', managementMoney(value.revenue)],
        ['Tiền kinh doanh thực thu', managementMoney(value.actualBusinessCollections)],
        ['Công nợ hiện tại', managementMoney(value.currentOutstanding)],
        ['Chưa thu của kỳ', managementMoney(value.periodOutstanding)],
        ['Nợ hóa đơn quá hạn', managementMoney(value.overdueInvoiceOutstanding)],
        ['Thu các kỳ trước', managementMoney(value.priorPeriodCollections)],
        ['Tiền thuê và phí ban đầu', managementMoney(value.initialRentAndFeeCollections)],
        ['Tiền thu trước', managementMoney(value.advanceCollections)],
        ['Tỷ lệ thu tiền', percentage(value.collectionRatePercent)],
      ],
    },
    {
      title: 'Chi phí & lợi nhuận',
      metrics: [
        ['Chi phí vận hành đã chi xác nhận', managementMoney(value.operatingPaymentsConfirmed)],
        ['Chi phí vận hành xác nhận chưa chi', managementMoney(value.operatingUnpaidConfirmed)],
        ['Chi phí chưa rõ tình trạng chi', managementMoney(value.operatingUnknownPaymentAmount)],
        ['Biên lợi nhuận vận hành', percentage(value.operatingMarginPercent)],
        ['Khấu hao', managementMoney(value.depreciation)],
        ['Lợi nhuận sau khấu hao', managementMoney(value.profitAfterDepreciation)],
      ],
    },
    {
      title: 'Dòng tiền & đầu tư',
      metrics: [
        ['Dòng tiền vận hành', managementMoney(value.operatingCashFlow)],
        ['Tiền cọc nhận trong kỳ', managementMoney(value.depositReceipts)],
        ['Tiền đầu tư đã chi xác nhận', managementMoney(value.investmentPaymentsConfirmed)],
        ['Thực thu thanh lý tài sản', managementMoney(value.assetDisposalReceipts)],
        ['Dòng tiền sau đầu tư', managementMoney(value.netCashAfterInvestment)],
        ['Đầu tư phát sinh trong kỳ', managementMoney(value.investmentInPeriod)],
        ['Dòng tiền vận hành lũy kế', managementMoney(value.cumulativeOperatingCashFlow)],
      ],
    },
  ];
  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0,1fr)',
            lg: compact ? 'minmax(0,1fr)' : 'repeat(3,minmax(0,1fr))',
          },
          gap: 1.5,
        }}
      >
        {groups.map((group) => (
          <Paper key={group.title} variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
            <Typography variant="h3" sx={{ mb: 1 }}>
              {group.title}
            </Typography>
            <Stack spacing={1}>
              {group.metrics.map(([label, amount]) => (
                <Box
                  key={label}
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 0.5,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {amount}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        ))}
      </Box>
      {value.cashFlowUnavailableReason && (
        <Alert severity="info">
          {value.cashFlowUnavailableReason === 'refund_classification_required'
            ? 'Chưa xác định dòng tiền do còn khoản hoàn tiền chưa được phân loại.'
            : value.cashFlowUnavailableReason === 'expense_payment_history_required'
              ? 'Chưa xác định dòng tiền do còn thiếu lịch sử xác nhận chi tiền.'
              : 'Chưa đủ dữ liệu để xác định dòng tiền.'}
        </Alert>
      )}
      {!compact && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Chi phí theo danh mục
          </Typography>
          {value.expenseCategories?.length ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
                gap: 1,
              }}
            >
              {value.expenseCategories.map((item) => (
                <Box
                  key={item.category}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 0.5,
                    minWidth: 0,
                  }}
                >
                  <Typography sx={{ overflowWrap: 'anywhere' }}>{item.category}</Typography>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {managementMoney(item.amount)}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary">Chưa có phân loại chi phí từ máy chủ.</Typography>
          )}
        </Paper>
      )}
      <Typography variant="caption" color="text.secondary">
        Tiền thực thu, tiền cọc và chi phí đã chi được theo dõi riêng. Giá trị chưa xác định không
        được mặc định bằng 0.
      </Typography>
    </Stack>
  );
}
