import { LinearProgress, Stack, Typography } from '@mui/material';
import { ChartCard } from '../../components/common/PortalUI';
import {
  formatFinanceMoney,
  type FinanceTotals,
} from '../../../../../packages/client-core/src/finance';

// Only the bounded bar width becomes a Number. Amount labels keep their exact server strings.
export function FinancialAmountChart({ totals }: { totals: FinanceTotals }) {
  const rows = [
    ['Doanh thu phát hành', totals.issued],
    ['Thu đã xác minh', totals.verifiedCollections],
    ['Chi phí vận hành', totals.operatingExpenses],
    ['Nợ hiện tại trong kỳ', totals.outstandingNow],
  ].map(([label, amount]) => ({ label: label!, amount: amount! }));
  if (rows.some((r) => !/^\d+(?:\.0{1,4})?$/.test(r.amount))) return null;
  const values = rows.map((r) => BigInt(r.amount.split('.')[0]!));
  const max = values.reduce((a, b) => (a > b ? a : b), 0n);
  return (
    <ChartCard
      title="Quy mô các chỉ tiêu"
      subtitle="Theo dữ liệu máy chủ; nợ phản ánh thời điểm tải, thu và chi theo kỳ đã chọn."
    >
      <Stack spacing={2}>
        {rows.map((r, i) => (
          <Stack key={r.label} spacing={0.75}>
            <Typography variant="body2">
              {r.label}: {formatFinanceMoney(r.amount)}
            </Typography>
            <LinearProgress
              aria-label={r.label}
              variant="determinate"
              value={max === 0n ? 0 : Number((values[i]! * 10000n) / max) / 100}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Stack>
        ))}
      </Stack>
    </ChartCard>
  );
}
