import { LinearProgress, Stack, Typography } from '@mui/material';
import { ChartCard } from '../../components/common/PortalUI';
import {
  formatFinanceMoney,
  type FinanceTotals,
} from '../../../../../packages/client-core/src/finance';

// Only the bounded bar width becomes a Number. Amount labels keep their exact server strings.
export function FinancialAmountChart({ totals }: { totals: FinanceTotals }) {
  const management = totals.management;
  const rows = (
    management
      ? [
          ['Doanh thu trong kỳ', management.revenue],
          ['Tiền kinh doanh thực thu', management.actualBusinessCollections],
          ['Chi phí vận hành đã chi xác nhận', management.operatingPaymentsConfirmed],
          ['Công nợ hiện tại', management.currentOutstanding],
        ]
      : [
          ['Doanh thu phát hành', totals.issued],
          ['Tiền phân bổ xác minh (dữ liệu cũ)', totals.verifiedCollections],
          ['Chi phí vận hành đã ghi nhận', totals.operatingExpenses],
          ['Nợ hiện tại trong kỳ', totals.outstandingNow],
        ]
  ).map(([label, amount]) => ({ label: label!, amount }));
  const values = rows.map((r) =>
    r.amount != null && /^\d+(?:\.0{1,4})?$/.test(r.amount)
      ? BigInt(r.amount.split('.')[0]!)
      : null,
  );
  const max = values.reduce<bigint>((a, b) => (b != null && b > a ? b : a), 0n);
  return (
    <ChartCard
      title="Quy mô các chỉ tiêu"
      subtitle="Theo dữ liệu máy chủ; nợ phản ánh thời điểm tải, thu và chi theo kỳ đã chọn."
    >
      <Stack spacing={2}>
        {rows.map((r, i) => (
          <Stack key={r.label} spacing={0.75}>
            <Typography variant="body2">
              {r.label}: {r.amount == null ? 'Chưa xác định' : formatFinanceMoney(r.amount)}
            </Typography>
            {values[i] != null && (
              <LinearProgress
                aria-label={r.label}
                variant="determinate"
                value={max === 0n ? 0 : Number((values[i]! * 10000n) / max) / 100}
                sx={{ height: 8, borderRadius: 1 }}
              />
            )}
          </Stack>
        ))}
      </Stack>
    </ChartCard>
  );
}
